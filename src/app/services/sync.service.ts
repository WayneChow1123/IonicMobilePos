import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, firstValueFrom } from 'rxjs';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { HttpErrorResponse } from '@angular/common/http';
import { LocalDbService, FullOrder, SyncStatus } from './local-db.service';
import { OfflineStorageService } from './offline-storage.service';
import { ApiService } from './api.service';

export interface SyncResult {
  successCount: number;
  failCount: number;
  totalProcessed: number;
  lastError?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  // 1. 并发互斥锁与状态机
  private isSyncing = false;
  private isSyncingSubject = new BehaviorSubject<boolean>(false);
  public isSyncing$: Observable<boolean> = this.isSyncingSubject.asObservable();

  // 认证失败事件（如 401 Token 过期），供界面订阅弹出重新登录
  private authErrorSubject = new Subject<string>();
  public authError$: Observable<string> = this.authErrorSubject.asObservable();

  // 同步完成事件
  private syncCompletedSubject = new Subject<SyncResult>();
  public syncCompleted$: Observable<SyncResult> = this.syncCompletedSubject.asObservable();

  // 指数退避参数（单位：毫秒）
  private backoffDelayMs = 2000;
  private readonly MAX_BACKOFF_DELAY_MS = 60000;
  private readonly MAX_RETRY_LIMIT = 5;

  constructor(
    private localDb: LocalDbService,
    private offlineStorage: OfflineStorageService,
    private api: ApiService
  ) {
    this.initTriggers();
  }

  /**
   * 初始化自动触发器：
   * 1. @capacitor/network 监听网络从无到有恢复
   * 2. @capacitor/app 监听 App 从后台切回前台
   * 3. 浏览器 window online 事件垫片
   */
  private initTriggers(): void {
    // 监听网络连接变化
    try {
      Network.addListener('networkStatusChange', (status: any) => {
        if (status.connected) {
          console.log('[SyncService] Network restored (Capacitor), triggering sync with forceRetry...');
          this.syncPendingOrders().catch(e => console.error('[SyncService] Network trigger error:', e));
        }
      });
    } catch (e) {
      console.warn('[SyncService] Capacitor Network listener unavailable, relying on window online:', e);
    }

    // 监听 App 从后台切回前台
    try {
      App.addListener('appStateChange', state => {
        if (state.isActive) {
          console.log('[SyncService] App resumed to foreground, triggering sync check...');
          this.syncPendingOrders().catch(e => console.error('[SyncService] AppState trigger error:', e));
        }
      });
    } catch (e) {
      console.warn('[SyncService] Capacitor App listener unavailable:', e);
    }

    // 浏览器 DOM online 事件兜底
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncService] Window online event fired, triggering sync...');
        this.syncPendingOrders().catch(e => console.error('[SyncService] Window online trigger error:', e));
      });
      window.addEventListener('focus', () => {
        this.syncPendingOrders().catch(e => console.error('[SyncService] Focus trigger error:', e));
      });
    }

    // 4. 定时心跳轮询兜底（每 5 秒）：网络恢复时保证自动无感同步
    setInterval(() => {
      if (!this.isSyncing) {
        this.offlineStorage.getPendingQueue().then(queue => {
          if (queue && queue.length > 0) {
            console.log('[SyncService] Heartbeat auto-sync trigger: pending items =', queue.length);
            this.syncPendingOrders().catch(e => console.warn('[SyncService] Heartbeat sync error:', e));
          }
        });
      }
    }, 5000);
  }

  /**
   * 向后兼容方法别名 (手动触发默认启用 forceRetry)
   */
  public syncPendingInvoices(forceRetry: boolean = true): Promise<SyncResult> {
    return this.syncPendingOrders(forceRetry);
  }

  /**
   * 执行待同步订单及所有离线任务上传：
   * - 严格加锁防并发
   * - 处理 LocalDb 订单
   * - 处理 offlineStorage 全部任务队列（发票创建/修改/删除、CN创建/修改/删除）
   */
  public async syncPendingOrders(forceRetry: boolean = false): Promise<SyncResult> {
    // 并发互斥锁：如果已有同步正在运行，立即退出
    if (this.isSyncing) {
      return { successCount: 0, failCount: 0, totalProcessed: 0 };
    }

    // Acquire the mutex before awaiting network checks.
    this.isSyncing = true;
    this.isSyncingSubject.next(true);
    let successCount = 0;
    let failCount = 0;
    let lastError: string | undefined;

    try {
      if (!await this.checkNetworkConnected()) return { successCount: 0, failCount: 0, totalProcessed: 0 };
      if (!(await this.offlineStorage.getPendingQueue()).length && !(await this.localDb.getPendingOrders()).length) {
        return { successCount: 0, failCount: 0, totalProcessed: 0 };
      }
      try { await this.api.verifyOfflineSyncSupport(); }
      catch { return { successCount: 0, failCount: 1, totalProcessed: 0, lastError: 'Offline sync needs the updated API and database schema. Local changes are retained.' }; }

      // 1. 从 LocalDbService 获取所有 PENDING 订单（已按 created_at 升序排列）
      const pendingOrders = await this.localDb.getPendingOrders();

      for (const order of pendingOrders) {
        // One authoritative upload path. Recover older local orders that have no queue entry.
        const queued = await this.offlineStorage.getQueueItemById(order.clientId);
        if (!queued) await this.offlineStorage.enqueue('CREATE_INVOICE', await this.buildInvoicePayload(order), order.clientId);
      }

      // 2. 全量同步 offlineStorage 中的各类任务（发票创建、发票修改、发票删除、CN操作等）
      const offlineRes = await this.syncOfflineTasks(forceRetry);
      successCount += offlineRes.successCount;
      failCount += offlineRes.failCount;
      if (!lastError && offlineRes.lastError) {
        lastError = offlineRes.lastError;
      }

    } finally {
      this.isSyncing = false;
      this.isSyncingSubject.next(false);
    }

    const result: SyncResult = {
      successCount,
      failCount,
      totalProcessed: successCount + failCount,
      lastError
    };

    this.syncCompletedSubject.next(result);
    return result;
  }

  /**
   * 组装与后端 CreateInvoiceDto 严格一致的上传数据载荷
   */
  private async buildInvoicePayload(order: FullOrder): Promise<any> {
    const cachedProds = await this.offlineStorage.getCache<any[]>('products') || [];
    const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];

    let customerId: any = order.customerId;
    if (typeof customerId === 'string' && String(customerId).startsWith('cust_')) {
      const mc = cachedCusts.find(c => String(c.id) === String(customerId) || c.offlineId === customerId);
      if (mc && typeof mc.id === 'number') {
        customerId = mc.id;
      }
    }

    return {
      customerId,
      invoiceDate: order.orderDate,
      remark: order.remark || '',
      useCreditBalance: !!order.useCreditBalance,
      selectedCreditNoteId: order.selectedCreditNoteId ?? null,
      selectedCreditNoteIds: order.selectedCreditNoteIds ?? null,
      termType: order.termType || 'Cash Sale',
      paidAmount: order.inputPaidAmount ?? order.paidAmount ?? 0,
      offlineCreditReservations: order.offlineCreditReservations,
      offlineChangeCreditNoteId: order.offlineChangeCreditNoteId,
      paymentMethod: order.paymentMethod || 'CASH',
      clientId: order.clientId,           // 关键客户端 Guid 幂等主键
      offlineReferenceId: order.clientId, // 兼容字段
      invoiceNumber: order.orderNumber,   // 关键客户端机台防撞单号
      items: (order.items || []).map(it => {
        let pid: any = it.productId;
        if (typeof pid === 'string' && String(pid).startsWith('prod_')) {
          const mp = cachedProds.find(p => String(p.id) === String(pid) || p.offlineId === pid);
          if (mp && typeof mp.id === 'number') {
            pid = mp.id;
          }
        }
        return {
          productId: pid,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          remark: it.remark || ''
        };
      })
    };
  }

  /**
   * 错误类型分类器
   */
  private classifyError(err: any): 'AUTH_ERROR' | 'NETWORK_ERROR' | 'CLIENT_DATA_ERROR' {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401 || err.status === 403) {
        return 'AUTH_ERROR';
      }
      if (err.status === 0 || err.status >= 500) {
        return 'NETWORK_ERROR';
      }
      if (err.status >= 400 && err.status < 500) {
        return 'CLIENT_DATA_ERROR';
      }
    }
    if (err?.message?.includes('timeout') || err?.message?.includes('Network')) {
      return 'NETWORK_ERROR';
    }
    return 'CLIENT_DATA_ERROR';
  }

  /**
   * 检查当前网络是否可用
   */
  private async checkNetworkConnected(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      return true;
    }
    try {
      const status = await Network.getStatus();
      if (status && typeof status.connected === 'boolean') {
        return status.connected;
      }
    } catch { }
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * 优先同步实体（离线新建的商品与客户）：
   * 保证在同步发票或订单之前，获取到后端分配的真实自增数字 ID，
   * 并级联更新本地缓存、Dexie 订单明细及待同步队列中的临时外键引用。
   */
  public async syncPriorityEntities(forceRetry = false): Promise<{ successCount: number; failCount: number; lastError?: string }> {
    let successCount = 0;
    let failCount = 0;
    let lastError: string | undefined;
    const baseUrl = (this.api as any).baseUrl;
    const queue = await this.offlineStorage.getPendingQueue();
    const tasks = queue.filter(q => ['CREATE_CATEGORY', 'CREATE_PRODUCT', 'CREATE_CUSTOMER'].includes(q.type));
    tasks.sort((a, b) => Number(b.type === 'CREATE_CATEGORY') - Number(a.type === 'CREATE_CATEGORY'));
    for (let task of tasks) {
      if (!forceRetry && (task.status === 'failed' || task.retryCount >= this.MAX_RETRY_LIMIT)) continue;
      try {
        const latest = await this.offlineStorage.getQueueItemById(task.id);
        if (!latest) continue;
        task = latest;
        if (!task.operationId) {
          task.operationId = this.offlineStorage.generateId();
          await this.offlineStorage.updateQueueItem(task);
        }
        task.attemptedAt = Date.now();
        await this.offlineStorage.updateQueueItem(task);
        const type = task.type === 'CREATE_CATEGORY' ? 'category' : task.type === 'CREATE_PRODUCT' ? 'product' : 'customer';
        const endpoint = { category: '/Category/CreateCategory/createcategory', product: '/Product/CreateProducts/createproducts', customer: '/Customer/CreateCustomers/createcustomers' }[type];
        const payload = task.payload?.data || task.payload;
        if (type === 'product' && payload.categoryId != null) payload.categoryId = await this.resolveId('category', payload.categoryId);
        const result: any = await firstValueFrom(this.api.postDirect(baseUrl + endpoint, payload, task.operationId));
        const id = result?.id || result?.data?.id || result?.productId || result?.customerId;
        await this.offlineStorage.mapServerId(type, task.id, id);
        if (type === 'product') await this.localDb.updateProductIdInOrderItems(task.id, id);
        if (type === 'customer') await this.localDb.updateCustomerIdInOrders(task.id, id);
        this.api.clearAllCache();
        await this.offlineStorage.removeQueueItem(task.id);
        successCount++;
      } catch (error: any) {
        failCount++;
        lastError = error?.error?.message || (typeof error?.error === 'string' ? error.error : error?.message) || 'Unable to sync';
        task.retryCount++;
        task.lastError = lastError;
        if (task.retryCount >= this.MAX_RETRY_LIMIT) task.status = 'failed';
        await this.offlineStorage.updateQueueItem(task);
        const kind = this.classifyError(error);
        if (kind === 'AUTH_ERROR') this.authErrorSubject.next('Session expired or unauthorized. Please re-login.');
        if (kind === 'AUTH_ERROR' || kind === 'NETWORK_ERROR') break;
      }
    }
    return { successCount, failCount, lastError };
  }

  /**
   * 全量同步 offlineStorage 中的所有任务类型：
   * - CREATE_PRODUCT: 商品创建
   * - UPDATE_PRODUCT: 商品修改
   * - DELETE_PRODUCT: 商品删除
   * - ACTIVATE_PRODUCT: 商品启用
   * - DEACTIVATE_PRODUCT: 商品停用
   * - ADD_STOCK: 商品加库存
   * - CREATE_INVOICE: 发票上传
   * - UPDATE_INVOICE: 发票修改
   * - DELETE_INVOICE: 发票作废
   * - CREATE_CN / CREATE_GLOBAL_CN: 点数单/退货单新建
   * - UPDATE_CN: 点数单修改
   * - DELETE_CN: 点数单删除
   */
  private async syncOfflineTasks(forceRetry: boolean = false): Promise<{ successCount: number; failCount: number; lastError?: string }> {
    let successCount = 0;
    let failCount = 0;
    let lastError: string | undefined;

    try {
      // 0. 优先执行商品与客户创建同步，确保 ID 依赖已全部解决
      const prioRes = await this.syncPriorityEntities(forceRetry);
      successCount += prioRes.successCount;
      failCount += prioRes.failCount;
      if (prioRes.lastError && !lastError) {
        lastError = prioRes.lastError;
      }

      const pending = await this.offlineStorage.getPendingQueue();
      const baseUrl = (this.api as any).baseUrl;

      // 过滤掉已由 syncPriorityEntities 处理的 CREATE_PRODUCT 和 CREATE_CUSTOMER
      const remainingTasks = pending.filter(t => t.type !== 'CREATE_CATEGORY' && t.type !== 'CREATE_PRODUCT' && t.type !== 'CREATE_CUSTOMER');

      // 关键依赖排序：保证发票在退货单之前同步，以便退货单在服务端有发票可以挂靠 (Anchor)
      const getTaskPriority = (t: string): number => {
        if (t === 'UPDATE_CATEGORY') return 0;
        if (t === 'CREATE_INVOICE') return 1;
        if (t === 'UPDATE_INVOICE') return 2;
        if (t.startsWith('UPDATE_PROD') || t.startsWith('ACTIVATE') || t.startsWith('DEACTIVATE') || t.startsWith('ADD_STOCK')) return 3;
        if (t === 'CREATE_CN' || t === 'CREATE_GLOBAL_CN') return 4;
        if (t === 'UPDATE_CN') return 5;
        if (t === 'CREATE_BULK_PAYMENT') return 6;
        if (t === 'USE_CN') return 7;
        return 10;
      };
      remainingTasks.sort((a, b) => getTaskPriority(a.type) - getTaskPriority(b.type));

      for (let task of remainingTasks) {
        if (!forceRetry && (task.status === 'failed' || task.retryCount >= this.MAX_RETRY_LIMIT)) {
          continue;
        }

        try {
          const latest = await this.offlineStorage.getQueueItemById(task.id);
          if (!latest) continue;
          task = latest;
          if (!task.operationId) { task.operationId = this.offlineStorage.generateId(); await this.offlineStorage.updateQueueItem(task); }
          task.attemptedAt = Date.now();
          await this.offlineStorage.updateQueueItem(task);
          if (task.type === 'UPDATE_CATEGORY' || task.type === 'DELETE_CATEGORY') {
            const id = await this.resolveId('category', task.payload.id);
            if (task.type === 'UPDATE_CATEGORY') await firstValueFrom(this.api.putDirect(baseUrl + '/Category/EditCategory/editcategory/' + id, task.payload.data, task.operationId));
            else {
              try { await firstValueFrom(this.api.deleteDirect(baseUrl + '/Category/DeleteCategory/deletecategory/' + id, task.operationId)); }
              catch (err: any) { if (err?.status !== 404) throw err; }
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'USE_CN') {
            const invoiceId = await this.resolveId('invoice', task.payload.requestedInvoiceId || task.payload.invoiceId);
            const cnId = await this.resolveId('cn', task.payload.cnId);
            await firstValueFrom(this.api.patchDirect(baseUrl + '/Credit/UseCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId + '/use', task.payload.requestBody || {
              expectedInvoiceId: invoiceId, expectedAmount: task.payload.amount
            }, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('upd_prod_', '');
            const url = `${baseUrl}/Product/EditProduct/editproduct/${pid}`;
            const payload = task.payload?.data || task.payload;
            await firstValueFrom(this.api.putDirect(url, payload, task.operationId));
            const cachedProducts = await this.offlineStorage.getCache<any[]>('products') || [];
            const matched = cachedProducts.find(p => String(p.id) === String(pid));
            if (matched) {
              matched.isModified = false;
              await this.offlineStorage.setCache('products', cachedProducts);
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('del_prod_', '');
            const url = `${baseUrl}/Product/DeleteProduct/deleteproduct/${pid}`;
            try {
              await firstValueFrom(this.api.deleteDirect(url, task.operationId));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'ACTIVATE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('act_prod_', '');
            const url = `${baseUrl}/Product/ActivateProduct/activateproduct/${pid}`;
            await firstValueFrom(this.api.patchDirect(url, {}, task.operationId));
            const cachedProducts = await this.offlineStorage.getCache<any[]>('products') || [];
            const matched = cachedProducts.find(p => String(p.id) === String(pid));
            if (matched) {
              matched.isModified = false;
              await this.offlineStorage.setCache('products', cachedProducts);
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DEACTIVATE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('deact_prod_', '');
            const url = `${baseUrl}/Product/DeactivateProduct/deactivateproduct/${pid}`;
            await firstValueFrom(this.api.patchDirect(url, {}, task.operationId));
            const cachedProducts = await this.offlineStorage.getCache<any[]>('products') || [];
            const matched = cachedProducts.find(p => String(p.id) === String(pid));
            if (matched) {
              matched.isModified = false;
              await this.offlineStorage.setCache('products', cachedProducts);
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'ADD_STOCK') {
            const pid = task.payload?.id || String(task.id).replace('stock_prod_', '').split('_')[0];
            const url = `${baseUrl}/Product/AddStock/addstock/${pid}`;
            const payload = { quantity: Number(task.payload?.quantity || 0) };
            await firstValueFrom(this.api.patchDirect(url, payload, task.operationId));
            const cachedProducts = await this.offlineStorage.getCache<any[]>('products') || [];
            const matched = cachedProducts.find(p => String(p.id) === String(pid));
            if (matched) {
              matched.isModified = false;
              await this.offlineStorage.setCache('products', cachedProducts);
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_CUSTOMER_PRICE') {
            const cid = task.payload?.customerId;
            const url = `${baseUrl}/Customer/CreateCustomerProductPrice/customers/${cid}/product-prices`;
            await firstValueFrom(this.api.postDirect(url, task.payload?.data || task.payload, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CUSTOMER_PRICE') {
            const cid = task.payload?.customerId;
            const pid = task.payload?.productId;
            const url = `${baseUrl}/Customer/UpdateCustomerProductPrice/customers/${cid}/product-prices/${pid}`;
            await firstValueFrom(this.api.patchDirect(url, task.payload?.data || task.payload, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CUSTOMER_PRICE') {
            const cid = task.payload?.customerId;
            const pid = task.payload?.productId;
            const url = `${baseUrl}/Customer/DeleteCustomerProductPrice/customers/${cid}/product-prices/${pid}`;
            await firstValueFrom(this.api.deleteDirect(url, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CUSTOMER') {
            const cid = task.payload?.id;
            const url = `${baseUrl}/Customer/EditCustomer/editcustomers/${cid}`;
            await firstValueFrom(this.api.putDirect(url, task.payload?.data || task.payload, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CUSTOMER') {
            const cid = task.payload?.id;
            const url = `${baseUrl}/Customer/DeleteCustomer/deletecustomer/${cid}`;
            await firstValueFrom(this.api.deleteDirect(url, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_INVOICE') {
            // 如果发票使用的是离线 customerId，先从已同步客户中查找映射
            if (typeof task.payload?.customerId === 'string' && task.payload.customerId.startsWith('cust_')) {
              const cachedCustomers = await this.offlineStorage.getCache<any[]>('customers') || [];
              const matched = cachedCustomers.find(c => String(c.id) === String(task.payload.customerId) || c.offlineId === task.payload.customerId);
              if (matched && typeof matched.id === 'number') {
                task.payload.customerId = matched.id;
              }
            }
            // 如果发票中的商品使用了离线 productId，先从已同步商品中查找映射
            if (Array.isArray(task.payload?.items)) {
              const cachedProds = await this.offlineStorage.getCache<any[]>('products') || [];
              for (const it of task.payload.items) {
                if (typeof it.productId === 'string' && String(it.productId).startsWith('prod_')) {
                  const matchedP = cachedProds.find(p => String(p.id) === String(it.productId) || p.offlineId === it.productId);
                  if (matchedP && typeof matchedP.id === 'number') {
                    it.productId = matchedP.id;
                  }
                }
              }
            }
            task.payload.customerId = await this.resolveId('customer', task.payload.customerId);
            for (const item of task.payload.items || []) item.productId = await this.resolveId('product', item.productId);
            if (task.payload.selectedCreditNoteId) task.payload.selectedCreditNoteId = await this.resolveId('cn', task.payload.selectedCreditNoteId);
            if (Array.isArray(task.payload.selectedCreditNoteIds)) {
              task.payload.selectedCreditNoteIds = await Promise.all(task.payload.selectedCreditNoteIds.map((id: any) => this.resolveId('cn', id)));
            }
            const res = await firstValueFrom(this.api.postInvoiceDirect(task.payload, task.operationId));
            const serverId = res?.invoiceId || res?.id || 0;
            await this.offlineStorage.mapServerId('invoice', task.id, serverId);
            if (task.payload.offlineChangeCreditNoteId) {
              await this.offlineStorage.mapServerId('cn', task.payload.offlineChangeCreditNoteId, res?.changeCreditNoteId);
            }
            try { await this.localDb.markAsSynced(task.id, serverId); } catch { }
            if (serverId) {
              const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
              const matched = cachedInvs.find(inv => inv.id === task.id || inv.offlineId === task.id);
              if (matched) {
                matched.serverId = serverId;
                await this.offlineStorage.setCache('invoices_list', cachedInvs);
              }
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_INVOICE') {
            console.log('[SyncService] Processing UPDATE_INVOICE:', task.id, task.payload);
            const rawData = task.payload?.data || task.payload || {};
            const invId = task.payload?.invoiceId || task.payload?.id || String(task.id).replace('upd_inv_', '');
            
            // 解析真实的 Server 发票 ID
            let realInvId: any = await this.resolveId('invoice', invId).catch(() => invId);
            if (isNaN(Number(invId)) || Number(invId) >= 100000000) {
              const strId = String(invId);
              const order = await this.localDb.getOrderByClientId(strId);
              if (order && order.serverId) {
                realInvId = order.serverId;
              } else {
                const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
                const matched = cachedInvs.find(inv =>
                  String(inv.id) === strId ||
                  inv.offlineId === strId ||
                  inv.clientId === strId ||
                  inv.docNo === strId ||
                  inv.invoiceNumber === strId
                );
                if (matched && matched.serverId) {
                  realInvId = matched.serverId;
                } else if (matched && typeof matched.id === 'number' && matched.id > 0 && matched.id < 100000000) {
                  realInvId = matched.id;
                }
              }
            }

            // 如果 customerId 是离线客户 ID，映射为服务端真实 ID
            let custId = rawData.customerId;
            if (typeof custId === 'string' && custId.startsWith('cust_')) {
              const cachedCustomers = await this.offlineStorage.getCache<any[]>('customers') || [];
              const matchedC = cachedCustomers.find(c => String(c.id) === String(custId) || c.offlineId === custId);
              if (matchedC && typeof matchedC.id === 'number') {
                custId = matchedC.id;
              }
            }

            const cleanData = { ...rawData };
            if (custId != null) cleanData.customerId = await this.resolveId('customer', custId);
            if (Array.isArray(rawData.items)) {
              cleanData.items = [];
              for (const item of rawData.items) cleanData.items.push({ ...item, productId: await this.resolveId('product', item.productId) });
            }
            realInvId = await this.resolveId('invoice', realInvId);
            await firstValueFrom(this.api.updateInvoiceDirect(realInvId, cleanData, task.operationId));
            // 同步成功后清理本地 overrides 缓存，确保多端以服务器为准
            try {
              const overrides = JSON.parse(localStorage.getItem('invoice_customer_overrides') || '{}');
              delete overrides[realInvId];
              delete overrides[invId];
              localStorage.setItem('invoice_customer_overrides', JSON.stringify(overrides));
            } catch { }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_INVOICE') {
            try {
              const targetInvId = task.payload.invoiceId;
              let realDeleteId = await this.resolveId('invoice', targetInvId).catch(() => targetInvId);
              if (isNaN(Number(targetInvId)) || Number(targetInvId) >= 100000000) {
                const strId = String(targetInvId);
                const order = await this.localDb.getOrderByClientId(strId);
                if (order && order.serverId) {
                  realDeleteId = order.serverId;
                }
              }
              await firstValueFrom(this.api.deleteInvoiceDirect(realDeleteId, task.operationId));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_CN' || task.type === 'CREATE_GLOBAL_CN') {
            const data = { ...task.payload.data };
            for (const item of data.items || []) item.productId = await this.resolveId('product', item.productId);
            let response: any;
            if (task.type === 'CREATE_CN') {
              const invoiceId = await this.resolveId('invoice', task.payload.invoiceId);
              response = await firstValueFrom(this.api.postDirect(baseUrl + '/Credit/CreateCreditNote/invoices/' + invoiceId + '/credit-notes', data, task.operationId));
            } else {
              const customerId = await this.resolveId('customer', task.payload.customerId);
              const preferred = data.preferredInvoiceId || task.payload.invoiceId;
              if (preferred) data.preferredInvoiceId = await this.resolveId('invoice', preferred);
              response = await firstValueFrom(this.api.postDirect(baseUrl + '/Credit/CreateGlobalCreditNote/customers/' + customerId + '/credit-notes-global', data, task.operationId));
            }
            await this.offlineStorage.mapServerId('cn', task.id, response?.cnId || response?.data?.id || response?.id);
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CN') {
            const url = `${baseUrl}/Credit/UpdateCreditNote/credit-notes/${task.payload.cnId}`;
            await firstValueFrom(this.api.putDirect(url, task.payload.data, task.operationId));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CN') {
            const url = `${baseUrl}/Credit/DeleteCreditNote/invoices/${task.payload.invoiceId}/credit-notes/${task.payload.cnId}`;
            try {
              await firstValueFrom(this.api.deleteDirect(url, task.operationId));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_BULK_PAYMENT') {
            const url = `${baseUrl}/Payment/CreateBulkPayment/bulk-payments`;
            const payload = JSON.parse(JSON.stringify(task.payload?.data || task.payload));

            payload.customerId = await this.resolveId('customer', payload.customerId);
            for (const payment of payload.payments || []) {
              payment.invoiceId = await this.resolveId('invoice', payment.invoiceId);
            }

            const response: any = await firstValueFrom(this.api.postDirect(url, payload, task.operationId));
            for (const local of task.payload.createdPayments || []) {
              const result = response?.payments?.find((p: any) => String(p.invoiceId) === String(local.invoiceId));
              if (!result?.paymentId) throw new Error('API update required: missing synchronized payment ID');
              await this.offlineStorage.mapServerId('payment', local.paymentId, result.paymentId);
            }
            if (task.payload.changeCreditNoteId) {
              await this.offlineStorage.mapServerId('cn', task.payload.changeCreditNoteId, response?.changeCreditNoteId);
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_PAYMENT') {
            const url = `${baseUrl}/Payment/DeletePayment/payments/${task.payload.paymentId}`;
            try {
              await firstValueFrom(this.api.deleteDirect(url, task.operationId));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else {
            throw new Error('Unsupported sync task: ' + task.type);
          }
        } catch (e: any) {
          console.warn('[SyncService] Failed to sync task:', task.id, task.type, e);
          failCount++;
          const errType = this.classifyError(e);
          if (errType === 'AUTH_ERROR') {
            this.authErrorSubject.next('Session expired or unauthorized. Please re-login.');
            break;
          }
          if (errType === 'NETWORK_ERROR') {
            break;
          }
          task.retryCount = (task.retryCount || 0) + 1;
          task.lastError = e?.error?.message || (typeof e?.error === 'string' ? e.error : e?.message) || 'Data error';
          lastError = task.lastError;
          if (task.retryCount >= this.MAX_RETRY_LIMIT) {
            task.status = 'failed';
          }
          await this.offlineStorage.updateQueueItem(task);
        }
      }
      await this.offlineStorage.refreshQueueCount();
    } catch (e) {
      console.warn('[SyncService] Offline tasks check error:', e);
    }

    return { successCount, failCount, lastError };
  }

  private async resolveId(type: 'invoice' | 'customer' | 'product' | 'category' | 'cn' | 'payment', id: any): Promise<number> {
    try { return await this.offlineStorage.resolveServerId(type, id); }
    catch (error) {
      let serverId: number | undefined;
      if (type === 'invoice') serverId = (await this.localDb.getOrderByClientId(String(id)))?.serverId;
      const cacheKey = { invoice: 'invoices_list', customer: 'customers', product: 'products', category: 'categories', cn: 'credit_notes_list', payment: 'payments_list' }[type];
      const list = await this.offlineStorage.getCache<any[]>(cacheKey) || [];
      const match = list.find(item => String(item.offlineId) === String(id) || String(item.clientId) === String(id));
      serverId = serverId || match?.serverId || (typeof match?.id === 'number' ? match.id : undefined);
      if (!serverId) throw error;
      await this.offlineStorage.mapServerId(type, id, serverId);
      return serverId;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
