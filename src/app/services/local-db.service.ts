import { Injectable } from '@angular/core';
import Dexie, { Table, liveQuery } from 'dexie';
import { BehaviorSubject, Observable, from } from 'rxjs';

export enum SyncStatus {
  PENDING = 0,
  SYNCED = 1
}

export interface LocalOrder {
  clientId: string;           // 客户端 UUID 主键
  serverId?: number;          // 服务端分配的自增 ID（同步后回填）
  orderNumber: string;        // 订单发票号 (如 INV-T108-20260929153000-01)
  customerId: number;
  customerName?: string;
  orderDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  termType?: string;
  paymentMethod?: string;
  remark?: string;
  sync_status: SyncStatus;    // 0=PENDING, 1=SYNCED
  sync_retry_count: number;   // 仅用于同步失败计数与上限控制
  last_sync_error?: string;   // 记录最后一次同步失败原因
  created_at: number;
  updated_at: number;
}

export interface LocalOrderItem {
  id?: number;                // 自增主键
  orderClientId: string;      // 外键关联 orders.clientId
  productId: number;
  productName?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  remark?: string;
}

export interface LocalPayment {
  id?: number;                // 自增主键
  orderClientId: string;      // 外键关联 orders.clientId
  customerId: number;
  amount: number;
  method: string;
  paymentDate: string;
}

export interface FullOrder extends LocalOrder {
  items: LocalOrderItem[];
  payments: LocalPayment[];
}

export class PosDexieDb extends Dexie {
  orders!: Table<LocalOrder, string>;
  order_items!: Table<LocalOrderItem, number>;
  payments!: Table<LocalPayment, number>;

  constructor() {
    super('TDMobilePOS_LocalDB');
    this.version(1).stores({
      orders: 'clientId, serverId, orderNumber, customerId, sync_status, created_at, updated_at',
      order_items: '++id, orderClientId, productId',
      payments: '++id, orderClientId, customerId'
    });
  }
}

@Injectable({
  providedIn: 'root'
})
export class LocalDbService {
  private db: PosDexieDb;

  // 对外暴露的 Observable 流，供页面及组件实时订阅
  public pendingCount$: Observable<number>;
  public pendingOrders$: Observable<FullOrder[]>;
  public allOrders$: Observable<FullOrder[]>;

  private manualRefreshTrigger = new BehaviorSubject<number>(0);

  constructor() {
    this.db = new PosDexieDb();

    // 采用 Dexie liveQuery 并通过 from() 转化为 Angular RxJS Observable
    this.pendingCount$ = from(
      liveQuery(async () => {
        return await this.db.orders
          .where('sync_status')
          .equals(SyncStatus.PENDING)
          .count();
      })
    );

    this.pendingOrders$ = from(
      liveQuery(async () => {
        return await this.getPendingOrders();
      })
    );

    this.allOrders$ = from(
      liveQuery(async () => {
        return await this.getAllOrders();
      })
    );
  }

  /**
   * 生成唯一 UUID (客户端主键)
   */
  public generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  /**
   * 插入订单（主体、商品明细、支付记录），必须在同一个原子事务中完成
   */
  public async insertOrderTransaction(
    orderData: Omit<LocalOrder, 'created_at' | 'updated_at' | 'sync_retry_count'> & { sync_retry_count?: number },
    itemsData: Omit<LocalOrderItem, 'id' | 'orderClientId'>[],
    paymentData?: Omit<LocalPayment, 'id' | 'orderClientId'>
  ): Promise<FullOrder> {
    const now = Date.now();

    const order: LocalOrder = {
      ...orderData,
      sync_retry_count: orderData.sync_retry_count || 0,
      created_at: now,
      updated_at: now
    };

    const items: LocalOrderItem[] = itemsData.map(item => ({
      ...item,
      orderClientId: order.clientId
    }));

    const payment: LocalPayment | undefined = paymentData ? {
      ...paymentData,
      orderClientId: order.clientId
    } : undefined;

    // Dexie 原生读写事务保证原子性：任一表失败整体回滚
    await this.db.transaction('rw', [this.db.orders, this.db.order_items, this.db.payments], async () => {
      await this.db.orders.put(order);

      if (items.length > 0) {
        await this.db.order_items.bulkAdd(items);
      }

      if (payment) {
        await this.db.payments.add(payment);
      }
    });

    this.notifyChange();

    return {
      ...order,
      items,
      payments: payment ? [payment] : []
    };
  }

  /**
   * 获取所有未同步 (PENDING) 的订单列表
   */
  public async getPendingOrders(): Promise<FullOrder[]> {
    const orders = await this.db.orders
      .where('sync_status')
      .equals(SyncStatus.PENDING)
      .sortBy('created_at');

    return await this.attachDetailsToOrders(orders);
  }

  /**
   * 获取所有订单（含 PENDING 与 SYNCED）
   */
  public async getAllOrders(): Promise<FullOrder[]> {
    const orders = await this.db.orders
      .orderBy('created_at')
      .reverse()
      .toArray();

    return await this.attachDetailsToOrders(orders);
  }

  /**
   * 根据 clientId 获取单个完整订单（含明细与支付）
   */
  public async getOrderByClientId(clientId: string): Promise<FullOrder | undefined> {
    const order = await this.db.orders.get(clientId);
    if (!order) return undefined;

    const items = await this.db.order_items.where('orderClientId').equals(clientId).toArray();
    const payments = await this.db.payments.where('orderClientId').equals(clientId).toArray();

    return {
      ...order,
      items,
      payments
    };
  }

  /**
   * 标记订单同步成功 (markAsSynced)
   */
  public async markAsSynced(clientId: string, serverId: number): Promise<void> {
    await this.db.orders.update(clientId, {
      serverId,
      sync_status: SyncStatus.SYNCED,
      last_sync_error: undefined,
      updated_at: Date.now()
    });
    this.notifyChange();
  }

  /**
   * 删除本地离线订单及其明细与支付记录
   */
  public async deleteOrderByClientId(clientId: string): Promise<void> {
    await this.db.transaction('rw', this.db.orders, this.db.order_items, this.db.payments, async () => {
      await this.db.orders.delete(clientId);
      await this.db.order_items.where('orderClientId').equals(clientId).delete();
      await this.db.payments.where('orderClientId').equals(clientId).delete();
    });
    this.notifyChange();
  }

  /**
   * 记录同步失败重试及错误原因
   */
  public async markSyncFailed(clientId: string, errorMessage: string): Promise<void> {
    const order = await this.db.orders.get(clientId);
    if (!order) return;

    await this.db.orders.update(clientId, {
      sync_status: SyncStatus.PENDING,
      sync_retry_count: (order.sync_retry_count || 0) + 1,
      last_sync_error: errorMessage,
      updated_at: Date.now()
    });
    this.notifyChange();
  }

  /**
   * 导入服务端已有的历史订单，默认全部标记为 SYNCED，严禁重复上传
   */
  public async importServerOrders(serverInvoices: any[]): Promise<void> {
    if (!Array.isArray(serverInvoices) || serverInvoices.length === 0) return;

    await this.db.transaction('rw', [this.db.orders, this.db.order_items], async () => {
      for (const inv of serverInvoices) {
        const clientId = inv.offlineReferenceId || `server_${inv.id}`;
        const existing = await this.db.orders.get(clientId);

        // 若本地已有且为待同步 (PENDING) 状态，保留本地优先，不被服务端旧记录覆盖
        if (existing && existing.sync_status === SyncStatus.PENDING) {
          continue;
        }

        const now = Date.now();
        const orderDateMs = inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : now;

        const order: LocalOrder = {
          clientId,
          serverId: inv.id,
          orderNumber: inv.invoiceNumber || inv.docNo || `INV-${inv.id}`,
          customerId: inv.customerId,
          customerName: inv.customerName,
          orderDate: inv.invoiceDate || new Date().toISOString(),
          totalAmount: inv.totalAmount || 0,
          paidAmount: inv.paidAmount || 0,
          balance: inv.balance ?? ((inv.totalAmount || 0) - (inv.paidAmount || 0)),
          termType: inv.termType,
          paymentMethod: inv.paymentMethod,
          remark: inv.remark,
          sync_status: SyncStatus.SYNCED, // 已有订单默认标记为 SYNCED
          sync_retry_count: 0,
          created_at: isNaN(orderDateMs) ? now : orderDateMs,
          updated_at: now
        };

        await this.db.orders.put(order);

        if (Array.isArray(inv.items) && inv.items.length > 0) {
          await this.db.order_items.where('orderClientId').equals(clientId).delete();
          const items: LocalOrderItem[] = inv.items.map((it: any) => ({
            orderClientId: clientId,
            productId: it.productId ?? it.ProductId ?? 0,
            productName: it.productName ?? it.ProductName ?? '',
            quantity: it.quantity ?? it.Quantity ?? 1,
            unitPrice: it.unitPrice ?? it.UnitPrice ?? 0,
            total: (it.unitPrice ?? it.UnitPrice ?? 0) * (it.quantity ?? it.Quantity ?? 1),
            remark: it.remark ?? it.Remark ?? ''
          }));
          await this.db.order_items.bulkAdd(items);
        }
      }
    });

    this.notifyChange();
  }

  /**
   * 删除本地订单及其明细
   */
  public async deleteOrder(clientId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.orders, this.db.order_items, this.db.payments], async () => {
      await this.db.orders.delete(clientId);
      await this.db.order_items.where('orderClientId').equals(clientId).delete();
      await this.db.payments.where('orderClientId').equals(clientId).delete();
    });
    this.notifyChange();
  }

  // --- 内部辅助函数 ---
  private async attachDetailsToOrders(orders: LocalOrder[]): Promise<FullOrder[]> {
    const result: FullOrder[] = [];
    for (const ord of orders) {
      const items = await this.db.order_items.where('orderClientId').equals(ord.clientId).toArray();
      const payments = await this.db.payments.where('orderClientId').equals(ord.clientId).toArray();
      result.push({
        ...ord,
        items,
        payments
      });
    }
    return result;
  }

  private notifyChange(): void {
    this.manualRefreshTrigger.next(Date.now());
  }
}
