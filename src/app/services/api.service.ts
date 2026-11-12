import { getInvoicePaymentStatus, getInvoicePaymentSummary } from '../utils/invoice-payment-summary';
import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, from, throwError, firstValueFrom } from 'rxjs';
import { map, tap, catchError, switchMap, timeout } from 'rxjs/operators';
import { Network } from '@capacitor/network';
import { updateInvoiceDocNos, formatDocNo, normalizeInvoiceDate, getInvoiceNormalizedDate } from '../utils/invoice-helper';
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

  getFullBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/full').pipe(timeout(330000)); }
  getIncrementBackup(): Observable<any> { return this.http.get(this.baseUrl + '/api/backup/increment'); }
  downloadBackup(id: string): Observable<Blob> { return this.http.get(this.baseUrl + '/api/backup/download/' + encodeURIComponent(id), { responseType: 'blob' }).pipe(timeout(330000)); }

  private operationOptions(operationId?: string): { headers: Record<string, string> } {
    if (operationId) this.offlineStorage.registerAttempt(operationId);
    return { headers: operationId ? { 'X-Offline-Operation-Id': operationId } : {} };
  }

  async verifyOfflineSyncSupport(): Promise<void> {
    const result = await firstValueFrom(this.http.get<any>(this.baseUrl + '/System/GetOfflineSyncCapabilities').pipe(timeout(5000)));
    if (result?.protocolVersion !== 1 || result?.explicitCreditSelection !== true) throw new Error('Update the API before syncing offline changes');
  }

  private async verifyCreditSelectionSupport(): Promise<void> {
    const result = await firstValueFrom(this.http.get<any>(this.baseUrl + '/System/GetOfflineSyncCapabilities').pipe(timeout(5000)));
    if (result?.explicitCreditSelection !== true) throw new Error('Update the API before using explicit CN selection.');
  }

  getCompanyProfile(): Observable<any> {
    return this.http.get(this.baseUrl + '/System/GetCompanyProfile').pipe(timeout(5000));
  }

  updateCompanyProfile(profile: any, expectedVersion: number, operationId: string): Observable<any> {
    return this.http.put(this.baseUrl + '/System/UpdateCompanyProfile', { ...profile, expectedVersion },
      this.operationOptions(operationId)).pipe(timeout(5000));
  }

  private hasTemporaryReferences(value: any): boolean {
    if (Array.isArray(value)) return value.some(item => this.hasTemporaryReferences(item));
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
      (key === 'selectedCreditNoteIds' && Array.isArray(child) && child.some(id => !Number.isSafeInteger(Number(id)))) ||
      (['customerId', 'productId', 'categoryId', 'invoiceId', 'cnId', 'selectedCreditNoteId'].includes(key) &&
        child != null && !Number.isSafeInteger(Number(child))) || this.hasTemporaryReferences(child));
  }

  private isConnectionError(error: any): boolean {
    return error?.status === 0 || error?.status >= 500 || error?.name === 'TimeoutError';
  }

  private categoryMutation(action: 'CREATE' | 'UPDATE' | 'DELETE', id: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const save = async () => {
      const list = await this.offlineStorage.getCache<any[]>('categories') || [];
      const pending = await this.offlineStorage.getPendingQueue();
      const create = pending.find(q => q.type === 'CREATE_CATEGORY' && String(q.id) === String(id));
      if (action === 'CREATE') {
        id = 'cat_' + this.offlineStorage.generateId();
        await this.offlineStorage.enqueue('CREATE_CATEGORY', data, id);
        list.unshift({ ...data, id, isOffline: true });
      } else if (action === 'UPDATE') {
        if (create && !create.attemptedAt) {
          create.payload = { ...create.payload, ...data };
          await this.offlineStorage.updateQueueItem(create);
        } else await this.offlineStorage.enqueue('UPDATE_CATEGORY', { _offlineOperationId: operationId, id, data }, 'upd_cat_' + id);
        const item = list.find(c => String(c.id) === String(id));
        if (item) Object.assign(item, data);
      } else {
        // Keep products attached to a category until it is explicitly reassigned.
        const products = await this.offlineStorage.getCache<any[]>('products') || [];
        const category = list.find(c => String(c.id) === String(id));
        if (products.some(p => String(p.categoryId) === String(id) ||
          (category && p.category === category.categoryName))) throw new Error('Category is used by products');
        await this.offlineStorage.removeQueueItem('upd_cat_' + id);
        if (create && !create.attemptedAt) await this.offlineStorage.removeQueueItem(create.id);
        else await this.offlineStorage.enqueue('DELETE_CATEGORY', { _offlineOperationId: operationId, id }, 'del_cat_' + id);
      }
      await this.offlineStorage.setCache('categories', list.filter(c => action !== 'DELETE' || String(c.id) !== String(id)));
      return { id, isOffline: true, message: 'Category saved on this device' };
    };
    if (!this.isOnline() || String(id).startsWith('cat_')) return from(save());
    const url = this.baseUrl + '/Category/' + (action === 'CREATE' ? 'CreateCategory/createcategory' :
      action === 'UPDATE' ? 'EditCategory/editcategory/' + id : 'DeleteCategory/deletecategory/' + id);
    const request = action === 'CREATE' ? this.http.post(url, data, this.operationOptions(operationId)) : action === 'UPDATE' ?
      this.http.put(url, data, this.operationOptions(operationId)) : this.http.delete(url, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) });
    return request.pipe(timeout(4000), catchError(error => this.isConnectionError(error) ? from(save()) : throwError(() => error)));
  }

  createCategory(data: any): Observable<any> { return this.categoryMutation('CREATE', null, data); }
  editCategory(id: any, data: any): Observable<any> { return this.categoryMutation('UPDATE', id, data); }
  deleteCategory(id: any): Observable<any> { return this.categoryMutation('DELETE', id, null); }
  getCategories(): Observable<any> {
    const merge = async (server?: any[]) => {
      const cached = await this.offlineStorage.getCache<any[]>('categories') || [];
      let list = server ? [...server] : [...cached];
      for (const q of await this.offlineStorage.getPendingQueue()) {
        if (q.type === 'CREATE_CATEGORY') {
          list = [{ ...q.payload, id: q.id, isOffline: true }, ...list.filter(c => String(c.id) !== q.id)];
        } else if (q.type === 'UPDATE_CATEGORY') {
          list = list.map(c => String(c.id) === String(q.payload.id) ? { ...c, ...q.payload.data } : c);
        } else if (q.type === 'DELETE_CATEGORY') list = list.filter(c => String(c.id) !== String(q.payload.id));
      }
      await this.offlineStorage.setCache('categories', list);
      return list;
    };
    if (!this.isOnline()) return from(merge());
    return this.http.get<any[]>(this.baseUrl + '/Category/GetCategories/categories').pipe(
      timeout(3500), switchMap(list => from(merge(list))), catchError(() => from(merge())));
  }

  createCreditNote(invoiceId: any, data: any, extraInfo?: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineCN = async () => {
      const offlineId = 'cn_' + this.offlineStorage.generateId();
      const cnNumber = 'CN-OFFLINE-' + String(Date.now()).slice(-6);
      const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);

      let custName = extraInfo?.customerName || '';
      let custId = (extraInfo?.customerId || 0);

      if (!custName || !custId) {
        const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
        const inv = cachedInvoices.find((i: any) => String(i.id) === String(invoiceId) || (extraInfo?.invoiceNumber && (i.invoiceNumber === extraInfo.invoiceNumber || i.docNo === extraInfo.invoiceNumber)));
        if (inv) {
          if (!custId) custId = (inv.customerId || inv.CustomerId || (inv.customer ? inv.customer.id : 0)) || 0;
          if (!custName) custName = inv.customerName || inv.CustomerName || (inv.customer ? inv.customer.name : '');
        }
      }
      if ((!custName || custName.startsWith('Customer #')) && custId) {
        const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];
        const c = cachedCusts.find((cust: any) => String(cust.id) === String(custId));
        if (c && c.name) custName = c.name;
      }

      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const newEntry = {
        id: offlineId,
        cnNumber,
        invoiceId,
        invoiceNumber: extraInfo?.invoiceNumber || '',
        customerId: custId,
        customerName: custName,
        amount: totalAmount,
        createdAt: new Date().toISOString(),
        reason: data?.reason || '',
        items: data?.items || [],
        Items: data?.items || [],
        isOffline: true
      };
      const filteredList = cached.filter(c => String(c.id ?? c.Id) !== String(offlineId));
      await this.offlineStorage.setCache('credit_notes_list', [newEntry, ...filteredList]);

      await this.offlineStorage.enqueue('CREATE_CN', { _offlineOperationId: operationId,
        invoiceId,
        invoiceNumber: extraInfo?.invoiceNumber || '',
        data,
        offlineId,
        cnNumber,
        customerName: custName,
        customerId: custId
      }, offlineId);

      await this.applyOfflineCNDeductionToInvoice(newEntry);

      return {
        message: 'Credit Note created offline (Queued for sync)',
        id: offlineId,
        cnNumber,
        customerName: custName,
        amount: totalAmount,
        isOffline: true
      };
    };

    if (!this.isOnline() || !Number.isSafeInteger(Number(invoiceId)) || this.hasTemporaryReferences(data)) {
      return from(saveOfflineCN());
    }

    return this.http.post(this.baseUrl + '/Credit/CreateCreditNote/invoices/' + invoiceId + '/credit-notes', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineCN()) : throwError(() => err))
    );
  }

  createGlobalCreditNote(customerId: any, data: any, extraInfo?: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineGlobalCN = async () => {
      const offlineId = 'cn_g_' + this.offlineStorage.generateId();
      const cnNumber = 'CN-GLOBAL-OFFLINE-' + String(Date.now()).slice(-6);
      const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);

      const targetInvId = extraInfo?.invoiceId || data?.preferredInvoiceId || 0;
      const targetInvDoc = extraInfo?.invoiceNumber || '';

      let custId = (customerId || extraInfo?.customerId || 0);
      let custName = extraInfo?.customerName || '';

      if ((!custName || custName.startsWith('Customer #')) && custId) {
        const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];
        const c = cachedCusts.find((cust: any) => String(cust.id) === String(custId));
        if (c && c.name) custName = c.name;
      }
      if (!custName && (targetInvId || targetInvDoc)) {
        const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
        const inv = cachedInvoices.find((i: any) => (targetInvId && String(i.id) === String(targetInvId)) || (targetInvDoc && (i.invoiceNumber === targetInvDoc || i.docNo === targetInvDoc)));
        if (inv) {
          if (!custId) custId = (inv.customerId || inv.CustomerId || 0) || 0;
          custName = inv.customerName || inv.CustomerName || (inv.customer ? inv.customer.name : '');
        }
      }
      if ((!custName || custName.startsWith('Customer #')) && custId) {
        const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];
        const c = cachedCusts.find((cust: any) => String(cust.id) === String(custId));
        if (c && c.name) custName = c.name;
      }

      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const newEntry = {
        id: offlineId,
        cnNumber,
        invoiceId: targetInvId,
        invoiceNumber: targetInvDoc,
        customerId: custId,
        customerName: custName,
        amount: totalAmount,
        createdAt: new Date().toISOString(),
        reason: data?.reason || '',
        items: data?.items || [],
        Items: data?.items || [],
        isOffline: true
      };
      const filteredList = cached.filter(c => String(c.id ?? c.Id) !== String(offlineId));
      await this.offlineStorage.setCache('credit_notes_list', [newEntry, ...filteredList]);

      await this.offlineStorage.enqueue('CREATE_GLOBAL_CN', { _offlineOperationId: operationId,
        customerId: custId,
        data,
        offlineId,
        cnNumber,
        customerName: custName,
        invoiceId: targetInvId,
        invoiceNumber: targetInvDoc
      }, offlineId);

      if (targetInvId || targetInvDoc) {
        await this.applyOfflineCNDeductionToInvoice(newEntry);
      }

      return {
        message: 'Global Credit Note created offline (Queued for sync)',
        id: offlineId,
        cnNumber,
        customerName: custName,
        amount: totalAmount,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_') || this.hasTemporaryReferences(data)) {
      return from(saveOfflineGlobalCN());
    }

    return this.http.post(this.baseUrl + '/Credit/CreateGlobalCreditNote/customers/' + customerId + '/credit-notes-global', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineGlobalCN()) : throwError(() => err))
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
  getAvailableCredits(customerId: any): Observable<any> {
    const offline = async () => {
      const credits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const savedSnapshot = await this.offlineStorage.getCache<any[]>('available_credits_' + customerId);
      const saved = savedSnapshot || [];
      const invoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const own = credits.filter(c => String(c.customerId ?? invoices.find(i => String(i.id) === String(c.invoiceId))?.customerId) === String(customerId)).map(c => {
        const capped = saved.find(s => String(s.id ?? s.Id) === String(c.id ?? c.Id));
        return capped ? { ...capped, ...c, faceAmount: Number(c.amount ?? c.Amount), amount: Math.min(Number(c.amount ?? c.Amount), Number(capped.amount ?? capped.Amount)) } : c;
      });
      const seen = new Set<string>();
      return [...own.filter(c => !savedSnapshot || c.isOffline || saved.some(s => String(s.id ?? s.Id) === String(c.id ?? c.Id))), ...saved].filter(c => {
        const id = String(c.id ?? c.Id);
        if (seen.has(id)) return false;
        seen.add(id);
        return !c.isUsed && Number(c.amount ?? c.Amount) > 0.01 &&
          (c.createdAfterPayment || String(c.cnNumber ?? c.CNNumber).startsWith('CN-CHG') || saved.includes(c));
      });
    };
    if (!this.isOnline() || String(customerId).startsWith('cust_')) return from(offline());
    return this.http.get<any[]>(this.baseUrl + '/Credit/GetAvailableCredits/customers/' + customerId + '/available-credits').pipe(
      timeout(3500), tap(list => this.offlineStorage.setCache('available_credits_' + customerId, list)),
      switchMap(list => from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
        queue.some(q => q.type === 'USE_CN' || q.type === 'CREATE_BULK_PAYMENT' || (q.type === 'CREATE_INVOICE' && q.payload?.useCreditBalance)) ? from(offline()) : of(list)))), catchError(() => from(offline())));
  }

  useCreditNote(invoiceId: any, cnId: any, queueOperation = true): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const offline = async () => {
      const credits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const invoices = await firstValueFrom(this.getInvoicesOffline());
      let target = invoices.find((i: any) => String(i.id) === String(invoiceId));
      if (!target) throw new Error('Invoice is not available on this device');
      const customerId = target.customerId;
      const available = await firstValueFrom(this.getAvailableCredits(customerId));
      const credit = available.find((c: any) => String(c.id ?? c.Id) === String(cnId));
      if (!credit) throw new Error('No available refund credit on this device');
      if (String(credit.customerId ?? customerId) !== String(customerId)) throw new Error('Credit belongs to another customer');
      if (Number(target.balance) <= 0.01) {
        target = invoices.filter((i: any) => String(i.customerId) === String(customerId) && Number(i.balance) > 0.01)
          .sort((a: any, b: any) => new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime())[0];
      }
      if (!target || !Number.isFinite(Number(target.balance))) throw new Error('No unpaid invoice available on this device');
      const amount = Math.round(Math.min(Number(credit.amount ?? credit.Amount), Number(target.balance)) * 100) / 100;
      if (amount <= 0.01) throw new Error('No usable credit balance');
      const remaining = Math.round((Number(credit.faceAmount ?? credit.amount ?? credit.Amount) - amount) * 100) / 100;
      const availableRemaining = Math.max(0, Number(credit.amount ?? credit.Amount) - amount);
      const updated = { ...credit, amount: remaining, isUsed: remaining <= 0.01 };
      const id = credit.id ?? credit.Id;
      const nextCredits = credits.filter(c => String(c.id ?? c.Id) !== String(id));
      nextCredits.push(updated);
      const task = queueOperation ? await this.offlineStorage.enqueue('USE_CN', { _offlineOperationId: operationId,
        invoiceId: target.id, requestedInvoiceId: this.offlineStorage.wasAttempted(operationId) ? invoiceId : target.id,
        requestBody: this.offlineStorage.wasAttempted(operationId) ? {} : undefined, cnId: id, customerId, amount,
        cnRemainingAmount: remaining, cnFullyUsed: updated.isUsed
      }) : { id: 'create-credit-' + invoiceId };
      await this.offlineStorage.setCache('credit_notes_list', nextCredits);
      await this.offlineStorage.setCache('available_credits_' + customerId, available.map((c: any) => String(c.id ?? c.Id) === String(id) ? { ...updated, amount: availableRemaining } : c));
      target.creditUsed = Number(target.creditUsed || 0) + amount;
      target.balance = Math.max(0, Number(target.balance) - amount);
      target.status = target.balance <= 0.01 ? 'Paid' : 'Partial';
      await this.offlineStorage.setCache('invoices_list', invoices);
      const detail = await this.offlineStorage.getCache<any>('inv_detail_' + target.id);
      if (detail) await this.offlineStorage.setCache('inv_detail_' + target.id, { ...detail, ...target });
      this.clearCustomerCache();
      return { isOffline: true, taskId: task.id, creditApplied: amount, cnRemainingAmount: remaining,
        cnFullyUsed: updated.isUsed, appliedToInvoice: target.invoiceNumber, invoiceNewBalance: target.balance, invoiceStatus: target.status };
    };
    if (!this.isOnline() || !Number.isSafeInteger(Number(invoiceId)) || !Number.isSafeInteger(Number(cnId))) return from(offline());
    return this.http.patch(this.baseUrl + '/Credit/UseCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId + '/use', {}, this.operationOptions(operationId)).pipe(
      timeout(4000), tap(() => this.clearCustomerCache()),
      catchError(error => this.isConnectionError(error) ? from(offline()) : throwError(() => error)));
  }

  private async updateCachedReturnCredit(previous: any, next?: any): Promise<void> {
    if (!previous || previous.createdAfterPayment || String(previous.cnNumber).startsWith('CN-CHG')) return;
    const invoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
    for (const inv of invoices) {
      if (String(inv.id) !== String(previous.invoiceId)) continue;
      inv.creditNotes = (inv.creditNotes || []).filter((c: any) => String(c.id) !== String(previous.id));
      if (next) inv.creditNotes.push(next);
      inv.cnTotal = Math.max(0, Number(inv.cnTotal ?? inv.CNTotal ?? previous.amount) - Number(previous.amount || 0) + Number(next?.amount || 0));
      inv.CNTotal = inv.cnTotal;
      inv.hasCreditNote = inv.HasCreditNote = inv.cnTotal > 0;
      inv.balance = Math.max(0, Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0) - Number(inv.creditUsed || 0) - inv.cnTotal);
      inv.status = inv.balance <= 0.01 ? 'Paid' : Number(inv.paidAmount || 0) + Number(inv.creditUsed || 0) > 0 ? 'Partial' : 'Unpaid';
      const detail = await this.offlineStorage.getCache<any>('inv_detail_' + inv.id);
      if (detail) await this.offlineStorage.setCache('inv_detail_' + inv.id, { ...detail, ...inv });
    }
    await this.offlineStorage.setCache('invoices_list', invoices);
  }

  updateCreditNote(cnId: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineUpdateCN = async () => {
      if (String(cnId).startsWith('cn_')) {
        const item = await this.offlineStorage.getQueueItemById(String(cnId));
        if (item?.attemptedAt) {
          await this.offlineStorage.enqueue('UPDATE_CN', { cnId, data }, 'upd_cn_' + cnId);
        } else if (item && item.payload) {
          item.payload.data = data;
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('UPDATE_CN', { _offlineOperationId: operationId, cnId, data }, 'upd_cn_' + cnId);
      }

      // 同步更新本地缓存
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const updated = cached.map(c => {
        if (String(c.id) === String(cnId)) {
          const totalAmount = (data?.items || []).reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
          return {
            ...c,
            amount: totalAmount,
            reason: data?.reason ?? c.reason,
            items: data?.items || c.items,
            Items: data?.items || c.items
          };
        }
        return c;
      });
      await this.offlineStorage.setCache('credit_notes_list', updated);
      await this.updateCachedReturnCredit(cached.find(c => String(c.id) === String(cnId)), updated.find(c => String(c.id) === String(cnId)));

      return {
        message: 'Credit Note updated offline (Queued for sync)',
        id: cnId,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(cnId).startsWith('cn_')) {
      return from(saveOfflineUpdateCN());
    }

    return this.http.put(this.baseUrl + '/Credit/UpdateCreditNote/credit-notes/' + cnId, data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineUpdateCN()) : throwError(() => err))
    );
  }

  deleteCreditNote(invoiceId: any, cnId: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const saveOfflineDeleteCN = async () => {
      const creating = await this.offlineStorage.getQueueItemById(String(cnId));
      if (String(cnId).startsWith('cn_') && !creating?.attemptedAt) {
        await this.offlineStorage.removeQueueItem(String(cnId));
        await this.offlineStorage.removeQueueItem('upd_cn_' + cnId);
        await this.offlineStorage.refreshQueueCount();
      } else {
        await this.offlineStorage.enqueue('DELETE_CN', { _offlineOperationId: operationId, invoiceId, cnId }, 'del_cn_' + cnId);
      }

      // 从缓存中直接过滤移除
      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const updated = cached.filter(c => String(c.id) !== String(cnId));
      await this.offlineStorage.setCache('credit_notes_list', updated);
      await this.updateCachedReturnCredit(cached.find(c => String(c.id) === String(cnId)));

      return {
        message: 'Credit Note removed offline',
        id: cnId,
        isOffline: true
      };
    };

    if (!this.isOnline() || String(cnId).startsWith('cn_')) {
      return from(saveOfflineDeleteCN());
    }

    return this.http.delete(this.baseUrl + '/Credit/DeleteCreditNote/invoices/' + invoiceId + '/credit-notes/' + cnId, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineDeleteCN()) : throwError(() => err))
    );
  }

  getAllCreditNotes(): Observable<any> {
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getAllCreditNotesInternal(queue.some(q => ["CREATE_INVOICE", "CREATE_CN","CREATE_GLOBAL_CN","UPDATE_CN","DELETE_CN","USE_CN","CREATE_BULK_PAYMENT"].includes(q.type)))));
  }

  private getAllCreditNotesInternal(preferLocal: boolean): Observable<any> {
    const mapOfflineCNs = (queue: any[], cachedCusts: any[] = [], cachedInvs: any[] = []) => {
      return queue
        .filter(q => q.type === 'CREATE_CN' || q.type === 'CREATE_GLOBAL_CN')
        .map(q => {
          const items = q.payload?.data?.items || [];
          const totalAmount = items.reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
          let custName = q.payload?.customerName || '';
          const cid = q.payload?.customerId || 0;
          if ((!custName || custName.startsWith('Customer #')) && cid && cachedCusts.length) {
            const foundC = cachedCusts.find(c => String(c.id) === String(cid));
            if (foundC && foundC.name) custName = foundC.name;
          }
          if ((!custName || custName.startsWith('Customer #')) && (q.payload?.invoiceId || q.payload?.invoiceNumber) && cachedInvs.length) {
            const foundInv = cachedInvs.find(i => String(i.id) === String(q.payload.invoiceId) || (q.payload.invoiceNumber && (i.invoiceNumber === q.payload.invoiceNumber || i.docNo === q.payload.invoiceNumber)));
            if (foundInv) {
              const invCust = foundInv.customerName || foundInv.CustomerName || (foundInv.customer ? foundInv.customer.name : '');
              if (invCust) custName = invCust;
            }
          }
          return {
            id: q.id,
            cnNumber: q.payload?.cnNumber || ('CN-OFFLINE-' + q.id),
            invoiceId: q.payload?.invoiceId || 0,
            customerId: cid,
            customerName: custName,
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
      const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];
      const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const offlineCNs = mapOfflineCNs(queue, cachedCusts, cachedInvs);
      for (const q of queue.filter(q => q.type === 'USE_CN')) {
        const credit = cached.find(c => String(c.id) === String(q.payload.cnId));
        if (credit) offlineCNs.unshift(credit);
      }
      const deletedCNIds = queue
        .filter(q => q.type === 'DELETE_CN')
        .map(q => String(q.payload?.cnId));

      const seenIds = new Set<string>();
      const seenNumbers = new Set<string>();
      const uniqueList: any[] = [];
      for (const item of [...offlineCNs, ...cached]) {
        const cid = String(item.id ?? item.Id ?? '');
        const cnum = item.cnNumber || item.CNNumber;
        if (deletedCNIds.includes(cid)) continue;
        if (cid && seenIds.has(cid)) continue;
        if (cnum && seenNumbers.has(cnum)) continue;
        if (cid) seenIds.add(cid);
        if (cnum) seenNumbers.add(cnum);

        if ((!item.customerName || item.customerName.startsWith('Customer #')) && (item.customerId || item.CustomerId)) {
          const custId = item.customerId || item.CustomerId;
          const foundC = cachedCusts.find(c => String(c.id) === String(custId));
          if (foundC && foundC.name) item.customerName = foundC.name;
        }
        if ((!item.customerName || item.customerName.startsWith('Customer #')) && (item.invoiceId || item.invoiceNumber)) {
          const foundInv = cachedInvs.find(i => String(i.id) === String(item.invoiceId) || (item.invoiceNumber && (i.invoiceNumber === item.invoiceNumber || i.docNo === item.invoiceNumber)));
          if (foundInv) {
            const invCust = foundInv.customerName || foundInv.CustomerName || (foundInv.customer ? foundInv.customer.name : '');
            if (invCust) item.customerName = invCust;
          }
        }
        uniqueList.push(item);
      }
      return uniqueList;
    };

    if (preferLocal || !this.isOnline()) {
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
        const cachedCusts = await this.offlineStorage.getCache<any[]>('customers') || [];
        const cachedInvs = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
        const offlineCNs = mapOfflineCNs(queue, cachedCusts, cachedInvs);
        const deletedCNIds = queue
          .filter(q => q.type === 'DELETE_CN')
          .map(q => String(q.payload?.cnId));
        const sList = Array.isArray(serverList) ? serverList : [];
        const seenIds = new Set<string>();
        const seenNumbers = new Set<string>();
        const uniqueList: any[] = [];
        for (const item of [...offlineCNs, ...sList]) {
          const cid = String(item.id ?? item.Id ?? '');
          const cnum = item.cnNumber || item.CNNumber;
          if (deletedCNIds.includes(cid)) continue;
          if (cid && seenIds.has(cid)) continue;
          if (cnum && seenNumbers.has(cnum)) continue;
          if (cid) seenIds.add(cid);
          if (cnum) seenNumbers.add(cnum);

          if ((!item.customerName || item.customerName.startsWith('Customer #')) && (item.customerId || item.CustomerId)) {
            const custId = item.customerId || item.CustomerId;
            const foundC = cachedCusts.find(c => String(c.id) === String(custId));
            if (foundC && foundC.name) item.customerName = foundC.name;
          }
          if ((!item.customerName || item.customerName.startsWith('Customer #')) && (item.invoiceId || item.invoiceNumber)) {
            const foundInv = cachedInvs.find(i => String(i.id) === String(item.invoiceId) || (item.invoiceNumber && (i.invoiceNumber === item.invoiceNumber || i.docNo === item.invoiceNumber)));
            if (foundInv) {
              const invCust = foundInv.customerName || foundInv.CustomerName || (foundInv.customer ? foundInv.customer.name : '');
              if (invCust) item.customerName = invCust;
            }
          }
          uniqueList.push(item);
        }
        return uniqueList;
      })())),
      catchError(() => from(fetchOfflineFallback()))
    );
  }

  createCustomer(data: any): Observable<any> {
    const operationId = data?._offlineOperationId || this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineCustomer = async () => {
      const offlineId = 'cust_off_' + this.offlineStorage.generateId();
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

      const cached = await this.offlineStorage.getCache<any[]>('customers') || [];
      await this.offlineStorage.setCache('customers', [newCustomer, ...cached]);

      if (this.cachedCustomers) {
        this.cachedCustomers = [newCustomer, ...this.cachedCustomers];
      }

      await this.offlineStorage.enqueue('CREATE_CUSTOMER', data, offlineId);
      return { message: 'Customer created offline (Queued for sync)', id: offlineId, data: newCustomer, isOffline: true };
    };

    if (!this.isOnline()) {
      return from(saveOfflineCustomer());
    }

    return this.http.post(this.baseUrl + '/Customer/CreateCustomers/createcustomers', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError(error => this.isConnectionError(error) ? from(saveOfflineCustomer()) : throwError(() => error))
    );
  }
  getAllCustomers(forceRefresh = false): Observable<any> {
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getAllCustomersInternal(forceRefresh, queue.some(q => ["CREATE_CUSTOMER","UPDATE_CUSTOMER","DELETE_CUSTOMER"].includes(q.type)))));
  }

  private getAllCustomersInternal(forceRefresh: boolean, preferLocal: boolean): Observable<any> {
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

    if (preferLocal || !this.isOnline()) {

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
              productId: item.productId ?? item.ProductId,
              customerId: item.customerId ?? item.CustomerId ?? cid,
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
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineEdit = async () => {
      if (String(id).startsWith('cust_')) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item?.attemptedAt) {
          await this.offlineStorage.enqueue('UPDATE_CUSTOMER', { id, data }, 'upd_cust_' + id);
        } else if (item && item.payload) {
          const currentData = item.payload.data || item.payload;
          item.payload = {
            ...item.payload,
            ...(item.payload.data ? { data: { ...currentData, ...data } } : data)
          };
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('UPDATE_CUSTOMER', { _offlineOperationId: operationId, id, data }, 'upd_cust_' + id);
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

    return this.http.put(this.baseUrl + '/Customer/EditCustomer/editcustomers/' + id, data, this.operationOptions(operationId)).pipe(
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
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineEdit()) : throwError(() => err))
    );
  }

  deleteCustomer(id: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const saveOfflineDelete = async () => {
      const creating = await this.offlineStorage.getQueueItemById(String(id));
      if (String(id).startsWith('cust_') && !creating?.attemptedAt) {
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
        await this.offlineStorage.enqueue('DELETE_CUSTOMER', { _offlineOperationId: operationId, id }, 'del_cust_' + id);
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

    return this.http.delete(this.baseUrl + '/Customer/DeleteCustomer/deletecustomer/' + id, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
      timeout(4000),
      tap(() => {
        this.clearCustomerCache();
        this.offlineStorage.removeCache('customer_detail_' + id);
        this.offlineStorage.removeCache('customer_prices_' + id);
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineDelete()) : throwError(() => err))
    );
  }

  getAllCustomerProductPrices(): Observable<any[]> {
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getAllCustomerProductPricesInternal(queue.some(q => q.type.includes('CUSTOMER_PRICE')))));
  }

  private getAllCustomerProductPricesInternal(preferLocal: boolean): Observable<any[]> {
    const normalizeList = (list: any[]) => {
      if (!Array.isArray(list)) return [];
      return list.map(item => ({
        id: item.id ?? item.Id,
        productId: item.productId ?? item.ProductId,
        customerId: item.customerId ?? item.CustomerId,
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

    if (preferLocal || !this.isOnline()) {
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
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getCustomerProductPricesInternal(customerId, queue.some(q => q.type.includes('CUSTOMER_PRICE') && String(q.payload?.customerId) === String(customerId)))));
  }

  private getCustomerProductPricesInternal(customerId: any, preferLocal: boolean): Observable<any[]> {
    if (!customerId) return of([]);
    const cid = customerId;
    const strCid = String(customerId);

    const normalizeList = (list: any[]) => {
      if (!Array.isArray(list)) return [];
      return list.map(item => ({
        id: item.id ?? item.Id,
        productId: item.productId ?? item.ProductId,
        customerId: item.customerId ?? item.CustomerId ?? cid,
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

    if (preferLocal || !this.isOnline() || String(customerId).startsWith('cust_')) {
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
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
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

      await this.offlineStorage.enqueue('CREATE_CUSTOMER_PRICE', { _offlineOperationId: operationId, customerId, data });
      return { message: 'Special price saved offline', data: newEntity, isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_') || String(data?.productId).startsWith('prod_')) {
      return from(saveOfflinePrice());
    }

    return this.http.post(this.baseUrl + '/Customer/CreateCustomerProductPrice/customers/' + customerId + '/product-prices', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(async (res: any) => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const newEntity = res?.data || { customerId, productId: data.productId, specialPrice: data.specialPrice };
        this.offlineStorage.setCache('customer_prices_' + customerId, [...prices, newEntity]);
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflinePrice()) : throwError(() => err))
    );
  }

  updateCustomerProductPrice(customerId: any, productId: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
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
      if (existingCreate && !existingCreate.attemptedAt) {
        if (existingCreate.payload?.data) existingCreate.payload.data.specialPrice = data.specialPrice;
        else existingCreate.payload.specialPrice = data.specialPrice;
        await this.offlineStorage.updateQueueItem(existingCreate);
      } else {
        await this.offlineStorage.enqueue('UPDATE_CUSTOMER_PRICE', { _offlineOperationId: operationId, customerId, productId, data }, `upd_cp_${customerId}_${productId}`);
      }
      return { message: 'Special price updated offline', isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_') || String(productId).startsWith('prod_')) {
      return from(saveOfflineUpdatePrice());
    }

    return this.http.patch(this.baseUrl + '/Customer/UpdateCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(async () => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const idx = prices.findIndex((p: any) => p.productId == productId);
        if (idx !== -1) {
          prices[idx] = { ...prices[idx], specialPrice: data.specialPrice };
          this.offlineStorage.setCache('customer_prices_' + customerId, prices);
        }
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineUpdatePrice()) : throwError(() => err))
    );
  }

  deleteCustomerProductPrice(customerId: any, productId: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const saveOfflineDeletePrice = async () => {
      const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
      const filtered = prices.filter((p: any) => p.productId != productId);
      await this.offlineStorage.setCache('customer_prices_' + customerId, filtered);

      const allPrices = await this.offlineStorage.getCache<any[]>('all_customer_prices') || [];
      const filteredAll = allPrices.filter((p: any) => !(String(p.customerId ?? p.CustomerId) === String(customerId) && p.productId == productId));
      await this.offlineStorage.setCache('all_customer_prices', filteredAll);

      const pending = await this.offlineStorage.getPendingQueue();
      const existingCreate = pending.find(q => q.type === 'CREATE_CUSTOMER_PRICE' && String(q.payload?.customerId) === String(customerId) && (q.payload?.data?.productId == productId || q.payload?.productId == productId));
      if (existingCreate && !existingCreate.attemptedAt) {
        await this.offlineStorage.removeQueueItem(existingCreate.id);
      } else if (existingCreate?.attemptedAt || !String(customerId).startsWith('cust_')) {
        await this.offlineStorage.enqueue('DELETE_CUSTOMER_PRICE', { _offlineOperationId: operationId, customerId, productId }, `del_cp_${customerId}_${productId}`);
      }
      return { message: 'Special price deleted offline', isOffline: true };
    };

    if (!this.isOnline() || String(customerId).startsWith('cust_') || String(productId).startsWith('prod_')) {
      return from(saveOfflineDeletePrice());
    }

    return this.http.delete(this.baseUrl + '/Customer/DeleteCustomerProductPrice/customers/' + customerId + '/product-prices/' + productId, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
      timeout(4000),
      tap(async () => {
        const prices = await this.offlineStorage.getCache<any[]>('customer_prices_' + customerId) || [];
        const filtered = prices.filter((p: any) => p.productId != productId);
        this.offlineStorage.setCache('customer_prices_' + customerId, filtered);
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineDeletePrice()) : throwError(() => err))
    );
  }
  getCustomerPurchaseHistory(customerId: any): Observable<any> {
    const fetchOfflineHistory = async () => {
      const invoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const custInvs = invoices.filter((inv: any) => String(inv.customerId) === String(customerId));
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
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
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
        creditUsed: 0,
        useCreditBalance: !!data.useCreditBalance,
        selectedCreditNoteId: data.selectedCreditNoteId ?? null,
        selectedCreditNoteIds: data.selectedCreditNoteIds ?? null,
        inputPaidAmount: Number(data.paidAmount || 0),
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

      const prepareCredit = async () => {
        const reservations: { cnId: any; customerId: any; amount: number }[] = [];
        const cachedCredits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
        const available = data.useCreditBalance && (data.selectedCreditNoteId || data.selectedCreditNoteIds?.length)
          ? await firstValueFrom(this.getAvailableCredits(data.customerId))
          : await this.offlineStorage.getCache<any[]>('available_credits_' + data.customerId) || [];
        let used = 0;
        if (data.useCreditBalance && (data.selectedCreditNoteId || data.selectedCreditNoteIds?.length)) {
          const explicitIds: any[] | null = Array.isArray(data.selectedCreditNoteIds) ? data.selectedCreditNoteIds : null;
          const selected = available.find((c: any) => String(c.id ?? c.Id) === String(data.selectedCreditNoteId ?? explicitIds?.[0]));
          if (!selected) throw new Error('Selected refund credit is not available on this device');
          const others = available.filter((c: any) => String(c.id ?? c.Id) !== String(data.selectedCreditNoteId))
            .sort((a: any, b: any) => new Date(a.createdAt ?? a.CreatedAt ?? 0).getTime() - new Date(b.createdAt ?? b.CreatedAt ?? 0).getTime());
          const candidates = explicitIds ? explicitIds.map(id => available.find((c: any) => String(c.id ?? c.Id) === String(id)))
            : data.termType === 'On Credit' ? [selected, ...others] : [selected];
          if (candidates.some(c => !c)) throw new Error('A selected credit note is not available on this device.');
          for (const credit of candidates) {
            const amount = Math.round(Math.min(Number(credit.amount ?? credit.Amount), roundedTotal - used) * 100) / 100;
            if (amount <= 0.01) continue;
            const id = credit.id ?? credit.Id;
            const faceRemaining = Math.round((Number(credit.faceAmount ?? credit.amount ?? credit.Amount) - amount) * 100) / 100;
            const updated = { ...credit, id, amount: faceRemaining, isUsed: faceRemaining <= 0.01 };
            const index = cachedCredits.findIndex(c => String(c.id ?? c.Id) === String(id));
            if (index >= 0) cachedCredits[index] = updated; else cachedCredits.push(updated);
            const snapshot = available.find((c: any) => String(c.id ?? c.Id) === String(id));
            Object.assign(snapshot, { amount: Math.max(0, Number(snapshot.amount ?? snapshot.Amount) - amount), isUsed: updated.isUsed });
            reservations.push({ cnId: id, customerId: data.customerId, amount });
            used = Math.round((used + amount) * 100) / 100;
            if (roundedTotal - used <= 0.01) break;
          }
        }
        Object.assign(orderData, { offlineCreditReservations: reservations });
        const actualPaid = Math.min(Number(data.paidAmount || 0), Math.max(0, roundedTotal - used));
        const excess = Math.round((Number(data.paidAmount || 0) - actualPaid) * 100) / 100;
        Object.assign(orderData, { paidAmount: actualPaid, creditUsed: used, balance: Math.max(0, roundedTotal - actualPaid - used) });
        Object.assign(offlineDetail, { paidAmount: actualPaid, creditUsed: used, balance: orderData.balance,
          status: orderData.balance <= 0.01 ? 'Paid' : actualPaid + used > 0 ? 'Partial' : 'Unpaid' });
        data.offlineCreditReservations = reservations;
        if (excess > 0.01) {
          const id = 'cn_' + this.offlineStorage.generateId();
          data.offlineChangeCreditNoteId = id;
          Object.assign(orderData, { offlineChangeCreditNoteId: id });
          data.offlineChangeCreditAmount = excess;
          cachedCredits.push({ id, invoiceId: data.offlineReferenceId, customerId: data.customerId,
            cnNumber: 'CN-CHG-OFFLINE-' + id, amount: excess, createdAfterPayment: true,
            createdAt: new Date().toISOString(), isUsed: false, isOffline: true });
        }
        // Preserve the original cash input in the upload; the API performs the same allocation.
        await Promise.all([
          this.localDb.insertOrderTransaction(orderData, itemsData, paymentData),
          this.offlineStorage.enqueue('CREATE_INVOICE', data, data.offlineReferenceId),
          this.offlineStorage.setCache('inv_detail_' + data.offlineReferenceId, offlineDetail),
          this.offlineStorage.getCache<any[]>('invoices_list').then(list =>
            this.offlineStorage.setCache('invoices_list', [offlineDetail, ...(list || []).filter(i => String(i.id) !== data.offlineReferenceId)]))
        ]);
        if (reservations.length || excess > 0.01) {
          await this.offlineStorage.setCache('credit_notes_list', cachedCredits);
          await this.offlineStorage.setCache('available_credits_' + data.customerId, available);
        }
        return { message: 'Invoice created offline (Saved to local DB & sync queue)', invoiceId: data.offlineReferenceId,
          isOffline: true, totalAmount: roundedTotal, creditUsed: used, remainingBalance: orderData.balance };
      };
      return from(prepareCredit());
    };

    if (!this.isOnline() || this.hasTemporaryReferences(data)) {
      return saveOfflineFallback();
    }

    const submit = () => this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data, this.operationOptions(operationId));
    const request = Array.isArray(data.selectedCreditNoteIds) && data.selectedCreditNoteIds.length
      ? from(this.verifyCreditSelectionSupport()).pipe(switchMap(() => submit())) : submit();
    return request.pipe(
      timeout(12000),
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
        if (!this.isConnectionError(err)) return throwError(() => err);
        console.warn('[Offline Fallback] Network unreachable or timeout, enqueuing invoice locally:', err);
        return saveOfflineFallback();
      })
    );
  }

  postInvoiceDirect(data: any, operationId?: string): Observable<any> {
    return this.http.post(this.baseUrl + '/Invoice/CreateInvoice/invoices', data, this.operationOptions(operationId)).pipe(
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
      // Cache all available invoice details, not only the latest 60.
      const targetInvoices = invoices;
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

      if (ov.invoiceNumber) {
        inv.invoiceNumber = ov.invoiceNumber;
        inv.docNo = ov.invoiceNumber;
      }
      if (ov.customerId !== undefined) inv.customerId = ov.customerId;
      if (ov.customerName !== undefined) inv.customerName = ov.customerName;


      if (ov.totalAmount !== undefined && inv.totalAmount == null) inv.totalAmount = ov.totalAmount;
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

    inv.invoiceDate = getInvoiceNormalizedDate(inv);
    if (inv.orderDate) {
      inv.orderDate = getInvoiceNormalizedDate(inv.orderDate);
    }
    if (!inv.customerName || !String(inv.customerName).trim()) {
      inv.customerName = inv.CustomerName || inv.customer?.name || '';
    }

    // Legacy display overrides must never overwrite current payment amounts.
    if (getInvoicePaymentSummary(inv).available) {
      inv.status = getInvoicePaymentStatus(inv);
      inv.balance = getInvoicePaymentSummary(inv).balance;
    }
  }

  async applyOfflineCNDeductionToInvoice(cn: any) {
    if (!cn || (!cn.invoiceId && !cn.invoiceNumber)) return;
    try {
      const invoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      let updated = false;
      const targetId = String(cn.invoiceId || '');
      const targetDoc = String(cn.invoiceNumber || '').trim();

      for (const inv of invoices) {
        const invIdStr = String(inv.id || '');
        const invDocStr = String(inv.invoiceNumber || inv.docNo || '').trim();
        const invRefStr = String(inv.offlineReferenceId || '');

        const matchId = targetId && targetId !== '0' && (targetId === invIdStr || (invRefStr && targetId === invRefStr));
        const matchDoc = targetDoc && (targetDoc === invDocStr || (invDocStr && targetDoc.includes(invDocStr)) || (invDocStr && invDocStr.includes(targetDoc)));

        if (matchId || matchDoc) {
          inv.creditNotes = inv.creditNotes || [];
          if (!inv.creditNotes.some((c: any) => String(c.id) === String(cn.id) || c.cnNumber === cn.cnNumber)) {
            inv.creditNotes.push(cn);
          }
          inv.hasCreditNote = true;
          inv.HasCreditNote = true;
          const totalCN = inv.creditNotes
            .filter((c: any) => !(c.cnNumber || '').startsWith('CN-CHG'))
            .reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);
          inv.cnTotal = totalCN;
          inv.CNTotal = totalCN;
          inv.balance = Math.max(0, (Number(inv.totalAmount) || 0) - (Number(inv.paidAmount) || 0) - (Number(inv.creditUsed) || 0) - totalCN);
          if (inv.balance <= 0.01 && ((Number(inv.paidAmount) || 0) > 0 || (Number(inv.creditUsed) || 0) > 0 || totalCN > 0)) {
            inv.status = 'Paid';
          }
          updated = true;

          const detailKey = 'inv_detail_' + inv.id;
          const cachedDetail = await this.offlineStorage.getCache<any>(detailKey);
          if (cachedDetail) {
            cachedDetail.creditNotes = inv.creditNotes;
            cachedDetail.hasCreditNote = true;
            cachedDetail.HasCreditNote = true;
            cachedDetail.cnTotal = totalCN;
            cachedDetail.CNTotal = totalCN;
            cachedDetail.balance = inv.balance;
            cachedDetail.status = inv.status;
            await this.offlineStorage.setCache(detailKey, cachedDetail);
          }
        }
      }
      if (updated) {
        await this.offlineStorage.setCache('invoices_list', invoices);
      }
    } catch (err) {
      console.warn('[Offline] Failed to apply CN deduction to cached invoice:', err);
    }
  }

  async applyOfflineCreditNotesToInvoicesList(invoices: any[]) {
    if (!Array.isArray(invoices) || invoices.length === 0) return;
    try {
      const cachedCNs = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const queueCNs = queue
        .filter(q => q.type === 'CREATE_CN' || q.type === 'CREATE_GLOBAL_CN')
        .map(q => {
          const items = q.payload?.data?.items || [];
          const totalAmount = items.reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
          return {
            id: q.id,
            cnNumber: q.payload?.cnNumber || ('CN-OFFLINE-' + q.id),
            invoiceId: q.payload?.invoiceId || q.payload?.data?.preferredInvoiceId || 0,
            invoiceNumber: q.payload?.invoiceNumber || '',
            customerId: q.payload?.customerId || 0,
            customerName: q.payload?.customerName || '',
            amount: totalAmount,
            createdAt: new Date(q.createdAt).toISOString(),
            reason: q.payload?.data?.reason || '',
            items: items,
            isOffline: true
          };
        });

      const deletedCNIds = new Set(queue.filter(q => q.type === 'DELETE_CN').map(q => String(q.payload.cnId)));
      const allOfflineCNs: any[] = [];
      const seenCN = new Set<string>();
      for (const cn of [...cachedCNs, ...queueCNs]) {
        const key = String(cn.id || cn.cnNumber || '');
        if (deletedCNIds.has(key)) continue;
        if (key && !seenCN.has(key)) {
          seenCN.add(key);
          allOfflineCNs.push(cn);
        }
      }

      if (allOfflineCNs.length === 0) return;

      for (const inv of invoices) {
        const invIdStr = String(inv.id || '');
        const invDocStr = String(inv.invoiceNumber || inv.docNo || '').trim();
        const invRefStr = String(inv.offlineReferenceId || '');

        const matchedCNs = allOfflineCNs.filter(cn => {
          const cnInvId = String(cn.invoiceId || '');
          const cnInvDoc = String(cn.invoiceNumber || '').trim();
          if (cnInvId && cnInvId !== '0' && (cnInvId === invIdStr || (invRefStr && cnInvId === invRefStr))) {
            return true;
          }
          if (cnInvDoc && (cnInvDoc === invDocStr || (invDocStr && cnInvDoc.includes(invDocStr)) || (invDocStr && invDocStr.includes(cnInvDoc)))) {
            return true;
          }
          return false;
        });

        if (matchedCNs.length > 0) {
          inv.creditNotes = (inv.creditNotes || []).filter((c: any) => !deletedCNIds.has(String(c.id)));
          for (const mcn of matchedCNs) {
            const alreadyHas = inv.creditNotes.some((c: any) =>
              String(c.id || '') === String(mcn.id || '') ||
              (c.cnNumber && c.cnNumber === mcn.cnNumber)
            );
            if (!alreadyHas) {
              inv.creditNotes.push(mcn);
            } else {
              inv.creditNotes = inv.creditNotes.map((c: any) => String(c.id) === String(mcn.id) ? mcn : c);
            }
          }
          inv.hasCreditNote = true;
          inv.HasCreditNote = true;
          const cnSum = inv.creditNotes
            .filter((c: any) => !(c.cnNumber || '').startsWith('CN-CHG'))
            .reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0);
          inv.cnTotal = cnSum;
          inv.CNTotal = cnSum;
          const total = Number(inv.totalAmount ?? inv.TotalAmount ?? 0);
          const paid = Number(inv.paidAmount ?? inv.PaidAmount ?? 0);
          const cred = Number(inv.creditUsed ?? inv.CreditUsed ?? 0);
          inv.balance = Math.max(0, total - paid - cred - cnSum);
          if (inv.balance <= 0.01 && ((Number(inv.paidAmount) || 0) > 0 || (Number(inv.creditUsed) || 0) > 0 || cnSum > 0 || inv.status === 'Paid')) {
            inv.status = 'Paid';
          }
        }
      }
    } catch (e) {
      console.warn('[Offline] Error applying offline CNs to invoices list:', e);
    }
  }

  private getInvoicesOffline(): Observable<any[]> {
    return from((async () => {
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const ids = new Set(cached.map(i => String(i.id)));
      for (const q of queue.filter(q => q.type === 'CREATE_INVOICE' && !ids.has(q.id))) {
        const p = q.payload;
        const total = p.totalAmount ?? p.items.reduce((sum: number, it: any) => sum + it.quantity * it.unitPrice, 0);
        cached.push({ ...p, id: q.id, totalAmount: total, balance: Math.max(0, total - Number(p.paidAmount || 0)), isOffline: true });
      }
      return cached;
    })());
  }

  getInvoices(params?: any): Observable<any> {
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getInvoicesInternal(params, queue.some(q => ["CREATE_INVOICE","UPDATE_INVOICE","DELETE_INVOICE","CREATE_CN","CREATE_GLOBAL_CN","UPDATE_CN","DELETE_CN","USE_CN","CREATE_BULK_PAYMENT","DELETE_PAYMENT"].includes(q.type)))));
  }

  private getInvoicesInternal(params: any, preferLocal: boolean): Observable<any> {
    const fetchOfflineInvoices = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const cachedCust = await this.offlineStorage.getCache<any[]>('customers') || [];
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
          const foundCustomer = cachedCust.find(c => String(c.id) === String(p.customerId));
          return {
            id: q.id,
            invoiceNumber: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
            docNo: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
            customerId: p.customerId,
            customerName: p.customerName || foundCustomer?.name || (p.customerId ? ('Customer #' + p.customerId) : ''),
            totalAmount: totalAmount,
            paidAmount: paidAmount,
            balance: p.balance != null ? Number(p.balance) : Math.max(0, totalAmount - paidAmount),
            invoiceDate: getInvoiceNormalizedDate({
              invoiceNumber: p.orderNumber || p.invoiceNumber || ('INV-OFFLINE-' + q.id),
              invoiceDate: p.orderDate || p.invoiceDate,
              createdAt: q.createdAt
            }),
            status: status,
            termType: p.termType || 'Cash Sale',
            items: p.items || [],
            isOffline: true
          };
        });
      const combined = [...pendingInvoices, ...cached].filter(inv => !deletedIds.includes(inv.id));
      for (const inv of combined) {
        if (!inv.customerName || !String(inv.customerName).trim()) {
          const cid = inv.customerId ?? inv.CustomerId;
          if (cid) {
            const foundC = cachedCust.find(c => String(c.id) === String(cid));
            if (foundC && foundC.name) inv.customerName = foundC.name;
          }
        }
      }
      const seenIds = new Set<string>();
      const serverInvNumbers = new Set<string>();
      const uniqueList: any[] = [];

      for (const inv of cached) {
        if (!inv || !inv.id) continue;
        const idKey = String(inv.id);
        if (seenIds.has(idKey)) continue;
        if (deletedIds.includes(inv.id) || deletedIds.includes(idKey)) continue;
        seenIds.add(idKey);
        if (inv.invoiceNumber) serverInvNumbers.add(String(inv.invoiceNumber).trim().toLowerCase());
        if (inv.offlineReferenceId) serverInvNumbers.add(String(inv.offlineReferenceId).trim().toLowerCase());
        uniqueList.push(inv);
      }

      for (const pending of pendingInvoices) {
        if (!pending || !pending.id) continue;
        const pId = String(pending.id);
        const pNum = String(pending.invoiceNumber || '').trim().toLowerCase();
        if (seenIds.has(pId)) continue;
        if (pNum && serverInvNumbers.has(pNum)) continue;
        if (deletedIds.includes(pending.id) || deletedIds.includes(pId)) continue;
        seenIds.add(pId);
        uniqueList.push(pending);
      }
      let result: any[] = uniqueList;
      if (params?.customerId) {
        result = result.filter(inv => String(inv.customerId) === String(params.customerId));
      }
      await this.applyOfflineCreditNotesToInvoicesList(result);
      this.applyInvoiceOverrides(result);
      updateInvoiceDocNos(result);
      return result;
    };

    if (preferLocal || !this.isOnline()) {
      return from(fetchOfflineInvoices());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoices/invoices', { params }).pipe(
      timeout(12000),
      tap((res: any) => {
        if (Array.isArray(res) && !params?.customerId) {
          this.applyInvoiceOverrides(res);
          this.offlineStorage.setCache('invoices_list', res);
          // 为每个包含 items 的发票直接写入 inv_detail_ 缓存，确保脱机离线时即刻可见完整商品清单
          for (const inv of res) {
            const items = inv.items || inv.Items;
            if (inv && inv.id && Array.isArray(items) && items.length > 0) {
              this.offlineStorage.setCache('inv_detail_' + inv.id, {
                ...inv,
                docNo: formatDocNo(inv),
                items: items
              });
            }
          }
          // 在后台静默预抓取发票明细到本地缓存
          this.prefetchInvoiceDetails(res).catch(() => { });
        }
      }),
      switchMap((serverList: any) => from((async () => {
        const list = Array.isArray(serverList) ? serverList : [];
        await this.applyOfflineCreditNotesToInvoicesList(list);
        this.applyInvoiceOverrides(list);
        updateInvoiceDocNos(list);
        return list;
      })())),
      catchError(() => from(fetchOfflineInvoices()))
    );
  }
  getInvoiceDetails(id: any): Observable<any> {
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getInvoiceDetailsInternal(id, queue.some(q => String(q.id) === String(id) || String(q.payload?.invoiceId) === String(id) || q.type === 'USE_CN' || q.type === 'CREATE_BULK_PAYMENT'))));
  }

  private getInvoiceDetailsInternal(id: any, preferLocal: boolean): Observable<any> {
    const fetchOfflineDetail = async () => {
      let cached = await this.offlineStorage.getCache<any>('inv_detail_' + id);
      const cachedItems = cached?.items || cached?.Items;
      if (cached && Array.isArray(cachedItems) && cachedItems.length > 0) {
        await this.applyOfflineCreditNotesToInvoicesList([cached]);
        return cached;
      }

      // 检查 localDb 待同步订单
      try {
        const pendingOrders = await this.localDb.getPendingOrders();
        const localMatch = pendingOrders.find(o => String(o.clientId) === String(id) || String(o.serverId) === String(id));
        if (localMatch) {
          const detailObj = {
            id: localMatch.clientId,
            invoiceNumber: localMatch.orderNumber,
            docNo: localMatch.orderNumber,
            customerId: localMatch.customerId,
            customerName: localMatch.customerName,
            orderDate: localMatch.orderDate,
            invoiceDate: localMatch.orderDate,
            totalAmount: localMatch.totalAmount,
            paidAmount: localMatch.paidAmount,
            creditUsed: localMatch.creditUsed || 0,
            balance: localMatch.balance,
            items: localMatch.items || [],
            isOffline: true
          };
          await this.applyOfflineCreditNotesToInvoicesList([detailObj]);
          if (Array.isArray(detailObj.items) && detailObj.items.length > 0) {
            await this.offlineStorage.setCache('inv_detail_' + id, detailObj);
          }
          return detailObj;
        }
      } catch { }

      // 检查离线 invoices_list 缓存
      const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const found = cachedInvoices.find((i: any) => String(i.id) === String(id)) || null;
      const foundItems = found?.items || found?.Items;
      if (found && Array.isArray(foundItems) && foundItems.length > 0) {
        const merged = { ...(cached || {}), ...found, items: foundItems };
        await this.applyOfflineCreditNotesToInvoicesList([merged]);
        await this.offlineStorage.setCache('inv_detail_' + id, merged);
        return merged;
      }

      // 若均无 items，则返回已有基础信息（避免完全无数据）
      const fallback = cached || found;
      if (fallback) {
        await this.applyOfflineCreditNotesToInvoicesList([fallback]);
        return fallback;
      }
      return null;
    };

    if (preferLocal || !this.isOnline() || !Number.isSafeInteger(Number(id))) {
      return from(fetchOfflineDetail());
    }

    return this.http.get(this.baseUrl + '/Invoice/GetInvoiceDetails/invoices/' + id).pipe(
      timeout(3500),
      map((res: any) => {
        if (res) {
          this.applyInvoiceOverrideToItem(res);
          res.docNo = formatDocNo(res);
          const resItems = res.items || res.Items;
          if (Array.isArray(resItems) && resItems.length > 0) {
            this.offlineStorage.setCache('inv_detail_' + id, res);
          }
        }
        return res;
      }),
      catchError(() => from(fetchOfflineDetail()))
    );
  }
  updateInvoice(id: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    data = { ...data, _offlineOperationId: operationId };
    const apply = async (offline: boolean, server?: any) => {
      const list = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      const detail = await this.offlineStorage.getCache<any>('inv_detail_' + id);
      const previous = detail || list.find(i => String(i.id) === String(id)) || {};
      const merged = { ...previous, ...data, ...(server || {}), id };
      if (Array.isArray(data.items)) merged.totalAmount = Math.round(data.items.reduce(
        (sum: number, it: any) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0) * 100) / 100;
      merged.paidAmount = Number(server?.paidAmount ?? previous.paidAmount ?? data.paidAmount ?? 0);
      merged.balance = getInvoicePaymentSummary(merged).balance;
      merged.status = getInvoicePaymentStatus(merged);
      merged.docNo = merged.invoiceNumber || previous.docNo;
      if (offline) {
        const pending = await this.offlineStorage.getQueueItemById(String(id));
        if (pending?.type === 'CREATE_INVOICE' && !pending.attemptedAt && !pending.payload?.useCreditBalance) {
          pending.payload = { ...pending.payload, ...data, totalAmount: merged.totalAmount, paidAmount: merged.paidAmount, balance: merged.balance };
          await this.localDb.updatePendingOrder(String(id), pending.payload);
          await this.offlineStorage.updateQueueItem(pending);
        } else await this.offlineStorage.enqueue('UPDATE_INVOICE', { _offlineOperationId: operationId, invoiceId: id, data }, 'upd_inv_' + id);
      }
      await this.offlineStorage.setCache('inv_detail_' + id, merged);
      await this.offlineStorage.setCache('invoices_list', [merged, ...list.filter(i => String(i.id) !== String(id))]);
      const overrides = this.getInvoiceOverridesMap();
      delete overrides[String(id)];
      localStorage.setItem(this.INV_DATA_OVERRIDES_KEY, JSON.stringify(overrides));
      this.clearCustomerCache();
      return { invoiceId: id, totalAmount: merged.totalAmount, paidAmount: merged.paidAmount, balance: merged.balance, status: merged.status, termType: merged.termType, isOffline: offline, message: offline ? 'Invoice updated on this device' : 'Invoice updated' };
    };
    if (!this.isOnline() || !Number.isSafeInteger(Number(id))) return from(apply(true));
    return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data, this.operationOptions(operationId)).pipe(
      timeout(10000), switchMap(server => from(apply(false, server))),
      catchError(error => this.isConnectionError(error) ? from(apply(true)) : throwError(() => error)));
  }

  updateInvoiceDirect(id: any, data: any, operationId?: string): Observable<any> {
    return this.http.patch(this.baseUrl + '/Invoice/UpdateInvoice/invoices/' + id, data, this.operationOptions(operationId)).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  postDirect(url: string, data: any, operationId?: string): Observable<any> {
    return this.http.post(url, data, this.operationOptions(operationId)).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  putDirect(url: string, data: any, operationId?: string): Observable<any> {
    return this.http.put(url, data, this.operationOptions(operationId)).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  patchDirect(url: string, data: any, operationId?: string): Observable<any> {
    return this.http.patch(url, data, this.operationOptions(operationId)).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  deleteDirect(url: string, operationId?: string): Observable<any> {
    return this.http.delete(url, { responseType: 'text', ...this.operationOptions(operationId) }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }

  deleteInvoice(id: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const isOfflineId = !Number.isSafeInteger(Number(id)) || Number(id) <= 0;

    const executeOfflineDeleteInvoice = async () => {
      const queue = await this.offlineStorage.getPendingQueue();
      const dependencies = queue.filter(q => !['CREATE_INVOICE', 'UPDATE_INVOICE', 'DELETE_INVOICE'].includes(q.type) &&
        (String(q.payload?.invoiceId) === String(id) ||
          q.payload?.data?.payments?.some((p: any) => String(p.invoiceId) === String(id))));
      const payments = await this.offlineStorage.getCache<any[]>('payments_list') || [];
      const credits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const create = queue.find(q => q.type === 'CREATE_INVOICE' && q.id === String(id));
      const changeId = create?.payload?.offlineChangeCreditNoteId;
      const usedChange = changeId && (queue.some(q => q.type === 'USE_CN' && String(q.payload?.cnId) === String(changeId)) ||
        queue.some(q => q.id !== String(id) && (q.payload?.offlineCreditReservations || []).some((r: any) => String(r.cnId) === String(changeId))));
      if (usedChange) throw new Error('Cancel dependent credit applications before deleting this invoice');
      if (dependencies.length || payments.some(p => String(p.invoiceId) === String(id)) ||
          credits.some(c => String(c.invoiceId) === String(id) && String(c.id) !== String(changeId))) {
        throw new Error('Delete related payments and credit notes before deleting this invoice');
      }
      const localOrder = isOfflineId ? await this.localDb.getOrderByClientId(String(id)) : undefined;
      if (isOfflineId && !localOrder?.serverId && !create?.attemptedAt && (create || localOrder)) {
        const reservations = create?.payload?.offlineCreditReservations || (create?.payload?.offlineCreditReservation ? [create.payload.offlineCreditReservation] : []);
        for (const reserved of reservations) {
          for (const key of ['credit_notes_list', 'available_credits_' + reserved.customerId]) {
            const credits = await this.offlineStorage.getCache<any[]>(key) || [];
            const credit = credits.find(c => String(c.id ?? c.Id) === String(reserved.cnId));
            if (credit) { credit.amount = Number(credit.amount || 0) + Number(reserved.amount); credit.isUsed = false; }
            await this.offlineStorage.setCache(key, credits);
          }
        }
        if (changeId) {
          const remainingCredits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
          await this.offlineStorage.setCache('credit_notes_list', remainingCredits.filter(c => String(c.id) !== String(changeId)));
        }
        await this.offlineStorage.removeQueueItem(String(id));
        await this.offlineStorage.removeQueueItem('upd_inv_' + id);
        await this.localDb.deleteOrderByClientId(String(id));
      } else {
        await this.offlineStorage.removeQueueItem('upd_inv_' + id);
        await this.offlineStorage.enqueue('DELETE_INVOICE', { _offlineOperationId: operationId, invoiceId: localOrder?.serverId || id }, 'del_inv_' + id);
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

    return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
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
      catchError((err: any) => this.isConnectionError(err) ? from(executeOfflineDeleteInvoice()) : throwError(() => err))
    );
  }
  deleteInvoiceDirect(id: any, operationId?: string): Observable<any> {
    return this.http.delete(this.baseUrl + '/Invoice/DeleteInvoice/invoices/' + id, { responseType: 'text', ...this.operationOptions(operationId) }).pipe(
      tap(() => this.clearCustomerCache())
    );
  }
  previewInvoice(id: any): Observable<any> {
    if (!this.isOnline() || !Number.isSafeInteger(Number(id))) return this.getInvoiceDetails(id);
    return this.http.get(this.baseUrl + '/Invoice/PreviewInvoice/invoices/' + id + '/preview').pipe(
      timeout(3500), map((res: any) => { if (res) res.docNo = formatDocNo(res); return res; }),
      catchError(() => this.getInvoiceDetails(id)));
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
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineBulkPayment = async () => {
      // Prevent rapid duplicate offline submissions
      const pendingQueue = await this.offlineStorage.getPendingQueue();
      const isDuplicate = pendingQueue.some(q =>
        q.type === 'CREATE_BULK_PAYMENT' &&
        String(q.payload?.data?.customerId) === String(data.customerId) &&
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
      const groupId = 'pay_bulk_' + this.offlineStorage.generateId();
      const createdPayments: any[] = [];
      let changeCreditNoteId: string | undefined;

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
          const detail = await this.offlineStorage.getCache<any>('inv_detail_' + targetInv.id);
          if (detail) await this.offlineStorage.setCache('inv_detail_' + targetInv.id, { ...detail, ...targetInv });
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
        const offlineCnId = 'cn_' + this.offlineStorage.generateId();
        changeCreditNoteId = offlineCnId;
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
      await this.offlineStorage.enqueue('CREATE_BULK_PAYMENT', { _offlineOperationId: operationId,
        data,
        groupId,
        changeCreditNoteId,
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

    if (!this.isOnline() || this.hasTemporaryReferences(data)) {
      return from(saveOfflineBulkPayment());
    }

    return this.http.post(this.baseUrl + '/Payment/CreateBulkPayment/bulk-payments', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearCustomerCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineBulkPayment()) : throwError(() => err))
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
    return from(this.offlineStorage.getPendingQueue()).pipe(switchMap(queue =>
      this.getPaymentsInternal(queue.some(q => ["CREATE_BULK_PAYMENT","DELETE_PAYMENT"].includes(q.type)))));
  }

  private getPaymentsInternal(preferLocal: boolean): Observable<any> {
    const mapOfflinePayments = (queue: any[]) => {
      const list: any[] = [];
      const bulkTasks = queue.filter(q => q.type === 'CREATE_BULK_PAYMENT');
      for (const task of bulkTasks) {
        if (task.payload?.createdPayments) {
          for (const cp of task.payload.createdPayments) {
            list.push({
              id: cp.paymentId,
              invoiceId: cp.invoiceId,
              customerId: task.payload?.data?.customerId,
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

    if (preferLocal || !this.isOnline()) {
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
    const operationId = this.offlineStorage.generateId();
    const isOfflinePayment = String(id).startsWith('pay_');

    const executeOfflineDelete = async (queueDelete = true) => {
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
              if (!matchedCp) continue;
              if (q.attemptedAt) {
                await this.offlineStorage.enqueue('DELETE_PAYMENT', { paymentId: id }, 'del_pay_' + id);
                continue;
              }
              const tasks = await this.offlineStorage.getPendingQueue();
              if (q.payload.changeCreditNoteId && tasks.some(t => t.type === 'USE_CN' && String(t.payload.cnId) === String(q.payload.changeCreditNoteId))) throw new Error('Sync used change credit before deleting its payment');
              if (q.payload.changeCreditNoteId) {
                const credits = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
                await this.offlineStorage.setCache('credit_notes_list', credits.filter(c => String(c.id) !== String(q.payload.changeCreditNoteId)));
                q.payload.changeCreditNoteId = undefined;
              }
              q.payload.createdPayments = q.payload.createdPayments.filter((cp: any) => String(cp.paymentId) !== String(id));
              
              if (Array.isArray(q.payload?.data?.payments) && matchedCp) {
                q.payload.data.payments = q.payload.data.payments.filter((p: any) => String(p.invoiceId) !== String(matchedCp.invoiceId));
                q.payload.data.totalInputAmount = q.payload.data.payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
                q.operationId = this.offlineStorage.generateId();
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
      } else if (queueDelete) {
        // Online payment deleted while offline: queue delete task for sync
        await this.offlineStorage.enqueue('DELETE_PAYMENT', { _offlineOperationId: operationId, paymentId: id }, 'del_pay_' + id);
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
          inv.balance = Math.max(0, (Number(inv.totalAmount) || 0) - (Number(inv.creditUsed) || 0) - (Number(inv.cnTotal) || 0) - inv.paidAmount);
          inv.status = getInvoicePaymentStatus(inv);
          const detail = await this.offlineStorage.getCache<any>('inv_detail_' + inv.id);
          if (detail) await this.offlineStorage.setCache('inv_detail_' + inv.id, { ...detail, ...inv });
          await this.offlineStorage.setCache('invoices_list', cachedInvoices);
        }
      }

      await this.offlineStorage.refreshQueueCount();
      this.clearCustomerCache();
      return { success: true, isOffline: queueDelete, message: queueDelete ? 'Payment deleted offline' : 'Payment deleted' };
    };

    if (!this.isOnline() || isOfflinePayment) {
      return from(executeOfflineDelete());
    }

    return this.http.delete(this.baseUrl + '/Payment/DeletePayment/payments/' + id, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
      timeout(4000),
      switchMap(() => from(executeOfflineDelete(false))),
      catchError((err: any) => this.isConnectionError(err) ? from(executeOfflineDelete()) : throwError(() => err))
    );
  }

  private async reconcileProductsWithQueue(serverProducts: any[], fromServer = true): Promise<any[]> {
    const queue = await this.offlineStorage.getPendingQueue();
    const offlineCreates = queue
      .filter(q => q.type === 'CREATE_PRODUCT')
      .map(q => {
        const p = q.payload?.data || q.payload || {};
        return {
          ...p,
          id: q.id,
          name: p.name || '',
          description: p.description || '',
          barcode: p.barcode || '',
          code: p.code || '',
          category: p.category || 'DEFAULT',
          uom: p.uom || 'UNIT',
          price: Number(p.price) || 0,
          rate: p.rate != null ? Number(p.rate) : 1,
          cost: Number(p.cost) || 0,
          lowestPrice: Number(p.lowestPrice) || 0,
          stock: p.stock != null ? Number(p.stock) : 0,
          includeTax: !!p.includeTax,
          salesDefault: !!p.salesDefault,
          returnDefault: !!p.returnDefault,
          isActive: p.isActive !== false,
          isOffline: true,
          createdAt: new Date(q.createdAt).toISOString()
        };
      });

    const deletedIds = new Set(
      queue.filter(q => q.type === 'DELETE_PRODUCT').map(q => String(q.payload?.id || q.id).replace('del_prod_', ''))
    );

    const updateMap = new Map<string, any>();
    queue
      .filter(q => q.type === 'UPDATE_PRODUCT')
      .forEach(q => {
        const pid = String(q.payload?.id || q.id).replace('upd_prod_', '');
        const data = q.payload?.data || q.payload || {};
        updateMap.set(pid, data);
      });

    const activateSet = new Set(
      queue.filter(q => q.type === 'ACTIVATE_PRODUCT').map(q => String(q.payload?.id || q.id).replace('act_prod_', ''))
    );
    const deactivateSet = new Set(
      queue.filter(q => q.type === 'DEACTIVATE_PRODUCT').map(q => String(q.payload?.id || q.id).replace('deact_prod_', ''))
    );
    const addStockMap = new Map<string, number>();
    queue
      .filter(q => q.type === 'ADD_STOCK')
      .forEach(q => {
        const pid = String(q.payload?.id || q.id).replace('stock_prod_', '').split('_')[0];
        const qty = Number(q.payload?.quantity || q.payload?.data?.quantity || 0);
        addStockMap.set(pid, (addStockMap.get(pid) || 0) + qty);
      });

    const baseList = Array.isArray(serverProducts) ? serverProducts : [];
    const combined = [...offlineCreates, ...baseList];
    const seen = new Set<string>();
    const result: any[] = [];

    for (let p of combined) {
      const pidStr = String(p.id ?? p.Id ?? '');
      if (pidStr && deletedIds.has(pidStr)) continue;
      if (pidStr && seen.has(pidStr)) continue;
      if (pidStr) seen.add(pidStr);

      let item = { ...p };
      let hasChanges = false;
      if (updateMap.has(pidStr)) {
        item = { ...item, ...updateMap.get(pidStr) };
        hasChanges = true;
      }
      if (activateSet.has(pidStr)) {
        item.isActive = true;
        hasChanges = true;
      } else if (deactivateSet.has(pidStr)) {
        item.isActive = false;
        hasChanges = true;
      }
      if (fromServer && addStockMap.has(pidStr)) {
        item.stock = (Number(item.stock) || 0) + (addStockMap.get(pidStr) || 0);
        hasChanges = true;
      }
      if (hasChanges && !item.isOffline) {
        item.isModified = true;
      }
      result.push(item);
    }

    return result;
  }

  createProduct(data: any): Observable<any> {
    const operationId = data?._offlineOperationId || this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const saveOfflineProduct = async () => {
      const offlineId = 'prod_off_' + this.offlineStorage.generateId();
      const newProduct = {
        id: offlineId,
        name: data.name || '',
        description: data.description || '',
        barcode: data.barcode || '',
        code: data.code || '',
        category: data.category || 'DEFAULT',
        uom: data.uom || 'UNIT',
        price: Number(data.price) || 0,
        rate: data.rate != null ? Number(data.rate) : 1,
        cost: Number(data.cost) || 0,
        lowestPrice: Number(data.lowestPrice) || 0,
        stock: data.stock != null ? Number(data.stock) : 0,
        includeTax: !!data.includeTax,
        salesDefault: !!data.salesDefault,
        returnDefault: !!data.returnDefault,
        isActive: true,
        isOffline: true,
        createdAt: new Date().toISOString()
      };

      await this.offlineStorage.enqueue('CREATE_PRODUCT', data, offlineId);

      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      const updated = [newProduct, ...cached.filter(p => String(p.id) !== offlineId)];
      await this.offlineStorage.setCache('products', updated);
      this.cachedProducts = updated;

      return {
        message: 'Product created offline (Queued for sync)',
        id: offlineId,
        data: newProduct,
        isOffline: true
      };
    };

    if (!this.isOnline()) {
      return from(saveOfflineProduct());
    }

    return this.http.post(this.baseUrl + '/Product/CreateProducts/createproducts', data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap((res: any) => {
        this.clearProductCache();
        if (res && (res.id || res.productId)) {
          const sid = res.id || res.productId;
          this.offlineStorage.getCache<any[]>('products').then(cached => {
            const list = cached || [];
            const item = { ...data, id: sid };
            this.offlineStorage.setCache('products', [item, ...list.filter(p => p.id !== sid)]);
          });
        }
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineProduct()) : throwError(() => err))
    );
  }

  getProducts(forceRefresh = false): Observable<any> {
    const fetchOfflineProducts = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      const reconciled = await this.reconcileProductsWithQueue(cached, false);
      this.cachedProducts = reconciled;
      return reconciled;
    };

    if (!this.isOnline()) {
      if (this.cachedProducts) return of(this.cachedProducts);
      return from(fetchOfflineProducts());
    }

    if (!forceRefresh && this.cachedProducts) {
      this.http.get(this.baseUrl + '/Product/GetProducts/products').pipe(timeout(3500)).subscribe({
        next: async (res: any) => {
          if (Array.isArray(res)) {
            const reconciled = await this.reconcileProductsWithQueue(res);
            this.cachedProducts = reconciled;
            await this.offlineStorage.setCache('products', reconciled);
          }
        },
        error: () => { }
      });
      return of(this.cachedProducts);
    }

    return this.http.get(this.baseUrl + '/Product/GetProducts/products').pipe(
      timeout(3500),
      switchMap((res: any) => from((async () => {
        if (Array.isArray(res)) {
          const reconciled = await this.reconcileProductsWithQueue(res);
          this.cachedProducts = reconciled;
          await this.offlineStorage.setCache('products', reconciled);
          return reconciled;
        }
        return res;
      })())),
      catchError(() => from(fetchOfflineProducts()))
    );
  }

  getProductById(id: any): Observable<any> {
    const fetchOfflineProduct = async () => {
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      return cached.find(p => String(p.id) === String(id)) || null;
    };
    if (!this.isOnline() || String(id).startsWith('prod_')) {
      return from(fetchOfflineProduct());
    }
    return this.http.get(this.baseUrl + '/Product/GetProductById/getproductsby/' + id).pipe(
      timeout(3500),
      catchError(() => from(fetchOfflineProduct()))
    );
  }

  editProduct(id: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const isOfflineId = String(id).startsWith('prod_');

    const saveOfflineEdit = async () => {
      if (isOfflineId) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item?.attemptedAt) {
          await this.offlineStorage.enqueue('UPDATE_PRODUCT', { id, data }, 'upd_prod_' + id);
        } else if (item && item.payload) {
          const currentData = item.payload.data || item.payload;
          item.payload = {
            ...item.payload,
            ...(item.payload.data ? { data: { ...currentData, ...data } } : data)
          };
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('UPDATE_PRODUCT', { _offlineOperationId: operationId, id, data }, 'upd_prod_' + id);
      }

      const cachedList = await this.offlineStorage.getCache<any[]>('products') || [];
      const updatedList = cachedList.map(p => {
        if (String(p.id) === String(id)) {
          return { ...p, ...data, isModified: !p.isOffline };
        }
        return p;
      });
      await this.offlineStorage.setCache('products', updatedList);
      this.cachedProducts = updatedList;

      return {
        message: 'Product updated offline (Queued for sync)',
        id,
        isOffline: true
      };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(saveOfflineEdit());
    }

    return this.http.put(this.baseUrl + '/Product/EditProduct/editproduct/' + id, data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => {
        this.clearProductCache();
        this.offlineStorage.getCache<any[]>('products').then(cached => {
          if (cached) {
            const updated = cached.map(p => String(p.id) === String(id) ? { ...p, ...data } : p);
            this.offlineStorage.setCache('products', updated);
          }
        });
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineEdit()) : throwError(() => err))
    );
  }

  deleteProduct(id: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const isOfflineId = String(id).startsWith('prod_');

    const saveOfflineDelete = async () => {
      const creating = await this.offlineStorage.getQueueItemById(String(id));
      if (isOfflineId && !creating?.attemptedAt) {
        await this.offlineStorage.removeQueueItem(String(id));
        await this.offlineStorage.removeQueueItem('upd_prod_' + id);
        await this.offlineStorage.removeQueueItem('act_prod_' + id);
        await this.offlineStorage.removeQueueItem('deact_prod_' + id);
        await this.offlineStorage.removeQueueItem('stock_prod_' + id);
      } else {
        await this.offlineStorage.removeQueueItem('upd_prod_' + id);
        await this.offlineStorage.removeQueueItem('act_prod_' + id);
        await this.offlineStorage.removeQueueItem('deact_prod_' + id);
        await this.offlineStorage.removeQueueItem('stock_prod_' + id);
        await this.offlineStorage.enqueue('DELETE_PRODUCT', { _offlineOperationId: operationId, id }, 'del_prod_' + id);
      }

      const cachedList = await this.offlineStorage.getCache<any[]>('products') || [];
      const filteredList = cachedList.filter(p => String(p.id) !== String(id));
      await this.offlineStorage.setCache('products', filteredList);
      this.cachedProducts = filteredList;

      return {
        message: 'Product deleted offline (Queued for sync)',
        id,
        isOffline: true
      };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(saveOfflineDelete());
    }

    return this.http.delete(this.baseUrl + '/Product/DeleteProduct/deleteproduct/' + id, { ...{ responseType: 'text' }, ...this.operationOptions(operationId) }).pipe(
      timeout(4000),
      tap(() => {
        this.clearProductCache();
        this.offlineStorage.getCache<any[]>('products').then(cached => {
          if (cached) {
            const updated = cached.filter(p => String(p.id) !== String(id));
            this.offlineStorage.setCache('products', updated);
          }
        });
      }),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineDelete()) : throwError(() => err))
    );
  }

  activateProduct(id: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const isOfflineId = String(id).startsWith('prod_');
    const saveOfflineActivate = async () => {
      if (isOfflineId) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item && item.payload) {
          const d = item.payload.data || item.payload;
          d.isActive = true;
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.removeQueueItem('deact_prod_' + id);
        await this.offlineStorage.enqueue('ACTIVATE_PRODUCT', { _offlineOperationId: operationId, id }, 'act_prod_' + id);
      }
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      const updated = cached.map(p => String(p.id) === String(id) ? { ...p, isActive: true, isModified: !p.isOffline } : p);
      await this.offlineStorage.setCache('products', updated);
      this.cachedProducts = updated;
      return { success: true, isOffline: true };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(saveOfflineActivate());
    }

    return this.http.patch(this.baseUrl + '/Product/ActivateProduct/activateproduct/' + id, {}, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearProductCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineActivate()) : throwError(() => err))
    );
  }

  deactivateProduct(id: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    const isOfflineId = String(id).startsWith('prod_');
    const saveOfflineDeactivate = async () => {
      if (isOfflineId) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item && item.payload) {
          const d = item.payload.data || item.payload;
          d.isActive = false;
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.removeQueueItem('act_prod_' + id);
        await this.offlineStorage.enqueue('DEACTIVATE_PRODUCT', { _offlineOperationId: operationId, id }, 'deact_prod_' + id);
      }
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      const updated = cached.map(p => String(p.id) === String(id) ? { ...p, isActive: false, isModified: !p.isOffline } : p);
      await this.offlineStorage.setCache('products', updated);
      this.cachedProducts = updated;
      return { success: true, isOffline: true };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(saveOfflineDeactivate());
    }

    return this.http.patch(this.baseUrl + '/Product/DeactivateProduct/deactivateproduct/' + id, {}, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearProductCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineDeactivate()) : throwError(() => err))
    );
  }

  addStock(id: any, data: any): Observable<any> {
    const operationId = this.offlineStorage.generateId();
    if (data) data._offlineOperationId = operationId;
    const isOfflineId = String(id).startsWith('prod_');
    const addedQty = Number(data?.quantity || 0);

    const saveOfflineAddStock = async () => {
      let newStock = addedQty;
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      const updated = cached.map(p => {
        if (String(p.id) === String(id)) {
          newStock = (Number(p.stock) || 0) + addedQty;
          return { ...p, stock: newStock, isModified: !p.isOffline };
        }
        return p;
      });
      await this.offlineStorage.setCache('products', updated);
      this.cachedProducts = updated;

      if (isOfflineId) {
        const item = await this.offlineStorage.getQueueItemById(String(id));
        if (item && item.payload) {
          const d = item.payload.data || item.payload;
          d.stock = newStock;
          await this.offlineStorage.updateQueueItem(item);
        }
      } else {
        await this.offlineStorage.enqueue('ADD_STOCK', { _offlineOperationId: operationId, id, quantity: addedQty }, 'stock_prod_' + id + '_' + Date.now());
      }

      return { success: true, isOffline: true, newStock };
    };

    if (!this.isOnline() || isOfflineId) {
      return from(saveOfflineAddStock());
    }

    return this.http.patch(this.baseUrl + '/Product/AddStock/addstock/' + id, data, this.operationOptions(operationId)).pipe(
      timeout(4000),
      tap(() => this.clearProductCache()),
      catchError((err: any) => this.isConnectionError(err) ? from(saveOfflineAddStock()) : throwError(() => err))
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
