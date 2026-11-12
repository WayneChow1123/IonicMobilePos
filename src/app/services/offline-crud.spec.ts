import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, NEVER, of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { OfflineStorageService } from './offline-storage.service';
import { LocalDbService } from './local-db.service';
import { SyncService } from './sync.service';
import { InvoicesPage } from '../pages/invoices/invoices.page';

// Runs in Karma's isolated Chrome profile using real IndexedDB and Dexie.
// HttpClient is stubbed; these tests never access the production API.
describe('Offline CRUD and reconnect regression coverage', () => {
  let storage: OfflineStorageService;
  let local: LocalDbService;
  let api: ApiService;
  let sync: SyncService;
  let http: jasmine.SpyObj<HttpClient>;

  beforeEach(async () => {
    spyOn<any>(ApiService.prototype, 'initNetworkStatus').and.stub();
    spyOn<any>(SyncService.prototype, 'initTriggers').and.stub();
    localStorage.clear();
    storage = new OfflineStorageService();
    const db: IDBDatabase = await (storage as any).getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sync_queue', 'master_cache'], 'readwrite');
      tx.objectStore('sync_queue').clear();
      tx.objectStore('master_cache').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    local = new LocalDbService();
    await Promise.all([(local as any).db.orders.clear(), (local as any).db.order_items.clear(), (local as any).db.payments.clear()]);
    http = jasmine.createSpyObj('HttpClient', ['get', 'post', 'put', 'patch', 'delete']);
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      http[verb].and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    }
    api = new ApiService(http, storage, local);
    spyOn(api, 'isOnline').and.returnValue(false);
    sync = new SyncService(local, storage, api);
    spyOn<any>(sync, 'checkNetworkConnected').and.resolveTo(true);
    spyOn(api, 'verifyOfflineSyncSupport').and.resolveTo();
  });

  afterEach(() => (local as any).db.close());

  async function createInvoice(price = 10) {
    return firstValueFrom(api.createInvoice({ customerId: 1, invoiceNumber: 'INV-TEST',
      invoiceDate: '2026-11-04T10:00:00', termType: 'On Credit', paidAmount: 0,
      items: [{ productId: 2, productName: 'Test', unitPrice: price, quantity: 1 }] }));
  }

  async function runQueue() { return (sync as any).syncOfflineTasks(true); }

  it('does not let old local invoice overrides restore a deleted payment', () => {
    localStorage.setItem('invoice_data_overrides', JSON.stringify({ 3: { paidAmount: 100, status: 'Paid', balance: 0 } }));
    const invoice: any = { id: 3, totalAmount: 100, paidAmount: 0, status: 'Unpaid', termType: 'On Credit' };
    api.applyInvoiceOverrideToItem(invoice);
    expect(invoice.paidAmount).toBe(0);
    expect(invoice.status).toBe('Unpaid');
    expect(invoice.balance).toBe(100);
  });

  it('updates invoice list and detail immediately after deleting an online payment without queuing another delete', async () => {
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    http.delete.and.returnValue(of('Delete Success'));
    await storage.setCache('payments_list', [{ id: 9, invoiceId: 3, amount: 100 }]);
    await storage.setCache('invoices_list', [{ id: 3, totalAmount: 100, paidAmount: 100, status: 'Paid' }]);
    await storage.setCache('inv_detail_3', { id: 3, totalAmount: 100, paidAmount: 100, status: 'Paid', items: [] });
    await firstValueFrom(api.deletePayment(9));
    expect((await storage.getCache<any[]>('invoices_list'))![0].status).toBe('Unpaid');
    expect((await storage.getCache<any>('inv_detail_3')).status).toBe('Unpaid');
    expect((await storage.getCache<any>('inv_detail_3')).balance).toBe(100);
    expect((await storage.getPendingQueue()).length).toBe(0);
  });

  it('changing invoice terms offline preserves actual paid amount instead of inventing a cash payment', async () => {
    await storage.setCache('invoices_list', [{ id: 3, totalAmount: 100, paidAmount: 40, status: 'Partial' }]);
    const result = await firstValueFrom(api.updateInvoice(3, { termType: 'CASH SALE', items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    expect(result.paidAmount).toBe(40);
    expect(result.status).toBe('Partial');
    expect(result.balance).toBe(60);
  });

  it('does not turn a rejected customer import into a successful offline record', async () => {
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    http.post.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    await expectAsync(firstValueFrom(api.createCustomer({ name: 'Invalid customer' }))).toBeRejected();
    expect((await storage.getPendingQueue()).length).toBe(0);
  });

  it('cancels a new UUID invoice without leaving an upload or local order', async () => {
    const created = await createInvoice();
    expect(created.invoiceId).toMatch(/^[\da-f-]{36}$/i);
    await firstValueFrom(api.deleteInvoice(created.invoiceId));
    expect(await storage.getPendingQueue()).toEqual([]);
    expect(await local.getOrderByClientId(created.invoiceId)).toBeUndefined();
    expect(await firstValueFrom(api.getInvoices())).toEqual([]);
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('updates the queued payload, Dexie order and detail together, surviving restart', async () => {
    const { invoiceId } = await createInvoice();
    await firstValueFrom(api.updateInvoice(invoiceId, { customerId: 1, termType: 'On Credit',
      items: [{ productId: 2, unitPrice: 25, quantity: 2 }] }));
    const queue = await new OfflineStorageService().getPendingQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].payload.items[0].unitPrice).toBe(25);
    const order = await local.getOrderByClientId(invoiceId);
    expect(order?.items[0].unitPrice).toBe(25);
    expect(order?.totalAmount).toBe(50);
    const detail = await firstValueFrom(api.getInvoiceDetails(invoiceId));
    expect(detail.totalAmount).toBe(50);
  });

  it('uploads an edited invoice once through the authoritative queue', async () => {
    const { invoiceId } = await createInvoice();
    await firstValueFrom(api.updateInvoice(invoiceId, { items: [{ productId: 2, unitPrice: 25, quantity: 1 }] }));
    http.post.and.returnValue(of({ invoiceId: 123 }));
    await sync.syncPendingOrders();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post.calls.mostRecent().args[1].items[0].unitPrice).toBe(25);
    expect((await local.getOrderByClientId(invoiceId))?.serverId).toBe(123);
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('maps UUID invoice IDs before uploading payments, and records payment identities', async () => {
    const { invoiceId } = await createInvoice();
    await firstValueFrom(api.createBulkPayment({ customerId: 1, method: 'CASH',
      totalInputAmount: 10, payments: [{ invoiceId, amount: 10 }] }));
    http.post.and.callFake(((url: string) => of(url.includes('/Payment/') ?
      { payments: [{ paymentId: 456, invoiceId: 123, amount: 10 }] } : { invoiceId: 123 })) as any);
    await sync.syncPendingOrders();
    const payment = http.post.calls.allArgs().find(args => String(args[0]).includes('/Payment/'))!;
    expect(payment[1].payments[0].invoiceId).toBe(123);
    expect((await storage.getCache<any[]>('payments_list'))?.[0].id).toBe(456);
    expect(await new OfflineStorageService().resolveServerId('invoice', invoiceId)).toBe(123);
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('retains a payment when the server rejects it instead of silently dropping it', async () => {
    await storage.enqueue('CREATE_BULK_PAYMENT', { data: { customerId: 1, payments: [{ invoiceId: 123, amount: 10 }] } });
    http.post.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: 'Invoice already fully paid' })));
    await runQueue();
    expect((await storage.getPendingQueue()).length).toBe(1);
  });

  it('does not upload an unresolved invoice ID as null or zero', async () => {
    await storage.enqueue('CREATE_BULK_PAYMENT', { data: { customerId: 1, payments: [{ invoiceId: 'unknown-uuid', amount: 10 }] } });
    await runQueue();
    expect(http.post).not.toHaveBeenCalled();
    expect((await storage.getPendingQueue()).length).toBe(1);
  });

  it('keeps the same operation identity across failed retries', async () => {
    await createInvoice();
    await runQueue();
    const first = http.post.calls.mostRecent().args[2] as any;
    await runQueue();
    const second = http.post.calls.mostRecent().args[2] as any;
    expect(first.headers['X-Offline-Operation-Id']).toBeTruthy();
    expect(second.headers['X-Offline-Operation-Id']).toBe(first.headers['X-Offline-Operation-Id']);
  });

  it('supports offline category create/edit/view/delete and persists the edited name', async () => {
    const created = await firstValueFrom(api.createCategory({ categoryName: 'Food', code: 'F' }));
    await firstValueFrom(api.editCategory(created.id, { categoryName: 'Drinks', code: 'D' }));
    expect((await firstValueFrom(api.getCategories()))[0].categoryName).toBe('Drinks');
    expect((await new OfflineStorageService().getPendingQueue())[0].payload.categoryName).toBe('Drinks');
    await firstValueFrom(api.deleteCategory(created.id));
    expect(await firstValueFrom(api.getCategories())).toEqual([]);
    expect(await storage.getPendingQueue()).toEqual([]);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('syncs new categories and maps their server identity', async () => {
    const created = await firstValueFrom(api.createCategory({ categoryName: 'Food', code: 'F' }));
    http.post.and.returnValue(of({ id: 8 }));
    await runQueue();
    expect(await storage.resolveServerId('category', created.id)).toBe(8);
    expect((await storage.getCache<any[]>('categories'))?.[0].id).toBe(8);
  });

  it('preserves temporary product and customer IDs in special prices', async () => {
    await firstValueFrom(api.createCustomerProductPrice('cust_off_1', { productId: 'prod_off_1', specialPrice: 7 }));
    const prices = await firstValueFrom(api.getCustomerProductPrices('cust_off_1'));
    expect(prices[0].customerId).toBe('cust_off_1');
    expect(prices[0].productId).toBe('prod_off_1');
  });

  it('remaps nested customer/product references and price cache keys across restart', async () => {
    await storage.setCache('customer_prices_cust_off_1', [{ customerId: 'cust_off_1', productId: 'prod_off_1', specialPrice: 7 }]);
    await storage.enqueue('CREATE_BULK_PAYMENT', { data: { customerId: 'cust_off_1', payments: [] } });
    await storage.mapServerId('customer', 'cust_off_1', 7);
    await storage.mapServerId('product', 'prod_off_1', 8);
    const restarted = new OfflineStorageService();
    const prices = await restarted.getCache<any[]>('customer_prices_7');
    expect(prices?.[0].productId).toBe(8);
    expect((await restarted.getPendingQueue())[0].payload.data.customerId).toBe(7);
  });

  it('does not add pending stock twice when reloading the offline product cache', async () => {
    await storage.setCache('products', [{ id: 2, name: 'Test', stock: 10 }]);
    await firstValueFrom(api.addStock(2, { quantity: 3 }));
    api.clearProductCache();
    expect((await firstValueFrom(api.getProducts()))[0].stock).toBe(13);
    api.clearProductCache();
    expect((await firstValueFrom(api.getProducts()))[0].stock).toBe(13);
  });

  it('applies refund credit locally and never spends more than the remaining credit', async () => {
    await storage.setCache('invoices_list', [{ id: 123, customerId: 1, invoiceNumber: 'INV-1', totalAmount: 20, paidAmount: 0, balance: 20 }]);
    await storage.setCache('credit_notes_list', [{ id: 9, customerId: 1, invoiceId: 123, cnNumber: 'CN-CHG-1', amount: 10, createdAfterPayment: true }]);
    const result = await firstValueFrom(api.useCreditNote(123, 9));
    expect(result.creditApplied).toBe(10);
    expect(result.cnFullyUsed).toBeTrue();
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(10);
    await expectAsync(firstValueFrom(api.useCreditNote(123, 9))).toBeRejected();
    expect((await storage.getPendingQueue()).filter(q => q.type === 'USE_CN').length).toBe(1);
  });

  it('uses the cached invoice for offline receipt preview', async () => {
    const { invoiceId } = await createInvoice();
    const preview = await firstValueFrom(api.previewInvoice(invoiceId));
    expect(preview.items[0].productId).toBe(2);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('does not pretend a server validation rejection was saved offline', async () => {
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    http.post.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: 'Invalid customer' })));
    await expectAsync(createInvoice()).toBeRejected();
    expect(await storage.getPendingQueue()).toEqual([]);
    expect(await local.getPendingOrders()).toEqual([]);
  });

  it('keeps invoice balances correct through credit-note create, edit and delete', async () => {
    const { invoiceId } = await createInvoice(100);
    const created = await firstValueFrom(api.createCreditNote(invoiceId,
      { items: [{ productId: 2, quantity: 1, unitPrice: 20 }], reason: 'Return' }, { customerId: 1 }));
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(80);
    await firstValueFrom(api.updateCreditNote(created.id, { items: [{ productId: 2, quantity: 1, unitPrice: 30 }] }));
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(70);
    await firstValueFrom(api.deleteCreditNote(invoiceId, created.id));
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(100);
  });

  it('cancels an offline payment and restores the invoice balance', async () => {
    const { invoiceId } = await createInvoice(100);
    const payment = await firstValueFrom(api.createBulkPayment({ customerId: 1, method: 'CASH',
      totalInputAmount: 40, payments: [{ invoiceId, amount: 40 }] },
      { invoices: [{ id: invoiceId, totalAmount: 100, balance: 100 }] }));
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(60);
    await firstValueFrom(api.deletePayment(payment.lastPaymentDetail.id));
    expect((await firstValueFrom(api.getInvoices()))[0].balance).toBe(100);
    expect((await storage.getPendingQueue()).map(q => q.type)).toEqual(['CREATE_INVOICE']);
    await firstValueFrom(api.deleteInvoice(invoiceId));
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('refuses to sync against an API without the new protocol, keeping all local data', async () => {
    await createInvoice();
    (api.verifyOfflineSyncSupport as jasmine.Spy).and.rejectWith(new Error('old API'));
    const result = await sync.syncPendingOrders();
    expect(result.lastError).toContain('updated API');
    expect(http.post).not.toHaveBeenCalled();
    expect((await storage.getPendingQueue()).length).toBe(1);
  });

  it('retains edited invoice data when a background list refresh occurs before sync', async () => {
    await storage.setCache('invoices_list', [{ id: 123, customerId: 1, totalAmount: 10, balance: 10,
      termType: 'On Credit', items: [{ productId: 2, quantity: 1, unitPrice: 10 }] }]);
    await firstValueFrom(api.updateInvoice(123, { items: [{ productId: 2, quantity: 1, unitPrice: 25 }] }));
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    http.get.and.returnValue(of([{ id: 123, totalAmount: 10 }]));
    expect((await firstValueFrom(api.getInvoices()))[0].totalAmount).toBe(25);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('reports a storage failure instead of retaining a memory-only successful cache write', async () => {
    spyOn<any>(storage, 'getDB').and.rejectWith(new Error('IndexedDB unavailable'));
    spyOn(Storage.prototype, 'setItem').and.throwError('Quota exceeded');
    await expectAsync(storage.setCache('test', { id: 1 })).toBeRejected();
    expect((storage as any).memoryCache.has('test')).toBeFalse();
  });

  it('preserves an already-attempted create and queues a later edit separately', async () => {
    const { invoiceId } = await createInvoice();
    await runQueue(); // Simulate a lost server response.
    await firstValueFrom(api.updateInvoice(invoiceId, { items: [{ productId: 2, unitPrice: 25, quantity: 1 }] }));
    const pending = await storage.getPendingQueue();
    expect(pending.find(q => q.type === 'CREATE_INVOICE')?.payload.items[0].unitPrice).toBe(10);
    expect(pending.find(q => q.type === 'UPDATE_INVOICE')?.payload.data.items[0].unitPrice).toBe(25);
    http.post.and.returnValue(of({ invoiceId: 123 }));
    http.patch.and.returnValue(of({}));
    await runQueue();
    expect(http.patch.calls.mostRecent().args[0]).toContain('/123');
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('replays an uncertain create before deleting the corresponding server invoice', async () => {
    const { invoiceId } = await createInvoice();
    await runQueue();
    await firstValueFrom(api.deleteInvoice(invoiceId));
    expect((await storage.getPendingQueue()).map(q => q.type)).toEqual(['CREATE_INVOICE', 'DELETE_INVOICE']);
    http.post.and.returnValue(of({ invoiceId: 123 }));
    http.delete.and.returnValue(of('Deleted'));
    await runQueue();
    expect(http.delete.calls.mostRecent().args[0]).toContain('/123');
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('reserves credit for a new offline invoice and restores it if creation is cancelled', async () => {
    await storage.setCache('credit_notes_list', [{ id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-1', amount: 10, createdAfterPayment: true }]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit',
      useCreditBalance: true, selectedCreditNoteId: 9, paidAmount: 0,
      items: [{ productId: 2, quantity: 1, unitPrice: 10 }] }));
    expect(created.creditUsed).toBe(10);
    expect(created.remainingBalance).toBe(0);
    expect(await firstValueFrom(api.getAvailableCredits(1))).toEqual([]);
    expect((await storage.getPendingQueue()).map(q => q.type)).toEqual(['CREATE_INVOICE']);
    await firstValueFrom(api.deleteInvoice(created.invoiceId));
    expect((await firstValueFrom(api.getAvailableCredits(1)))[0].amount).toBe(10);
  });

  it('maps a new customer and product through special prices, invoices and payments', async () => {
    const customer = await firstValueFrom(api.createCustomer({ name: 'Offline Customer' }));
    const product = await firstValueFrom(api.createProduct({ name: 'Offline Product', price: 10 }));
    await firstValueFrom(api.createCustomerProductPrice(customer.id, { productId: product.id, specialPrice: 8 }));
    const invoice = await firstValueFrom(api.createInvoice({ customerId: customer.id, termType: 'On Credit',
      items: [{ productId: product.id, quantity: 1, unitPrice: 8 }] }));
    await firstValueFrom(api.createBulkPayment({ customerId: customer.id, method: 'CASH', totalInputAmount: 8,
      payments: [{ invoiceId: invoice.invoiceId, amount: 8 }] }));
    http.post.and.callFake(((url: string) => {
      if (url.includes('CreateCustomers')) return of({ id: 7 });
      if (url.includes('CreateProducts')) return of({ id: 8 });
      if (url.includes('/Payment/')) return of({ payments: [{ paymentId: 456, invoiceId: 123 }] });
      if (url.includes('/Invoice/')) return of({ invoiceId: 123 });
      return of({});
    }) as any);
    await sync.syncPendingOrders();
    expect(await storage.getPendingQueue()).toEqual([]);
    const invoiceCall = http.post.calls.allArgs().find(args => String(args[0]).includes('/Invoice/'))!;
    expect(invoiceCall[1].customerId).toBe(7);
    expect(invoiceCall[1].items[0].productId).toBe(8);
    const priceCall = http.post.calls.allArgs().find(args => String(args[0]).includes('CreateCustomerProductPrice'))!;
    expect(priceCall[0]).toContain('/customers/7/');
    expect(priceCall[1].productId).toBe(8);
  });

  it('queues dependent invoices when connectivity returns before their customer or product has synced', async () => {
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    const result = await firstValueFrom(api.createInvoice({ customerId: 'cust_off_1', termType: 'On Credit',
      items: [{ productId: 'prod_off_1', unitPrice: 10, quantity: 1 }] }));
    expect(result.isOffline).toBeTrue();
    expect(http.post).not.toHaveBeenCalled();
    expect((await storage.getPendingQueue())[0].payload.customerId).toBe('cust_off_1');
  });

  it('honors the last downloaded available-credit cap when the credit-note face value is higher', async () => {
    await storage.setCache('credit_notes_list', [{ id: 9, customerId: 1, cnNumber: 'CN-CHG-1', amount: 20, createdAfterPayment: true }]);
    await storage.setCache('available_credits_1', [{ id: 9, amount: 10 }]);
    expect((await firstValueFrom(api.getAvailableCredits(1)))[0].amount).toBe(10);
  });

  it('maps available-credit identities together with credit-note identities', async () => {
    await storage.setCache('available_credits_1', [{ id: 'cn_local', amount: 10 }]);
    await storage.mapServerId('cn', 'cn_local', 9);
    expect((await storage.getCache<any[]>('available_credits_1'))?.[0].id).toBe(9);
  });

  it('does not expose server credits excluded by a downloaded empty availability snapshot', async () => {
    await storage.setCache('credit_notes_list', [{ id: 9, customerId: 1, cnNumber: 'CN-CHG-1', amount: 20, createdAfterPayment: true }]);
    await storage.setCache('available_credits_1', []);
    expect(await firstValueFrom(api.getAvailableCredits(1))).toEqual([]);
  });

  it('matches the existing API rule that On Credit invoices use the selected refund credit and then other credits', async () => {
    await storage.setCache('credit_notes_list', [
      { id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-A', amount: 20, createdAfterPayment: true },
      { id: 10, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-B', amount: 20, createdAfterPayment: true }
    ]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit',
      useCreditBalance: true, selectedCreditNoteId: 9, paidAmount: 0,
      items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    // InvoiceController currently consumes both CNs for On Credit (40 in total).
    expect(created.creditUsed).toBe(40);
    expect(created.remainingBalance).toBe(60);
    expect(await firstValueFrom(api.getAvailableCredits(1))).toEqual([]);
    const restarted = new OfflineStorageService();
    expect((await restarted.getCache<any>('inv_detail_' + created.invoiceId)).creditUsed).toBe(40);
    await firstValueFrom(api.deleteInvoice(created.invoiceId));
    expect((await firstValueFrom(api.getAvailableCredits(1))).reduce((sum: number, c: any) => sum + c.amount, 0)).toBe(40);
  });

  it('uses the selected CN first, then the oldest others, and preserves a partially used CN', async () => {
    await storage.setCache('credit_notes_list', [
      { id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-OLD', amount: 20, createdAfterPayment: true, createdAt: '2026-11-01' },
      { id: 10, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-SELECTED', amount: 20, createdAfterPayment: true, createdAt: '2026-11-03' },
      { id: 11, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-OTHER', amount: 20, createdAfterPayment: true, createdAt: '2026-11-02' }
    ]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 10, items: [{ productId: 2, quantity: 1, unitPrice: 30 }] }));
    const credits = await storage.getCache<any[]>('credit_notes_list');
    expect(created.creditUsed).toBe(30);
    expect(credits?.find(c => c.id === 10).amount).toBe(0);
    expect(credits?.find(c => c.id === 9).amount).toBe(10);
    expect(credits?.find(c => c.id === 11).amount).toBe(20);
    await firstValueFrom(api.deleteInvoice(created.invoiceId));
    expect((await firstValueFrom(api.getAvailableCredits(1))).reduce((sum: number, c: any) => sum + c.amount, 0)).toBe(60);
  });

  it('keeps non-On-Credit invoices limited to the selected CN', async () => {
    await storage.setCache('credit_notes_list', [
      { id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-A', amount: 20, createdAfterPayment: true },
      { id: 10, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-B', amount: 20, createdAfterPayment: true }
    ]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'CASH SALE', useCreditBalance: true,
      selectedCreditNoteId: 9, items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    expect(created.creditUsed).toBe(20);
    expect((await firstValueFrom(api.getAvailableCredits(1)))[0].id).toBe(10);
  });

  it('applies credit before cash, keeps the original cash input for sync and maps the resulting change CN', async () => {
    await storage.setCache('credit_notes_list', [
      { id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-A', amount: 20, createdAfterPayment: true },
      { id: 10, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-B', amount: 20, createdAfterPayment: true }
    ]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 9, paidAmount: 80, items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    const detail = await firstValueFrom(api.getInvoiceDetails(created.invoiceId));
    expect(detail.creditUsed).toBe(40);
    expect(detail.paidAmount).toBe(60);
    expect(detail.balance).toBe(0);
    expect((await firstValueFrom(api.getAvailableCredits(1)))[0].amount).toBe(20);
    const queued = (await storage.getPendingQueue())[0];
    expect(queued.payload.paidAmount).toBe(80);
    http.post.and.returnValue(of({ invoiceId: 123, changeCreditNoteId: 456 }));
    await runQueue();
    expect((await storage.getCache<any[]>('credit_notes_list'))?.find(c => c.id === 456)?.amount).toBe(20);
    expect(await storage.getPendingQueue()).toEqual([]);
  });

  it('preserves credited creation when an offline invoice is subsequently edited', async () => {
    await storage.setCache('credit_notes_list', [{ id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-A', amount: 20, createdAfterPayment: true }]);
    const created = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 9, items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    await firstValueFrom(api.updateInvoice(created.invoiceId, { items: [{ productId: 2, quantity: 1, unitPrice: 120 }] }));
    const queue = await storage.getPendingQueue();
    expect(queue.map(q => q.type)).toEqual(['CREATE_INVOICE', 'UPDATE_INVOICE']);
    expect(queue[0].payload.items[0].unitPrice).toBe(100);
    expect((await firstValueFrom(api.getInvoiceDetails(created.invoiceId))).balance).toBe(100);
  });

  it('applies only the explicitly selected CNs even for On Credit', async () => {
    await storage.setCache('credit_notes_list', [
      { id: 9, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-A', amount: 20, createdAfterPayment: true },
      { id: 10, invoiceId: 99, customerId: 1, cnNumber: 'CN-CHG-B', amount: 20, createdAfterPayment: true }
    ]);
    const one = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 9, selectedCreditNoteIds: [9], items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    expect(one.creditUsed).toBe(20);
    expect(one.remainingBalance).toBe(80);
    await firstValueFrom(api.deleteInvoice(one.invoiceId));
    const two = await firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 9, selectedCreditNoteIds: [9, 10], items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }));
    expect(two.creditUsed).toBe(40);
    expect(two.remainingBalance).toBe(60);
  });

  it('lets the UI select and deselect CNs independently without changing the payment term', () => {
    const page: InvoicesPage = Object.create(InvoicesPage.prototype);
    Object.assign(page, { selectedCreditNoteIds: [], selectedCreditNoteId: null, form: {}, termType: 'On Credit',
      availableCredits: [{ id: 9, amount: 20 }, { id: 'cn_local', amount: 20 }] });
    spyOn(page, 'getFormTotal').and.returnValue(100);
    page.toggleCreditSelection(page.availableCredits[0]);
    expect(page.getSelectedCreditAmount()).toBe(20);
    page.toggleCreditSelection(page.availableCredits[1]);
    expect(page.getSelectedCreditAmount()).toBe(40);
    page.toggleCreditSelection(page.availableCredits[0]);
    expect(page.selectedCreditNoteIds).toEqual(['cn_local']);
    expect(page.getSelectedCreditAmount()).toBe(20);
    expect(page.termType).toBe('On Credit');
  });

  it('sends the UI CN selection as an explicit list in the invoice request', () => {
    const page: InvoicesPage = Object.create(InvoicesPage.prototype);
    const create = jasmine.createSpy('createInvoice').and.returnValue(NEVER);
    Object.assign(page, { selectedCreditNoteIds: [9, 10], selectedCreditNoteId: 9, isSubmitting: false,
      isEditing: false, form: { customerId: 1, items: [{ productId: 2, quantity: 1, unitPrice: 100 }] },
      termType: 'On Credit', amountPaid: 0, paymentMethod: 'CASH', availableCredits: [{ id: 9, amount: 20 }, { id: 10, amount: 20 }],
      offlineStorage: storage, api: { createInvoice: create }, cdr: { detectChanges() {} } });
    spyOn(page, 'getFormTotal').and.returnValue(100);
    spyOn(page, 'getMYSDate').and.returnValue('2026-11-04T10:00:00');
    spyOn(page, 'isStockInsufficient').and.returnValue(false);
    page.saveInvoice();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.calls.mostRecent().args[0].selectedCreditNoteIds).toEqual([9, 10]);
  });

  it('refuses to send explicit CN selection to an old API that would ignore it', async () => {
    (api.isOnline as jasmine.Spy).and.returnValue(true);
    http.get.and.returnValue(of({ protocolVersion: 1 }));
    await expectAsync(firstValueFrom(api.createInvoice({ customerId: 1, termType: 'On Credit', useCreditBalance: true,
      selectedCreditNoteId: 9, selectedCreditNoteIds: [9], items: [{ productId: 2, quantity: 1, unitPrice: 100 }] }))).toBeRejected();
    expect(http.post).not.toHaveBeenCalled();
    expect(await storage.getPendingQueue()).toEqual([]);
  });
});
