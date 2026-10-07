import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, from, throwError, firstValueFrom } from 'rxjs';
import { map, tap, catchError, switchMap, timeout } from 'rxjs/operators';
import { Network } from '@capacitor/network';
import { updateInvoiceDocNos, formatDocNo } from '../utils/invoice-helper';
import { OfflineStorageService } from './offline-storage.service';
import { LocalDbService, SyncStatus } from './local-db.service';

@Injectable({
  providedIn: 'root'
})
export class ApiService {

  // private baseUrl = 'http://localhost:5262';
  private baseUrl = 'https://td.mobile.pos.xcode.com.my';

  private cachedCustomers: any[] | null = null;
  private cachedProducts: any[] | null = null;
  public isNetworkOnline: boolean = true;

  constructor(
    private http: HttpClient,
    private offlineStorage: OfflineStorageService,
    private localDb: LocalDbService
  ) {
    this.initNetworkStatus();
  }

  private initNetworkStatus() {
    try {
      Network.getStatus().then(status => {
        this.isNetworkOnline = status.connected;
      }).catch(() => {
        this.isNetworkOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      });

      Network.addListener('networkStatusChange', status => {
        this.isNetworkOnline = status.connected;
      });
    } catch {
      this.isNetworkOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.isNetworkOnline = true; });
      window.addEventListener('offline', () => { this.isNetworkOnline = false; });
    }
  }

  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }
    return this.isNetworkOnline;
  }

  clearCustomerCache() {
    this.cachedCustomers = null;
  }

  clearProductCache() {
    this.cachedProducts = null;
  }

  clearAllCache() {
    this.cachedCustomers = null;
    this.cachedProducts = null;
  }

  getFullBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/full'); }
  getIncrementBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/increment'); }
  downloadBackup(id: string): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/download/' + id); }

  createCategory(data: any): Observable<any> { return this.http.post(this.baseUrl + '/Category/CreateCategory/createcategory', data); }
  getCategories(): Observable<any> { return this.http.get(this.baseUrl + '/Category/GetCategories/categories'); }
  editCategory(id: any, data: any): Observable<any> { return this.http.put(this.baseUrl + '/Category/EditCategory/editcategory/' + id, data); }
  deleteCategory(id: any): Observable<any> { return this.http.delete(this.baseUrl + '/Category/DeleteCategory/deletecategory/' + id, { responseType: 'text' }); }

  createCreditNote(invoiceId: any, data: any, extraInfo?: any): Observable<any> {
    const saveOfflineCN = () => {
      const offlineId = 'cn_' + Date.now();
      const cnNumber = 'CN-OFFLINE-' + String(Date.now()).slice(-6);
      const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);

      this.offlineStorage.getCache<any[]>('credit_notes_list').then(cached => {
        const list = cached || [];
        const newEntry = {
          id: offlineId,
          cnNumber,
          invoiceId,
          customerId: extraInfo?.customerId || 0,
          customerName: extraInfo?.customerName || '',
          amount: totalAmount,
          createdAt: new Date().toISOString(),
          reason: data?.reason || '',
          items: data?.items || [],
          Items: data?.items || [],
          isOffline: true
        };
        this.offlineStorage.setCache('credit_notes_list', [newEntry, ...list]);
      });

      return from(
        this.offlineStorage.enqueue('CREATE_CN', {
          invoiceId,
          data,
          offlineId,
          cnNumber,
          customerName: extraInfo?.customerName,
          customerId: extraInfo?.customerId
        }, offlineId).then(() => ({
          message: 'Credit Note created offline (Queued for sync)',
          id: offlineId,
          cnNumber,
          customerName: extraInfo?.customerName,
          amount: totalAmount,
          isOffline: true
        }))
      );
    };

    if (!this.isOnline() || String(invoiceId).startsWith('inv_') || String(invoiceId).startsWith('offline_')) {
      return saveOfflineCN();
    }

    return this.http.post(this.baseUrl + '/Credit/CreateCreditNote/invoices/' + invoiceId + '/credit-notes', data).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => saveOfflineCN())
    );
  }

  createGlobalCreditNote(customerId: any, data: any, extraInfo?: any): Observable<any> {
    const saveOfflineGlobalCN = () => {
      const offlineId = 'cn_g_' + Date.now();
      const cnNumber = 'CN-GLOBAL-OFFLINE-' + String(Date.now()).slice(-6);
      const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);

      this.offlineStorage.getCache<any[]>('credit_notes_list').then(cached => {
        const list = cached || [];
        const newEntry = {
          id: offlineId,
          cnNumber,
          invoiceId: 0,
          customerId,
          customerName: extraInfo?.customerName || '',
          amount: totalAmount,
          createdAt: new Date().toISOString(),
          reason: data?.reason || '',
          items: data?.items || [],
          Items: data?.items || [],
          isOffline: true
        };
        this.offlineStorage.setCache('credit_notes_list', [newEntry, ...list]);
      });

      return from(
        this.offlineStorage.enqueue('CREATE_GLOBAL_CN', {
          customerId,
          data,
          offlineId,
          cnNumber,
          customerName: extraInfo?.customerName
        }, offlineId).then(() => ({
          message: 'Global Credit Note created offline (Queued for sync)',
          id: offlineId,
          cnNumber,
          customerName: extraInfo?.customerName,
          amount: totalAmount,
          isOffline: true
        }))
      );
    };

    if (!this.isOnline()) {
      return saveOfflineGlobalCN();
    }

    return this.http.post(this.baseUrl + '/Credit/CreateGlobalCreditNote/customers/' + customerId + '/credit-notes-global', data).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => saveOfflineGlobalCN())
    );
  }

  getCreditNotesByInvoice(invoiceId: any): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetCreditNotesByInvoice/invoices/' + invoiceId + '/credit-notes').pipe(timeout(3500), catchError(() => of([]))); }
  getCreditNoteById(invoiceId: any, cnId: any): Observable<any> {
    const fetchOfflineCN = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const found = cached.find((c: any) => String(c.id ?? c.Id) === String(cnId));
      if (found) return found;
      const queue = await this.offlineStorage.getPendingQueue();
      const task = queue.find(q => String(q.id) === String(cnId) || String(q.payload?.cnId) === String(cnId));
      if (task) {
        return {
          id: task.id,
          cnNumber: task.payload?.cnNumber || ('CN-OFFLINE-' + task.id),
          invoiceId: task.payload?.invoiceId || 0,
          customerId: task.payload?.customerId || 0,
          customerName: task.payload?.customerName || '',
          amount: (task.payload?.data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0),
          createdAt: new Date(task.createdAt).toISOString(),
          reason: task.payload?.data?.reason || '',
          items: task.payload?.data?.items || [],
          Items: task.payload?.data?.items || [],
          isOffline: true
        };
      }
      return null;
    };

    if (!this.isOnline() || String(cnId).startsWith('cn_')) {
      return from(fetchOfflineCN());
    }

    return this.http.get(this.baseUrl + '/Credit/GetCreditNoteById/invoices/' + invoiceId + '/credit-notes/' + cnId).pipe(
      timeout(3500),
      catchError(() => from(fetchOfflineCN()))
    );
  }
  getAvailableCredits(customerId: number): Observable<any> { return this.http.get(this.baseUrl + '/Credit/GetAvailableCredits/customers/' + customerId + '/available-credits').pipe(timeout(3500), catchError(() => of([]))); }

  useCreditNote(invoiceId: number, cnId: number): Observable<any> {
    return this.http.patch(this.baseUrl + '/Credit/UseCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId + '/use', {}).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  updateCreditNote(cnId: any, data: any): Observable<any> {
    const saveOfflineUpdateCN = async () => {
      if (String(cnId).startsWith('cn_')) {
        const item = await this.offlineStorage.getQueueItemById(String(cnId));
        if (item && item.payload) {
          item.payload.data = data;
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('UPDATE_CN', { cnId, data }, 'upd_cn_' + cnId);
      }

      // 同步更新本地缓存
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const updated = cached.map(c => {
        if (String(c.id) === String(cnId)) {
          const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
          return {
            ...c,
            amount: totalAmount || c.amount,
            reason: data?.reason ?? c.reason,
            items: data?.items || c.items,
            Items: data?.items || c.items
          };
        }
        return c;
      });
      await this.offlineStorage.setCache('credit_notes_list', updated);

      return {
        message: 'Credit Note updated offline (Queued for sync)',
        id: cnId,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(cnId).startsWith('cn_')) {
      return from(saveOfflineUpdateCN());
    }

    return this.http.put(this.baseUrl + '/Credit/UpdateCreditNote/credit-notes/' + cnId, data).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => from(saveOfflineUpdateCN()))
    );
  }

  deleteCreditNote(invoiceId: any, cnId: any): Observable<any> {
    const saveOfflineDeleteCN = async () => {
      if (String(cnId).startsWith('cn_')) {
        await this.offlineStorage.removeQueueItem(String(cnId));
        await this.offlineStorage.removeQueueItem('upd_cn_' + cnId);
        await this.offlineStorage.refreshQueueCount();
      } else {
        await this.offlineStorage.enqueue('DELETE_CN', { invoiceId, cnId }, 'del_cn_' + cnId);
      }

      // 从缓存中直接过滤移除
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const updated = cached.filter(c => String(c.id) !== String(cnId));
      await this.offlineStorage.setCache('credit_notes_list', updated);

      return {
        message: 'Credit Note removed offline',
        id: cnId,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(cnId).startsWith('cn_')) {
      return from(saveOfflineDeleteCN());
    }

    return this.http.delete(this.baseUrl + '/Credit/DeleteCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId, { responseType: 'text' }).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => from(saveOfflineDeleteCN()))
    );
  }

  getAllCreditNotes(): Observable<any> {
    const mapOfflineCNs = (queue: any[]) => {
      return queue
        .filter(q => q.type === 'CREATE_CN' || q.type === 'CREATE_GLOBAL_CN')
        .map(q => {
          const items = q.payload?.data?.items || [];
          const totalAmount = items.reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
          return {
            id: q.id,
            cnNumber: q.payload?.cnNumber || ('CN-OFFLINE-' + q.id),
            invoiceId: q.payload?.invoiceId || 0,
            customerId: q.payload?.customerId || 0,
            customerName: q.payload?.customerName || '',
            amount: totalAmount,
            createdAt: new Date(q.createdAt).toISOString(),
            reason: q.payload?.data?.reason || '',
            items: items,
            Items: items,
            isOffline: true
          };
        });
    };

    const fetchOfflineFallback = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const offlineCNs = mapOfflineCNs(queue);
      const deletedCNIds = queue
        .filter(q => q.type === 'DELETE_CN')
        .map(q => String(q.payload?.cnId));
      return [...offlineCNs, ...cached].filter(c => !deletedCNIds.includes(String(c.id)));
    };

    if (!this.isOnline()) {
      return from(fetchOfflineFallback());
    }

    return this.http.get(this.baseUrl + '/Credit/GetAllCreditNotes/credit-notes/list').pipe(
      timeout(3500),
      tap((res: any) => {
        if (Array.isArray(res)) {
          this.offlineStorage.setCache('credit_notes_list', res);
        }
      }),
      switchMap((serverList: any) => from((async () => {
        const queue = await this.offlineStorage.getPendingQueue();
        const offlineCNs = mapOfflineCNs(queue);
        const deletedCNIds = queue
          .filter(q => q.type === 'DELETE_CN')
          .map(q => String(q.payload?.cnId));
        return [...offlineCNs, ...(Array.isArray(serverList) ? serverList : [])].filter(c => !deletedCNIds.includes(String(c.id)));
      })())),
      catchError(() => from(fetchOfflineFallback()))
    );
  }

  createCustomer(data: any): Observable<any> {
    const saveOfflineCustomer = () => {
      const offlineId = 'cust_off_' + Date.now();
      const newCustomer = {
        id: offlineId,
        customerCode: data.customerCode || ('CUST-OFFLINE-' + String(Date.now()).slice(-6)),
        name: data.name || '',
        customerCategory: data.customerCategory || 'DEFAULT',
        term: data.term || 'Cash Sale',
        sequence: Number(data.sequence) || 0,
        description: data.description || '',
        processCompany: data.processCompany || 'ALL COMPANY',
        taxStatus: data.taxStatus || 'Un-Defined',
        taxDocNo: data.taxDocNo || '',
        discountPercent: Number(data.discountPercent) || 0,
        enableDiscount: data.enableDiscount != null ? !!data.enableDiscount : true,
        requireDigitSign: !!data.requireDigitSign,
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        branches: data.branches || [],
        isOffline: true,
        createdAt: new Date().toISOString()
      };

      this.offlineStorage.getCache<any[]>('customers').then(cached => {
        const list = cached || [];
        this.offlineStorage.setCache('customers', [newCustomer, ...list]);
      });

      if (this.cachedCustomers) {
        this.cachedCustomers = [newCustomer, ...this.cachedCustomers];
      }

      return from(
        this.offlineStorage.enqueue('CREATE_CUSTOMER', data, offlineId).then(() => ({
          message: 'Customer created offline (Queued for sync)',
          id: offlineId,
          data: newCustomer,
          isOffline: true
        }))
      );
    };

    if (!this.isOnline()) {
      return saveOfflineCustomer();
    }

    return this.http.post(this.baseUrl + '/Customer/CreateCustomers/createcustomers', data).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => saveOfflineCustomer())
    );
  }
  getAllCustomers(forceRefresh = false): Observable<any> {
    const mapOfflineCustomers = (queue: any[]) => {
      return queue
        .filter(q => q.type === 'CREATE_CUSTOMER')
        .map(q => {
          const p = q.payload?.data || q.payload || {};
          return {
            id: q.id,
            customerCode: p.customerCode || ('CUST-OFFLINE-' + String(q.id).slice(-6)),
            name: p.name || '',
            customerCategory: p.customerCategory || 'DEFAULT',
            term: p.term || 'Cash Sale',
            sequence: Number(p.sequence) || 0,
            description: p.description || '',
            processCompany: p.processCompany || 'ALL COMPANY',
            taxStatus: p.taxStatus || 'Un-Defined',
            taxDocNo: p.taxDocNo || '',
            discountPercent: Number(p.discountPercent) || 0,
            enableDiscount: p.enableDiscount != null ? !!p.enableDiscount : true,
            requireDigitSign: !!p.requireDigitSign,
            phone: p.phone || '',
            email: p.email || '',
            address: p.address || '',
            branches: p.branches || [],
            isOffline: true,
            createdAt: new Date(q.createdAt).toISOString()
          };
        });
    };

    const fetchOfflineCustomers = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('customers') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const offlineCusts = mapOfflineCustomers(queue);
      const deletedIds = new Set(
        queue.filter(q => q.type === 'DELETE_CUSTOMER').map(q => String(q.payload?.id || q.id))
      );
      const seen = new Set<string>();
      const result: any[] = [];
      for (const c of [...offlineCusts, ...cached]) {
        const idKey = String(c.id || '');
        if (idKey && deletedIds.has(idKey)) continue;
        if (!idKey || !seen.has(idKey)) {
          if (idKey) seen.add(idKey);
          result.push(c);
        }
      }
      this.cachedCustomers = result;
      return result;
    };

    if (!this.isOnline()) {
      if (this.cachedCustomers) return of(this.cachedCustomers);
      return from(fetchOfflineCustomers());
    }

    if (!forceRefresh && this.cachedCustomers) {
      this.http.get(this.baseUrl + '/Customer/GetAllCustomer/getallcustomer').subscribe({
        next: async (res: any) => {
          if (Array.isArray(res)) {
            const queue = await this.offlineStorage.getPendingQueue();
            const offlineCusts = mapOfflineCustomers(queue);
            const deletedIds = new Set(
              queue.filter(q => q.type === 'DELETE_CUSTOMER').map(q => String(q.payload?.id || q.id))
            );
            const seen = new Set<string>();
            const result: any[] = [];
            for (const c of [...offlineCusts, ...res]) {
              const idKey = String(c.id || '');
              if (idKey && deletedIds.has(idKey)) continue;
              if (!idKey || !seen.has(idKey)) {
                if (idKey) seen.add(idKey);
                result.push(c);
              }
            }
            this.cachedCustomers = result;
            this.offlineStorage.setCache('customers', result);
            this.preloadAllCustomerPrices(result);
          }
        },
        error: () => { }
      });
      return of(this.cachedCustomers);
    }
    return this.http.get(this.baseUrl + '/Customer/GetAllCustomer/getallcustomer').pipe(
      timeout(3500),
      switchMap((res: any) => from((async () => {
        if (Array.isArray(res)) {
          const queue = await this.offlineStorage.getPendingQueue();
          const offlineCusts = mapOfflineCustomers(queue);
          const seen = new Set<string>();
          const result: any[] = [];
          for (const c of [...offlineCusts, ...res]) {
            const idKey = String(c.id || '');
            if (!idKey || !seen.has(idKey)) {
              if (idKey) seen.add(idKey);
              result.push(c);
            }
          }
          this.cachedCustomers = result;
          this.offlineStorage.setCache('customers', result);
          this.preloadAllCustomerPrices(result);
          return result;
        }
        return res;
      })())),
      catchError(() => from(fetchOfflineCustomers()))
    );
  }

  private preloadAllCustomerPrices(customers: any[]) {
    if (!Array.isArray(customers) || customers.length === 0 || !this.isOnline()) return;

    customers.forEach((c, index) => {
      const cid = c.id ?? c.Id;
      if (!cid) return;
      setTimeout(() => {
        if (!this.isOnline()) return;
        this.http.get(this.baseUrl + '/Customer/GetCustomerProductPrices/customers/' + cid + '/product-prices').pipe(
          timeout(5000),
          catchError(() => of([]))
        ).subscribe((prices: any) => {
          if (Array.isArray(prices) && prices.length > 0) {
            const normalized = prices.map(item => ({
              id: item.id ?? item.Id,
              productId: Number(item.productId ?? item.ProductId),
              customerId: Number(item.customerId ?? item.CustomerId ?? cid),
              specialPrice: Number((item.specialPrice !== undefined ? item.specialPrice : item.SpecialPrice) ?? 0),
              productName: item.productName || item.ProductName || '',
              productCode: item.productCode || item.ProductCode || '',
              originalPrice: Number((item.originalPrice !== undefined ? item.originalPrice : item.OriginalPrice) ?? 0)
            }));
            this.offlineStorage.setCache('customer_prices_' + cid, normalized);
            this.offlineStorage.setCache('customer_prices_' + String(cid), normalized);

            this.offlineStorage.getCache<any[]>('all_customer_prices').then(existing => {
              const all = Array.isArray(existing) ? existing : [];
              const filtered = all.filter((p: any) => Number(p.customerId ?? p.CustomerId) !== Number(cid) && String(p.customerId ?? p.CustomerId) !== String(cid));
              this.offlineStorage.setCache('all_customer_prices', [...filtered, ...normalized]);
            });
          }
        });
      }, index * 60);
    });
  }
  getCustomerById(id: any): Observable<any> {
    const fetchOffline = async () => {
      const cached = await this.offlineStorage.getCache<any>('customer_detail_' + id);
      if (cached) return cached;
      const customers = await this.offlineStorage.getCache<any[]>('customers') || [];
      return customers.find((c: any) => c.id == id) || null;
    };

    if (!this.isOnline() || String(id).startsWith('cust_')) {
      return from(fetchOffline());
    }

    return this.http.get(this.baseUrl + '/Customer/GetCustomerById/getcustomersby/' + id).pipe(
      timeout(3500),
      tap((res: any) => {
        if (res) {
          this.offlineStorage.setCache('customer_detail_' + id, res);
          const pprices = res.productPrices || res.ProductPrices;
          if (Array.isArray(pprices) && pprices.length > 0) {
            this.offlineStorage.setCache('customer_prices_' + id, pprices);
          }
        }
      }),
      catchError(() => from(fetchOffline()))
    );
  }

  editCustomer(id: any, data: any): Observable<any> {
    const saveOfflineEdit = async () => {
      if (String(id).startsWith('cust_')) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item && item.payload) {
          const currentData = item.payload.data || item.payload;
          item.payload = {
            ...item.payload,
            ...(item.payload.data ? { data: { ...currentData, ...data } } : data)
          };
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('UPDATE_CUSTOMER', { id, data }, 'upd_cust_' + id);
      }

      const cachedList = await this.offlineStorage.getCache<any[]>('customers') || [];
      const updatedList = cachedList.map(c => {
        if (String(c.id) === String(id)) {
          return { ...c, ...data };
        }
        return c;
      });
      await this.offlineStorage.setCache('customers', updatedList);
      this.cachedCustomers = updatedList;

      const existingDetail = await this.offlineStorage.getCache<any>('customer_detail_' + id);
      if (existingDetail) {
        await this.offlineStorage.setCache('customer_detail_' + id, { ...existingDetail, ...data });
      }

      return {
        message: 'Customer updated offline (Queued for sync)',
        id,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(id).startsWith('cust_')) {
      return from(saveOfflineEdit());
    }

    return this.http.put(this.baseUrl + '/Customer/EditCustomer/editcustomers/' + id, data).pipe(
      timeout(4000),
      tap((res: any) => {
        this.clearCustomerCache();
        this.offlineStorage.getCache<any>('customer_detail_' + id).then(existing => {
          if (existing) {
            const updated = { ...existing, ...data };
            this.offlineStorage.setCache('customer_detail_' + id, updated);
          }
        });
      }),
      catchError(() => from(saveOfflineEdit()))
    );
  }

  deleteCustomer(id: any): Observable<any> {
    const saveOfflineDelete = async () => {
      if (String(id).startsWith('cust_')) {
        await this.offlineStorage.removeQueueItem(String(id));
        await this.offlineStorage.removeQueueItem('upd_cust_' + id);
        const pending = await this.offlineStorage.getPendingQueue();
        for (const q of pending) {
          if ((q.type === 'CREATE_CUSTOMER_PRICE' || q.type === 'UPDATE_CUSTOMER_PRICE' || q.type === 'DELETE_CUSTOMER_PRICE') && String(q.payload?.customerId) === String(id)) {
            await this.offlineStorage.removeQueueItem(q.id);
          }
        }
      } else {
        await this.offlineStorage.removeQueueItem('upd_cust_' + id);
        await this.offlineStorage.enqueue('DELETE_CUSTOMER', { id }, 'del_cust_' + id);
      }

      const cachedList = await this.offlineStorage.getCache<any[]>('customers') || [];
      const filteredList = cachedList.filter(c => String(c.id) !== String(id));
      await this.offlineStorage.setCache('customers', filteredList);
      this.cachedCustomers = filteredList;

      await this.offlineStorage.removeCache('customer_detail_' + id);
      await this.offlineStorage.removeCache('customer_prices_' + id);

      return {
        message: 'Customer deleted offline (Queued for sync)',
        id,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(id).startsWith('cust_')) {
      return from(saveOfflineDelete());
    }

    return this.http.delete(this.baseUrl + '/Customer/DeleteCustomer/deletecustomer/' + id, { responseType: 'text' }).pipe(
      timeout(4000),
      tap(() => {
        this.clearCustomerCache();
        this.offlineStorage.removeCache('customer_detail_' + id);
        this.offlineStorage.removeCache('customer_prices_' + id);
      }),
      catchError(() => from(saveOfflineDelete()))
    );
  }

  getAllCustomerProductPrices(): Observable<any[]> {
    const normalizeList = (list: any[]) => {
      if (!Array.isArray(list)) return [];
      return list.map(item => ({
        id: item.id ?? item.Id,
        productId: Number(item.productId ?? item.ProductId),
        customerId: Number(item.customerId ?? item.CustomerId),
        specialPrice: Number((item.specialPrice !== undefined ? item.specialPrice : item.SpecialPrice) ?? 0),
        productName: item.productName || item.ProductName || '',
        productCode: item.productCode || item.ProductCode || '',
        originalPrice: Number((item.originalPrice !== undefined ? item.originalPrice : item.OriginalPrice) ?? 0)
      }));
    };

    const fetchOffline = async () => {
      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      return normalizeList(allPrices);
    };

    if (!this.isOnline()) {
      return from(fetchOffline());
    }

    return this.http.get<any[]>(this.baseUrl + '/Customer/GetAllProductPrices/all-product-prices').pipe(
      timeout(3500),
      map((prices: any[]) => normalizeList(prices)),
      tap((prices: any[]) => {
        if (Array.isArray(prices)) {
          this.offlineStorage.setCache('all_customer_prices', prices);
          const groupMap: { [cid: number]: any[] } = {};
          for (const p of prices) {
            const cid = p.customerId;
            if (cid) {
              if (!groupMap[cid]) groupMap[cid] = [];
              groupMap[cid].push(p);
            }
          }
          for (const cid of Object.keys(groupMap)) {
            this.offlineStorage.setCache('customer_prices_' + cid, groupMap[Number(cid)]);
          }
        }
      }),
      catchError(() => from(fetchOffline()))
    );
  }

  getCustomerProductPrices(customerId: any): Observable<any[]> {
    if (!customerId) return of([]);
    const cid = Number(customerId);
    const strCid = String(customerId);

    const normalizeList = (list: any[]) => {
      if (!Array.isArray(list)) return [];
      return list.map(item => ({
        id: item.id ?? item.Id,
        productId: Number(item.productId ?? item.ProductId),
        customerId: Number(item.customerId ?? item.CustomerId ?? cid),
        specialPrice: Number((item.specialPrice !== undefined ? item.specialPrice : item.SpecialPrice) ?? 0),
        productName: item.productName || item.ProductName || '',
        productCode: item.productCode || item.ProductCode || '',
        originalPrice: Number((item.originalPrice !== undefined ? item.originalPrice : item.OriginalPrice) ?? 0)
      }));
    };

    const fetchOffline = async () => {
      // 1. 先查专属缓存 (数字 id 与 字符串 id)
      let cached = await this.offlineStorage.getCache<any[]>('customer_prices_' + cid);
      if (!cached || !Array.isArray(cached) || cached.length === 0) {
        cached = await this.offlineStorage.getCache<any[]>('customer_prices_' + strCid);
      }
      if (Array.isArray(cached) && cached.length > 0) {
        return normalizeList(cached);
      }
      // 2. 查全局所有客户特价缓存
      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      const matchedAll = allPrices.filter((p: any) => Number(p.customerId ?? p.CustomerId) === cid || String(p.customerId ?? p.CustomerId) === strCid);
      if (matchedAll.length > 0) {
        this.offlineStorage.setCache('customer_prices_' + cid, matchedAll);
        this.offlineStorage.setCache('customer_prices_' + strCid, matchedAll);
        return normalizeList(matchedAll);
      }
      // 3. 查该客户详情缓存
      let custDetail = await this.offlineStorage.getCache<any>('customer_detail_' + cid);
      if (!custDetail) {
        custDetail = await this.offlineStorage.getCache<any>('customer_detail_' + strCid);
      }
      const detailPrices = custDetail?.productPrices || custDetail?.ProductPrices;
      if (Array.isArray(detailPrices) && detailPrices.length > 0) {
        this.offlineStorage.setCache('customer_prices_' + cid, detailPrices);
        this.offlineStorage.setCache('customer_prices_' + strCid, detailPrices);
        return normalizeList(detailPrices);
      }
      // 4. 查客户列表缓存中的该客户
      const custList = await this.offlineStorage.getCache<any[]>('customers') || [];
      const found = custList.find((c: any) => Number(c.id ?? c.Id) === cid || String(c.id ?? c.Id) === strCid || String(c.customerCode) === strCid);
      const listPrices = found?.productPrices || found?.ProductPrices;
      if (Array.isArray(listPrices) && listPrices.length > 0) {
        this.offlineStorage.setCache('customer_prices_' + cid, listPrices);
        this.offlineStorage.setCache('customer_prices_' + strCid, listPrices);
        return normalizeList(listPrices);
      }
      return [];
    };

    if (!this.isOnline()) {
      return from(fetchOffline());
    }

    return this.http.get(this.baseUrl + '/Customer/GetCustomerProductPrices/customers/' + customerId + '/product-prices').pipe(
      timeout(3500),
      map((res: any) => normalizeList(Array.isArray(res) ? res : [])),
      tap((res: any[]) => {
        if (Array.isArray(res)) {
          this.offlineStorage.setCache('customer_prices_' + cid, res);
          this.offlineStorage.setCache('customer_prices_' + strCid, res);
          this.offlineStorage.getCache<any[]>('all_customer_prices').then(existing => {
            const all = Array.isArray(existing) ? existing : [];
            const filtered = all.filter((p: any) => Number(p.customerId ?? p.CustomerId) !== cid && String(p.customerId ?? p.CustomerId) !== strCid);
            this.offlineStorage.setCache('all_customer_prices', [...filtered, ...res]);
          });
        }
      }),
      catchError(() => from(fetchOffline()))
    );
  }

  createCustomerProductPrice(customerId: any, data: any): Observable<any> {
    const saveOfflinePrice = async () => {
      const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
      const newEntity = { customerId, productId: data.productId, specialPrice: data.specialPrice, isOffline: true };
      const updated = prices.filter((p: any) => p.productId != data.productId);
      updated.push(newEntity);
      await this.offlineStorage.setCache('customer_prices_' + customerId, updated);
      await this.offlineStorage.setCache('customer_prices_' + String(customerId), updated);

      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      const filteredAll = allPrices.filter((p: any) => !(String(p.customerId ?? p.CustomerId) === String(customerId) && p.productId == data.productId));
      filteredAll.push(newEntity);
      await this.offlineStorage.setCache('all_customer_prices', filteredAll);

      await this.offlineStorage.enqueue('CREATE_CUSTOMER_PRICE', { customerId, data });
      return { message: 'Special price saved offline', data: newEntity, isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_')) {
      return from(saveOfflinePrice());
    }

    return this.http.post(this.baseUrl + '/Customer/CreateCustomerProductPrice/customers/' + customerId + '/product-prices', data).pipe(
      timeout(4000),
      tap(async (res: any) => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const newEntity = res?.data || { customerId, productId: data.productId, specialPrice: data.specialPrice };
        this.offlineStorage.setCache('customer_prices_' + customerId, [...prices, newEntity]);
      }),
      catchError(() => from(saveOfflinePrice()))
    );
  }

  updateCustomerProductPrice(customerId: any, productId: any, data: any): Observable<any> {
    const saveOfflineUpdatePrice = async () => {
      const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
      const idx = prices.findIndex((p: any) => p.productId == productId);
      if (idx !== -1) {
        prices[idx] = { ...prices[idx], specialPrice: data.specialPrice };
        await this.offlineStorage.setCache('customer_prices_' + customerId, prices);
      }
      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      const aIdx = allPrices.findIndex((p: any) => (String(p.customerId ?? p.CustomerId) === String(customerId)) && p.productId == productId);
      if (aIdx !== -1) {
        allPrices[aIdx] = { ...allPrices[aIdx], specialPrice: data.specialPrice };
        await this.offlineStorage.setCache('all_customer_prices', allPrices);
      }

      const pending = await this.offlineStorage.getPendingQueue();
      const existingCreate = pending.find(q => q.type === 'CREATE_CUSTOMER_PRICE' && String(q.payload?.customerId) === String(customerId) && (q.payload?.data?.productId == productId || q.payload?.productId == productId));
      if (existingCreate) {
        if (existingCreate.payload?.data) existingCreate.payload.data.specialPrice = data.specialPrice;
        else existingCreate.payload.specialPrice = data.specialPrice;
        await this.offlineStorage.updateQueueItem(existingCreate);
      } else {
        await this.offlineStorage.enqueue('UPDATE_CUSTOMER_PRICE', { customerId, productId, data }, `upd_cp_${customerId}_${productId}`);
      }
      return { message: 'Special price updated offline', isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_')) {
      return from(saveOfflineUpdatePrice());
    }

    return this.http.patch(this.baseUrl + '/Customer/UpdateCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, data).pipe(
      timeout(4000),
      tap(async () => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const idx = prices.findIndex((p: any) => p.productId == productId);
        if (idx !== -1) {
          prices[idx] = { ...prices[idx], specialPrice: data.specialPrice };
          this.offlineStorage.setCache('customer_prices_' + customerId, prices);
        }
      }),
      catchError(() => from(saveOfflineUpdatePrice()))
    );
  }

  deleteCustomerProductPrice(customerId: any, productId: any): Observable<any> {
    const saveOfflineDeletePrice = async () => {
      const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
      const filtered = prices.filter((p: any) => p.productId != productId);
      await this.offlineStorage.setCache('customer_prices_' + customerId, filtered);

      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      const filteredAll = allPrices.filter((p: any) => !(String(p.customerId ?? p.CustomerId) === String(customerId) && p.productId == productId));
      await this.offlineStorage.setCache('all_customer_prices', filteredAll);

      const pending = await this.offlineStorage.getPendingQueue();
      const existingCreate = pending.find(q => q.type === 'CREATE_CUSTOMER_PRICE' && String(q.payload?.customerId) === String(customerId) && (q.payload?.data?.productId == productId || q.payload?.productId == productId));
      if (existingCreate) {
        await this.offlineStorage.removeQueueItem(existingCreate.id);
      } else if (!String(customerId).startsWith('cust_')) {
        await this.offlineStorage.enqueue('DELETE_CUSTOMER_PRICE', { customerId, productId }, `del_cp_${customerId}_${productId}`);
      }
      return { message: 'Special price deleted offline', isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_')) {
      return from(saveOfflineDeletePrice());
    }

    return this.http.delete(this.baseUrl + '/Customer/DeleteCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, { responseType: 'text' }).pipe(
      timeout(4000),
      tap(async () => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const filtered = prices.filter((p: any) => p.productId != productId);
        this.offlineStorage.setCache('customer_prices_' + customerId, filtered);
      }),
      catchError(() => from(saveOfflineDeletePrice()))
    );
  }
  getCustomerPurchaseHistory(customerId: any): Observable<any> {
    const fetchOfflineHistory = async () => {
      const invoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const custInvs = invoices.filter((inv: any) => Number(inv.customerId) === Number(customerId));
      const history: any[] = [];
      for (const inv of custInvs) {
        const items = inv.items || inv.Items || [];
        for (const it of items) {
          history.push({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber || inv.docNo || ('INV-' + inv.id),
            customerId: inv.customerId,
            productId: it.productId ?? it.ProductId,
            productName: it.productName || it.ProductName || '',
            unitPrice: Number(it.unitPrice || it.UnitPrice || it.price || 0),
            quantity: Number(it.quantity || it.Quantity || 1),
            returnedQuantity: Number(it.returnedQuantity || 0)
          });
        }
      }
      return history;
    };

    if (!this.isOnline()) {
      return from(fetchOfflineHistory());
    }

    return this.http.get(this.baseUrl + '/Customer/GetCustomerPurchaseHistory/customers/' + customerId + '/purchase-history').pipe(
      timeout(3500),
      catchError(() => from(fetchOfflineHistory()))
    );
  }

  createInvoice(data: any): Observable<any> {
    if (!data.offlineReferenceId) {
      data.offlineReferenceId = this.offlineStorage.generateId();
    }

    const saveOfflineFallback = () => {
      const calculatedTotal = (data.items || []).reduce((sum: number, it: any) => {
        const p = Number(it.unitPrice || 0);
        const q = Number(it.quantity || 1);
        return sum + (p * q);
      }, 0);
      const roundedTotal = Math.round((calculatedTotal + Number.EPSILON) * 100) / 100;
      data.totalAmount = roundedTotal;

      const orderData = {
        clientId: data.offlineReferenceId,
        orderNumber: data.invoiceNumber || this.offlineStorage.generateInvoiceNumber(),
        customerId: data.customerId,
        orderDate: data.invoiceDate || new Date().toISOString(),
        totalAmount: roundedTotal,
        paidAmount: data.paidAmount || 0,
        balance: roundedTotal - (data.paidAmount || 0),
        termType: data.termType || 'Cash Sale',
        paymentMethod: data.paymentMethod || 'CASH',
        remark: data.remark || '',
        sync_status: SyncStatus.PENDING
      };

      const itemsData = (data.items || []).map((it: any) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: Math.round((Number(it.unitPrice || 0) * Number(it.quantity || 1) + Number.EPSILON) * 100) / 100,
        remark: it.remark || ''
      }));

      const paymentData = data.paidAmount > 0 ? {
        customerId: data.customerId,
        amount: data.paidAmount,
        method: data.paymentMethod || 'CASH',
        paymentDate: new Date().toISOString()
      } : undefined;

      const offlineDetail = {
        ...orderData,
        id: data.offlineReferenceId,
        invoiceNumber: orderData.orderNumber,
        docNo: orderData.orderNumber,
        items: (data.items || []).map((it: any) => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          remark: it.remark || ''
        })),
        isOffline: true
      };

      return from(
        Promise.all([
          this.localDb.insertOrderTransaction(orderData, itemsData, paymentData),
          this.offlineStorage.enqueue('CREATE_INVOICE', data, data.offlineReferenceId),
          this.offlineStorage.setCache('inv_detail_' + data.offlineReferenceId, offlineDetail)
        ]).then(() => ({
          message: 'Invoice created offline (Saved to local DB & sync queue)',
          invoiceId: data.offlineReferenceId,
          isOffline: true,
          totalAmount: roundedTotal,
          creditUsed: 0,
          remainingBalance: 0
        }))
      );
    };

    if (!this.isOnline()) {
      return saveOfflineFallback();
    }

    return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data).pipe(
      timeout(4000),
      tap((res: any) => {
        this.clearCustomerCache();
        const serverId = res?.invoiceId || res?.id;
        if (serverId) {
          const detail = {
            ...data,
            id: serverId,
            totalAmount: res?.totalAmount || data.totalAmount,
            invoiceNumber: res?.invoiceNumber || data.invoiceNumber,
            docNo: formatDocNo(res || data),
            items: data.items || []
          };
          this.offlineStorage.setCache('inv_detail_' + serverId, detail);
        }
      }),
      catchError((err: any) => {
        console.warn('[Offline Fallback] Network unreachable or timeout, enqueuing invoice locally:', err);
        return saveOfflineFallback();
      })
    );
  }

  postInvoiceDirect(data: any): Observable<any> {
    return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  getStockReadyInvoices(): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/GetStockReadyInvoices/invoices/stock-ready'); }

  private isPrefetchingInvoices = false;

  /**
   * 连网时自动在后台静默预拉取并缓存发票明细，确保离线脱机时点击发票能看到真实的商品、数量和价格
   */
  public async prefetchInvoiceDetails(invoices: any[]): Promise<void> {
    if (!invoices || !Array.isArray(invoices) || this.isPrefetchingInvoices) return;
    if (!this.isOnline()) return;

    this.isPrefetchingInvoices = true;
    try {
      // 预先缓存最近的 60 张发票明细
      const targetInvoices = invoices.slice(0, 60);
      for (const inv of targetInvoices) {
        if (!inv || !inv.id) continue;
        if (!this.isOnline()) break;

        const cached = await this.offlineStorage.getCache<any>('inv_detail_' + inv.id);
        const hasCachedItems = (cached?.items || cached?.Items) && (cached?.items || cached?.Items).length > 0;
        if (hasCachedItems) {
          continue;
        }

        try {
          const detail: any = await firstValueFrom(
            this.http.get(this.baseUrl + '/Invoice/GetInvoiceDetails/invoices/' + inv.id).pipe(timeout(3500))
          );
          if (detail) {
            detail.docNo = formatDocNo(detail);
            await this.offlineStorage.setCache('inv_detail_' + inv.id, detail);
          }
        } catch {
          // 静默忽略单个发票在后台预抓取时的网络波动
        }
        // 微小停顿，避免给前端线程和移动网络带来并发压力
        await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      this.isPrefetchingInvoices = false;
    }
  }

  private readonly INV_DATA_OVERRIDES_KEY = 'invoice_data_overrides';

  getInvoiceOverridesMap(): Record<string, any> {
    try {
      const data = localStorage.getItem(this.INV_DATA_OVERRIDES_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  saveInvoiceOverride(invoiceId: any, override: any) {
    if (!invoiceId) return;
    try {
      const map = this.getInvoiceOverridesMap();
      map[String(invoiceId)] = { ...(map[String(invoiceId)] || {}), ...override };
      localStorage.setItem(this.INV_DATA_OVERRIDES_KEY, JSON.stringify(map));
    } catch { }
  }

  applyInvoiceOverrides(invoices: any[]) {
    if (!Array.isArray(invoices) || invoices.length === 0) return;
    const map = this.getInvoiceOverridesMap();
    for (const inv of invoices) {
      this.applyInvoiceOverrideToItem(inv, map);
    }
  }

  applyInvoiceOverrideToItem(inv: any, map?: Record<string, any>) {
    if (!inv || !inv.id) return;
    const overrides = map || this.getInvoiceOverridesMap();
    const ov = overrides[String(inv.id)];
    if (ov) {
      if (ov.termType) inv.termType = ov.termType;
      if (ov.status) inv.status = ov.status;
      if (ov.invoiceNumber) {
        inv.invoiceNumber = ov.invoiceNumber;
        inv.docNo = ov.invoiceNumber;
      }
      if (ov.customerId !== undefined) inv.customerId = ov.customerId;
      if (ov.customerName !== undefined) inv.customerName = ov.customerName;
      if (ov.paidAmount !== undefined) inv.paidAmount = ov.paidAmount;
      if (ov.balance !== undefined) inv.balance = ov.balance;
      if (ov.totalAmount !== undefined) inv.totalAmount = ov.totalAmount;
    }

    try {
      const custData = localStorage.getItem('invoice_customer_overrides');
      if (custData) {
        const custMap = JSON.parse(custData);
        const cOv = custMap[String(inv.id)] || custMap[Number(inv.id)];
        if (cOv) {
          if (cOv.customerId !== undefined) inv.customerId = cOv.customerId;
          if (cOv.customerName) inv.customerName = cOv.customerName;
          if (cOv.customerCode) inv.customerCode = cOv.customerCode;
        }
      }
    } catch { }

    const term = inv.termType || inv.TermType;
    const isCreditTerm = (term === 'On Credit' || term === 'Net 30 Days');
    if (isCreditTerm) {
      const hasActualPayments = Array.isArray(inv.payments) && inv.payments.length > 0;
      const tot = Number(inv.totalAmount ?? inv.TotalAmount ?? 0);
      const cred = Number(inv.creditUsed ?? inv.CreditUsed ?? 0);
      const paid = ov?.paidAmount !== undefined ? Number(ov.paidAmount) : Number(inv.paidAmount || 0);
      const effBal = Math.max(0, tot - cred - paid);

      if (effBal <= 0.01 && (cred > 0 || paid > 0 || inv.status === 'Paid')) {
        inv.status = 'Paid';
        inv.balance = 0;
      } else if (!hasActualPayments && (ov?.status !== 'Paid')) {
        inv.status = (cred > 0 || paid > 0) ? 'Partial' : 'Unpaid';
        if (ov?.paidAmount !== undefined) {
          inv.paidAmount = ov.paidAmount;
        } else {
          inv.paidAmount = paid;
        }
        if (ov?.balance !== undefined) {
          inv.balance = ov.balance;
        } else {
          inv.balance = effBal;
        }
      }
    }
  }

  getInvoices(params?: any): Observable<any> {
    const fetchOfflineInvoices = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const deletedIds = queue.filter(q => q.type === 'DELETE_INVOICE').map(q => q.payload?.invoiceId);
      const pendingInvoices = queue
        .filter(q => q.type === 'CREATE_INVOICE')
        .map(q => {
          const p = q.payload || {};
          const itemsTotal = (p.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
          const computedTotal = Math.round((itemsTotal + Number.EPSILON) * 100) / 100;
          const totalAmount = (p.totalAmount != null && Number(p.totalAmount) > 0) ? Number(p.totalAmount) : computedTotal;
          const paidAmount = Number(p.paidAmount) || 0;
          const isCash = (p.termType === 'CASH SALE' || p.termType === 'Cash');
          const status = isCash ? 'Paid' : (paidAmount >= totalAmount ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Unpaid'));
          return {
            id: q.id,
            invoiceNumber: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
            docNo: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
            customerId: p.customerId,
            customerName: p.customerName || '',
            totalAmount: totalAmount,
            paidAmount: paidAmount,
            balance: p.balance != null ? Number(p.balance) : Math.max(0, totalAmount - paidAmount),
            invoiceDate: p.orderDate || p.invoiceDate || new Date(q.createdAt).toISOString(),
            status: status,
            termType: p.termType || 'Cash Sale',
            items: p.items || [],
            isOffline: true
          };
        });
      const combined = [...pendingInvoices, ...cached].filter(inv => !deletedIds.includes(inv.id));
      const seenIds = new Set<string>();
      const seenDocs = new Set<string>();
      let result: any[] = [];
      for (const inv of combined) {
        const idKey = String(inv.id || '');
        const docKey = String(inv.invoiceNumber || inv.docNo || '').trim();
        if (idKey && seenIds.has(idKey)) continue;
        if (docKey && !docKey.startsWith('INV-OFFLINE') && !docKey.startsWith('OFFLINE') && seenDocs.has(docKey)) continue;
        if (idKey) seenIds.add(idKey);
        if (docKey && !docKey.startsWith('INV-OFFLINE') && !docKey.startsWith('OFFLINE')) seenDocs.add(docKey);
        result.push(inv);
      }
      if (params?.customerId) {
        result = result.filter(inv => Number(inv.customerId) === Number(params.customerId));
      }
      this.applyInvoiceOverrides(result);
      updateInvoiceDocNos(result);
      return result;
    };

    if (!this.isOnline()) {
      return from(fetchOfflineInvoices());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoices/invoices', { params }).pipe(
      timeout(5000),
      tap((res: any) => {
        if (Array.isArray(res) && !params?.customerId) {
          this.applyInvoiceOverrides(res);
          this.offlineStorage.setCache('invoices_list', res);
          // 在后台静默预抓取发票明细到本地缓存
          this.prefetchInvoiceDetails(res).catch(() => { });
        }
      }),
      map((res: any) => {
        if (Array.isArray(res)) {
          this.applyInvoiceOverrides(res);
          updateInvoiceDocNos(res);
        }
        return res;
      }),
      catchError(() => from(fetchOfflineInvoices()))
    );
  }
  getInvoiceDetails(id: any): Observable<any> {
    const fetchOfflineDetail = async () => {
      const cached = await this.offlineStorage.getCache<any>('inv_detail_' + id);
      if (cached) return cached;

      // 检查 localDb 待同步订单
      try {
        const pendingOrders = await this.localDb.getPendingOrders();
        const localMatch = pendingOrders.find(o => String(o.clientId) === String(id) || String(o.serverId) === String(id));
        if (localMatch) {
          return {
            id: localMatch.clientId,
            invoiceNumber: localMatch.orderNumber,
            docNo: localMatch.orderNumber,
            customerId: localMatch.customerId,
            customerName: localMatch.customerName,
            orderDate: localMatch.orderDate,
            invoiceDate: localMatch.orderDate,
            totalAmount: localMatch.totalAmount,
            paidAmount: localMatch.paidAmount,
            balance: localMatch.balance,
            items: localMatch.items || [],
            isOffline: true
          };
        }
      } catch { }

      const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      return cachedInvoices.find((i: any) => String(i.id) === String(id)) || null;
    };

    if (!this.isOnline()) {
      return from(fetchOfflineDetail());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoiceDetails/invoices/' + id).pipe(
      timeout(3500),
      map((res: any) => {
        if (res) {
          this.applyInvoiceOverrideToItem(res);
          res.docNo = formatDocNo(res);
          this.offlineStorage.setCache('inv_detail_' + id, res);
        }
        return res;
      }),
      catchError(() => from(fetchOfflineDetail()))
    );
  }
  updateInvoice(id: any, data: any): Observable<any> {
    const isCash = (data.termType === 'CASH SALE' || data.termType === 'Cash');
    const newStatus = isCash ? 'Paid' : 'Unpaid';
    const calculatedTotal = (data.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
    const totalAmount = data.totalAmount != null ? Number(data.totalAmount) : (calculatedTotal > 0 ? calculatedTotal : undefined);

    if (data.termType) {
      const overrideObj: any = {
        termType: data.termType,
        status: newStatus,
        invoiceNumber: data.invoiceNumber,
        docNo: data.invoiceNumber,
        customerId: data.customerId,
        customerName: data.customerName
      };
      if (totalAmount !== undefined) {
        overrideObj.totalAmount = Math.round((totalAmount + Number.EPSILON) * 100) / 100;
        overrideObj.paidAmount = isCash ? overrideObj.totalAmount : 0;
        overrideObj.balance = isCash ? 0 : overrideObj.totalAmount;
      } else {
        if (!isCash) {
          overrideObj.paidAmount = 0;
        }
      }
      this.saveInvoiceOverride(id, overrideObj);
    }

    const updateCachesLocally = () => {
      this.offlineStorage.getCache<any>('inv_detail_' + id).then(detail => {
        if (detail) {
          if (data.invoiceNumber) {
            detail.invoiceNumber = data.invoiceNumber;
            detail.docNo = data.invoiceNumber;
          }
          detail.items = data.items || detail.items;
          detail.remark = data.remark ?? detail.remark;
          detail.invoiceDate = data.invoiceDate ?? detail.invoiceDate;
          detail.termType = data.termType ?? detail.termType;
          if (data.customerId !== undefined) {
            detail.customerId = data.customerId;
          }
          if (data.customerName !== undefined) {
            detail.customerName = data.customerName;
          }
          const calcTotal = (detail.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
          detail.totalAmount = Math.round((calcTotal + Number.EPSILON) * 100) / 100;
          if (data.termType === 'CASH SALE') {
            detail.status = 'Paid';
            detail.paidAmount = detail.totalAmount;
            detail.balance = 0;
          } else if (data.termType === 'On Credit' || data.termType === 'Net 30 Days') {
            detail.status = 'Unpaid';
            detail.paidAmount = 0;
            detail.balance = detail.totalAmount;
          }
          this.offlineStorage.setCache('inv_detail_' + id, detail);
        }
      });
      this.offlineStorage.getCache<any[]>('invoices_list').then(cached => {
        if (cached && cached.length > 0) {
          const item = cached.find((c: any) => String(c.id) === String(id));
          if (item) {
            if (data.invoiceNumber) {
              item.invoiceNumber = data.invoiceNumber;
              item.docNo = data.invoiceNumber;
            }
            if (data.customerId !== undefined) item.customerId = data.customerId;
            if (data.customerName !== undefined) item.customerName = data.customerName;
            if (data.items) {
              const calcTotal = (data.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
              item.totalAmount = Math.round((calcTotal + Number.EPSILON) * 100) / 100;
              item.items = data.items;
            }
            if (data.termType) item.termType = data.termType;
            if (data.termType === 'CASH SALE') {
              item.status = 'Paid';
              item.paidAmount = item.totalAmount;
              item.balance = 0;
            } else if (data.termType === 'On Credit' || data.termType === 'Net 30 Days') {
              item.status = 'Unpaid';
              item.paidAmount = 0;
              item.balance = item.totalAmount;
            }
            this.offlineStorage.setCache('invoices_list', cached);
          }
        }
      });
    };

    const saveOfflineUpdate = () => {
      updateCachesLocally();
      return from(
        this.offlineStorage.enqueue('UPDATE_INVOICE', { invoiceId: id, data }, 'upd_inv_' + id).then(() => ({
          message: 'Invoice updated offline (Queued for sync)',
          invoiceId: id,
          isOffline: true
        }))
      );
    };

    const isOfflineId = String(id).startsWith('offline_') || String(id).startsWith('inv_');

    if (!this.isOnline() || isOfflineId) {
      return saveOfflineUpdate();
    }

    return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data).pipe(
      timeout(4000),
      tap(() => {
        this.clearCustomerCache();
        updateCachesLocally();
      }),
      catchError((err: any) => {
        console.warn('[Offline Fallback] Update invoice network failed, falling back to offline update:', err);
        return saveOfflineUpdate();
      })
    );
  }

  updateInvoiceDirect(id: any, data: any): Observable<any> {
    return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  postDirect(url: string, data: any): Observable<any> {
    return this.http.post(url, data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  putDirect(url: string, data: any): Observable<any> {
    return this.http.put(url, data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  patchDirect(url: string, data: any): Observable<any> {
    return this.http.patch(url, data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  deleteDirect(url: string): Observable<any> {
    return this.http.delete(url, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  deleteInvoice(id: any): Observable<any> {
    const isOfflineId = String(id).startsWith('offline_') || String(id).startsWith('inv_');

    const executeOfflineDeleteInvoice = async () => {
      if (isOfflineId) {
        try {
          await this.offlineStorage.removeQueueItem(String(id));
          await this.offlineStorage.removeQueueItem('upd_inv_' + id);
        } catch {}
        try {
          await this.localDb.deleteOrderByClientId(String(id));
        } catch {}
      } else {
        await this.offlineStorage.enqueue('DELETE_INVOICE', { invoiceId: id }, 'del_inv_' + id);
      }

      // Remove from cached invoices_list
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const updated = cached.filter(inv => String(inv.id) !== String(id) && String(inv.offlineId) !== String(id));
      await this.offlineStorage.setCache('invoices_list', updated);

      // Remove cached detail
      await this.offlineStorage.removeCache('inv_detail_' + id);

      await this.offlineStorage.refreshQueueCount();
      return { success: true, isOffline: true, message: 'Invoice deleted offline' };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(executeOfflineDeleteInvoice());
    }

    return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { responseType: 'text' }).pipe(
      timeout(4000),
      tap(() => {
        this.clearCustomerCache();
        this.offlineStorage.removeCache('inv_detail_' + id);
        this.offlineStorage.getCache<any[]>('invoices_list').then(cached => {
          if (cached) {
            const updated = cached.filter(inv => String(inv.id) !== String(id));
            this.offlineStorage.setCache('invoices_list', updated);
          }
        });
      }),
      catchError(() => from(executeOfflineDeleteInvoice()))
    );
  }
  deleteInvoiceDirect(id: any): Observable<any> {
    return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  previewInvoice(id: any): Observable<any> {
    return this.http.get(this.baseUrl + '/Invoice/PreviewInvoice/invoices/' + id + '/preview').pipe(
      map((res: any) => {
        if (res) {
          res.docNo = formatDocNo(res);
        }
        return res;
      })
    );
  }

  createPayment(data: any, extraInfo?: any): Observable<any> {
    const bulkData = {
      customerId: data.customerId,
      method: data.method || data.paymentMethod || 'CASH',
      referenceNo: data.referenceNo || '',
      totalInputAmount: Number(data.amount || 0),
      payments: [
        {
          invoiceId: data.invoiceId,
          amount: Number(data.amount || 0)
        }
      ]
    };
    return this.createBulkPayment(bulkData, extraInfo);
  }

  createBulkPayment(data: any, extraInfo?: any): Observable<any> {
    const saveOfflineBulkPayment = async () => {
      // Prevent rapid duplicate offline submissions
      const pendingQueue = await this.offlineStorage.getPendingQueue();
      const isDuplicate = pendingQueue.some(q =>
        q.type === 'CREATE_BULK_PAYMENT' &&
        Number(q.payload?.data?.customerId) === Number(data.customerId) &&
        JSON.stringify(q.payload?.data?.payments) === JSON.stringify(data.payments) &&
        Math.abs(Date.now() - new Date(q.createdAt).getTime()) < 6000
      );
      if (isDuplicate) {
        console.warn('[ApiService] Duplicate offline bulk payment ignored.');
        return {
          message: 'Payment already recorded offline!',
          isOffline: true,
          groupId: 'pay_bulk_' + Date.now(),
          payments: [],
          lastPaymentDetail: null
        };
      }

      const now = new Date();
      const dateStr = now.toISOString();
      const groupId = 'pay_bulk_' + Date.now();
      const createdPayments: any[] = [];

      const customer = extraInfo?.customer || {
        id: data.customerId,
        name: extraInfo?.customerName || ('Customer #' + data.customerId),
        phone: extraInfo?.customerPhone || '',
        email: extraInfo?.customerEmail || ''
      };

      const cachedPayments = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];

      for (let i = 0; i < (data.payments || []).length; i++) {
        const item = data.payments[i];
        const invInfo = (extraInfo?.invoices || []).find((inv: any) => String(inv.id) === String(item.invoiceId) || String(inv.invoiceId) === String(item.invoiceId)) || {};
        const offlinePaymentId = 'pay_' + Date.now() + '_' + i;
        const receiptNumber = 'RCPT-OFFLINE-' + String(Date.now()).slice(-6) + (data.payments.length > 1 ? `-${i + 1}` : '');

        const invDocNo = invInfo.docNo || invInfo.invoiceNumber || ('INV-' + item.invoiceId);
        const invTotal = Number(invInfo.totalAmount ?? item.amount ?? 0);
        const prevBal = Number(invInfo.balance ?? invInfo.previousBalance ?? item.amount);
        const newBal = Math.max(0, prevBal - Number(item.amount));

        const detailPreview = {
          id: offlinePaymentId,
          receiptNumber: receiptNumber,
          paymentDate: dateStr,
          paymentMethod: data.method || 'CASH',
          referenceNo: data.referenceNo || '',
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone || '',
            email: customer.email || ''
          },
          invoice: {
            id: item.invoiceId,
            invoiceNumber: invDocNo,
            docNo: invDocNo,
            invoiceDate: invInfo.invoiceDate || dateStr,
            totalAmount: invTotal,
            paidAmount: Number(item.amount),
            balance: newBal,
            items: invInfo.items || []
          },
          paymentAmount: Number(item.amount),
          isOffline: true
        };

        // Cache detail preview for offline viewing and printing
        await this.offlineStorage.setCache('payment_detail_' + offlinePaymentId, detailPreview);

        const paymentListEntry = {
          id: offlinePaymentId,
          customerId: customer.id,
          customerName: customer.name,
          invoiceId: item.invoiceId,
          invoiceNumber: invDocNo,
          amount: Number(item.amount),
          method: data.method || 'CASH',
          paymentDate: dateStr,
          referenceNo: data.referenceNo || '',
          receiptNumber: receiptNumber,
          isOffline: true
        };

        createdPayments.push({
          paymentId: offlinePaymentId,
          receiptNumber: receiptNumber,
          invoiceId: item.invoiceId,
          amount: Number(item.amount),
          customerName: customer.name,
          invoiceNumber: invDocNo,
          paymentDate: dateStr,
          detail: detailPreview,
          listEntry: paymentListEntry
        });

        // Update cached invoice balance and status
        const targetInv = cachedInvoices.find((ci: any) => String(ci.id) === String(item.invoiceId));
        if (targetInv) {
          targetInv.paidAmount = (Number(targetInv.paidAmount) || 0) + Number(item.amount);
          targetInv.balance = Math.max(0, (Number(targetInv.totalAmount) || 0) - targetInv.paidAmount);
          if (targetInv.balance <= 0.01) {
            targetInv.status = 'Paid';
          } else {
            targetInv.status = 'Partial';
          }
        }
      }

      // Update payments_list cache with newly created offline payments at the front
      const newPaymentListEntries = createdPayments.map(cp => cp.listEntry);
      await this.offlineStorage.setCache('payments_list', [...newPaymentListEntries, ...cachedPayments]);

      if (cachedInvoices.length > 0) {
        await this.offlineStorage.setCache('invoices_list', cachedInvoices);
      }

      // If excess amount > 0, generate offline Change Credit Note
      const excess = Number(extraInfo?.excess || 0);
      if (excess > 0.01 && data.payments.length > 0) {
        const cnNumber = 'CN-CHG-OFFLINE-' + String(Date.now()).slice(-6);
        const offlineCnId = 'cn_' + Date.now();
        const firstInvoiceId = data.payments[0]?.invoiceId;
        const cachedCNs = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
        const changeCnEntry = {
          id: offlineCnId,
          cnNumber,
          invoiceId: firstInvoiceId,
          customerId: customer.id,
          customerName: customer.name,
          amount: excess,
          createdAt: dateStr,
          reason: `Change from bulk payment (excess RM ${excess.toFixed(2)})`,
          createdAfterPayment: true,
          isUsed: false,
          isOffline: true
        };
        await this.offlineStorage.setCache('credit_notes_list', [changeCnEntry, ...cachedCNs]);
      }

      // Enqueue the task into offlineStorage
      await this.offlineStorage.enqueue('CREATE_BULK_PAYMENT', {
        data,
        groupId,
        createdPayments: createdPayments.map(cp => ({
          paymentId: cp.paymentId,
          receiptNumber: cp.receiptNumber,
          invoiceId: cp.invoiceId,
          amount: cp.amount,
          customerName: cp.customerName,
          invoiceNumber: cp.invoiceNumber,
          paymentDate: cp.paymentDate
        }))
      }, groupId);

      await this.offlineStorage.refreshQueueCount();

      return {
        message: 'Payment recorded offline! (Queued for sync)',
        isOffline: true,
        groupId,
        payments: createdPayments.map(cp => cp.detail),
        lastPaymentDetail: createdPayments[0]?.detail
      };
    };

    if (!this.isOnline()) {
      return from(saveOfflineBulkPayment());
    }

    return this.http.post(this.baseUrl + '/Payment/CreateBulkPayment/bulk-payments', data).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => from(saveOfflineBulkPayment()))
    );
  }
  getPayInfo(customerId: any, invoiceId: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPayInfo/customers/' + customerId + '/invoices/' + invoiceId + '/pay-info'); }
  getPaymentPreview(id: any): Observable<any> {
    const fetchOfflinePaymentPreview = async () => {
      let cached = await this.offlineStorage.getCache<any>('payment_detail_' + id);
      if (cached) return cached;

      const paymentList = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      const p = paymentList.find((item: any) => String(item.id) === String(id));
      if (p) {
        return {
          id: p.id,
          receiptNumber: p.receiptNumber || ('RCPT-' + (String(p.id).startsWith('pay_') ? String(p.id).slice(-6) : p.id)),
          paymentDate: p.paymentDate || new Date().toISOString(),
          paymentMethod: p.method || p.paymentMethod || 'CASH',
          referenceNo: p.referenceNo || '',
          customer: {
            id: p.customerId,
            name: p.customerName || ('Customer #' + p.customerId),
            phone: p.customerPhone || '',
            email: p.customerEmail || ''
          },
          invoice: {
            id: p.invoiceId,
            invoiceNumber: p.invoiceNumber || ('INV-' + (p.invoiceId || '')),
            docNo: p.invoiceNumber || ('INV-' + (p.invoiceId || '')),
            totalAmount: p.amount || 0,
            paidAmount: p.amount || 0,
            balance: 0,
            items: []
          },
          paymentAmount: p.amount || 0,
          isOffline: true
        };
      }
      return null;
    };

    if (!this.isOnline() || String(id).startsWith('pay_')) {
      return from(fetchOfflinePaymentPreview());
    }

    return this.http.get(this.baseUrl + '/Payment/GetPaymentPreview/payments/' + id + '/preview').pipe(
      timeout(3500),
      tap((res: any) => {
        if (res) {
          this.offlineStorage.setCache('payment_detail_' + id, res);
        }
      }),
      catchError(() => from(fetchOfflinePaymentPreview()))
    );
  }
  getPayments(): Observable<any> {
    const mapOfflinePayments = (queue: any[]) => {
      const list: any[] = [];
      const bulkTasks = queue.filter(q => q.type === 'CREATE_BULK_PAYMENT');
      for (const task of bulkTasks) {
        if (task.payload?.createdPayments) {
          for (const cp of task.payload.createdPayments) {
            list.push({
              id: cp.paymentId,
              customerName: cp.customerName || task.payload?.data?.customerName || ('Customer #' + task.payload?.data?.customerId),
              invoiceNumber: cp.invoiceNumber || ('INV-' + cp.invoiceId),
              amount: cp.amount,
              method: task.payload?.data?.method || 'CASH',
              paymentDate: cp.paymentDate || new Date(task.createdAt).toISOString(),
              referenceNo: task.payload?.data?.referenceNo || '',
              isOffline: true
            });
          }
        }
      }
      return list;
    };

    const fetchOfflinePayments = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      let queue: any[] = [];
      try {
        queue = await this.offlineStorage.getPendingQueue();
      } catch { }
      const deletedPaymentIds = queue
        .filter(q => q.type === 'DELETE_PAYMENT')
        .map(q => String(q.payload?.paymentId));

      const offlineItems = mapOfflinePayments(queue);
      const combined = [...offlineItems, ...cached].filter(p => !deletedPaymentIds.includes(String(p.id)));

      const seen = new Set();
      return combined.filter(p => {
        const key = String(p.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    if (!this.isOnline()) {
      return from(fetchOfflinePayments());
    }

    return this.http.get(this.baseUrl + '/Payment/GetPayments/payments').pipe(
      timeout(5000),
      tap((res: any) => {
        if (Array.isArray(res)) {
          this.offlineStorage.setCache('payments_list', res);
        }
      }),
      switchMap((serverList: any) => from((async () => {
        let queue: any[] = [];
        try {
          queue = await this.offlineStorage.getPendingQueue();
        } catch { }
        const offlineItems = mapOfflinePayments(queue);
        const deletedPaymentIds = queue
          .filter(q => q.type === 'DELETE_PAYMENT')
          .map(q => String(q.payload?.paymentId));
        const combined = [...offlineItems, ...(Array.isArray(serverList) ? serverList : [])].filter(p => !deletedPaymentIds.includes(String(p.id)));
        const seen = new Set();
        return combined.filter(p => {
          const key = String(p.id);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })())),
      catchError((err) => {
        console.warn('[ApiService] getPayments request failed, using offline cache:', err);
        return from(fetchOfflinePayments());
      })
    );
  }
  getPaymentById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPaymentById/payments/' + id); }
  deletePayment(id: any): Observable<any> {
    const isOfflinePayment = String(id).startsWith('pay_');

    const executeOfflineDelete = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      const targetPayment = cached.find(p => String(p.id) === String(id));
      const deletedAmount = Number(targetPayment?.amount ?? 0);
      const targetInvId = targetPayment?.invoiceId;
      const targetInvDoc = targetPayment?.invoiceNumber;

      if (isOfflinePayment) {
        // 1. Remove from pending CREATE_BULK_PAYMENT tasks
        const queue = await this.offlineStorage.getPendingQueue();
        for (const q of queue) {
          if (q.type === 'CREATE_BULK_PAYMENT') {
            if (Array.isArray(q.payload?.createdPayments)) {
              const matchedCp = q.payload.createdPayments.find((cp: any) => String(cp.paymentId) === String(id));
              q.payload.createdPayments = q.payload.createdPayments.filter((cp: any) => String(cp.paymentId) !== String(id));
              
              if (Array.isArray(q.payload?.data?.payments) && matchedCp) {
                q.payload.data.payments = q.payload.data.payments.filter((p: any) => String(p.invoiceId) !== String(matchedCp.invoiceId));
              }

              if (q.payload.createdPayments.length === 0) {
                await this.offlineStorage.removeQueueItem(q.id);
              } else {
                await this.offlineStorage.updateQueueItem(q);
              }
            }
          }
        }

        // 2. Remove payment detail cache
        await this.offlineStorage.removeCache('payment_detail_' + id);
      } else {
        // Online payment deleted while offline: queue delete task for sync
        await this.offlineStorage.enqueue('DELETE_PAYMENT', { paymentId: id }, 'del_pay_' + id);
      }

      // 3. Remove from payments_list cache
      const updatedPayments = cached.filter(p => String(p.id) !== String(id));
      await this.offlineStorage.setCache('payments_list', updatedPayments);

      // 4. Restore invoice balance & status in invoices_list cache
      if (deletedAmount > 0) {
        const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
        const inv = cachedInvoices.find(ci => 
          (targetInvId && String(ci.id) === String(targetInvId)) ||
          (targetInvDoc && (ci.invoiceNumber === targetInvDoc || ci.docNo === targetInvDoc))
        );
        if (inv) {
          inv.paidAmount = Math.max(0, (Number(inv.paidAmount) || 0) - deletedAmount);
          inv.balance = Math.max(0, (Number(inv.totalAmount) || 0) - (Number(inv.creditUsed) || 0) - inv.paidAmount);
          if (inv.paidAmount <= 0.01) {
            inv.status = 'Unpaid';
          } else {
            inv.status = 'Partial';
          }
          await this.offlineStorage.setCache('invoices_list', cachedInvoices);
        }
      }

      await this.offlineStorage.refreshQueueCount();
      return { success: true, isOffline: true, message: 'Payment deleted offline' };
    };

    if (!this.isOnline() || isOfflinePayment) {
      return from(executeOfflineDelete());
    }

    return this.http.delete(this.baseUrl + '/Payment/DeletePayment/payments/' + id, { responseType: 'text' }).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(() => from(executeOfflineDelete()))
    );
  }

  createProduct(data: any): Observable<any> {
    return this.http.post(this.baseUrl + '/Product/CreateProducts/createproducts', data).pipe(
      tap(() => this.clearProductCache())
    );
  }
  getProducts(forceRefresh = false): Observable<any> {
    const fetchOfflineProducts = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      this.cachedProducts = cached;
      return cached;
    };

    if (!this.isOnline()) {
      if (this.cachedProducts) return of(this.cachedProducts);
      return from(fetchOfflineProducts());
    }

    if (!forceRefresh && this.cachedProducts) {
      this.http.get(this.baseUrl + '/Product/GetProducts/products').pipe(timeout(3500)).subscribe({
        next: (res: any) => {
          if (Array.isArray(res)) {
            this.cachedProducts = res;
            this.offlineStorage.setCache('products', res);
          }
        },
        error: () => { }
      });
      return of(this.cachedProducts);
    }
    return this.http.get(this.baseUrl + '/Product/GetProducts/products').pipe(
      timeout(3500),
      tap((res: any) => {
        if (Array.isArray(res)) {
          this.cachedProducts = res;
          this.offlineStorage.setCache('products', res);
        }
      }),
      catchError(() => from(fetchOfflineProducts()))
    );
  }
  getProductById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Product/GetProductById/getproductsby/' + id); }
  editProduct(id: any, data: any): Observable<any> {
    return this.http.put(this.baseUrl + '/Product/EditProduct/editproduct/' + id, data).pipe(
      tap(() => this.clearProductCache())
    );
  }
  deleteProduct(id: any): Observable<any> {
    return this.http.delete(this.baseUrl + '/Product/DeleteProduct/deleteproduct/' + id, { responseType: 'text' }).pipe(
      tap(() => this.clearProductCache())
    );
  }
  activateProduct(id: any): Observable<any> {
    return this.http.patch(this.baseUrl + '/Product/ActivateProduct/activateproduct/' + id, {}).pipe(
      tap(() => this.clearProductCache())
    );
  }
  deactivateProduct(id: any): Observable<any> {
    return this.http.patch(this.baseUrl + '/Product/DeactivateProduct/deactivateproduct/' + id, {}).pipe(
      tap(() => this.clearProductCache())
    );
  }
  addStock(id: any, data: any): Observable<any> {
    return this.http.patch(this.baseUrl + '/Product/AddStock/addstock/' + id, data).pipe(
      tap(() => this.clearProductCache())
    );
  }

  getBillReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetBillReport/reports/bill'); }
  getProductSalesReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetProductSalesReport/reports/product-sales'); }
  getCompanyReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetCompanyReport/reports/company'); }
  getInvoiceReport(): Observable<any> { return this.http.get(this.baseUrl + '/Report/GetInvoiceReport/reports/invoice'); }
  previewReport(reportType: string): Observable<any> { return this.http.get(this.baseUrl + '/Report/PreviewReport/reports/' + reportType + '/preview'); }

  setSystemPassword(data: any): Observable<any> { return this.http.post(this.baseUrl + '/System/SetSystemPassword/system/password', data); }
  updateSystemPassword(data: any): Observable<any> { return this.http.patch(this.baseUrl + '/System/UpdateSystemPassword/system/password', data); }
  getPrintSetting(): Observable<any> { return this.http.get(this.baseUrl + '/System/GetPrintSetting/system/print-setting'); }
}
