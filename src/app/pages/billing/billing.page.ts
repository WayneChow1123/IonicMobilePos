import { AlertService } from '../../services/alert.service';
import Swal from 'sweetalert2';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Subscription } from 'rxjs';

import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppComponent } from '../../app.component';
import { BluetoothPrintService } from '../../services/bluetooth-print.service';
import { formatDocNo } from '../../utils/invoice-helper';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { SyncService } from '../../services/sync.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-billing',
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
})
export class BillingPage implements OnInit, OnDestroy {
  pendingOfflineCount: number = 0;
  isSyncing: boolean = false;
  private queueCountSub?: Subscription;
  private syncingSub?: Subscription;
  private syncSub?: Subscription;

  ionViewWillEnter() {
    const action = this.route.snapshot.queryParams['action'];
    if (!action) {
      this.currentView = 'home';
    }
    this.loadCustomers();
    this.loadAllInvoices();
    this.loadCreditNotes();
    this.offlineStorage.refreshQueueCount();
    this.cdr.detectChanges();
  }


  payments: any[] = [];
  filteredPayments: any[] = [];
  creditNotes: any[] = [];
  filteredCreditNotes: any[] = [];
  customers: any[] = [];
  invoices: any[] = [];
  isLoading = false;
  selectedPaymentDetail: any = null;
  printerSettings: any = null;
  showPaymentPreview = false;
  private _currentView = 'home';
  get currentView(): string {
    return this._currentView;
  }
  set currentView(value: string) {
    this._currentView = value;
    this.updateBottomNav();
  }

  updateBottomNav() {
    if (this.appComponent) {
      this.appComponent.showBottomNav = (this._currentView === 'home');
    }
  }
  showDeletePaymentAlert = false;
  showDeleteCNAlert = false;
  showStockAlert = false;
  showToast = false;
  toastMessage = '';
  selectedPayment: any = null;
  selectedCN: any = null;
  selectedCNDetail: any = null;
  showCNPreview = false;
  showCNActionsDropdown = false;
  isCNLoading = false;
  selectedInvoiceDetail: any = null;
  selectedCNInvoiceDetail: any = null;
  showCNInvoiceFinancials = true;
  customerProductPrices: any[] = [];

  // Edit CN state
  isEditingCN = false;
  editCNForm: any = { id: 0, customerId: 0, customerName: '', reason: '', items: [] };

  // Create CN Invoice Selector Modal
  showCNInvoiceModal = false;
  cnInvoiceSearchTerm = '';
  filteredCNInvoicesForSelect: any[] = [];

  loadCustomerProductPrices(customerId: number) {
    if (!customerId) {
      this.customerProductPrices = [];
      return;
    }
    this.api.getCustomerProductPrices(customerId).subscribe({
      next: (res) => { this.customerProductPrices = Array.isArray(res) ? res : []; },
      error: () => { this.customerProductPrices = []; }
    });
  }

  getCustomerSpecialPrice(productId: any): number | null {
    if (!this.customerProductPrices || this.customerProductPrices.length === 0) return null;
    const special = this.customerProductPrices.find(p => p.productId == productId);
    return special ? special.specialPrice : null;
  }

  getOriginalUnitPrice(productId: any): number {
    const product = this.allProducts.find(p => p.id == productId);
    return product ? product.price : 0;
  }
  cnFilteredInvoices: any[] = [];
  stockIssues: any[] = [];
  pendingPayload: any = null;
  waitingInvoiceId: number | null = null;
  paymentSearchTerm = '';
  cnSearchTerm = '';
  paymentForm: any = { customerId: 0, invoiceIds: [], amount: 0, method: 'Cash', referenceNo: '' };
  cnForm: any = { customerId: 0, invoiceId: 0, reason: '', items: [] };
  paymentMethods = ['Cash', 'Card', 'Online Transfer', 'Cheque'];
  isFirstATMInput = true;
  
  showInvoiceSelectionModal = false;
  selectedInvoicesList: any[] = [];
  invoiceSearchTerm = '';
  filteredPaymentInvoices: any[] = [];

  deletePaymentButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deletePayment() }
  ];
  deleteCNButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCreditNote() }
  ];

  showHistoryModal = false;
  purchaseHistory: any[] = [];
  filteredHistory: any[] = [];
  historySearchTerm = '';

  showProductModal = false;
  allProducts: any[] = [];
  filteredProductsSelection: any[] = [];
  productSearchTerm = '';

  showCustomerModal = false;
  customerSearchTerm = '';
  filteredCustomers: any[] = [];
  customerModalTarget: 'payment' | 'cn' | 'editCN' = 'payment';
  cnProductSearchTerm = '';

  getProductName(productId: any): string {
    if (!this.allProducts || this.allProducts.length === 0) return 'Product #' + productId;
    const p = this.allProducts.find((x: any) => x.id == productId);
    return p ? p.name : 'Product #' + productId;
  }

  getSelectedCustomerDiscount(): number {
    if (!this.cnForm.customerId) return 0;
    const customer: any = this.customers.find((c: any) => c.id == this.cnForm.customerId);
    if (customer && (customer.enableDiscount === false || customer.EnableDiscount === false)) return 0;
    return customer ? (customer.discountPercent || customer.discount || customer.DiscountPercent || 0) : 0;
  }

  getDiscountedPrice(price: number): number {
    const discount = this.getSelectedCustomerDiscount();
    if (discount <= 0) return price;
    return Math.round(price * (1 - discount / 100) * 100) / 100;
  }

  async loadAllProducts() {
    if (!this.allProducts || this.allProducts.length === 0) {
      const cached = await this.offlineStorage.getCache<any[]>('products') || [];
      if (cached.length > 0) {
        this.allProducts = cached;
      }
    }
    if (this.allProducts && this.allProducts.length > 0) {
      this.filteredProductsSelection = [...this.allProducts];
      this.showProductModal = true;
      this.cdr.detectChanges();
    } else {
      this.isLoading = true;
    }

    this.api.getProducts().subscribe({
      next: (res: any) => {
        if (Array.isArray(res) && res.length > 0) {
          this.allProducts = res;
          this.filteredProductsSelection = [...this.allProducts];
        }
        this.showProductModal = true;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.showProductModal = true;
        this.cdr.detectChanges();
      }
    });
  }

  filterProductsForSelection() {
    const term = this.productSearchTerm.toLowerCase();
    this.filteredProductsSelection = this.allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.productCode || p.code || '').toLowerCase().includes(term) ||
      (p.barcode || '').toLowerCase().includes(term)
    );
  }

  selectProduct(product: any) {
    this.showProductModal = false;

    if (this.isEditingCN) {
      if (!this.editCNForm.items) {
        this.editCNForm.items = [];
      }
      const found = this.editCNForm.items.find((i: any) => i.productId === product.id);
      if (found) {
        found.quantity = (Number(found.quantity) || 0) + 1;
      } else {
        let price = product.price || 0;
        const custPrice = this.getCustomerSpecialPrice(product.id);
        if (custPrice != null) {
          price = custPrice;
        }
        price = this.getDiscountedPrice(price);

        this.editCNForm.items.push({
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: price,
          returnToStock: true
        });
      }
      this.editCNForm.items = [...this.editCNForm.items];
      this.showToastMsg(`Added ${product.name}`);
      this.cdr.detectChanges();
      return;
    }

    // Check if item already exists in the list
    const found = this.cnForm.items.find((i: any) => i.productId === product.id);
    if (found) {
      found.returnQuantity += 1;
    } else {
      let price = product.price || 0;
      const custPrice = this.getCustomerSpecialPrice(product.id);
      if (custPrice != null) {
        price = custPrice;
      }
      price = this.getDiscountedPrice(price);

      this.cnForm.items.push({
        productId: product.id,
        productName: product.name,
        unitPrice: price,
        maxQuantity: 9999, // Allow return if selected from all products
        returnedQuantity: 0,
        returnQuantity: 1,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.showCNInvoiceFinancials = true;
    this.cnForm.items = [...this.cnForm.items];
    this.cnProductSearchTerm = '';
    this.showToastMsg(`Added ${product.name}`);
    this.cdr.detectChanges();
  }

  async loadPurchaseHistory() {
    if (!this.cnForm.customerId || this.cnForm.customerId == 0) {
      this.showToastMsg('Please select a customer first');
      return;
    }

    // 优先从本地已缓存发票快速构建购买历史（支持离线跨单退货）
    const localHistory: any[] = [];
    const custInvs = (this.invoices || []).filter((inv: any) => Number(inv.customerId) === Number(this.cnForm.customerId));
    for (const inv of custInvs) {
      const items = inv.items || inv.Items || [];
      for (const it of items) {
        localHistory.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber || inv.docNo || ('INV-' + inv.id),
          customerId: inv.customerId,
          productId: it.productId ?? it.ProductId,
          productName: it.productName || it.ProductName || this.getProductName(it.productId ?? it.ProductId),
          unitPrice: Number(it.unitPrice || it.UnitPrice || it.price || 0),
          quantity: Number(it.quantity || it.Quantity || 1),
          returnedQuantity: Number(it.returnedQuantity || 0)
        });
      }
    }

    if (localHistory.length > 0) {
      this.purchaseHistory = localHistory;
      this.filteredHistory = [...this.purchaseHistory];
      this.showHistoryModal = true;
      this.cdr.detectChanges();
    } else {
      this.isLoading = true;
    }

    this.api.getCustomerPurchaseHistory(this.cnForm.customerId).subscribe({
      next: (res: any) => {
        if (Array.isArray(res) && res.length > 0) {
          this.purchaseHistory = res;
          this.filteredHistory = [...this.purchaseHistory];
        }
        this.showHistoryModal = true;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.showHistoryModal = true;
        this.cdr.detectChanges();
      }
    });
  }

  filterHistory() {
    const term = this.historySearchTerm.toLowerCase();
    this.filteredHistory = this.purchaseHistory.filter(h =>
      (h.productName || '').toLowerCase().includes(term) ||
      (h.invoiceNumber || '').toLowerCase().includes(term)
    );
  }

  selectHistoryItem(item: any) {
    this.cnForm.customerId = Number(item.customerId) || this.cnForm.customerId; 
    this.showHistoryModal = false;

    // Check if item already exists in the list
    const found = this.cnForm.items.find((i: any) => i.productId === item.productId);
    if (found) {
      found.returnQuantity += 1;
      if (found.returnQuantity > found.maxQuantity) found.returnQuantity = found.maxQuantity;
    } else {
      this.cnForm.items.push({
        productId: item.productId,
        productName: item.productName,
        maxQuantity: item.remaining, 
        returnedQuantity: item.totalReturned,
        returnQuantity: 0,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.showCNInvoiceFinancials = true;
    this.cnForm.items = [...this.cnForm.items];
    this.cnProductSearchTerm = '';
    this.showToastMsg(`Added ${item.productName} from history`);
    this.cdr.detectChanges();
  }

  constructor(
    private router: Router, 
    private route: ActivatedRoute, 
    private navCtrl: NavController, 
    private api: ApiService, 
    private cdr: ChangeDetectorRef, 
    private alertService: AlertService,
    private appComponent: AppComponent,
    public btPrint: BluetoothPrintService,
    private offlineStorage: OfflineStorageService,
    private syncService: SyncService
  ) {}

  getDocNo(inv: any): string {
    return inv?.docNo || formatDocNo(inv, this.invoices);
  }

  ionViewWillLeave() {
  }

  ngOnDestroy() {
    this.queueCountSub?.unsubscribe();
    this.syncingSub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  async manualSync() {
    if (this.isSyncing) return;
    this.showToastMsg('Syncing offline data...');
    const res = await this.syncService.syncPendingInvoices(true);
    if (res.successCount > 0) {
      this.showToastMsg(`Synced ${res.successCount} item(s) successfully!`);
      this.loadCreditNotes();
      this.loadPayments();
    } else if (res.failCount > 0) {
      this.alertService.confirm(
        'Sync Issue',
        `Failed to sync ${res.failCount} task(s) to server. Clear stuck task from offline queue?`
      ).then(async (clear) => {
        if (clear) {
          const pending = await this.offlineStorage.getPendingQueue();
          for (const t of pending) {
            await this.offlineStorage.removeQueueItem(t.id);
          }
          await this.offlineStorage.refreshQueueCount();
          this.showToastMsg('Offline queue cleared.');
          this.loadCreditNotes();
        }
      });
    } else {
      this.showToastMsg('All data is already synced.');
    }
  }

  ngOnInit() { 
    this.loadCustomers(); 
    this.loadAllInvoices();

    this.queueCountSub = this.offlineStorage.queueCount$.subscribe(count => {
      this.pendingOfflineCount = count;
      this.cdr.detectChanges();
    });

    this.syncingSub = this.syncService.isSyncing$.subscribe(syncing => {
      this.isSyncing = syncing;
      this.cdr.detectChanges();
    });

    this.syncSub = this.syncService.syncCompleted$.subscribe(res => {
      if (res.successCount > 0) {
        if (this.currentView === 'cnList') {
          this.loadCreditNotes();
        } else if (this.currentView === 'paymentList') {
          this.loadPayments();
        }
      }
    });

    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'newCN') {
        const custId = Number(params['customerId']);
        const invId = Number(params['invoiceId']);
        
        // Short delay to ensure data is loaded
        setTimeout(() => {
          this.currentView = 'newCN';
          this.cnForm.customerId = custId;
          this.onCNCustomerChange();
          this.cnForm.invoiceId = invId;
          if (invId) {
            this.promptCNInvoiceProducts(invId);
          } else {
            this.showCNInvoiceFinancials = false;
            this.onCNInvoiceChange(false);
          }
        }, 300);
      } else if (params['action'] === 'viewPayment') {
        const invNum = params['invoiceNumber'];
        this.isLoading = true;
        this.api.getPayments().subscribe({
          next: (res) => {
            this.payments = Array.isArray(res) ? res : [];
            this.filteredPayments = [...this.payments];
            
            const payment = this.payments.find((p: any) => p.invoiceNumber === invNum);
            if (payment) {
              this.viewPaymentDetails(payment);
            } else {
              this.showToastMsg('No payment record found for this invoice');
              this.openPaymentList();
            }
            this.isLoading = false;
          },
          error: () => {
            this.isLoading = false;
            this.showToastMsg('Failed to load payments');
          }
        });
      } else if (params['action'] === 'viewCN') {
        const cnId = Number(params['cnId']);
        const invId = Number(params['invoiceId']) || 0;
        const cnNumber = params['cnNumber'];

        this.isCNLoading = true;
        this.currentView = 'cnDetails';
        this.cdr.detectChanges();

        this.api.getAllCreditNotes().subscribe({
          next: (res) => {
            const rawList = Array.isArray(res) ? res : [];
            this.creditNotes = this.groupCreditNotes(rawList);
            this.filteredCreditNotes = [...this.creditNotes];

            const foundCN = this.creditNotes.find((c: any) =>
              (cnId && (c.id === cnId || (c.rawIds && c.rawIds.includes(cnId)))) ||
              (cnNumber && (c.cnNumber === cnNumber || c.CNNumber === cnNumber))
            );

            if (foundCN) {
              this.viewCNDetails(foundCN);
            } else {
              this.viewCNDetails({
                id: cnId,
                invoiceId: invId,
                cnNumber: cnNumber || ('CN-' + cnId)
              });
            }
          },
          error: () => {
            this.viewCNDetails({
              id: cnId,
              invoiceId: invId,
              cnNumber: cnNumber || ('CN-' + cnId)
            });
          }
        });
      }
    });
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { 
        this.customers = Array.isArray(res) ? res : []; 
        this.filteredCustomers = [...this.customers];
        if (this.currentView === 'newPayment' && (!this.paymentForm.customerId || this.paymentForm.customerId === 0) && this.customers.length > 0) {
          this.paymentForm.customerId = this.customers[0].id;
          this.loadInvoicesByCustomer(this.customers[0].id);
        }
      },
      error: () => {}
    });
  }

  loadAllInvoices() {
    this.api.getInvoices({ _t: new Date().getTime() }).subscribe({
      next: (res) => { 
        this.invoices = Array.isArray(res) ? res : []; 
        this.cnFilteredInvoices = [...this.invoices];
      },
      error: () => {}
    });
  }

  paymentInvoices: any[] = [];

  loadInvoicesByCustomer(customerId: any) {
    const cid = Number(customerId);
    this.api.getInvoices({ customerId: cid, _t: new Date().getTime() }).subscribe({
      next: (res) => { 
        const list = Array.isArray(res) ? res : [];
        console.log('API returned invoices count:', list.length);
        this.paymentInvoices = list.filter((inv: any) => inv.status !== 'Paid');
        this.filteredPaymentInvoices = [...this.paymentInvoices];
        this.invoiceSearchTerm = '';
        console.log('Filtered invoices count:', this.paymentInvoices.length);
        this.cdr.detectChanges(); // Force UI update
      },
      error: (err) => { console.error('API Error:', err); }
    });
  }

  loadPayments() {
    this.isLoading = true;
    this.api.getPayments().subscribe({
      next: (res) => { this.payments = Array.isArray(res) ? res : []; this.filteredPayments = [...this.payments]; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  groupCreditNotes(rawList: any[]): any[] {
    const groupedMap = new Map<string, any>();
    for (const item of (rawList || [])) {
      if (!item) continue;
      const isChange = (item.cnNumber || item.CNNumber || '').startsWith('CN-CHG');
      const invId = Number(item.invoiceId || item.InvoiceId || 0);
      const id = item.id ?? item.Id;
      // 只要在同一个 invoice 的所有 product 造成的 CN 都合并
      const key = (!isChange && invId > 0)
        ? ('INV-' + invId)
        : (item.cnNumber || item.CNNumber || (id ? ('CN-' + id) : ('RAW-' + Math.random())));
      const amount = Number(item.amount ?? item.Amount ?? 0);
      const customerId = item.customerId ?? item.CustomerId ?? 0;
      let customerName = item.customerName || item.CustomerName;
      if (!customerName && customerId && this.customers?.length) {
        const c = this.customers.find((cust: any) => cust.id == customerId);
        if (c) customerName = c.name;
      }
      const rawItems = item.items || item.Items || [];
      const normalizedItems = rawItems.map((it: any) => ({
        ...it,
        productId: it.productId ?? it.ProductId,
        productName: it.productName || it.ProductName || it.Name || it.name || this.getProductName(it.productId ?? it.ProductId),
        quantity: Number(it.quantity ?? it.Quantity ?? 0),
        unitPrice: Number(it.unitPrice ?? it.UnitPrice ?? 0),
        returnToStock: !!(it.returnToStock ?? it.ReturnToStock)
      }));

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          ...item,
          id: id,
          cnNumber: item.cnNumber || item.CNNumber,
          CNNumber: item.CNNumber || item.cnNumber,
          customerId: customerId,
          customerName: customerName,
          amount: amount,
          createdAt: item.createdAt || item.CreatedAt || new Date().toISOString(),
          reason: item.reason ?? item.Reason ?? '',
          invoiceId: item.invoiceId ?? item.InvoiceId ?? 0,
          invoiceNumber: item.invoiceNumber || item.InvoiceNumber || '',
          isUsed: !!(item.isUsed ?? item.IsUsed),
          createdAfterPayment: !!(item.createdAfterPayment ?? item.CreatedAfterPayment),
          isOffline: !!item.isOffline,
          rawIds: item.rawIds || item.RawIds || [id],
          items: normalizedItems,
          Items: normalizedItems
        });
      } else {
        const existing = groupedMap.get(key);
        const rIds = item.rawIds || item.RawIds || [id];
        for (const rid of rIds) {
          if (!existing.rawIds.includes(rid)) existing.rawIds.push(rid);
        }
        existing.amount += amount;
        existing.items.push(...normalizedItems);
        existing.Items.push(...normalizedItems);
        if (item.isOffline) existing.isOffline = true;

        // 保留第一张 CN 单号 (最早创建的那张)
        if (item.createdAt && existing.createdAt && new Date(item.createdAt) < new Date(existing.createdAt)) {
          existing.cnNumber = item.cnNumber || item.CNNumber;
          existing.CNNumber = item.CNNumber || item.cnNumber;
          existing.createdAt = item.createdAt;
          existing.id = id;
        }
      }
    }
    return Array.from(groupedMap.values());
  }

  renderCreditNotesList(rawList: any[]) {
    this.creditNotes = this.groupCreditNotes(rawList);
    this.filterCreditNotes();
    this.cdr.detectChanges();
  }

  async loadCreditNotes() {
    this.isLoading = true;

    // 1. 优先读取本地 IndexedDB 缓存和待同步队列，秒开无延迟展示
    try {
      let cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const queue = await this.offlineStorage.getPendingQueue();
      const offlineCNs = queue
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
      const deletedCNIds = queue
        .filter(q => q.type === 'DELETE_CN')
        .map(q => String(q.payload?.cnId));

      // 如果 credit_notes_list 缓存为空，尝试从 cached invoices_list 中提取已有的 Credit Notes
      if (cached.length === 0) {
        const cachedInvoices = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
        const extractedCNs: any[] = [];
        for (const inv of cachedInvoices) {
          if (Array.isArray(inv.creditNotes)) {
            for (const cn of inv.creditNotes) {
              extractedCNs.push({
                ...cn,
                invoiceId: cn.invoiceId || inv.id,
                invoiceNumber: cn.invoiceNumber || inv.invoiceNumber,
                customerId: cn.customerId || inv.customerId,
                customerName: cn.customerName || inv.customerName
              });
            }
          }
        }
        if (extractedCNs.length > 0) {
          cached = extractedCNs;
          await this.offlineStorage.setCache('credit_notes_list', cached);
        }
      }

      const localList = [...offlineCNs, ...cached].filter(c => !deletedCNIds.includes(String(c.id ?? c.Id)));
      this.renderCreditNotesList(localList);
      this.isLoading = false;
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('Error reading local CNs:', e);
      this.isLoading = false;
      this.cdr.detectChanges();
    }

    // 2. 异步请求服务端同步最新列表（如果成功则静默更新）
    this.api.getAllCreditNotes().subscribe({
      next: (res) => {
        const rawList = Array.isArray(res) ? res : [];
        if (rawList.length > 0 || this.creditNotes.length === 0) {
          this.renderCreditNotesList(rawList);
        }
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  filterPayments() {
    this.filteredPayments = this.payments.filter(p =>
      (p.customerName || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.invoiceNumber || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.docNo || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      this.getDocNo(p.invoiceNumber || p).toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.referenceNo || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase())
    );
  }

  filterCreditNotes() {
    this.filteredCreditNotes = this.creditNotes.filter(cn =>
      (cn.cnNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.invoiceNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.docNo || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      this.getDocNo(cn.invoiceNumber || cn).toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.customerName || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.reason || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase())
    );
  }

  goHome() { this.currentView = 'home'; }

  openNewPayment() {
    this.paymentForm = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceIds: [], amount: 0, method: 'Cash', referenceNo: '' };
    this.selectedInvoicesList = [];
    if (this.customers.length > 0) this.loadInvoicesByCustomer(this.customers[0].id);
    this.currentView = 'newPayment';
  }

  openInvoiceModal() {
    if (!this.paymentForm.customerId || this.paymentForm.customerId === 0) {
      this.showToastMsg('Please select a customer first');
      return;
    }
    this.invoiceSearchTerm = '';
    this.loadInvoicesByCustomer(this.paymentForm.customerId);
    this.currentView = 'selectInvoices';
    this.cdr.detectChanges();
  }

  filterInvoicesForSelection() {
    const term = this.invoiceSearchTerm.trim().toLowerCase();
    if (!term) {
      this.filteredPaymentInvoices = [...this.paymentInvoices];
    } else {
      this.filteredPaymentInvoices = this.paymentInvoices.filter(inv =>
        (inv.invoiceNumber || '').toLowerCase().includes(term) ||
        (inv.docNo || '').toLowerCase().includes(term) ||
        this.getDocNo(inv).toLowerCase().includes(term)
      );
    }
    this.cdr.detectChanges();
  }

  async openNewCN() {
    if (!this.invoices || this.invoices.length === 0) {
      const cached = await this.offlineStorage.getCache<any[]>('invoices_list') || [];
      if (cached.length > 0) {
        this.invoices = cached;
      }
    }
    if (!this.customers || this.customers.length === 0) {
      const cachedCust = await this.offlineStorage.getCache<any[]>('customers') || [];
      if (cachedCust.length > 0) {
        this.customers = cachedCust;
        this.filteredCustomers = [...cachedCust];
      }
    }
    this.loadAllInvoices();
    this.cnForm = { customerId: 0, invoiceId: 0, reason: '', items: [] };
    this.cnFilteredInvoices = [...this.invoices];
    this.selectedCNInvoiceDetail = null;
    this.showCNInvoiceFinancials = true;
    this.cnProductSearchTerm = '';
    this.currentView = 'newCN';
    this.cdr.detectChanges();
  }

  openPaymentList() { this.paymentSearchTerm = ''; this.loadPayments(); this.currentView = 'paymentList'; }
  viewPaymentDetails(payment: any) {
    this.showPaymentPreview = false;
    this.isLoading = true;
    if (!this.allProducts || this.allProducts.length === 0) {
      this.api.getProducts().subscribe({ next: (res: any) => { this.allProducts = res || []; } });
    }
    this.api.getPaymentPreview(payment.id).subscribe({
      next: (res: any) => {
        this.selectedPaymentDetail = res;
        this.currentView = 'paymentDetails';
        this.isLoading = false;
      },
      error: (err: any) => {
        this.isLoading = false;
        this.showToastMsg('Failed to load payment details: ' + (err.error?.message || err.message || 'error'));
      }
    });
  }

  loadPrinterSettings() {
    const saved = localStorage.getItem('printerSettings');
    if (saved) {
      try {
        this.printerSettings = JSON.parse(saved);
        if (this.printerSettings.autoAdapt === undefined) {
          this.printerSettings.autoAdapt = true;
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (!this.printerSettings) {
      this.printerSettings = {
        paperWidth: 58,
        autoAdapt: true,
        bottomEmptyLine: 5,
        contentOptions: [
          { name: 'Print Company Logo', enabled: true },
          { name: 'Print Issue Time', enabled: true },
          { name: 'Print Item Code', enabled: false },
          { name: 'Print Item U.O.M.', enabled: true },
          { name: 'Print Term Date', enabled: false },
          { name: 'Print Customer Tel', enabled: true },
          { name: 'Print Customer Add', enabled: true },
          { name: 'Sign on Cash Invoice', enabled: true },
          { name: 'Sign on Credit Invoice', enabled: true },
          { name: 'Sign on Credit Note', enabled: true },
          { name: 'Sign on Payment', enabled: true },
          { name: 'Footer', enabled: true },
          { name: 'Print Product Barcode', enabled: false }
        ]
      };
    }
  }

  isOptionEnabled(optionName: string): boolean {
    this.loadPrinterSettings();
    if (!this.printerSettings || !this.printerSettings.contentOptions) return true;
    const opt = this.printerSettings.contentOptions.find((o: any) => o.name === optionName);
    return opt ? opt.enabled : true;
  }

  getProductCode(productId: any): string {
    if (!this.allProducts) return '';
    const product = this.allProducts.find(p => p.id == productId);
    return product?.productCode || product?.code || '';
  }

  getProductBarcode(productId: any): string {
    if (!this.allProducts) return '';
    const product = this.allProducts.find(p => p.id == productId);
    return product?.barcode || '';
  }

  printPaymentReceipt() {
    this.loadPrinterSettings();
    if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
      this.btPrint.printPayment(this.selectedPaymentDetail, this.printerSettings, this.customers, this.allProducts);
      return;
    }
    
    let iframe = document.getElementById('print-iframe') as HTMLIFrameElement;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
    }
    const printWindow = iframe.contentWindow || (iframe.contentDocument as any)?.defaultView;
    if (!printWindow) { this.showToastMsg('Failed to initialize print iframe'); return; }

    const isSmall = !this.printerSettings?.paperWidth || 
      this.printerSettings.paperWidth <= 58 || 
      (this.printerSettings?.autoAdapt !== false && (!this.printerSettings?.hardwareWidth || this.printerSettings.hardwareWidth <= 58));
    const width = isSmall ? '360px' : '480px';
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: ${width}; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .due-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; } .due-label { display: block; font-size: 10px; letter-spacing: 3px; color: #888; margin-bottom: 6px; } .due-date { font-size: 18px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; }</style>`;

    const pd = this.selectedPaymentDetail;
    if (!pd) return;

    // Company Header
    let companyHeaderHtml = '';
    if (this.isOptionEnabled('Print Company Logo')) {
      companyHeaderHtml = `
        <div class="company">B JAYA TRADING</div>
        <span class="co-reg">(001188861-T)</span>
        <span class="address">NO. 467, JALAN PALAS 13, TAMAN PELANGI,</span>
        <span class="address">70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA</span>
        <span class="contact">TEL: 012-6988080</span>
      `;
    }

    // Date
    let dateHtml = '';
    const payDate = pd.paymentDate ? new Date(pd.paymentDate) : new Date();
    const dateStr = payDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (this.isOptionEnabled('Print Issue Time')) {
      dateHtml = `<div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div>`;
    }

    // Customer
    let customerBoxHtml = '';
    if (this.isOptionEnabled('Print Customer Tel') || this.isOptionEnabled('Print Customer Add')) {
      customerBoxHtml = `
        <div class="to-section">
          <span class="to-label">CUSTOMER:</span>
          <div class="to-box">
            <strong>${pd.customer?.name}</strong>
            ${this.isOptionEnabled('Print Customer Tel') && pd.customer?.phone ? `<div style="margin-top: 4px; font-weight:bold;">TEL: ${pd.customer?.phone}</div>` : ''}
          </div>
        </div>
      `;
    }

    // Invoice items table
    let itemsHtml = '';
    const items = pd.invoice?.items || [];
    items.forEach((item: any, i: number) => {
      const subtotal = item.total.toFixed(2);
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${item.productName}</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>${subtotal}</span></div></div>`;
    });

    const receiptNumber = pd.receiptNumber || `RCPT-${pd.id}`;
    const invoiceNumber = this.getDocNo(pd.invoice || pd.invoiceNumber);
    
    const paymentDetailHtml = `<div style="padding:12px 20px;border:1px dashed #ddd;border-radius:8px;margin-bottom:16px;background:#fcfcfc;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>PAYMENT METHOD</span><span style="text-transform:uppercase;">${pd.paymentMethod}</span></div>
        ${pd.referenceNo ? `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>REFERENCE NO</span><span>${pd.referenceNo}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;border-top:1px dashed #eee;margin-top:6px;padding-top:6px;"><span>INVOICE TOTAL</span><span>RM ${(pd.invoice?.totalAmount || 0).toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>INVOICE BALANCE</span><span>RM ${(pd.invoice?.balance || 0).toFixed(2)}</span></div>
    </div>`;

    let sigBoxHtml = '';
    if (this.isOptionEnabled('Sign on Payment')) {
      sigBoxHtml = `<div class="sig-box"><span class="sig-label">PAYMENT RECEIVED SIGNATURE</span></div>`;
    }
    
    let footerHtml = '';
    if (this.isOptionEnabled('Footer')) {
      footerHtml = `<div class="thanks">THANK YOU</div>`;
    }

    let emptyLinesHtml = '';
    const linesCount = this.printerSettings?.bottomEmptyLine ?? 5;
    for (let l = 0; l < linesCount; l++) {
      emptyLinesHtml += `<div style="height: 20px;"></div>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Receipt ${receiptNumber}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">OFFICIAL RECEIPT</span><div class="divider"></div>${companyHeaderHtml}<div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">RECEIPT NO</span><span class="doc-value">: ${receiptNumber}</span></div><div class="doc-row"><span class="doc-label">INVOICE NO</span><span class="doc-value">: ${invoiceNumber}</span></div>${dateHtml}</div>${customerBoxHtml}<div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div>${paymentDetailHtml}<div class="net-bar"><span class="net-label">PAYMENT RECEIVED</span><span class="net-value">RM ${pd.paymentAmount.toFixed(2)}</span></div>${sigBoxHtml}${footerHtml}${emptyLinesHtml}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  openCNList() { this.cnSearchTerm = ''; this.loadCreditNotes(); this.currentView = 'cnList'; }

  onCustomerChange() {
    if (this.paymentForm.customerId) {
      this.loadInvoicesByCustomer(this.paymentForm.customerId);
      this.paymentForm.invoiceIds = [];
      this.selectedInvoicesList = [];
    }
  }

  openCustomerModal(target: 'payment' | 'cn' | 'editCN' = 'payment') {
    this.customerModalTarget = target;
    this.customerSearchTerm = '';
    this.filteredCustomers = [...this.customers];
    this.showCustomerModal = true;
    this.cdr.detectChanges();
  }

  closeCustomerModal() {
    this.showCustomerModal = false;
    this.cdr.detectChanges();
  }

  focusCustomerSearch() {
    setTimeout(() => {
      const input = document.getElementById('customer-modal-search-input') as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  }

  onCustomerSearch(event: any) {
    const val = event?.target?.value ?? '';
    this.customerSearchTerm = val;
    this.applyCustomerSearchFilter(val);
  }

  clearCustomerSearch() {
    this.customerSearchTerm = '';
    this.filteredCustomers = [...this.customers];
    this.cdr.detectChanges();
    const input = document.getElementById('customer-modal-search-input') as HTMLInputElement;
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  filterCustomers() {
    this.applyCustomerSearchFilter(this.customerSearchTerm);
  }

  applyCustomerSearchFilter(query: string) {
    const term = (query || '').trim().toLowerCase();
    if (!term) {
      this.filteredCustomers = [...this.customers];
    } else {
      const matches = this.customers.filter((c: any) => {
        if (!c) return false;
        const name = (c.name || c.Name || c.customerName || c.CustomerName || '').toString().trim().toLowerCase();
        const code = (c.customerCode || c.code || c.CustomerCode || '').toString().trim().toLowerCase();
        return name.includes(term) || code.includes(term);
      });

      matches.sort((a: any, b: any) => {
        const nameA = (a.name || a.Name || a.customerName || a.CustomerName || '').toString().trim().toLowerCase();
        const nameB = (b.name || b.Name || b.customerName || b.CustomerName || '').toString().trim().toLowerCase();
        const aStarts = nameA.startsWith(term);
        const bStarts = nameB.startsWith(term);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return nameA.localeCompare(nameB);
      });

      this.filteredCustomers = matches;
    }
    this.cdr.detectChanges();
  }

  selectCustomerFromModal(customer: any) {
    if (this.customerModalTarget === 'cn') {
      this.selectCNCustomer(customer);
    } else if (this.customerModalTarget === 'editCN') {
      this.selectEditCNCustomer(customer);
    } else {
      this.selectPaymentCustomer(customer);
    }
  }

  selectPaymentCustomer(customer: any) {
    if (!customer) return;
    this.paymentForm.customerId = customer.id;
    this.onCustomerChange();
    this.closeCustomerModal();
  }

  selectCNCustomer(customer: any) {
    this.cnForm.customerId = customer ? customer.id : 0;
    this.onCNCustomerChange();
    this.closeCustomerModal();
  }

  selectEditCNCustomer(customer: any) {
    if (!customer) return;
    this.editCNForm.customerId = customer.id;
    this.editCNForm.customerName = customer.name;
    this.closeCustomerModal();
  }

  getCNSelectedCustomerName(): string {
    if (!this.cnForm?.customerId || this.cnForm.customerId == 0) {
      return 'All Customers';
    }
    const cust = this.customers.find((c: any) => c.id == this.cnForm.customerId);
    return cust ? cust.name : 'Customer #' + this.cnForm.customerId;
  }

  isCustomerModalSelected(c: any): boolean {
    if (!c) return false;
    if (this.customerModalTarget === 'cn') {
      return (this.cnForm?.customerId ?? 0) == c.id;
    }
    if (this.customerModalTarget === 'editCN') {
      return (this.editCNForm?.customerId ?? 0) == c.id;
    }
    return (this.paymentForm?.customerId ?? 0) == c.id;
  }

  // ─── Create CN Invoice Selector Modal ───
  openCNInvoiceModal() {
    this.cnInvoiceSearchTerm = '';
    this.filteredCNInvoicesForSelect = [...this.cnFilteredInvoices];
    this.showCNInvoiceModal = true;
    this.cdr.detectChanges();
  }

  closeCNInvoiceModal() {
    this.showCNInvoiceModal = false;
    this.cdr.detectChanges();
  }

  filterCNInvoicesForSelect() {
    const term = (this.cnInvoiceSearchTerm || '').trim().toLowerCase();
    if (!term) {
      this.filteredCNInvoicesForSelect = [...this.cnFilteredInvoices];
    } else {
      this.filteredCNInvoicesForSelect = this.cnFilteredInvoices.filter((inv: any) =>
        (inv.invoiceNumber || '').toLowerCase().includes(term) ||
        (inv.docNo || '').toLowerCase().includes(term) ||
        this.getDocNo(inv).toLowerCase().includes(term) ||
        (inv.customerName || '').toLowerCase().includes(term)
      );
    }
    this.cdr.detectChanges();
  }

  selectCNInvoice(inv: any) {
    this.cnForm.invoiceId = inv ? inv.id : 0;
    this.closeCNInvoiceModal();

    if (!inv || !inv.id) {
      this.showCNInvoiceFinancials = false;
      this.onCNInvoiceChange(false);
      return;
    }

    this.promptCNInvoiceProducts(inv.id);
  }

  promptCNInvoiceProducts(invoiceId: number) {
    Swal.fire({
      title: 'Display Products?',
      text: 'Would you like to display all products from this invoice?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      confirmButtonColor: '#6c5ce7',
      cancelButtonColor: '#747d8c',
      allowOutsideClick: false,
    }).then((result) => {
      if (result.isConfirmed) {
        this.showCNInvoiceFinancials = true;
        this.onCNInvoiceChange(true);
      } else {
        this.showCNInvoiceFinancials = false;
        this.onCNInvoiceChange(false);
      }
    });
  }

  getSelectedCNInvoice(): any {
    if (!this.cnForm?.invoiceId || this.cnForm.invoiceId === 0) return null;
    return this.invoices.find((i: any) => i.id == this.cnForm.invoiceId) || this.selectedCNInvoiceDetail;
  }

  get filteredCNItems(): any[] {
    if (!this.cnForm?.items) return [];
    if (!this.cnProductSearchTerm || !this.cnProductSearchTerm.trim()) {
      return this.cnForm.items;
    }
    const term = this.cnProductSearchTerm.trim().toLowerCase();
    return this.cnForm.items.filter((item: any) => {
      const name = (item.productName || '').toString().toLowerCase();
      const code = (item.productCode || item.code || item.barcode || '').toString().toLowerCase();
      return name.includes(term) || code.includes(term);
    });
  }

  getCNSelectedReturnCount(): number {
    if (!this.cnForm?.items) return 0;
    return this.cnForm.items.filter((i: any) => Number(i.returnQuantity) > 0).length;
  }

  removeCNItem(item: any) {
    if (!this.cnForm?.items) return;
    const idx = this.cnForm.items.indexOf(item);
    if (idx > -1) {
      this.cnForm.items.splice(idx, 1);
      this.cnForm.items = [...this.cnForm.items];
    }
  }

  getSelectedPaymentCustomer(): any {
    if (!this.paymentForm.customerId) return null;
    return this.customers.find((c: any) => c.id == this.paymentForm.customerId) || null;
  }

  getSelectedCustomerName(): string {
    const cust = this.getSelectedPaymentCustomer();
    return cust ? cust.name : 'Select Customer...';
  }

  getCustomerInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getCustomerUnpaidInvoicesCount(customerId: any): number {
    if (!customerId || !this.invoices) return 0;
    return this.invoices.filter((inv: any) => inv.customerId == customerId && inv.status !== 'Paid').length;
  }

  getCustomerTotalUnpaidBalance(customerId: any): number {
    if (!customerId || !this.invoices) return 0;
    return this.invoices
      .filter((inv: any) => inv.customerId == customerId && inv.status !== 'Paid')
      .reduce((sum: number, inv: any) => sum + (Number(inv.balance) || 0), 0);
  }

  onInvoiceChange() {
    // Legacy onInvoiceChange not needed for multiple selection.
  }

  onCNCustomerChange() {
    this.cnForm.invoiceId = 0;
    this.cnForm.items = [];
    this.selectedCNInvoiceDetail = null;
    this.cnProductSearchTerm = '';
    if (this.cnForm.customerId && this.cnForm.customerId != 0) {
      this.cnFilteredInvoices = this.invoices.filter((inv: any) => inv.customerId == this.cnForm.customerId);
      this.loadCustomerProductPrices(Number(this.cnForm.customerId));
    } else {
      this.cnFilteredInvoices = [...this.invoices];
      this.customerProductPrices = [];
    }
  }

  onCNInvoiceChange(loadProducts = true) {
    this.cnProductSearchTerm = '';
    if (this.cnForm.invoiceId && this.cnForm.invoiceId != 0) {
      // 优先从已加载的发票列表提取（离线秒开且能查看明细）
      const localInv = this.invoices.find((i: any) => String(i.id) === String(this.cnForm.invoiceId));
      if (localInv) {
        this.selectedCNInvoiceDetail = localInv;
        const cid = localInv.customerId || (localInv.customer ? localInv.customer.id : 0);
        if (cid) {
          this.cnForm.customerId = Number(cid);
          this.loadCustomerProductPrices(Number(cid));
        }
        const sourceItems = localInv.items || localInv.Items || [];
        if (sourceItems.length > 0) {
          this.cnForm.items = sourceItems.map((item: any) => {
            const remainingQty = (Number(item.quantity) || 1) - (Number(item.returnedQuantity) || 0);
            return {
              productId: item.productId,
              productName: item.productName || this.getProductName(item.productId),
              unitPrice: Number(item.unitPrice || item.price || 0),
              maxQuantity: Math.max(1, remainingQty),
              returnedQuantity: item.returnedQuantity || 0,
              returnQuantity: 0,
              returnToStock: false
            };
          });
        }
        this.cdr.detectChanges();
      }

      this.api.getInvoiceDetails(this.cnForm.invoiceId).subscribe({
        next: (res: any) => {
          if (!res) return;
          this.selectedCNInvoiceDetail = res;
          const cid = res.customerId || (res.customer ? res.customer.id : 0);
          if (cid) {
            this.cnForm.customerId = Number(cid); 
            this.loadCustomerProductPrices(Number(cid));
          }
          if (loadProducts) {
            this.cnForm.items = [];
            const fetchedItems = res.items || res.Items || [];
            if (fetchedItems.length > 0) {
              fetchedItems.forEach((item: any) => {
                const remainingQty = (Number(item.quantity) || 1) - (Number(item.returnedQuantity) || 0);
                if (remainingQty > 0) {
                  this.cnForm.items.push({
                    productId: item.productId,
                    productName: item.productName || this.getProductName(item.productId),
                    unitPrice: Number(item.unitPrice || item.price || 0),
                    maxQuantity: remainingQty,
                    returnedQuantity: item.returnedQuantity || 0,
                    returnQuantity: 0,
                    returnToStock: false
                  });
                }
              });
            }
          }
          this.cdr.detectChanges();
        },
        error: () => {
          if (!this.selectedCNInvoiceDetail && localInv) {
            this.selectedCNInvoiceDetail = localInv;
          }
          this.cdr.detectChanges();
        }
      });
    } else {
      this.selectedCNInvoiceDetail = null;
    }
  }

  toggleInvoiceSelection(inv: any) {
    const idx = this.paymentForm.invoiceIds.indexOf(inv.id);
    if (idx > -1) {
      this.paymentForm.invoiceIds.splice(idx, 1);
      this.selectedInvoicesList = this.selectedInvoicesList.filter((i: any) => i.id !== inv.id);
    } else {
      this.paymentForm.invoiceIds.push(inv.id);
      this.selectedInvoicesList.push(inv);
    }
  }

  isInvoiceSelected(inv: any): boolean {
    return this.paymentForm.invoiceIds.includes(inv.id);
  }

  hasStandardCN(inv: any): boolean {
    const cnTotal = inv.CNTotal ?? inv.cnTotal ?? 0;
    return cnTotal > 0.01;
  }

  getStandardCNDeduction(inv: any): number {
    return inv.CNTotal ?? inv.cnTotal ?? 0;
  }

  getInvoiceCreditUsed(inv: any): number {
    return inv.CreditUsed ?? inv.creditUsed ?? 0;
  }

  confirmInvoiceSelection() {
    this.currentView = 'newPayment';
    this.paymentForm.amount = this.getBulkBalance();
    this.isFirstATMInput = true;
  }

  handleATMInput(event: any) {
    const key = event.key;
    
    // Allow Tab and Enter to pass through without blocking
    if (key === 'Tab' || key === 'Enter') {
      return;
    }
    
    // Prevent default typing/navigation behavior for numbers, Backspace, and other characters
    event.preventDefault();
    
    const balance = this.getBulkBalance();
    let digits = '';
    
    if (this.isFirstATMInput && key >= '0' && key <= '9') {
      this.isFirstATMInput = false;
      digits = key;
    } else {
      if (key >= '0' && key <= '9') {
        this.isFirstATMInput = false;
      }
      
      let currentCents = Math.round((this.paymentForm.amount || 0) * 100);
      let centsStr = currentCents.toString();
      if (centsStr === '0' || centsStr === 'NaN') {
        centsStr = '';
      }
      
      if (key >= '0' && key <= '9') {
        centsStr += key;
      } else if (key === 'Backspace') {
        centsStr = centsStr.slice(0, -1);
      } else {
        return; // Ignore other keys
      }
      digits = centsStr;
    }
    
    const rawVal = digits ? parseInt(digits, 10) : 0;
    let newVal = rawVal / 100;
    
    if (newVal > balance) {
      newVal = balance;
    }
    
    this.paymentForm.amount = newVal;
  }

  getBulkTotalAmount(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.totalAmount ?? inv.TotalAmount ?? 0), 0);
  }

  getBulkPaidAmount(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.paidAmount ?? inv.PaidAmount ?? 0), 0);
  }

  getBulkCreditNotes(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.CNTotal ?? inv.cnTotal ?? 0), 0);
  }

  getBulkCreditUsed(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.CreditUsed ?? inv.creditUsed ?? 0), 0);
  }

  getBulkBalance(): number {
    return this.selectedInvoicesList.reduce((sum, inv) => sum + (inv.Balance ?? inv.balance ?? 0), 0);
  }

  useCreditNote(cn: any) {
    if (cn.isUsed) return;
    this.api.useCreditNote(Number(cn.invoiceId), Number(cn.id)).subscribe({
      next: (res: any) => {
        const applied = (res.creditApplied || 0).toFixed(2);
        const remaining = (res.cnRemainingAmount || 0).toFixed(2);
        const invoice = res.appliedToInvoice || '';
        const fullyUsed = res.cnFullyUsed;

        if (fullyUsed) {
          this.showToastMsg(`RM ${applied} credit applied to ${invoice}. CN fully used.`);
        } else {
          this.showToastMsg(`RM ${applied} applied to ${invoice}. CN remaining: RM ${remaining}`);
        }
        this.loadCreditNotes();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  getPaymentAmountValidationError(): string | null {
    if (!this.paymentForm.invoiceIds || this.paymentForm.invoiceIds.length === 0) {
      return 'Please select at least one invoice';
    }
    const balance = this.getBulkBalance();
    const amount = Number(this.paymentForm.amount);
    
    if (isNaN(amount) || amount <= 0) {
      return 'Amount must be greater than 0';
    }
    
    if (amount > balance) {
      return `Amount cannot exceed the balance due: RM ${balance.toFixed(2)}`;
    }
    
    return null;
  }

  getPaymentChange(): number {
    const balance = this.getBulkBalance();
    const amount = Number(this.paymentForm.amount);
    if (!amount || amount <= balance) return 0;
    return amount - balance;
  }

  savePayment() {
    if (!this.paymentForm.customerId) { this.showToastMsg('Please select a customer'); return; }
    
    const errorMsg = this.getPaymentAmountValidationError();
    if (errorMsg) { this.showToastMsg(errorMsg); return; }
    
    const totalInputAmount = Number(this.paymentForm.amount);

    // Distribute payment — each invoice gets at most its own balance
    let remainingAmount = totalInputAmount;
    const payments = [];
    
    // Sort invoices oldest first based on invoiceDate
    const sortedInvoices = [...this.selectedInvoicesList].sort((a, b) => {
      const dateA = new Date(a.invoiceDate || 0).getTime();
      const dateB = new Date(b.invoiceDate || 0).getTime();
      return dateA - dateB;
    });

    for (const inv of sortedInvoices) {
      if (remainingAmount <= 0) break;
      const invBalance = inv.balance ?? inv.Balance ?? 0;
      const amountToApply = Math.min(remainingAmount, invBalance);
      if (amountToApply > 0) {
        payments.push({
          invoiceId: inv.id,
          amount: amountToApply
        });
        remainingAmount -= amountToApply;
      }
    }

    if (payments.length === 0) {
      this.showToastMsg('Could not distribute payment amount to selected invoices.'); return;
    }

    const payload = {
      customerId: Number(this.paymentForm.customerId),
      method: this.paymentForm.method,
      referenceNo: this.paymentForm.referenceNo || '',
      totalInputAmount: totalInputAmount,   // ← backend uses this to compute CN-CHG excess
      payments: payments
    };

    const excess = this.getPaymentChange();
    const successMsg = excess > 0.01
      ? `Payment recorded! Excess RM ${excess.toFixed(2)} converted to Credit Note.`
      : 'Bulk Payment created successfully!';

    this.api.createBulkPayment(payload).subscribe({
      next: () => { this.showToastMsg(successMsg); this.openPaymentList(); },
      error: (err: any) => {
        const errBody = err.error;
        this.showToastMsg('Failed: ' + (errBody?.message || errBody || err.message || 'error'));
      }
    });
  }

  adjustInvoiceToStock() {
    this.showStockAlert = false;
    this.navCtrl.navigateRoot('pages/invoices');
    this.showToastMsg('Please edit the invoice to match available stock');
  }

  deleteInvoiceFromStock() {
    if (!this.pendingPayload) return;
    this.showStockAlert = false;
    this.api.deleteInvoice(this.pendingPayload.invoiceId).subscribe({
      next: () => { this.showToastMsg('Invoice deleted!'); this.goHome(); },
      error: () => this.showToastMsg('Failed to delete invoice')
    });
  }

  ignoreStockIssue() {
    if (this.pendingPayload) {
      this.waitingInvoiceId = this.pendingPayload.invoiceId;
      const waiting = JSON.parse(localStorage.getItem('waitingInvoices') || '[]');
      if (!waiting.includes(this.pendingPayload.invoiceId)) {
        waiting.push(this.pendingPayload.invoiceId);
        localStorage.setItem('waitingInvoices', JSON.stringify(waiting));
      }
    }
    this.showStockAlert = false;
    this.showToastMsg('Invoice marked as waiting for stock');
  }

  saveCreditNote() {
    if (!this.cnForm.customerId || this.cnForm.customerId == 0) {
      // If no customer selected, try to get from items
      if (this.cnForm.items.length > 0) {
        // Already set in selectHistoryItem
      } else {
        this.showToastMsg('Please select a customer'); return; 
      }
    }
    
    const itemsToReturn = this.cnForm.items.filter((i: any) => i.returnQuantity > 0);
    if (itemsToReturn.length === 0) {
      this.showToastMsg('Please select at least one item to return');
      return;
    }

    for (const item of itemsToReturn) {
      if (Number(item.returnQuantity) > item.maxQuantity) {
        this.showToastMsg(`Cannot return ${item.returnQuantity} units of ${item.productName}. Only ${item.maxQuantity} remaining.`);
        return;
      }
    }

    const payloadItems = itemsToReturn.map((i: any) => ({
      productId: i.productId,
      productName: i.productName || this.getProductName(i.productId),
      unitPrice: Number(i.unitPrice ?? i.price ?? 0),
      quantity: Number(i.returnQuantity),
      returnToStock: !!i.returnToStock
    }));

    const payload = { reason: (this.cnForm.reason?.trim() ?? ''), items: payloadItems };

    // ✅ 智能切换：如果列表里有来自“历史记录”的商品，或者根本没选发票，或是离线开具的发票，就走全局接口
    const hasGlobalItems = itemsToReturn.some((i: any) => i.isGlobal);
    const isOfflineInvoice = this.cnForm.invoiceId && String(this.cnForm.invoiceId).startsWith('inv_');
    const useGlobalMode = !this.cnForm.invoiceId || this.cnForm.invoiceId == 0 || hasGlobalItems || isOfflineInvoice;

    const customer = this.customers.find((c: any) => c.id == this.cnForm.customerId);
    const customerName = customer ? customer.name : (this.cnForm.customerName || '');
    const extraInfo = { customerName, customerId: this.cnForm.customerId };

    console.log('[CN DEBUG] payload', payload, 'invoiceId', this.cnForm.invoiceId, 'useGlobalMode', useGlobalMode);
    if (!useGlobalMode) {
      const invId = this.cnForm.invoiceId;
      this.api.createCreditNote(invId, payload, extraInfo).subscribe({
        next: (res: any) => {
          if (res?.isOffline) {
            this.showToastMsg('Credit Note saved offline! (Queued for sync)');
          } else {
            this.showToastMsg('Credit Note created!');
          }
          this.openCNList();
        },
        error: (err: any) => { console.error('[CN ERROR]', err); const detail = typeof err.error === 'string' ? err.error : JSON.stringify(err.error); this.showToastMsg('Failed: ' + (err.error?.message || detail || err.message || 'error')); }
      });
    } else {
      // 智能全局模式：支持跨单退货
      const payloadGlobal = { 
        reason: (this.cnForm.reason?.trim() ?? ''), 
        items: payloadItems, 
        isManual: true,
        preferredInvoiceId: (this.cnForm.invoiceId && !isOfflineInvoice && this.cnForm.invoiceId != 0 && !isNaN(Number(this.cnForm.invoiceId))) ? Number(this.cnForm.invoiceId) : null
      };
      const cid = this.cnForm.customerId || (this.selectedCNInvoiceDetail?.customerId) || 0;
      if (!cid || cid == 0) { this.showToastMsg('Customer ID is required for global return'); return; }

      this.api.createGlobalCreditNote(Number(cid), payloadGlobal, extraInfo).subscribe({
        next: (res: any) => {
          if (res?.isOffline) {
            this.showToastMsg('Global Credit Note saved offline! (Queued for sync)');
          } else {
            this.showToastMsg('Global Credit Note created successfully!');
          }
          this.openCNList();
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
      });
    }
  }

  confirmDeletePayment(payment: any) { this.selectedPayment = payment; this.alertService.confirm('Delete Payment', 'Are you sure?').then(c => { if(c) this.deletePayment(); }); }
  deletePayment() {
    if (!this.selectedPayment) return;
    this.api.deletePayment(this.selectedPayment.id).subscribe({
      next: () => { this.showToastMsg('Payment deleted!'); this.loadPayments(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  confirmDeleteCN(cn: any) {
    this.selectedCN = cn;
    this.alertService.confirm('Delete Credit Note', 'Are you sure you want to delete ' + (cn.cnNumber || 'CN-' + cn.id) + '?').then(c => { if(c) this.deleteCreditNote(); });
  }

  async deleteCreditNote() {
    const target = this.selectedCNDetail || this.selectedCN;
    if (!target) return;

    const isOfflineCN = target.isOffline || String(target.id).startsWith('cn_');

    if (isOfflineCN) {
      await this.offlineStorage.removeQueueItem(String(target.id));
      await this.offlineStorage.removeQueueItem('upd_cn_' + target.id);
      await this.offlineStorage.removeQueueItem('del_cn_' + target.id);
      await this.offlineStorage.refreshQueueCount();

      this.creditNotes = this.creditNotes.filter(c => String(c.id) !== String(target.id));
      this.filteredCreditNotes = this.filteredCreditNotes.filter(c => String(c.id) !== String(target.id));

      const cached = await this.offlineStorage.getCache<any[]>('credit_notes_list') || [];
      const updatedCache = cached.filter(c => String(c.id) !== String(target.id));
      await this.offlineStorage.setCache('credit_notes_list', updatedCache);

      this.showToastMsg('Offline Credit Note deleted!');
      this.showCNActionsDropdown = false;
      if (this.currentView === 'cnDetails') {
        this.openCNList();
      } else {
        this.loadCreditNotes();
      }
      this.cdr.detectChanges();
      return;
    }

    const invId = target.invoiceId != null && !isNaN(Number(target.invoiceId)) ? Number(target.invoiceId) : 0;
    const cnId = target.id;

    this.api.deleteCreditNote(invId, cnId).subscribe({
      next: async (res: any) => {
        if (res?.isOffline) {
          this.showToastMsg('Credit Note marked for deletion (Queued for sync)!');
        } else {
          this.showToastMsg('Credit Note deleted!');
        }
        this.creditNotes = this.creditNotes.filter(c => String(c.id) !== String(target.id));
        this.filteredCreditNotes = this.filteredCreditNotes.filter(c => String(c.id) !== String(target.id));
        this.showCNActionsDropdown = false;
        if (this.currentView === 'cnDetails') {
          this.openCNList();
        } else {
          this.loadCreditNotes();
        }
        this.cdr.detectChanges();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
    });
  }

  viewCNDetails(cn: any) {
    this.isEditingCN = false;
    this.currentView = 'cnDetails';
    this.showCNActionsDropdown = false;
    if (!this.allProducts || this.allProducts.length === 0) {
      this.api.getProducts().subscribe({ next: (res: any) => { this.allProducts = res || []; } });
    }
    if (!this.customers || this.customers.length === 0) {
      this.loadCustomers();
    }

    const sourceItems = cn.Items || cn.items || [];
    const normalized = sourceItems.map((it: any) => ({
      ...it,
      productName: it.productName || it.ProductName || it.Name || it.name || it.product_name || this.getProductName(it.productId ?? it.ProductId) || '',
      productId: it.productId ?? it.ProductId,
      quantity: it.quantity ?? it.Quantity,
      unitPrice: it.unitPrice ?? it.UnitPrice,
      returnToStock: !!(it.returnToStock ?? it.ReturnToStock)
    }));
    this.selectedCNDetail = { ...cn, Items: normalized, items: normalized };
    this.isCNLoading = false;
    this.cdr.detectChanges();

    const isOfflineCN = cn.isOffline || String(cn.id).startsWith('cn_');
    const invId = cn.invoiceId != null && !isNaN(Number(cn.invoiceId)) ? Number(cn.invoiceId) : 0;
    const cid = cn.id != null && !isNaN(Number(cn.id)) ? Number(cn.id) : 0;

    if (isOfflineCN || !cid || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }

    this.api.getCreditNoteById(invId, cid).subscribe({
      next: (res: any) => {
        if (!res) return;
        const fetchedItems = res.Items || res.items || res.data?.Items || res.data?.items;
        const existingItems = cn.items || cn.Items || [];
        const sItems = (existingItems.length >= (fetchedItems?.length || 0)) ? existingItems : (Array.isArray(fetchedItems) ? fetchedItems : existingItems);
        const norm = sItems.map((it: any) => ({
          ...it,
          productName: it.productName || it.ProductName || it.Name || it.name || it.product_name || this.getProductName(it.productId ?? it.ProductId) || '',
          productId: it.productId ?? it.ProductId,
          quantity: it.quantity ?? it.Quantity,
          unitPrice: it.unitPrice ?? it.UnitPrice,
          returnToStock: !!(it.returnToStock ?? it.ReturnToStock)
        }));
        this.selectedCNDetail = { ...this.selectedCNDetail, ...res, amount: res.amount != null ? res.amount : this.selectedCNDetail.amount, Items: norm, items: norm };
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  handleCNDetailsBack() {
    if (this.isEditingCN) {
      this.cancelEditCN();
    } else {
      this.closeCNDetails();
    }
  }

  closeCNDetails() {
    this.currentView = 'cnList';
    this.showCNActionsDropdown = false;
    this.showCNPreview = false;
    this.isEditingCN = false;
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  startEditCN() {
    if (!this.selectedCNDetail) return;
    const cn = this.selectedCNDetail;
    const items = (cn.Items || cn.items || []).map((it: any) => ({
      productId: it.productId ?? it.ProductId,
      productName: it.productName || it.ProductName || it.name || it.Name || this.getProductName(it.productId ?? it.ProductId),
      quantity: it.quantity ?? it.Quantity ?? 1,
      unitPrice: it.unitPrice ?? it.UnitPrice ?? 0,
      returnToStock: !!(it.returnToStock ?? it.ReturnToStock)
    }));
    this.editCNForm = {
      id: cn.id,
      customerId: cn.customerId || (cn.customer?.id) || 0,
      customerName: cn.customerName || (cn.customer?.name) || (this.customers.find(c => c.id == cn.customerId)?.name) || '',
      reason: cn.reason || '',
      items: items
    };
    this.isEditingCN = true;
    this.showCNActionsDropdown = false;
  }

  cancelEditCN() {
    this.isEditingCN = false;
  }

  removeEditCNItem(index: number) {
    if (!this.editCNForm?.items) return;
    const removed = this.editCNForm.items[index];
    this.editCNForm.items.splice(index, 1);
    this.editCNForm.items = [...this.editCNForm.items];
    if (removed) {
      this.showToastMsg(`Removed ${removed.productName || 'product'}`);
    }
  }

  getEditCNTotal(): number {
    if (!this.editCNForm?.items) return 0;
    return this.editCNForm.items.reduce((sum: number, it: any) => sum + ((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)), 0);
  }

  saveEditCN() {
    if (!this.editCNForm || !this.selectedCNDetail) return;
    if (!this.editCNForm.customerId || this.editCNForm.customerId === 0) {
      this.showToastMsg('Please select a customer');
      return;
    }
    if (!this.editCNForm.items || this.editCNForm.items.length === 0) {
      this.showToastMsg('Credit Note must have at least one product');
      return;
    }
    for (const it of this.editCNForm.items) {
      if (!it.quantity || Number(it.quantity) <= 0) {
        this.showToastMsg('Quantity must be greater than 0');
        return;
      }
      if (it.unitPrice == null || Number(it.unitPrice) < 0) {
        this.showToastMsg('Unit price cannot be negative');
        return;
      }
    }

    const payload = {
      customerId: Number(this.editCNForm.customerId),
      reason: this.editCNForm.reason,
      items: this.editCNForm.items.map((it: any) => ({
        productId: Number(it.productId),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        returnToStock: it.returnToStock
      }))
    };

    this.isCNLoading = true;
    this.api.updateCreditNote(this.selectedCNDetail.id, payload).subscribe({
      next: (res: any) => {
        if (res?.isOffline) {
          this.showToastMsg('Credit Note updated offline! (Queued for sync)');
        } else {
          this.showToastMsg('Credit Note updated successfully!');
        }
        this.isEditingCN = false;
        this.isCNLoading = false;
        const updatedCust = this.customers.find(c => c.id == this.editCNForm.customerId);
        this.selectedCNDetail = {
          ...this.selectedCNDetail,
          customerId: this.editCNForm.customerId,
          customerName: updatedCust ? updatedCust.name : this.editCNForm.customerName,
          amount: this.getEditCNTotal(),
          reason: this.editCNForm.reason,
          Items: [...this.editCNForm.items],
          items: [...this.editCNForm.items]
        };
        this.loadCreditNotes();
      },
      error: (err: any) => {
        this.isCNLoading = false;
        this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'));
      }
    });
  }

  getCNStatusForDetail(): string {
    const cn = this.selectedCNDetail;
    if (!cn) return '';
    if (cn.isUsed) return 'Credit Used';
    if (cn.createdAfterPayment) return 'Credit Active';
    return 'Debt Offset';
  }

  getCNItemName(item: any): string {
    if (item.productName || item.ProductName || item.Name || item.name) return item.productName || item.ProductName || item.Name || item.name;
    if (!this.allProducts || this.allProducts.length === 0) return 'Product #' + (item.productId ?? item.ProductId);
    const pid = item.productId ?? item.ProductId;
    const p = this.allProducts.find((x: any) => x.id == pid);
    return p ? p.name : 'Product #' + pid;
  }

  getCustomer(id: any) {
    if (!this.customers || !Array.isArray(this.customers)) return null;
    const targetId = id || this.selectedCNDetail?.customerId || this.selectedCNDetail?.CustomerId || this.selectedCNDetail?.customer_id || this.selectedCNDetail?.customer?.id;
    if (targetId) {
      const found = this.customers.find((c: any) => c.id == targetId);
      if (found) return found;
    }
    const custName = (this.selectedCNDetail?.customerName || this.selectedCNDetail?.CustomerName || this.selectedCNDetail?.customer?.name || '').trim().toLowerCase();
    if (custName) {
      const found = this.customers.find((c: any) => (c.name || '').trim().toLowerCase() === custName);
      if (found) return found;
    }
    return null;
  }

  getCustomerPhone(customerId: any): string {
    const c = this.getCustomer(customerId);
    return this.selectedCNDetail?.customerPhone || c?.phone || this.selectedCNDetail?.customer?.phone || '';
  }

  getCustomerFullAddress(customerId: any): string {
    const c = this.getCustomer(customerId);
    if (c) {
      const branch = (c.branches && c.branches.length > 0)
        ? (c.branches.find((b: any) => b.isDefaultBranch) || c.branches[0])
        : null;
      if (branch) {
        const parts = [branch.address1, branch.address2, branch.city, branch.postcode, branch.state].filter(p => !!p);
        if (parts.length > 0) return parts.join(', ');
      }
      if (c.address) return c.address;
    }
    return this.selectedCNDetail?.customerAddress || this.selectedCNDetail?.address || this.selectedCNDetail?.customer?.address || '';
  }

  printCNDetails() {
    const cn = this.selectedCNDetail;
    if (!cn) return;
    this.loadPrinterSettings();
    if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
      this.btPrint.printCreditNote(cn, this.printerSettings, this.customers, this.allProducts);
      return;
    }
    this.showCNPreview = true;
  }

  printCNReceipt() {
    const cn = this.selectedCNDetail;
    if (!cn) return;
    this.loadPrinterSettings();
    if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
      this.btPrint.printCreditNote(cn, this.printerSettings, this.customers, this.allProducts);
      return;
    }

    let iframe = document.getElementById('print-iframe') as HTMLIFrameElement;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
    }
    const printWindow = iframe.contentWindow || (iframe.contentDocument as any)?.defaultView;
    if (!printWindow) { this.showToastMsg('Failed to initialize print iframe'); return; }

    const isSmall = !this.printerSettings?.paperWidth || 
      this.printerSettings.paperWidth <= 58 || 
      (this.printerSettings?.autoAdapt !== false && (!this.printerSettings?.hardwareWidth || this.printerSettings.hardwareWidth <= 58));
    const width = isSmall ? '360px' : '480px';
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: ${width}; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; }</style>`;

    let companyHeaderHtml = '';
    if (this.isOptionEnabled('Print Company Logo')) {
      companyHeaderHtml = `
        <div class="company">B JAYA TRADING</div>
        <span class="co-reg">(001188861-T)</span>
        <span class="address">NO. 467, JALAN PALAS 13, TAMAN PELANGI,</span>
        <span class="address">70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA</span>
        <span class="contact">TEL: 012-6988080</span>
      `;
    }

    let dateHtml = '';
    const cnDate = cn.createdAt ? new Date(cn.createdAt) : new Date();
    const dateStr = cnDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (this.isOptionEnabled('Print Issue Time')) {
      dateHtml = `<div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div>`;
    }

    let customerBoxHtml = '';
    if (this.isOptionEnabled('Print Customer Tel') || this.isOptionEnabled('Print Customer Add')) {
      const c = this.getCustomer(cn.customerId);
      const custName = cn.customerName || (c ? c.name : 'Customer');
      const addr = this.getCustomerFullAddress(cn.customerId);
      const phone = this.getCustomerPhone(cn.customerId);
      let addrHtml = '';
      if (this.isOptionEnabled('Print Customer Add') && addr) {
        addrHtml = `<div style="margin-top: 4px; font-size: 11px; line-height: 1.4; color: #333;">${addr}</div>`;
      }
      let telHtml = '';
      if (this.isOptionEnabled('Print Customer Tel') && phone) {
        telHtml = `<div style="margin-top: 4px; font-weight:bold;">TEL: ${phone}</div>`;
      }
      customerBoxHtml = `
        <div class="to-section">
          <span class="to-label">CUSTOMER:</span>
          <div class="to-box">
            <strong>${custName}</strong>
            ${addrHtml}
            ${telHtml}
          </div>
        </div>
      `;
    }

    let itemsHtml = '';
    const items = cn.Items || cn.items || [];
    items.forEach((item: any, i: number) => {
      const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
      let prodName = item.productName || item.Name || this.getCNItemName(item);
      if (this.isOptionEnabled('Print Item Code')) {
        const code = item.productCode || this.getProductCode(item.productId);
        if (code) prodName = `[${code}] ${prodName}`;
      }
      const uom = this.isOptionEnabled('Print Item U.O.M.') ? ` (${item.uom || 'UNIT'})` : '';
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${prodName}${uom}</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>RM ${subtotal}</span></div></div>`;
    });

    const cnNumber = cn.cnNumber || ('CN-' + cn.id);
    const invoiceNumber = this.getDocNo(cn.invoiceNumber || cn);
    const reasonHtml = cn.reason ? `<div style="font-size:11px;font-style:italic;color:#555;margin:8px 0;">Reason: ${cn.reason}</div>` : '';
    const status = cn.isUsed ? 'CREDIT USED' : cn.createdAfterPayment ? 'CREDIT ACTIVE' : 'DEBT OFFSET';

    let sigBoxHtml = '';
    if (this.isOptionEnabled('Sign on Credit Note')) {
      sigBoxHtml = `<div class="sig-box"><span class="sig-label">CREDIT NOTE RECEIVED SIGNATURE</span></div>`;
    }

    let footerHtml = '';
    if (this.isOptionEnabled('Footer')) {
      footerHtml = `<div class="thanks">THANK YOU</div>`;
    }

    let emptyLinesHtml = '';
    const linesCount = this.printerSettings?.bottomEmptyLine ?? 5;
    for (let l = 0; l < linesCount; l++) {
      emptyLinesHtml += `<div style="height: 20px;"></div>`;
    }

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Credit Note ${cnNumber}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">CREDIT NOTE</span><div class="divider"></div>${companyHeaderHtml}<div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">CN NO</span><span class="doc-value">: ${cnNumber}</span></div><div class="doc-row"><span class="doc-label">INV NO</span><span class="doc-value">: ${invoiceNumber}</span></div>${dateHtml}</div>${customerBoxHtml}<div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div><div class="total-row" style="font-weight:800;font-size:14px;"><span>REFUND AMOUNT</span><span>RM ${(cn.amount || 0).toFixed(2)}</span></div>${reasonHtml}<div class="net-bar"><span class="net-label">STATUS</span><span class="net-value" style="font-size:16px;">${status}</span></div>${sigBoxHtml}${footerHtml}${emptyLinesHtml}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  printCNFromPreview() {
    this.printCNReceipt();
  }

  noLeadingZero(event: KeyboardEvent, val: any) {
    if ((val === 0 || val === '' || val === null || val === undefined) && event.key === '0') {
      event.preventDefault();
    }
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goTo(path: string, params?: any) { 
    if (params) {
      this.navCtrl.navigateRoot(path, { queryParams: params }); 
    } else {
      this.navCtrl.navigateRoot(path); 
    }
  }

  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}



