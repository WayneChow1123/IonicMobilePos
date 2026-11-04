import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type QueueItemStatus = 'pending' | 'syncing' | 'failed';

export interface SyncQueueItem<T = any> {
  id: string;
  type: string;
  payload: T;
  createdAt: number;
  status: QueueItemStatus;
  retryCount: number;
  lastError?: string;
  operationId?: string;
  attemptedAt?: number;
}

export interface CacheEntry<T = any> {
  key: string;
  data: T;
  updatedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class OfflineStorageService {
  private readonly DB_NAME = 'TDMobilePOS_OfflineDB';
  private readonly DB_VERSION = 2;
  private readonly STORE_QUEUE = 'sync_queue';
  private readonly STORE_CACHE = 'master_cache';

  private memoryCache = new Map<string, any>();
  private attemptedOperations = new Map<string, number>();

  public wasAttempted(operationId: string): boolean { return this.attemptedOperations.has(operationId); }

  public registerAttempt(operationId: string): void {
    this.attemptedOperations.set(operationId, Date.now());
    if (this.attemptedOperations.size > 1000) {
      this.attemptedOperations.delete(this.attemptedOperations.keys().next().value!);
    }
  }
  private dbPromise: Promise<IDBDatabase> | null = null;
  private queueCountSubject = new BehaviorSubject<number>(0);
  public queueCount$: Observable<number> = this.queueCountSubject.asObservable();

  constructor() {
    this.refreshQueueCount();
  }

  /**
   * 初始化并获取 IndexedDB 数据库连接实例
   */
  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this environment'));
        return;
      }

      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_QUEUE)) {
          const queueStore = db.createObjectStore(this.STORE_QUEUE, { keyPath: 'id' });
          queueStore.createIndex('status', 'status', { unique: false });
          queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(this.STORE_CACHE)) {
          db.createObjectStore(this.STORE_CACHE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };
    });

    return this.dbPromise;
  }

  /**
   * 生成唯一 ID（优先使用 crypto.randomUUID，降级使用时间戳+随机数）
   */
  public generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'offline_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  public async resolveServerId(type: string, id: any): Promise<number> {
    const map = await this.getCache<Record<string, number>>('server_id_map') || {};
    const value = map[`${type}:${id}`] ?? Number(id);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Waiting for ${type} ${id} to sync`);
    }
    return value;
  }

  /** Persist identity mappings before removing creates, including dependent caches. */
  public async mapServerId(type: 'invoice' | 'customer' | 'product' | 'category' | 'cn' | 'payment', oldId: any, serverId: number): Promise<void> {
    if (!Number.isSafeInteger(Number(serverId)) || Number(serverId) <= 0) {
      throw new Error(`Missing server ID for ${type}`);
    }
    const map = await this.getCache<Record<string, number>>('server_id_map') || {};
    map[`${type}:${oldId}`] = Number(serverId);
    await this.setCache('server_id_map', map);
    const foreignKey = { invoice: 'invoiceId', customer: 'customerId', product: 'productId',
      category: 'categoryId', cn: 'cnId', payment: 'paymentId' }[type];
    const entityCache = { invoice: 'invoices_list', customer: 'customers', product: 'products',
      category: 'categories', cn: 'credit_notes_list', payment: 'payments_list' }[type];
    const replace = (value: any, ownIds: boolean): any => {
      if (Array.isArray(value)) return value.map(v => replace(v, ownIds));
      if (!value || typeof value !== 'object') return value;
      const result: any = {};
      for (const [key, child] of Object.entries(value)) {
        const isId = key.toLowerCase() === foreignKey?.toLowerCase() ||
          (ownIds && key.toLowerCase() === 'id');
        result[key] = isId && String(child) === String(oldId) ? Number(serverId) : replace(child, false);
      }
      if (ownIds && String(value.id) === String(oldId)) {
        result.offlineId = oldId;
        result.isOffline = false;
      }
      return result;
    };
    for (const task of await this.getAllQueue()) {
      const ownIds = task.type.endsWith('_' + type.toUpperCase());
      task.payload = replace(task.payload, ownIds);
      await this.updateQueueItem(task);
    }
    const keys = new Set(this.memoryCache.keys());
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('td_cache_')) keys.add(key.slice(9));
      }
      const db = await this.getDB();
      const storedKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = db.transaction(this.STORE_CACHE, 'readonly').objectStore(this.STORE_CACHE).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      storedKeys.forEach(key => keys.add(String(key)));
    } catch { /* localStorage and in-memory keys remain available */ }
    for (const key of keys) {
      if (key === 'server_id_map') continue;
      const detailPrefix = { invoice: 'inv_detail_', customer: 'customer_detail_', cn: 'cn_detail_', product: '', category: '', payment: 'payment_detail_' }[type];
      const ownIds = key === entityCache || (type === 'cn' && key.startsWith('available_credits_')) || (!!detailPrefix && key === detailPrefix + oldId);
      const data = replace(await this.getCache(key), ownIds);
      await this.setCache(key, data);
      if (detailPrefix && key === detailPrefix + oldId) await this.setCache(detailPrefix + serverId, data);
      if (type === 'customer' && key === 'customer_prices_' + oldId) {
        await this.setCache('customer_prices_' + serverId, data);
      }
    }
  }

  /**
   * 获取或初始化本机台唯一编号 (Terminal ID)，防止多台设备离线开单冲突
   */
  public getTerminalId(): string {
    const KEY = 'pos_terminal_id';
    let tid = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!tid) {
      const rand = Math.floor(100 + Math.random() * 900);
      tid = `T${rand}`;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY, tid);
      }
    }
    return tid;
  }

  /**
   * 生成全局防撞离线单号：INV-{TerminalID}-{yyyyMMddHHmmss}-{随机2位}
   */
  public generateInvoiceNumber(): string {
    const tid = this.getTerminalId();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const rand = Math.floor(10 + Math.random() * 90).toString();
    return `INV-${tid}-${timeStr}-${rand}`;
  }

  /**
   * 根据 ID 查询特定队列项
   */
  public async getQueueItemById(id: string): Promise<SyncQueueItem | null> {
    try {
      const db = await this.getDB();
      return await new Promise<SyncQueueItem | null>((resolve) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readonly');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      const list = this.getFromLocalStorageFallback();
      return list.find(x => x.id === id) || null;
    }
  }

  /**
   * 将待同步任务加入本地离线队列
   */
  public async enqueue<T>(type: string, payload: T, customId?: string): Promise<SyncQueueItem<T>> {
    // A request whose response was lost must be replayed with its original payload.
    const previous = customId ? await this.getQueueItemById(customId) : null;
    if (previous?.attemptedAt) customId += '_' + this.generateId();
    const item: SyncQueueItem<T> = {
      id: customId || this.generateId(),
      type,
      payload,
      createdAt: Date.now(),
      status: 'pending',
      retryCount: 0,
      operationId: (payload as any)?._offlineOperationId || (payload as any)?.data?._offlineOperationId || this.generateId()
    };
    item.attemptedAt = this.attemptedOperations.get(item.operationId!);

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.put(item);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));
        req.onerror = () => reject(req.error);
      });
    } catch {
      // 降级使用 localStorage 存储队列
      this.saveToLocalStorageFallback(item);
    }

    await this.refreshQueueCount();
    return item;
  }

  /**
   * 获取所有待同步（pending）或失败重试中的离线任务，按创建时间正序排列
   */
  public async getPendingQueue(): Promise<SyncQueueItem[]> {
    try {
      const db = await this.getDB();
      return await new Promise<SyncQueueItem[]>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readonly');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.getAll();
        req.onsuccess = () => {
          const list: SyncQueueItem[] = req.result || [];
          const pending = list
            .filter(item => item.status === 'pending' || item.status === 'failed')
            .sort((a, b) => a.createdAt - b.createdAt);
          resolve(pending);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.getFromLocalStorageFallback()
        .filter(item => item.status === 'pending' || item.status === 'failed')
        .sort((a, b) => a.createdAt - b.createdAt);
    }
  }

  /**
   * 获取所有队列项（包含 pending, syncing, failed）
   */
  public async getAllQueue(): Promise<SyncQueueItem[]> {
    try {
      const db = await this.getDB();
      return await new Promise<SyncQueueItem[]>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readonly');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.getAll();
        req.onsuccess = () => {
          const list: SyncQueueItem[] = req.result || [];
          resolve(list.sort((a, b) => a.createdAt - b.createdAt));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.getFromLocalStorageFallback().sort((a, b) => a.createdAt - b.createdAt);
    }
  }

  /**
   * 更新队列项的状态（如更新为 syncing 或记录重试失败原因）
   */
  public async updateQueueItem(item: SyncQueueItem): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.put(item);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));
        req.onerror = () => reject(req.error);
      });
    } catch {
      const list = this.getFromLocalStorageFallback();
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) {
        list[idx] = item;
      } else {
        list.push(item);
      }
      localStorage.setItem('td_offline_sync_queue', JSON.stringify(list));
    }
    await this.refreshQueueCount();
  }

  /**
   * 任务同步成功后从队列中移除
   */
  public async removeQueueItem(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));
        req.onerror = () => reject(req.error);
      });
    } catch {
      let list = this.getFromLocalStorageFallback();
      list = list.filter(x => x.id !== id);
      localStorage.setItem('td_offline_sync_queue', JSON.stringify(list));
    }
    await this.refreshQueueCount();
  }

  /**
   * 清空待处理队列
   */
  public async clearQueue(): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.STORE_QUEUE, 'readwrite');
        const store = tx.objectStore(this.STORE_QUEUE);
        const req = store.clear();
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));
        req.onerror = () => reject(req.error);
      });
    } catch {
      localStorage.removeItem('td_offline_sync_queue');
    }
    await this.refreshQueueCount();
  }

  /**
   * 刷新并推送待处理队列数量
   */
  public async refreshQueueCount(): Promise<number> {
    try {
      const pending = await this.getPendingQueue();
      const count = pending.length;
      this.queueCountSubject.next(count);
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * 保存离线基础数据缓存（如商品列表、客户列表等）
   */
  public async setCache<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { key, data, updatedAt: Date.now() };
    let persisted = false;
    try {
      localStorage.setItem('td_cache_' + key, JSON.stringify(entry));
      persisted = true;
    } catch { /* IndexedDB can still store this entry. */ }
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.STORE_CACHE, 'readwrite');
        tx.objectStore(this.STORE_CACHE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Cache transaction aborted'));
        tx.onerror = () => reject(tx.error);
      });
      persisted = true;
    } catch { /* localStorage is a persistent fallback. */ }
    if (!persisted) throw new Error('Unable to save offline data. Device storage may be full.');
    this.memoryCache.set(key, structuredClone(data));
  }

  /**
   * 读取离线基础数据缓存
   */
  public async getCache<T>(key: string): Promise<T | null> {
    if (this.memoryCache.has(key)) {
      return structuredClone(this.memoryCache.get(key)) as T;
    }
    try {
      const raw = localStorage.getItem('td_cache_' + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data !== undefined) {
          this.memoryCache.set(key, parsed.data);
          return parsed.data as T;
        }
      }
    } catch {}

    try {
      const db = await this.getDB();
      if (db.objectStoreNames.contains(this.STORE_CACHE)) {
        return await new Promise<T | null>((resolve) => {
          const tx = db.transaction(this.STORE_CACHE, 'readonly');
          const store = tx.objectStore(this.STORE_CACHE);
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result && req.result.data !== undefined) {
              this.memoryCache.set(key, req.result.data);
              resolve(req.result.data as T);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        });
      }
    } catch {}

    return null;
  }

  public async removeCache(key: string): Promise<void> {
    this.memoryCache.delete(key);
    try {
      localStorage.removeItem('td_cache_' + key);
    } catch {}
    try {
      const db = await this.getDB();
      if (db.objectStoreNames.contains(this.STORE_CACHE)) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(this.STORE_CACHE, 'readwrite');
          const store = tx.objectStore(this.STORE_CACHE);
          const req = store.delete(key);
          tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Offline transaction aborted'));
          req.onerror = () => reject(req.error);
        });
      }
    } catch {}
  }

  // --- LocalStorage Fallback 辅助函数 ---
  private saveToLocalStorageFallback(item: SyncQueueItem): void {
    const list = this.getFromLocalStorageFallback();
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) {
      list[idx] = item;
    } else {
      list.push(item);
    }
    localStorage.setItem('td_offline_sync_queue', JSON.stringify(list));
  }

  private getFromLocalStorageFallback(): SyncQueueItem[] {
    try {
      const raw = localStorage.getItem('td_offline_sync_queue');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}
