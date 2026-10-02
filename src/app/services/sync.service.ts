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
        this.syncPendingOrders().catch(e => console.error('[SyncService] Window online trigger error:', e));
      });
      window.addEventListener('focus', () => {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          this.syncPendingOrders().catch(e => console.error('[SyncService] Focus trigger error:', e));
        }
      });
    }

    // 4. 定时心跳轮询兜底（每 8 秒）：网络恢复时保证自动无感同步
    setInterval(() => {
      if (!this.isSyncing && (typeof navigator === 'undefined' || navigator.onLine)) {
        this.offlineStorage.getPendingQueue().then(queue => {
          if (queue && queue.length > 0) {
            console.log('[SyncService] Heartbeat auto-sync trigger: pending items =', queue.length);
            this.syncPendingOrders().catch(e => console.warn('[SyncService] Heartbeat sync error:', e));
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

    try {
      // 1. 从 LocalDbService 获取所有 PENDING 订单（已按 created_at 升序排列）
      const pendingOrders = await this.localDb.getPendingOrders();

      for (const order of pendingOrders) {
        if (order.sync_retry_count >= this.MAX_RETRY_LIMIT && order.last_sync_error?.includes('400')) {
          continue;
        }

        const payload = this.buildInvoicePayload(order);

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
            console.error('[SyncService] Client data error on order:', order.clientId, errMsg);
            await this.localDb.markSyncFailed(order.clientId, `Data Error: ${errMsg}`);
          }
        }
      }

      // 2. 全量同步 offlineStorage 中的各类任务（发票创建、发票修改、发票删除、CN操作等）
      const offlineRes = await this.syncOfflineTasks(forceRetry);
      successCount += offlineRes.successCount;
      failCount += offlineRes.failCount;

    } finally {
      this.isSyncing = false;
      this.isSyncingSubject.next(false);
    }

    const result: SyncResult = {
      successCount,
      failCount,
      totalProcessed: successCount + failCount
    };

    this.syncCompletedSubject.next(result);
    return result;
  }

  /**
   * 组装与后端 CreateInvoiceDto 严格一致的上传数据载荷
   */
  private buildInvoicePayload(order: FullOrder): any {
    return {
      customerId: order.customerId,
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
      items: (order.items || []).map(it => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        remark: it.remark || ''
      }))
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
    try {
      const status = await Network.getStatus();
      if (status && typeof status.connected === 'boolean') {
        return status.connected;
      }
    } catch {}
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  /**
   * 全量同步 offlineStorage 中的所有任务类型：
   * - CREATE_INVOICE: 发票上传
   * - UPDATE_INVOICE: 发票修改
   * - DELETE_INVOICE: 发票作废
   * - CREATE_CN / CREATE_GLOBAL_CN: 点数单/退货单新建
   * - UPDATE_CN: 点数单修改
   * - DELETE_CN: 点数单删除
   */
  private async syncOfflineTasks(forceRetry: boolean = false): Promise<{ successCount: number; failCount: number }> {
    let successCount = 0;
    let failCount = 0;

    try {
      const pending = await this.offlineStorage.getPendingQueue();
      const baseUrl = (this.api as any).baseUrl;

      for (const task of pending) {
        if (!forceRetry && (task.status === 'failed' || task.retryCount >= this.MAX_RETRY_LIMIT)) {
          continue;
        }

        try {
          if (task.type === 'CREATE_INVOICE') {
            const res = await firstValueFrom(this.api.postInvoiceDirect(task.payload));
            const serverId = res?.invoiceId || res?.id || 0;
            try { await this.localDb.markAsSynced(task.id, serverId); } catch {}
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'UPDATE_INVOICE') {
            console.log('[SyncService] Processing UPDATE_INVOICE:', task.id, task.payload);
            const rawData = task.payload?.data || task.payload || {};
            const invId = task.payload?.invoiceId || task.payload?.id || String(task.id).replace('upd_inv_', '');
            const cleanItems = (rawData.items || []).map((it: any) => {
              let p = it.unitPrice != null ? Number(it.unitPrice) : null;
              if (p !== null && p <= 0) {
                p = null; // 转换为 null，使后端自动按特价/原价取值，避免 400 校验错误
              }
              return {
                productId: Number(it.productId),
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
            const url = `${baseUrl}/Credit/CreateCreditNote/invoices/${task.payload.invoiceId}/credit-notes`;
            await firstValueFrom(this.api.postDirect(url, task.payload.data));
            await this.offlineStorage.removeQueueItem(task.id);
            successCount++;
          } else if (task.type === 'CREATE_GLOBAL_CN') {
            const url = `${baseUrl}/Credit/CreateGlobalCreditNote/customers/${task.payload.customerId}/credit-notes-global`;
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
          task.lastError = e?.message || 'Data error';
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

    return { successCount, failCount };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
