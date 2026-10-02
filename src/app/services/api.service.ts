import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, from, throwError } from 'rxjs';
import { map, tap, catchError, switchMap, timeout } from 'rxjs/operators';
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

  constructor(
    private http: HttpClient,
    private offlineStorage: OfflineStorageService,
    private localDb: LocalDbService
  ) { }

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

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || String(invoiceId).startsWith('inv_')) {
      return saveOfflineCN();
    }

    return this.http.post(this.baseUrl + '/Credit/CreateCreditNote/invoices/' + invoiceId + '/credit-notes', data).pipe(
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

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return saveOfflineGlobalCN();
    }

    return this.http.post(this.baseUrl + '/Credit/CreateGlobalCreditNote/customers/' + customerId + '/credit-notes-global', data).pipe(
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

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || String(cnId).startsWith('cn_')) {
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

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || String(cnId).startsWith('cn_')) {
      return from(saveOfflineUpdateCN());
    }

    return this.http.put(this.baseUrl + '/Credit/UpdateCreditNote/credit-notes/' + cnId, data).pipe(
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

    if ((typeof navigator !== 'undefined' && !navigator.onLine) || String(cnId).startsWith('cn_')) {
      return from(saveOfflineDeleteCN());
    }

    return this.http.delete(this.baseUrl + '/Credit/DeleteCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId, { responseType: 'text' }).pipe(
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

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
    return this.http.post(this.baseUrl + '/Customer/CreateCustomers/createcustomers', data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  getAllCustomers(forceRefresh = false): Observable<any> {
    const fetchOfflineCustomers = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('customers') || [];
      this.cachedCustomers = cached;
      return cached;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (this.cachedCustomers) return of(this.cachedCustomers);
      return from(fetchOfflineCustomers());
    }

    if (!forceRefresh && this.cachedCustomers) {
      this.http.get(this.baseUrl + '/Customer/GetAllCustomer/getallcustomer').subscribe({
        next: (res: any) => {
          if (Array.isArray(res)) {
            this.cachedCustomers = res;
            this.offlineStorage.setCache('customers', res);
          }
        },
        error: () => {}
      });
      return of(this.cachedCustomers);
    }
    return this.http.get(this.baseUrl + '/Customer/GetAllCustomer/getallcustomer').pipe(
      timeout(3500),
      tap((res: any) => {
        if (Array.isArray(res)) {
          this.cachedCustomers = res;
          this.offlineStorage.setCache('customers', res);
        }
      }),
      catchError(() => from(fetchOfflineCustomers()))
    );
  }
  getCustomerById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Customer/GetCustomerById/getcustomersby/' + id); }
  editCustomer(id: any, data: any): Observable<any> {
    return this.http.put(this.baseUrl + '/Customer/EditCustomer/editcustomers/' + id, data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  deleteCustomer(id: any): Observable<any> {
    return this.http.delete(this.baseUrl + '/Customer/DeleteCustomer/deletecustomer/' + id, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  getCustomerProductPrices(customerId: any): Observable<any> { return this.http.get(this.baseUrl + '/Customer/GetCustomerProductPrices/customers/' + customerId + '/product-prices').pipe(timeout(3500), catchError(() => of([]))); }
  createCustomerProductPrice(customerId: any, data: any): Observable<any> { return this.http.post(this.baseUrl + '/Customer/CreateCustomerProductPrice/customers/' + customerId + '/product-prices', data); }
  updateCustomerProductPrice(customerId: any, productId: any, data: any): Observable<any> { return this.http.patch(this.baseUrl + '/Customer/UpdateCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, data); }
  deleteCustomerProductPrice(customerId: any, productId: any): Observable<any> { return this.http.delete(this.baseUrl + '/Customer/DeleteCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, { responseType: 'text' }); }
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

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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

      return from(
        Promise.all([
          this.localDb.insertOrderTransaction(orderData, itemsData, paymentData),
          this.offlineStorage.enqueue('CREATE_INVOICE', data, data.offlineReferenceId)
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

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return saveOfflineFallback();
    }

    return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data).pipe(
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => {
        if (err instanceof HttpErrorResponse && err.status === 0) {
          console.warn('[Offline Fallback] Network unreachable, enqueuing invoice locally:', err);
          return saveOfflineFallback();
        }
        return throwError(() => err);
      })
    );
  }

  postInvoiceDirect(data: any): Observable<any> {
    return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  getStockReadyInvoices(): Observable<any> { return this.http.get(this.baseUrl + '/Invoice/GetStockReadyInvoices/invoices/stock-ready'); }

  getInvoices(params?: any): Observable<any> {
    const fetchOfflineInvoices = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const deletedIds = queue.filter(q => q.type === 'DELETE_INVOICE').map(q => q.payload?.invoiceId);
      const pendingInvoices = queue
        .filter(q => q.type === 'CREATE_INVOICE')
        .map(q => {
          const p = q.payload;
          return {
            id: q.id,
            invoiceNumber: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
            customerId: p.customerId,
            customerName: p.customerName || '',
            totalAmount: p.totalAmount,
            paidAmount: p.paidAmount || 0,
            balance: p.balance != null ? p.balance : (p.totalAmount - (p.paidAmount || 0)),
            invoiceDate: p.orderDate || p.invoiceDate || new Date(q.createdAt).toISOString(),
            status: p.paidAmount >= p.totalAmount ? 'Paid' : (p.paidAmount > 0 ? 'Partial' : 'Pending'),
            termType: p.termType || 'Cash Sale',
            items: p.items || [],
            isOffline: true
          };
        });
      let result = [...pendingInvoices, ...cached].filter(inv => !deletedIds.includes(inv.id));
      if (params?.customerId) {
        result = result.filter(inv => Number(inv.customerId) === Number(params.customerId));
      }
      updateInvoiceDocNos(result);
      return result;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return from(fetchOfflineInvoices());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoices/invoices', { params }).pipe(
      timeout(3500),
      tap((res: any) => {
        if (Array.isArray(res) && !params?.customerId) {
          this.offlineStorage.setCache('invoices_list', res);
        }
      }),
      map((res: any) => {
        if (Array.isArray(res)) {
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
      const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      return cachedInvoices.find((i: any) => String(i.id) === String(id)) || null;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return from(fetchOfflineDetail());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoiceDetails/invoices/' + id).pipe(
      timeout(3500),
      map((res: any) => {
        if (res) {
          res.docNo = formatDocNo(res);
          this.offlineStorage.setCache('inv_detail_' + id, res);
        }
        return res;
      }),
      catchError(() => from(fetchOfflineDetail()))
    );
  }
  updateInvoice(id: any, data: any): Observable<any> {
    const saveOfflineUpdate = () => {
      this.offlineStorage.getCache<any>('inv_detail_' + id).then(detail => {
        if (detail) {
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
          this.offlineStorage.setCache('inv_detail_' + id, detail);
        }
      });
      return from(
        this.offlineStorage.enqueue('UPDATE_INVOICE', { invoiceId: id, data }, 'upd_inv_' + id).then(() => ({
          message: 'Invoice updated offline (Queued for sync)',
          invoiceId: id,
          isOffline: true
        }))
      );
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return saveOfflineUpdate();
    }

    return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data).pipe(
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => {
        if (err instanceof HttpErrorResponse && err.status === 0) {
          return saveOfflineUpdate();
        }
        return throwError(() => err);
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

  deleteDirect(url: string): Observable<any> {
    return this.http.delete(url, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  deleteInvoice(id: any): Observable<any> {
    return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
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

  createPayment(data: any): Observable<any> {
    return this.http.post(this.baseUrl + '/Payment/CreatePayment/payments', data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  createBulkPayment(data: any): Observable<any> {
    return this.http.post(this.baseUrl + '/Payment/CreateBulkPayment/bulk-payments', data).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  getPayInfo(customerId: any, invoiceId: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPayInfo/customers/' + customerId + '/invoices/' + invoiceId + '/pay-info'); }
  getPaymentPreview(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPaymentPreview/payments/' + id + '/preview').pipe(timeout(3500), catchError(() => of(null))); }
  getPayments(): Observable<any> {
    const fetchOfflinePayments = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      return cached;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return from(fetchOfflinePayments());
    }

    return this.http.get(this.baseUrl + '/Payment/GetPayments/payments').pipe(
      timeout(3500),
      tap((res: any) => {
        if (Array.isArray(res)) {
          this.offlineStorage.setCache('payments_list', res);
        }
      }),
      catchError(() => from(fetchOfflinePayments()))
    );
  }
  getPaymentById(id: any): Observable<any> { return this.http.get(this.baseUrl + '/Payment/GetPaymentById/payments/' + id); }
  deletePayment(id: any): Observable<any> {
    return this.http.delete(this.baseUrl + '/Payment/DeletePayment/payments/' + id, { responseType: 'text' }).pipe(
      tap(() => this.clearCustomerCache())
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

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
        error: () => {}
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
