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
          console.log('[SyncService] Network restored (Capacitor), triggering sync...');
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
        this.syncPendingOrders(true).catch(e => console.error('[SyncService] Window online trigger error:', e));
      });
      window.addEventListener('focus', () => {
        this.syncPendingOrders(true).catch(e => console.error('[SyncService] Focus trigger error:', e));
      });
    }

    // 4. 定时心跳轮询兜底（每 8 秒）：网络恢复时保证自动无感同步
    setInterval(() => {
      if (!this.isSyncing) {
        this.offlineStorage.getPendingQueue().then(queue => {
          if (queue && queue.length > 0) {
            console.log('[SyncService] Heartbeat auto-sync trigger: pending items =', queue.length);
            this.syncPendingOrders(true).catch(e => console.warn('[SyncService] Heartbeat sync error:', e));
          }
        });
      }
    }, 8000);
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

    // 检查网络状态
    const status = await this.checkNetworkConnected();
    if (!status) {
      return { successCount: 0, failCount: 0, totalProcessed: 0 };
    }

    this.isSyncing = true;
    this.isSyncingSubject.next(true);

    let successCount = 0;
    let failCount = 0;
    let lastError: string | undefined;

    try {
      // 0. 优先同步离线创建的商品与客户，确保获取到真实的服务端自增 ID，并完成所有待发票订单的 ID 回填
      const priorityRes = await this.syncPriorityEntities(forceRetry);
      successCount += priorityRes.successCount;
      failCount += priorityRes.failCount;
      if (priorityRes.lastError && !lastError) {
        lastError = priorityRes.lastError;
      }

      // 1. 从 LocalDbService 获取所有 PENDING 订单（已按 created_at 升序排列）
      const pendingOrders = await this.localDb.getPendingOrders();

      for (const order of pendingOrders) {
        if (order.sync_retry_count >= this.MAX_RETRY_LIMIT && order.last_sync_error?.includes('400')) {
          continue;
        }

        const payload = await this.buildInvoicePayload(order);

        try {
          const res = await firstValueFrom(this.api.postInvoiceDirect(payload));
          const serverId = res?.invoiceId || res?.id || (order.serverId || 0);
          await this.localDb.markAsSynced(order.clientId, serverId);
          await this.offlineStorage.removeQueueItem(order.clientId);

          successCount++;
          this.backoffDelayMs = 2000;
        } catch (err: any) {
          failCount++;
          const errorType = this.classifyError(err);

          if (errorType === 'AUTH_ERROR') {
            console.warn('[SyncService] 401 Unauthorized encountered. Halting queue.');
            this.authErrorSubject.next('Session expired or unauthorized. Please re-login.');
            break;
          }

          if (errorType === 'NETWORK_ERROR') {
            console.warn(`[SyncService] Network/Server unavailable. Applying backoff (${this.backoffDelayMs}ms):`, err);
            await this.localDb.markSyncFailed(order.clientId, 'Network error / server unavailable');
            await this.sleep(this.backoffDelayMs);
            this.backoffDelayMs = Math.min(this.backoffDelayMs * 2, this.MAX_BACKOFF_DELAY_MS);
            break;
          }

          if (errorType === 'CLIENT_DATA_ERROR') {
            const errMsg = err?.error?.message || (typeof err?.error === 'string' ? err?.error : null) || 'Bad Request (400)';
            lastError = errMsg;
            console.error('[SyncService] Client data error on order:', order.clientId, errMsg);
            await this.localDb.markSyncFailed(order.clientId, `Data Error: ${errMsg}`);
          }
        }
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
      customerId: Number(customerId) || 0,
      invoiceDate: order.orderDate,
      remark: order.remark || '',
      useCreditBalance: false,
      selectedCreditNoteId: null,
      termType: order.termType || 'Cash Sale',
      paidAmount: order.paidAmount || 0,
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
          productId: Number(pid) || 0,
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
    return 'NETWORK_ERROR';
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
  public async syncPriorityEntities(forceRetry: boolean = false): Promise<{ successCount: number; failCount: number; lastError?: string }> {
    let successCount = 0;
    let failCount = 0;
    let lastError: string | undefined;
    const baseUrl = (this.api as any).baseUrl;

    try {
      const pending = await this.offlineStorage.getPendingQueue();
      const priorityTasks = pending.filter(t => t.type === 'CREATE_PRODUCT' || t.type === 'CREATE_CUSTOMER');

      for (const task of priorityTasks) {
        if (!forceRetry && (task.status === 'failed' || task.retryCount >= this.MAX_RETRY_LIMIT)) {
          continue;
        }

        try {
          if (task.type === 'CREATE_PRODUCT') {
            const url = `${baseUrl}/Product/CreateProducts/createproducts`;
            const payload = task.payload?.data || task.payload;
            const res: any = await firstValueFrom(this.api.postDirect(url, payload));
            const serverId = res?.id || res?.data?.id || res?.productId || 0;

            if (serverId) {
              // 1. 更新商品缓存
              const cachedProducts = await this.offlineStorage.getCache<any[]>('products') || [];
              const matched = cachedProducts.find(p => String(p.id) === String(task.id) || p.offlineId === task.id);
              if (matched) {
                matched.id = serverId;
                matched.isOffline = false;
                await this.offlineStorage.setCache('products', cachedProducts);
              }

              // 2. 级联更新 Dexie 本地订单明细中的临时 productId
              try {
                await this.localDb.updateProductIdInOrderItems(task.id, serverId);
              } catch (dexErr) {
                console.warn('[SyncService] Failed updating Dexie order_items productId:', dexErr);
              }

              // 3. 级联更新待同步队列中的外键引用
              const pendingQueue = await this.offlineStorage.getPendingQueue();
              for (const q of pendingQueue) {
                // 发票创建
                if (q.type === 'CREATE_INVOICE' && q.payload?.items && Array.isArray(q.payload.items)) {
                  let changed = false;
                  for (const it of q.payload.items) {
                    if (String(it.productId) === String(task.id)) {
                      it.productId = serverId;
                      changed = true;
                    }
                  }
                  if (changed) await this.offlineStorage.updateQueueItem(q);
                }
                // 发票更新
                if (q.type === 'UPDATE_INVOICE' && q.payload) {
                  const itList = q.payload.data?.items || q.payload.items;
                  if (Array.isArray(itList)) {
                    let changed = false;
                    for (const it of itList) {
                      if (String(it.productId) === String(task.id)) {
                        it.productId = serverId;
                        changed = true;
                      }
                    }
                    if (changed) await this.offlineStorage.updateQueueItem(q);
                  }
                }
                // 退货单
                if (q.type === 'CREATE_CN' || q.type === 'CREATE_GLOBAL_CN' || q.type === 'UPDATE_CN') {
                  const itList = q.payload?.items || q.payload?.data?.items;
                  if (Array.isArray(itList)) {
                    let changed = false;
                    for (const it of itList) {
                      if (String(it.productId) === String(task.id)) {
                        it.productId = serverId;
                        changed = true;
                      }
                    }
                    if (changed) await this.offlineStorage.updateQueueItem(q);
                  }
                }
                // 客户特价
                if ((q.type === 'CREATE_CUSTOMER_PRICE' || q.type === 'UPDATE_CUSTOMER_PRICE' || q.type === 'DELETE_CUSTOMER_PRICE') && q.payload) {
                  if (String(q.payload.productId) === String(task.id) || String(q.payload.data?.productId) === String(task.id)) {
                    if (q.payload.productId) q.payload.productId = serverId;
                    if (q.payload.data?.productId) q.payload.data.productId = serverId;
                    await this.offlineStorage.updateQueueItem(q);
                  }
                }
                // 商品后续操作
                if ((q.type === 'UPDATE_PRODUCT' || q.type === 'DELETE_PRODUCT' || q.type === 'ACTIVATE_PRODUCT' || q.type === 'DEACTIVATE_PRODUCT' || q.type === 'ADD_STOCK') && q.payload) {
                  if (String(q.payload.id) === String(task.id)) {
                    q.payload.id = serverId;
                    await this.offlineStorage.updateQueueItem(q);
                  }
                }
              }
            }

            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;

          } else if (task.type === 'CREATE_CUSTOMER') {
            const url = `${baseUrl}/Customer/CreateCustomers/createcustomers`;
            const payload = task.payload?.data || task.payload;
            const res: any = await firstValueFrom(this.api.postDirect(url, payload));
            const serverId = res?.data?.id || res?.id || 0;

            if (serverId) {
              const cachedCustomers = await this.offlineStorage.getCache<any[]>('customers') || [];
              const matched = cachedCustomers.find(c => String(c.id) === String(task.id) || c.offlineId === task.id);
              if (matched) {
                matched.id = serverId;
                matched.isOffline = false;
                await this.offlineStorage.setCache('customers', cachedCustomers);
              }

              // 级联更新 Dexie 本地订单主体中的临时 customerId
              try {
                await this.localDb.updateCustomerIdInOrders(task.id, serverId);
              } catch (dexErr) {
                console.warn('[SyncService] Failed updating Dexie orders customerId:', dexErr);
              }

              // 同步更新队列中依赖该离线 customerId 的发票和特价任务
              const pendingQueue = await this.offlineStorage.getPendingQueue();
              for (const q of pendingQueue) {
                if (q.type === 'CREATE_INVOICE' && q.payload && String(q.payload.customerId) === String(task.id)) {
                  q.payload.customerId = serverId;
                  await this.offlineStorage.updateQueueItem(q);
                }
                if ((q.type === 'CREATE_CUSTOMER_PRICE' || q.type === 'UPDATE_CUSTOMER_PRICE' || q.type === 'DELETE_CUSTOMER_PRICE') && q.payload && String(q.payload.customerId) === String(task.id)) {
                  q.payload.customerId = serverId;
                  await this.offlineStorage.updateQueueItem(q);
                }
              }
            }

            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          }
        } catch (err: any) {
          failCount++;
          const errorType = this.classifyError(err);
          if (errorType === 'AUTH_ERROR') {
            this.authErrorSubject.next('Session expired or unauthorized. Please re-login.');
            break;
          }
          if (errorType === 'NETWORK_ERROR') {
            break;
          }
          if (errorType === 'CLIENT_DATA_ERROR') {
            const errMsg = err?.error?.message || (typeof err?.error === 'string' ? err?.error : null) || 'Bad Request (400)';
            lastError = errMsg;
            task.status = 'failed';
            task.retryCount = (task.retryCount || 0) + 1;
            task.lastError = errMsg;
            await this.offlineStorage.updateQueueItem(task);
          }
        }
      }
    } catch (e: any) {
      lastError = e?.message;
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
      const remainingTasks = pending.filter(t => t.type !== 'CREATE_PRODUCT' && t.type !== 'CREATE_CUSTOMER');

      for (const task of remainingTasks) {
        if (!forceRetry && (task.status === 'failed' || task.retryCount >= this.MAX_RETRY_LIMIT)) {
          continue;
        }

        try {
          if (task.type === 'UPDATE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('upd_prod_', '');
            const url = `${baseUrl}/Product/EditProduct/editproduct/${pid}`;
            const payload = task.payload?.data || task.payload;
            await firstValueFrom(this.api.putDirect(url, payload));
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
              await firstValueFrom(this.api.deleteDirect(url));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'ACTIVATE_PRODUCT') {
            const pid = task.payload?.id || String(task.id).replace('act_prod_', '');
            const url = `${baseUrl}/Product/ActivateProduct/activateproduct/${pid}`;
            await firstValueFrom(this.api.patchDirect(url, {}));
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
            await firstValueFrom(this.api.patchDirect(url, {}));
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
            await firstValueFrom(this.api.patchDirect(url, payload));
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
            await firstValueFrom(this.api.postDirect(url, task.payload?.data || task.payload));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CUSTOMER_PRICE') {
            const cid = task.payload?.customerId;
            const pid = task.payload?.productId;
            const url = `${baseUrl}/Customer/UpdateCustomerProductPrice/customers/${cid}/product-prices/${pid}`;
            await firstValueFrom(this.api.patchDirect(url, task.payload?.data || task.payload));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CUSTOMER_PRICE') {
            const cid = task.payload?.customerId;
            const pid = task.payload?.productId;
            const url = `${baseUrl}/Customer/DeleteCustomerProductPrice/customers/${cid}/product-prices/${pid}`;
            await firstValueFrom(this.api.deleteDirect(url));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CUSTOMER') {
            const cid = task.payload?.id;
            const url = `${baseUrl}/Customer/EditCustomer/editcustomers/${cid}`;
            await firstValueFrom(this.api.putDirect(url, task.payload?.data || task.payload));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CUSTOMER') {
            const cid = task.payload?.id;
            const url = `${baseUrl}/Customer/DeleteCustomer/deletecustomer/${cid}`;
            await firstValueFrom(this.api.deleteDirect(url));
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
            const res = await firstValueFrom(this.api.postInvoiceDirect(task.payload));
            const serverId = res?.invoiceId || res?.id || 0;
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
            const cachedProds = await this.offlineStorage.getCache<any[]>('products') || [];
            const cleanItems = (rawData.items || []).map((it: any) => {
              let p = it.unitPrice != null ? Number(it.unitPrice) : null;
              if (p !== null && p <= 0) {
                p = null; // 转换为 null，使后端自动按特价/原价取值，避免 400 校验错误
              }
              let pid = it.productId;
              if (typeof pid === 'string' && pid.startsWith('prod_')) {
                const mp = cachedProds.find(cp => String(cp.id) === String(pid) || cp.offlineId === pid);
                if (mp && typeof mp.id === 'number') pid = mp.id;
              }
              return {
                productId: Number(pid) || 0,
                quantity: Number(it.quantity || 1),
                unitPrice: p,
                remark: it.remark || ''
              };
            });
            const cleanData: any = {
              customerId: rawData.customerId,
              customerName: rawData.customerName,
              invoiceDate: rawData.invoiceDate,
              remark: rawData.remark,
              termType: rawData.termType,
              items: cleanItems
            };
            console.log('[SyncService] Sending clean UPDATE_INVOICE payload to invId:', invId, cleanData);
            await firstValueFrom(this.api.updateInvoiceDirect(invId, cleanData));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_INVOICE') {
            try {
              await firstValueFrom(this.api.deleteInvoiceDirect(task.payload.invoiceId));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_CN') {
            let invId = task.payload?.invoiceId;
            let realServerInvId: number | null = null;

            // 1. Check if invId is already a valid server integer ID
            const numInvId = Number(invId);
            if (!isNaN(numInvId) && numInvId > 0 && numInvId < 100000000) {
              realServerInvId = numInvId;
            }

            // 2. If it's an offline ID (UUID, offline_, inv_, OFFLINE-), look up the serverId
            if (!realServerInvId && invId) {
              const strInvId = String(invId);
              const order = await this.localDb.getOrderByClientId(strInvId);
              if (order && order.serverId) {
                realServerInvId = order.serverId;
              } else {
                const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
                const matched = cachedInvs.find(inv =>
                  String(inv.id) === strInvId ||
                  inv.offlineId === strInvId ||
                  inv.clientId === strInvId ||
                  inv.docNo === strInvId ||
                  inv.invoiceNumber === strInvId
                );
                if (matched && matched.serverId) {
                  realServerInvId = matched.serverId;
                } else if (matched && typeof matched.id === 'number' && matched.id > 0 && matched.id < 100000000) {
                  realServerInvId = matched.id;
                }
              }
            }

            // 3. Try to sync via specific invoice endpoint if server ID is resolved
            let synced = false;
            if (realServerInvId) {
              try {
                const url = `${baseUrl}/Credit/CreateCreditNote/invoices/${realServerInvId}/credit-notes`;
                await firstValueFrom(this.api.postDirect(url, task.payload.data));
                synced = true;
              } catch (err: any) {
                console.warn('[SyncService] Specific invoice CN failed, attempting global fallback:', err);
              }
            }

            // 4. Fallback to CreateGlobalCreditNote for the customer if invoice endpoint fails or ID not resolved
            if (!synced) {
              const custId = task.payload?.customerId || task.payload?.data?.customerId;
              if (custId) {
                const url = `${baseUrl}/Credit/CreateGlobalCreditNote/customers/${custId}/credit-notes-global`;
                const globalData = {
                  ...task.payload.data,
                  preferredInvoiceId: realServerInvId || undefined
                };
                await firstValueFrom(this.api.postDirect(url, globalData));
                synced = true;
              } else {
                throw new Error('Cannot sync CN: Missing valid customerId and invoiceId');
              }
            }

            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_GLOBAL_CN') {
            let custId = task.payload.customerId;
            if (typeof custId === 'string' && custId.startsWith('cust_')) {
              const cachedCustomers = await this.offlineStorage.getCache<any[]>('customers') || [];
              const matched = cachedCustomers.find(c => String(c.id) === String(custId) || c.offlineId === custId);
              if (matched && typeof matched.id === 'number') {
                custId = matched.id;
              }
            }
            const url = `${baseUrl}/Credit/CreateGlobalCreditNote/customers/${custId}/credit-notes-global`;
            await firstValueFrom(this.api.postDirect(url, task.payload.data));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_CN') {
            const url = `${baseUrl}/Credit/UpdateCreditNote/credit-notes/${task.payload.cnId}`;
            await firstValueFrom(this.api.putDirect(url, task.payload.data));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_CN') {
            const url = `${baseUrl}/Credit/DeleteCreditNote/invoices/${task.payload.invoiceId}/credit-notes/${task.payload.cnId}`;
            try {
              await firstValueFrom(this.api.deleteDirect(url));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_BULK_PAYMENT') {
            const url = `${baseUrl}/Payment/CreateBulkPayment/bulk-payments`;
            const payload = JSON.parse(JSON.stringify(task.payload?.data || task.payload));

            // Map any offline invoiceId to real serverId if available
            if (Array.isArray(payload?.payments)) {
              for (const p of payload.payments) {
                if (typeof p.invoiceId === 'string' && (p.invoiceId.startsWith('offline_') || p.invoiceId.startsWith('inv_'))) {
                  const order = await this.localDb.getOrderByClientId(p.invoiceId);
                  if (order && order.serverId) {
                    p.invoiceId = order.serverId;
                  } else {
                    const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
                    const matched = cachedInvs.find(inv => inv.id === p.invoiceId || inv.offlineId === p.invoiceId);
                    if (matched && matched.serverId) {
                      p.invoiceId = matched.serverId;
                    }
                  }
                }
                p.invoiceId = Number(p.invoiceId);
              }
            }

            try {
              await firstValueFrom(this.api.postDirect(url, payload));
            } catch (payErr: any) {
              const errMsg = payErr?.error?.message || (typeof payErr?.error === 'string' ? payErr?.error : payErr?.message) || '';
              if (payErr?.status === 400 && String(errMsg).toLowerCase().includes('already fully paid')) {
                console.log('[SyncService] Bulk payment invoice already settled on server, resolving task:', task.id);
              } else {
                throw payErr;
              }
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'DELETE_PAYMENT') {
            const url = `${baseUrl}/Payment/DeletePayment/payments/${task.payload.paymentId}`;
            try {
              await firstValueFrom(this.api.deleteDirect(url));
            } catch (err: any) {
              if (err?.status !== 404) throw err;
            }
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
