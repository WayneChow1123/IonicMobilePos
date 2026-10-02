import { AlertService } from '../../services/alert.service';
import Swal from 'sweetalert2';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NavController, Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute } from '@angular/router';
import { BluetoothPrintService } from '../../services/bluetooth-print.service';
import { formatDocNo, updateInvoiceDocNos } from '../../utils/invoice-helper';
import { SyncService } from '../../services/sync.service';
import { OfflineStorageService } from '../../services/offline-storage.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-invoices',
  templateUrl: './invoices.page.html',
  styleUrls: ['./invoices.page.scss'],
})
export class InvoicesPage implements OnInit, OnDestroy {
  invoices: any[] = [];
  filteredInvoices: any[] = [];
  displayedInvoices: any[] = [];
  pageSize = 30;
  currentPage = 1;
  isLoadingMore = false;
  customers: any[] = [];
  products: any[] = [];
  allProducts: any[] = [];
  availableCredits: any[] = [];
  pendingOfflineCount: number = 0;
  isSyncing: boolean = false;
  private syncSub?: any;
  private queueCountSub?: any;
  private syncingSub?: any;
  customerProductPrices: any[] = [];
  loadedCustomerId: number = 0;
  selectedCreditNoteId: number | null = null;
  isLoading = false;
  showModal = false;
  isDirectEntry = false;
  showCustomerSelector = false;
  showProductSelector = false;
  showPaymentCollection = false;
  amountPaid: number = 0;
  paymentMethod: string = 'CASH';
  paymentMethods: string[] = ['CASH', 'TRANSFER', 'CHEQUE', 'CARD'];
  termType: string = 'CASH SALE';
  termTypes: string[] = ['CASH SALE', 'Net 30 Days', 'On Credit'];
  showBillRemark: boolean = false;
  customerSearchTerm = '';
  productSearchTerm = '';
  filteredCustomers: any[] = [];
  filteredProductsForSelection: any[] = [];
  showSearch = false;
  searchTerm = '';
  startDate = '';
  endDate = '';
  activePreset = '';
  isEditing = false;
  isEditMode = false;
  selectedInvoice: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  selectedCustomerDetail: any = null;
  showCheckPreview = false;
  previewData: any = null;
  form: any = { customerId: 0, invoiceDate: this.getMYSDate(), remark: '', useCreditBalance: false, items: [] };
  editForm: any = { customerId: 0, customerName: '', invoiceDate: this.getMYSDate(), remark: '', items: [{ productId: 0, quantity: null, unitPrice: null }] };
  showStockAlert = false;
  stockIssues: any[] = [];
  showAvailableCredits = true;
  showInvoiceRemark = false;
  showActionsDropdown = false;

  showEditItemModal = false;
  editItemForm: any = { quantity: null, unitPrice: null, remark: '' };
  editItemIndex: number = -1;

  // Edit Invoice Product Select Modal
  showEditProductSelectModal = false;
  editingItemIndex: number = -1;
  selectedTempProduct: any = null;
  productModalSearchText = '';
  matchedModalProducts: any[] = [];
  otherModalProducts: any[] = [];

  printerSettings: any = null;

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

  getDocNo(inv: any): string {
    return inv?.docNo || formatDocNo(inv, this.invoices);
  }

  getProductCode(productId: any): string {
    const product = this.allProducts.find(p => p.id == productId);
    return product?.productCode || product?.code || '';
  }

  getProductBarcode(productId: any): string {
    const product = this.allProducts.find(p => p.id == productId);
    return product?.barcode || '';
  }

  getBottomEmptyLines(): number[] {
    const count = this.printerSettings?.bottomEmptyLine ?? 5;
    return Array(count).fill(0);
  }

  getReceiptNetAmount(): number {
    if (!this.selectedInvoice) return 0;
    const net = (this.selectedInvoice.totalAmount || 0) - this.getTotalCN() - (this.selectedInvoice.creditUsed || 0);
    return net > 0 ? Math.round((net + Number.EPSILON) * 100) / 100 : 0;
  }

  getReceiptBalance(): number {
    if (!this.selectedInvoice) return 0;
    const net = this.getReceiptNetAmount();
    const bal = net - (this.selectedInvoice.paidAmount || 0);
    return bal > 0 ? Math.round((bal + Number.EPSILON) * 100) / 100 : 0;
  }
  
  getGrandNetTotal() {
    return (this.filteredInvoices || [])
      .filter(inv => inv.status === 'Paid' || inv.status === 'Partial')
      .reduce((sum, inv) => {
        const net = inv.netTotal ?? inv.NetTotal ?? inv.totalAmount ?? 0;
        return sum + (Number(net) || 0);
      }, 0);
  }

  getGrandTotalBills() {
    return (this.filteredInvoices || []).length;
  }

  getGrandTotalAmount(): number {
    return (this.filteredInvoices || [])
      .reduce((sum, inv) => sum + (inv.totalAmount || inv.TotalAmount || 0), 0);
  }

  getGrandCNTotal(): number {
    return (this.filteredInvoices || [])
      .reduce((sum, inv) => sum + (inv.cnTotal || inv.CNTotal || 0), 0);
  }

  getGrandCreditUsed(): number {
    return (this.filteredInvoices || [])
      .reduce((sum, inv) => sum + (inv.creditUsed || inv.CreditUsed || 0), 0);
  }

  getGrandPaidTotal(): number {
    return (this.filteredInvoices || [])
      .reduce((sum, inv) => sum + (inv.paidAmount || inv.PaidAmount || 0), 0);
  }

  getGrandBalanceTotal(): number {
    const total = (this.filteredInvoices || [])
      .reduce((sum, inv) => {
        const bal = inv.balance ?? inv.Balance ?? 0;
        return sum + (bal > 0 ? bal : 0);
      }, 0);
    return total > 0 ? Math.round((total + Number.EPSILON) * 100) / 100 : 0;
  }

  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteInvoice() }
  ];

  private backButtonSub?: any;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private alertService: AlertService,
    private btPrint: BluetoothPrintService,
    private platform: Platform,
    private syncService: SyncService,
    private offlineStorage: OfflineStorageService
  ) { }

  ionViewWillEnter() {
    this.loadPrinterSettings();
    this.loadInvoices();
    this.loadCustomers();
    this.cdr.detectChanges();
  }

  ngOnInit() {
    this.loadInvoices();
    this.loadCustomers();
    this.loadProducts();

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
        this.loadInvoices();
      }
    });

    // Check for query parameters to auto-open form
    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'new') {
        this.isDirectEntry = true;
        this.openAddModal();
      } else {
        this.isDirectEntry = false;
      }
    });

    // Handle hardware / gesture back button
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
      if (this.showModal && !this.isEditing) {
        this.handleNewInvoiceBack();
      } else if (this.showModal && this.isEditing) {
        this.closeModal();
      } else if (this.isDirectEntry) {
        this.goBack();
      }
    });
  }

  ngOnDestroy() {
    if (this.backButtonSub) {
      this.backButtonSub.unsubscribe();
    }
    if (this.queueCountSub) {
      this.queueCountSub.unsubscribe();
    }
    if (this.syncingSub) {
      this.syncingSub.unsubscribe();
    }
    if (this.syncSub) {
      this.syncSub.unsubscribe();
    }
  }

  async loadInvoices() {
    this.isLoading = true;

    const pendingQueue = await this.offlineStorage.getPendingQueue();
    const deletedIds = pendingQueue
      .filter(q => q.type === 'DELETE_INVOICE')
      .map(q => q.payload?.invoiceId);

    const pendingInvoices = pendingQueue
      .filter(q => q.type === 'CREATE_INVOICE')
      .map(q => {
        const p = q.payload || {};
        const total = (p.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
        return {
          id: q.id,
          invoiceNumber: p.invoiceNumber || ('OFFLINE-' + String(q.id).slice(-6)),
          docNo: p.invoiceNumber || 'OFFLINE (Pending)',
          customerName: this.customers.find(c => c.id == p.customerId)?.name || ('Customer #' + p.customerId),
          customerId: p.customerId,
          invoiceDate: p.invoiceDate || new Date(q.createdAt).toISOString(),
          totalAmount: Math.round((total + Number.EPSILON) * 100) / 100,
          paidAmount: p.paidAmount || 0,
          balance: (total || 0) - (p.paidAmount || 0),
          status: 'Offline Pending',
          termType: p.termType,
          paymentMethod: p.paymentMethod,
          remark: p.remark || '',
          items: p.items || [],
          isOffline: true
        };
      });

    this.api.getInvoices().subscribe({
      next: (res) => {
        const rawList = Array.isArray(res) ? res : [];
        const serverInvoices = rawList.map(inv => {
          const override = this.getCustomerOverride(inv.id);
          const custId = override ? override.customerId : (inv.customerId ?? inv.CustomerId);
          const cust = this.customers.find(c => c.id == custId);
          const cName = override ? override.customerName : (inv.customerName || inv.CustomerName || cust?.name);
          const cCode = override?.customerCode || inv.customerCode || inv.CustomerCode || cust?.customerCode || cust?.code || '';
          return {
            ...inv,
            customerId: custId,
            customerName: cName || (custId ? ('Customer #' + custId) : 'Walk-in Cash'),
            customerCode: cCode
          };
        });
        this.offlineStorage.setCache('invoices_list', serverInvoices);
        this.invoices = [...pendingInvoices, ...serverInvoices].filter(inv => !deletedIds.includes(inv.id));
        updateInvoiceDocNos(this.invoices);
        this.filterInvoices();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: async () => {
        const cached = await this.offlineStorage.getCache<any[]>('invoices_list');
        this.invoices = [...pendingInvoices, ...(cached || [])].filter(inv => !deletedIds.includes(inv.id));
        updateInvoiceDocNos(this.invoices);
        this.filterInvoices();
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  async manualSync() {
    if (this.isSyncing) return;
    this.showToastMsg('Syncing offline invoices...');
    const res = await this.syncService.syncPendingInvoices(true);
    if (res.successCount > 0) {
      this.showToastMsg(`Synced ${res.successCount} item(s) successfully!`);
      this.loadInvoices();
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
        }
      });
    } else {
      this.showToastMsg('All invoices are already synced.');
    }
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => {
        this.customers = Array.isArray(res) ? res : [];
        this.filteredCustomers = [...this.customers];
        // If we are currently in New Invoice mode and have a customer selected (e.g. from draft), sync customer details
        if (this.showModal && !this.isEditing && this.form?.customerId > 0) {
          const match = this.customers.find(c => c.id == this.form.customerId);
          if (match) {
            this.selectedCustomerDetail = match;
            this.loadAvailableCredits(Number(this.form.customerId));
            this.loadCustomerProductPrices(Number(this.form.customerId));
          }
        }
        if (this.invoices && this.invoices.length > 0) {
          this.filterInvoices();
        }
      },
      error: () => { }
    });
  }

  loadProducts() {
    this.api.getProducts().subscribe({
      next: (res) => {
        const all = (Array.isArray(res) ? res : []).filter((p: any) => p.isActive !== false);
        this.products = all;
        this.allProducts = all;
      },
      error: () => { }
    });
  }

  mergeInvoiceCreditNotes(rawCNs: any[]): any[] {
    if (!rawCNs || rawCNs.length === 0) return [];
    const groupedMap = new Map<string, any>();
    for (const cn of rawCNs) {
      const isChange = (cn.cnNumber || cn.CNNumber || '').startsWith('CN-CHG');
      // Option 3+A: 只要在同一个 invoice 的所有 product 造成的 CN 都合并
      const key = !isChange ? 'RETURN_CN' : (cn.cnNumber || cn.CNNumber || ('ID-' + (cn.id || cn.Id)));

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          ...cn,
          rawIds: cn.rawIds || cn.RawIds || [cn.id || cn.Id],
          items: [...(cn.items || cn.Items || [])],
          Items: [...(cn.items || cn.Items || [])],
          amount: Number(cn.amount || cn.Amount || 0)
        });
      } else {
        const exist = groupedMap.get(key);
        const rIds = cn.rawIds || cn.RawIds || [cn.id || cn.Id];
        for (const rid of rIds) {
          if (!exist.rawIds.includes(rid)) exist.rawIds.push(rid);
        }
        exist.amount += Number(cn.amount || cn.Amount || 0);
        const newItems = cn.items || cn.Items || [];
        exist.items.push(...newItems);
        exist.Items.push(...newItems);

        // 选项 A: 保留第一张 CN 单号
        const cnCreated = cn.createdAt || cn.CreatedAt;
        const existCreated = exist.createdAt || exist.CreatedAt;
        if (cnCreated && existCreated && new Date(cnCreated) < new Date(existCreated)) {
          exist.cnNumber = cn.cnNumber || cn.CNNumber;
          exist.CNNumber = cn.CNNumber || cn.cnNumber;
          exist.createdAt = cnCreated;
          exist.CreatedAt = cnCreated;
          exist.id = cn.id || cn.Id;
          exist.Id = cn.Id || cn.id;
        }
      }
    }
    return Array.from(groupedMap.values());
  }

  loadAvailableCredits(customerId: number) {
    this.api.getAvailableCredits(customerId).subscribe({
      next: (res: any) => {
        const raw = Array.isArray(res) ? res : [];
        const groupedMap = new Map<string, any>();
        for (const cn of raw) {
          const isChange = (cn.cnNumber || cn.CNNumber || '').startsWith('CN-CHG');
          const invKey = (!isChange && (cn.invoiceNumber || cn.InvoiceNumber))
            ? ('INV-' + (cn.invoiceNumber || cn.InvoiceNumber))
            : (cn.cnNumber || cn.CNNumber || ('ID-' + cn.id));
          if (!groupedMap.has(invKey)) {
            groupedMap.set(invKey, {
              ...cn,
              rawIds: cn.rawIds || [cn.id],
              items: [...(cn.items || cn.Items || [])],
              amount: Number(cn.amount || 0)
            });
          } else {
            const exist = groupedMap.get(invKey);
            exist.amount += Number(cn.amount || 0);
            if (cn.rawIds) {
              for (const rid of cn.rawIds) { if (!exist.rawIds.includes(rid)) exist.rawIds.push(rid); }
            } else if (!exist.rawIds.includes(cn.id)) {
              exist.rawIds.push(cn.id);
            }
            if (cn.items || cn.Items) {
              exist.items.push(...(cn.items || cn.Items));
            }
            // 选项 A: 保留第一张 CN 单号
            if (cn.createdAt && exist.createdAt && new Date(cn.createdAt) < new Date(exist.createdAt)) {
              exist.cnNumber = cn.cnNumber || cn.CNNumber;
              exist.CNNumber = cn.CNNumber || cn.cnNumber;
              exist.createdAt = cn.createdAt;
              exist.id = cn.id;
            }
          }
        }
        this.availableCredits = Array.from(groupedMap.values());
      },
      error: () => { this.availableCredits = []; }
    });
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredInvoices = [...this.invoices]; this.currentPage = 1; this.displayedInvoices = this.filteredInvoices.slice(0, this.pageSize); }
  }

  filterInvoices() {
    const term = (this.searchTerm || '').toLowerCase().trim();
    this.filteredInvoices = this.invoices.filter(inv => {
      // Search term filtering
      const custName = (this.getInvoiceCustomerName(inv) || '').toLowerCase();
      const custCode = (this.getCustomerCode(inv) || '').toLowerCase();
      const invNum = (inv.invoiceNumber || '').toLowerCase();
      const docNo = (inv.docNo || this.getDocNo(inv) || '').toLowerCase();

      const matchesSearch = !term ||
        invNum.includes(term) ||
        docNo.includes(term) ||
        custName.includes(term) ||
        custCode.includes(term);

      if (!matchesSearch) return false;

      // Date range filtering
      let matchesDate = true;
      if (inv.invoiceDate) {
        let invDateStr = '';
        if (typeof inv.invoiceDate === 'string') {
          invDateStr = inv.invoiceDate;
        } else if (inv.invoiceDate instanceof Date) {
          invDateStr = inv.invoiceDate.toISOString();
        } else {
          invDateStr = new Date(inv.invoiceDate).toISOString();
        }
        const invDatePart = invDateStr.substring(0, 10); // Extract "YYYY-MM-DD"

        if (this.startDate && invDatePart < this.startDate) {
          matchesDate = false;
        }
        if (this.endDate && invDatePart > this.endDate) {
          matchesDate = false;
        }
      } else if (this.startDate || this.endDate) {
        matchesDate = false; // Exclude invoices without a date if date filters are applied
      }

      return matchesDate;
    });
    this.currentPage = 1;
    this.displayedInvoices = this.filteredInvoices.slice(0, this.pageSize);
  }

  loadMoreInvoices() {
    if (this.displayedInvoices.length >= this.filteredInvoices.length) return;
    this.isLoadingMore = true;
    setTimeout(() => {
      this.currentPage++;
      this.displayedInvoices = this.filteredInvoices.slice(0, this.currentPage * this.pageSize);
      this.isLoadingMore = false;
      this.cdr.detectChanges();
    }, 300);
  }

  onInfiniteInvoices(event: any) {
    if (this.displayedInvoices.length >= this.filteredInvoices.length) { event.target.complete(); return; }
    this.currentPage++;
    setTimeout(() => {
      this.displayedInvoices = this.filteredInvoices.slice(0, this.currentPage * this.pageSize);
      event.target.complete();
      this.cdr.detectChanges();
    }, 400);
  }

  clearDateFilter() {
    this.startDate = '';
    this.endDate = '';
    this.activePreset = '';
    this.filterInvoices();
  }

  formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  setPreset(preset: string) {
    this.activePreset = preset;
    const now = new Date();
    
    if (preset === 'today') {
      const todayStr = this.formatDate(now);
      this.startDate = todayStr;
      this.endDate = todayStr;
    } else if (preset === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      const yesterdayStr = this.formatDate(yesterday);
      this.startDate = yesterdayStr;
      this.endDate = yesterdayStr;
    } else if (preset === 'week') {
      // Start of this week (Monday)
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now.setDate(diff));
      this.startDate = this.formatDate(monday);
      this.endDate = this.formatDate(new Date());
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      this.startDate = this.formatDate(firstDay);
      this.endDate = this.formatDate(new Date());
    } else if (preset === '30days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      this.startDate = this.formatDate(thirtyDaysAgo);
      this.endDate = this.formatDate(new Date());
    }
    
    this.filterInvoices();
  }

  loadCustomerProductPrices(customerId: number) {
    if (!customerId) return;
    this.loadedCustomerId = 0;
    this.api.getCustomerProductPrices(customerId).subscribe({
      next: (res) => {
        this.customerProductPrices = Array.isArray(res) ? res : [];
        this.loadedCustomerId = customerId;
        // Edit模式(Invoice Details)不要整批覆蓋 editForm.items，
        // 否則剛從DB讀回來 / 剛手改好的 unitPrice 會被原價*折扣洗掉
        if (!this.isEditing) {
          this.applyCustomerDiscount();
        }
      },
      error: () => {
        this.customerProductPrices = [];
        this.loadedCustomerId = customerId;
      }
    });
  }

  onCustomerChange() {
    if (this.form.customerId) {
      const customer = this.customers.find((c: any) => c.id == this.form.customerId);
      this.selectedCustomerDetail = customer || null;
      this.form.useCreditBalance = false;
      this.selectedCreditNoteId = null;
      this.availableCredits = [];
      this.customerProductPrices = [];
      this.loadAvailableCredits(Number(this.form.customerId));
      this.loadCustomerProductPrices(Number(this.form.customerId));
    }
  }

  applyCustomerDiscount() {
    if (!this.selectedCustomerDetail) return;
    const discount = this.selectedCustomerDetail.discountPercent || this.selectedCustomerDetail.discount || 0;
    const items = this.isEditing ? this.editForm.items : this.form.items;
    (items || []).forEach((item: any) => {
      const product = this.allProducts.find(p => p.id == item.productId);
      if (product) {
        const specialPrice = this.customerProductPrices.find(p => p.productId == item.productId);
        const basePrice = specialPrice ? specialPrice.specialPrice : product.price;
        item.unitPrice = basePrice * (1 - (discount / 100));
      }
    });
  }

  openCustomerSelector() {
    this.customerSearchTerm = '';
    this.filteredCustomers = [...this.customers];
    this.showCustomerSelector = true;
  }

  filterCustomers() {
    const term = this.customerSearchTerm.toLowerCase();
    this.filteredCustomers = this.customers.filter(c =>
      (c.name || '').toLowerCase().includes(term) ||
      (c.customerCode || '').toLowerCase().includes(term) ||
      (c.code || '').toLowerCase().includes(term)
    );
  }

  private readonly INV_CUST_OVERRIDES_KEY = 'invoice_customer_overrides';

  private getCustomerOverride(invoiceId: any): { customerId: number, customerName: string, customerCode?: string } | null {
    try {
      const data = localStorage.getItem(this.INV_CUST_OVERRIDES_KEY);
      if (!data) return null;
      const map = JSON.parse(data);
      return map[invoiceId] || null;
    } catch {
      return null;
    }
  }

  private setCustomerOverride(invoiceId: any, customerId: number, customerName: string, customerCode?: string) {
    try {
      const data = localStorage.getItem(this.INV_CUST_OVERRIDES_KEY);
      const map = data ? JSON.parse(data) : {};
      map[invoiceId] = { customerId, customerName, customerCode };
      localStorage.setItem(this.INV_CUST_OVERRIDES_KEY, JSON.stringify(map));
    } catch {}
  }

  selectCustomer(customer: any) {
    if (this.isEditing) {
      this.editForm.customerId = customer ? customer.id : 0;
      this.editForm.customerName = customer ? (customer.name || '') : '';
      this.selectedCustomerDetail = customer || null;
      if (this.selectedInvoice) {
        this.selectedInvoice.customerId = this.editForm.customerId;
        this.selectedInvoice.customerName = this.editForm.customerName;
      }
      if (customer?.id) {
        this.loadCustomerProductPrices(Number(customer.id));
      } else {
        this.customerProductPrices = [];
      }
      this.showCustomerSelector = false;
      this.cdr.detectChanges();
      return;
    }
    this.form.customerId = customer.id;
    this.selectedCustomerDetail = customer;
    this.customerProductPrices = [];
    this.onCustomerChange();
    this.showCustomerSelector = false;
  }

  openProductSelector() {
    this.productSearchTerm = '';
    this.filteredProductsForSelection = [...this.products];
    this.showProductSelector = true;
  }

  filterProductsForSelection() {
    const term = this.productSearchTerm.toLowerCase().trim();
    this.filteredProductsForSelection = this.products.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.code || '').toLowerCase().includes(term) ||
      (p.barcode || '').toLowerCase().includes(term)
    );
  }

  selectProduct(product: any) {
    // 同產品重複選直接加新卡（數量空白、單價自動帶，不再數量+1）
    const discount = this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
    const specialPrice = this.customerProductPrices.find(p => p.productId == product.id);
    const basePrice = specialPrice ? specialPrice.specialPrice : product.price;
    const finalPrice = basePrice * (1 - (discount / 100));
    const newItem = {
      productId: product.id,
      productName: product.name,
      unitPrice: finalPrice,
      quantity: null,
      remark: '',
      barcode: product.barcode || ''
    };
    this.form.items.push(newItem);
    this.showProductSelector = false;
  }


  onProductChange(item: any) {
    const product = this.products.find((p: any) => p.id == item.productId);
    if (!product) return;
    const discount = this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
    const specialPrice = this.customerProductPrices.find(p => p.productId == product.id);
    const basePrice = specialPrice ? specialPrice.specialPrice : product.price;
    item.unitPrice = basePrice * (1 - (discount / 100));
  }

  onUnitPriceChange(item: any) {
  }

  getCustomerCreditBalance(): number {
    if (!this.selectedCustomerDetail) return 0;
    return this.selectedCustomerDetail.creditBalance || 0;
  }

  private readonly DRAFT_STORAGE_KEY = 'new_invoice_draft';

  hasNewInvoiceData(): boolean {
    if (!this.form) return false;
    if (this.form.items && this.form.items.length > 0) return true;
    if (this.form.remark && this.form.remark.trim() !== '') return true;
    if (this.form.customerId && this.form.customerId > 0) return true;
    if (this.termType !== 'CASH SALE' || this.paymentMethod !== 'CASH') return true;
    if (this.selectedCreditNoteId) return true;
    if (this.amountPaid > 0) return true;
    if (localStorage.getItem(this.DRAFT_STORAGE_KEY)) return true;
    return false;
  }

  saveInvoiceDraft() {
    try {
      const draft = {
        form: this.form,
        selectedCustomerDetail: this.selectedCustomerDetail,
        selectedCreditNoteId: this.selectedCreditNoteId,
        amountPaid: this.amountPaid,
        paymentMethod: this.paymentMethod,
        termType: this.termType,
        showInvoiceRemark: this.showInvoiceRemark,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(this.DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (e) {
      console.error('Failed to save invoice draft to localStorage', e);
    }
  }

  clearInvoiceDraft() {
    try {
      localStorage.removeItem(this.DRAFT_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear invoice draft', e);
    }
  }

  loadInvoiceDraft(): boolean {
    try {
      const saved = localStorage.getItem(this.DRAFT_STORAGE_KEY);
      if (!saved) return false;
      const draft = JSON.parse(saved);
      if (!draft || !draft.form) return false;

      this.form = draft.form;
      this.selectedCreditNoteId = draft.selectedCreditNoteId || null;
      this.amountPaid = draft.amountPaid || 0;
      this.paymentMethod = draft.paymentMethod || 'CASH';
      this.termType = draft.termType || 'CASH SALE';
      this.showInvoiceRemark = !!draft.showInvoiceRemark;

      const targetCustomerId = Number(this.form.customerId);
      if (targetCustomerId > 0) {
        const match = this.customers.find(c => c.id == targetCustomerId);
        this.selectedCustomerDetail = match || draft.selectedCustomerDetail || null;
        this.loadAvailableCredits(targetCustomerId);
        this.loadCustomerProductPrices(targetCustomerId);
      } else {
        this.selectedCustomerDetail = null;
        this.availableCredits = [];
        this.customerProductPrices = [];
      }
      return true;
    } catch (e) {
      console.error('Failed to parse invoice draft', e);
      return false;
    }
  }

  resetNewInvoiceForm() {
    this.selectedInvoice = null;
    this.selectedCustomerDetail = null;
    this.selectedCreditNoteId = null;
    this.availableCredits = [];
    this.customerProductPrices = [];
    this.termType = 'CASH SALE';
    this.paymentMethod = 'CASH';
    this.amountPaid = 0;
    this.showInvoiceRemark = false;
    this.form = {
      customerId: 0,
      invoiceDate: this.getMYSDate(),
      remark: '',
      useCreditBalance: false,
      items: []
    };
  }

  openAddModal() {
    this.isEditing = false;
    this.isEditMode = true;
    this.selectedInvoice = null;

    const restored = this.loadInvoiceDraft();
    if (restored) {
      this.alertService.toast('Draft invoice restored', 'info');
    } else {
      this.resetNewInvoiceForm();
    }
    this.showModal = true;
  }

  async handleNewInvoiceBack() {
    if (!this.hasNewInvoiceData()) {
      this.closeModal();
      return;
    }

    const action = await this.alertService.confirmDraft(
      'Save Invoice Draft?',
      'You have unsaved invoice changes. Do you want to keep the current draft or discard and exit?'
    );

    if (action === 'keep') {
      this.saveInvoiceDraft();
      this.alertService.toast('Invoice draft saved', 'success');
      this.closeModal();
    } else if (action === 'discard') {
      this.clearInvoiceDraft();
      this.resetNewInvoiceForm();
      this.closeModal();
    }
    // If 'cancel', do nothing and remain in the New Invoice editor
  }

  async openEditModal(invoice: any) {
    this.showActionsDropdown = false;
    this.isEditing = true;
    this.isEditMode = false;
    this.selectedInvoice = null;
    const initialCustId = invoice.customerId ?? invoice.CustomerId ?? 0;
    this.selectedCustomerDetail = this.customers.find(c => c.id === initialCustId);

    // 1. 如果是离线创建的单据：直接从本地数据源组装详情，无需发起服务端 HTTP 请求
    if (invoice.isOffline) {
      this.selectedInvoice = { ...invoice };
      const rawOfflineItems = (invoice.items && Array.isArray(invoice.items) && invoice.items.length > 0) ? invoice.items : [];
      this.editForm = {
        customerId: initialCustId,
        customerName: invoice.customerName ?? invoice.CustomerName ?? this.selectedCustomerDetail?.name ?? '',
        invoiceDate: invoice.invoiceDate || this.getMYSDate(),
        remark: invoice.remark || '',
        items: rawOfflineItems.map((i: any) => ({
          productId: i.productId || 0,
          quantity: i.quantity || 1,
          unitPrice: i.unitPrice ?? null,
          productName: i.productName || this.getProductName(i.productId),
          returnedQuantity: 0,
          remark: i.remark || ''
        }))
      };
      this.showModal = true;
      this.cdr.detectChanges();
      return;
    }

    // 2. 离线降级渲染辅助函数：从本地缓存或列表模型直接显示发票详情，绝不白屏卡住
    const renderOfflineFallback = async () => {
      this.isLoading = false;
      const cached = await this.offlineStorage.getCache<any>('inv_detail_' + invoice.id);
      const details = cached || invoice;
      const custId = details.customerId ?? details.CustomerId ?? invoice.customerId ?? invoice.CustomerId ?? 0;
      this.selectedCustomerDetail = this.customers.find(c => c.id === custId);
      this.selectedInvoice = { ...details, customerName: details.customerName || invoice.customerName, customerId: custId };
      const rawFallbackItems = (details.items || details.Items);
      const hasValidItems = Array.isArray(rawFallbackItems) && rawFallbackItems.length > 0;
      this.editForm = {
        customerId: custId,
        customerName: details.customerName || invoice.customerName || this.selectedCustomerDetail?.name || '',
        invoiceDate: details.invoiceDate || this.getMYSDate(),
        remark: details.remark || '',
        termType: details.termType || details.TermType || 'CASH SALE',
        items: hasValidItems
          ? rawFallbackItems.map((i: any) => ({
            productId: i.productId ?? i.ProductId ?? 0,
            quantity: i.quantity ?? i.Quantity ?? 1,
            unitPrice: i.unitPrice ?? i.UnitPrice ?? null,
            productName: i.productName ?? i.ProductName ?? this.getProductName(i.productId ?? i.ProductId),
            returnedQuantity: 0,
            remark: i.remark ?? i.Remark ?? ''
          }))
          : []
      };
      this.showModal = true;
      this.cdr.detectChanges();
    };

    // 如果处于断网状态，直接调用离线降级渲染打开页面
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await renderOfflineFallback();
      return;
    }

    this.isLoading = true;
    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.isLoading = false;
        if (res && res.creditNotes) {
          res.creditNotes = this.mergeInvoiceCreditNotes(res.creditNotes);
        }
        const details = res || invoice;
        const custId = details.customerId ?? details.CustomerId ?? invoice.customerId ?? invoice.CustomerId ?? 0;
        this.selectedCustomerDetail = this.customers.find(c => c.id === custId);
        this.selectedInvoice = { ...details, customerName: details.customerName || invoice.customerName, customerId: custId };
        const customerId = Number(custId);
        if (customerId) {
          this.loadCustomerProductPrices(customerId);
        }
        const rawSuccessItems = (details.items || details.Items);
        const hasSuccessItems = Array.isArray(rawSuccessItems) && rawSuccessItems.length > 0;
        this.editForm = {
          customerId: custId,
          customerName: details.customerName || invoice.customerName || this.selectedCustomerDetail?.name || '',
          invoiceDate: details.invoiceDate || this.getMYSDate(),
          remark: details.remark || '',
          termType: details.termType || details.TermType || 'CASH SALE',
          items: hasSuccessItems
            ? rawSuccessItems.map((i: any) => ({
              productId: i.productId ?? i.ProductId ?? 0,
              quantity: i.quantity ?? i.Quantity ?? 1,
              unitPrice: i.unitPrice ?? i.UnitPrice ?? null,
              productName: i.productName ?? i.ProductName ?? this.getProductName(i.productId ?? i.ProductId),
              returnedQuantity: i.returnedQuantity ?? i.ReturnedQuantity ?? 0,
              remark: i.remark ?? i.Remark ?? ''
            }))
            : []
        };
        // 保证列表中的该张发票数据与后端实时详情绝对一致
        const matchingInList = this.invoices.find(inv => inv.id === invoice.id);
        if (matchingInList) {
          matchingInList.customerId = custId;
          matchingInList.customerName = details.customerName || (details.customer?.name) || this.selectedCustomerDetail?.name || matchingInList.customerName;
          matchingInList.customerCode = this.selectedCustomerDetail?.customerCode || this.selectedCustomerDetail?.code || matchingInList.customerCode;
        }

        // 保存至本地离线缓存
        this.offlineStorage.setCache('inv_detail_' + invoice.id, details);

        this.showModal = true;
        this.cdr.detectChanges();
      },
      error: async (err) => {
        // 请求失败（服务器不通或半断网），同样执行降级展示
        await renderOfflineFallback();
      }
    });
  }

  getCustomerCodeForDetails(): string {
    if (this.selectedCustomerDetail && this.selectedCustomerDetail.customerCode) {
      return this.selectedCustomerDetail.customerCode;
    }
    if (this.selectedCustomerDetail && this.selectedCustomerDetail.code) {
      return this.selectedCustomerDetail.code;
    }
    const custId = this.isEditing ? (this.editForm?.customerId ?? this.selectedInvoice?.customerId) : this.selectedInvoice?.customerId;
    return custId ? 'NO CODE' : 'CASH000001';
  }

  getCustomerAddressForDetails(): string {
    if (!this.selectedCustomerDetail) {
      return this.selectedInvoice?.customer?.address || 'NO ADDRESS PROVIDED';
    }
    const c = this.selectedCustomerDetail;
    if (c.branches && c.branches.length > 0) {
      const b = c.branches.find((br: any) => br.isDefaultBranch) || c.branches[0];
      let parts = [];
      if (b.address1) parts.push(b.address1);
      if (b.city) parts.push(b.city);
      if (b.postcode) parts.push(b.postcode);
      if (b.state) parts.push(b.state);
      if (parts.length > 0) return parts.join(', ');
    }
    return c.address || c.billingAddress || 'NO ADDRESS PROVIDED';
  }

  goToCreateCN() {
    if (!this.selectedInvoice) return;
    const invId = this.selectedInvoice.id;
    const custId = this.selectedInvoice.customerId;
    this.showModal = false;
    // We navigate to billing with query params
    this.navCtrl.navigateRoot('pages/billing', {
      queryParams: {
        action: 'newCN',
        invoiceId: invId,
        customerId: custId,
        _t: Date.now()
      }
    });
  }

  goToCNDetails(cn: any) {
    if (!cn) return;
    const invId = this.selectedInvoice?.id || cn.invoiceId || 0;
    const cnId = cn.id || cn.Id;
    const cnNumber = cn.cnNumber || cn.CNNumber || ('CN-' + cnId);
    this.showModal = false;
    this.navCtrl.navigateRoot('pages/billing', {
      queryParams: {
        action: 'viewCN',
        cnId: cnId,
        invoiceId: invId,
        cnNumber: cnNumber,
        _t: new Date().getTime()
      }
    });
  }

  goToPaymentDetails() {
    if (!this.selectedInvoice) return;
    if (!(this.selectedInvoice.paidAmount > 0)) {
      this.showToastMsg('No payment has been recorded for this invoice yet.');
      return;
    }
    this.showModal = false;
    this.navCtrl.navigateRoot('pages/billing', {
      queryParams: {
        action: 'viewPayment',
        invoiceNumber: this.selectedInvoice.invoiceNumber
      }
    });
  }

  closeModal() {
    this.showActionsDropdown = false;
    if (this.isDirectEntry) {
      this.goBack(); // Navigate back to Billing
    } else {
      this.showModal = false;
      this.isEditing = false;
      this.selectedInvoice = null;
      this.filterInvoices();
      this.cdr.detectChanges();
    }
  }

  addItem() {
    if (this.isEditing) {
      const defaultProduct = this.products.length > 0 ? this.products[0] : null;
      this.editForm.items.push({ productId: defaultProduct?.id || 0, productName: defaultProduct?.name || '', quantity: null, unitPrice: defaultProduct?.price ?? null, returnedQuantity: 0, remark: '' });
    } else {
      this.form.items.push({ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: null, unitPrice: null });
    }
  }

  removeItem(index: number) {
    if (this.isEditing) {
      this.editForm.items.splice(index, 1);
    } else {
      this.form.items.splice(index, 1);
    }
  }

  openEditItemModal(index: number) {
    const item = this.editForm.items[index];
    if (!item) return;
    this.editItemIndex = index;
    this.editItemForm = { productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, remark: item.remark || '' };
    this.showEditItemModal = true;
    this.cdr.detectChanges();
  }

  closeEditItemModal() {
    this.showEditItemModal = false;
    this.editItemIndex = -1;
    this.cdr.detectChanges();
  }

  saveEditItem() {
    if (this.editItemIndex < 0 || !this.editForm.items[this.editItemIndex]) return;
    const target = this.editForm.items[this.editItemIndex];
    target.productId = this.editItemForm.productId ?? target.productId;
    target.quantity = Number(this.editItemForm.quantity);
    target.unitPrice = Number(this.editItemForm.unitPrice);
    target.remark = this.editItemForm.remark ?? '';
    target.productName = this.getProductName(target.productId);
    this.editForm.items = [...this.editForm.items];
    this.closeEditItemModal();
    this.cdr.detectChanges();
  }

  saveEditItemAndUpdate() {
    this.saveEditItem();
    setTimeout(() => this.saveInvoice(), 300);
  }

  openProductPickerFromEditModal() {
    this.editingItemIndex = this.editItemIndex;
    this.productModalSearchText = '';
    const pid = this.editItemForm.productId;
    this.selectedTempProduct = this.products.find(p => p.id == pid) || null;
    this.onProductModalSearch();
    this.showEditProductSelectModal = true;
    this.cdr.detectChanges();
  }

  // =========================
  // EDIT INVOICE PRODUCT MODAL
  // =========================
  openEditProductSelectModal(itemIndex: number) {
    this.editingItemIndex = itemIndex;
    this.productModalSearchText = '';
    const currentProductId = this.editForm.items[itemIndex]?.productId;
    this.selectedTempProduct = this.products.find(p => p.id === currentProductId) || null;
    this.onProductModalSearch();
    this.showEditProductSelectModal = true;
    this.cdr.detectChanges();
  }

  closeEditProductSelectModal() {
    this.showEditProductSelectModal = false;
    this.editingItemIndex = -1;
    this.cdr.detectChanges();
  }

  selectTempProduct(product: any) {
    this.selectedTempProduct = product;
    this.cdr.detectChanges();
  }

  confirmEditProductSelection() {
    if (this.selectedTempProduct) {
      if (this.showEditItemModal && this.editItemIndex >= 0) {
        this.editItemForm.productId = this.selectedTempProduct.id;
        // 跟 onProductChange 一致：特價優先，其次原價，再套客戶折扣，不要直接用原價蓋掉
        const discount = this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
        const special = this.customerProductPrices.find((p: any) => p.productId == this.selectedTempProduct.id);
        const basePrice = special ? special.specialPrice : this.selectedTempProduct.price;
        this.editItemForm.unitPrice = basePrice * (1 - (discount / 100));
      } else if (this.editingItemIndex >= 0 && this.editForm.items[this.editingItemIndex]) {
        const item = this.editForm.items[this.editingItemIndex];
        item.productId = this.selectedTempProduct.id;
        item.productName = this.selectedTempProduct.name;
        this.onProductChange(item);
      }
    }
    this.showEditProductSelectModal = false;
    this.editingItemIndex = -1;
    this.cdr.detectChanges();
  }

  onProductModalSearch() {
    const keyword = this.productModalSearchText.trim().toLowerCase();

    if (!keyword) {
      this.matchedModalProducts = [];
      this.otherModalProducts = [...this.products];
      return;
    }

    const matchesProduct = (product: any) =>
      (product.name || product.productName || '').toLowerCase().includes(keyword) ||
      (product.barcode || '').toLowerCase().includes(keyword);

    this.matchedModalProducts = this.products.filter(matchesProduct);

    this.otherModalProducts = this.products.filter(product =>
      !matchesProduct(product)
    );
  }

  getHighlightedProductName(name: string): string {
    if (!this.productModalSearchText || !name) return name;
    const keyword = this.productModalSearchText.trim();
    if (!keyword) return name;
    const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return name.replace(regex, '<span class="search-highlight">$1</span>');
  }

  cycleTermType() {
    const currentIndex = this.termTypes.indexOf(this.termType);
    const nextIndex = (currentIndex + 1) % this.termTypes.length;
    this.termType = this.termTypes[nextIndex];
    this.onTermTypeChange();
  }

  onTermTypeChange() {
    if (this.termType === 'On Credit') {
      if (!this.selectedCreditNoteId) {
        this.form.useCreditBalance = false;
      }
      this.amountPaid = 0;
    } else if (this.termType === 'CASH SALE') {
      if (!this.selectedCreditNoteId) {
        this.form.useCreditBalance = false;
      }
      this.amountPaid = this.getNetTotal();
    } else {
      this.amountPaid = 0;
    }
  }

  getApplicableCreditAmount(): number {
    const gross = this.getFormTotal();
    if (gross <= 0) return 0;
    // 如果用户手动选择了某张 CN，只使用该张，不自动聚合全部
    if (this.selectedCreditNoteId) {
      return this.getSelectedCreditAmount();
    }
    return 0;
  }

  isOnCreditAutoApply(): boolean {
    return false;
  }

  openPaymentCollection() {
    const net = this.getNetTotal();
    this.amountPaid = this.termType === 'CASH SALE' ? net : 0;
    this.showPaymentCollection = true;
  }

  getChangeToReturn() {
    const total = this.getNetTotal();
    const paid = Number(this.amountPaid) || 0;
    const change = paid - total;
    return change > 0 ? change : 0;
  }

  confirmPayment() {
    if (this.termType === 'On Credit' && this.amountPaid > this.getNetTotal()) {
      this.showToastMsg('Paid amount cannot exceed Net Total for On Credit');
      return;
    }
    // Here we would call the actual save logic
    this.saveInvoice();
    this.showPaymentCollection = false;
  }

  saveInvoice() {
    if (this.termType === 'On Credit' && this.amountPaid > this.getNetTotal()) {
      this.showToastMsg('Paid amount cannot exceed Net Total for On Credit');
      return;
    }
    const items = this.isEditing ? this.editForm.items : this.form.items;
    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) { this.showToastMsg('Quantity must be greater than 0'); return; }
      if (this.isStockInsufficient(item)) {
        const prodName = item.productName || this.getProductName(item.productId);
        this.showToastMsg('Insufficient stock for ' + prodName);
        return;
      }
    }
    if (this.isEditing && this.selectedInvoice) {
      const currentTerm = this.selectedInvoice.termType || this.selectedInvoice.TermType || this.editForm.termType || 'CASH SALE';
      
      const termOptions: { [key: string]: string } = {};
      for (const t of this.termTypes) {
        termOptions[t] = t;
      }

      Swal.fire({
        title: 'Change Term Type?',
        text: 'Do you want to change invoice Term Type?',
        input: 'select',
        inputOptions: termOptions,
        inputValue: currentTerm,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Yes',
        denyButtonText: 'No',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#6c5ce7',
        denyButtonColor: '#2ecc71',
        cancelButtonColor: '#747d8c',
        allowOutsideClick: false,
      }).then((result) => {
        if (result.isConfirmed) {
          // Yes: 进行更换 Term Type
          this.editForm.termType = result.value || currentTerm;
          this.executeUpdateInvoice();
        } else if (result.isDenied) {
          // No: 不进行更换 Term Type
          this.editForm.termType = currentTerm;
          this.executeUpdateInvoice();
        }
        // Cancel / Dismiss: 不提交更新，留在编辑页面
      });
      return;
    } else {
      if (!this.form.customerId) { this.showToastMsg('Please select a customer'); return; }
      
      const offlineDocNo = this.offlineStorage.generateInvoiceNumber();
      const offlineId = this.offlineStorage.generateId();

      const useCredit = !!this.selectedCreditNoteId;
      const payload = {
        ...this.form,
        invoiceNumber: offlineDocNo,
        offlineReferenceId: offlineId,
        useCreditBalance: useCredit,
        selectedCreditNoteId: this.selectedCreditNoteId,
        paidAmount: this.amountPaid,
        paymentMethod: this.paymentMethod,
        termType: this.termType,
        status: (this.termType === 'Net 30 Days' || this.termType === 'On Credit') ? 'Unpaid' : 'Paid'
      };
      this.api.createInvoice(payload).subscribe({
        next: (res: any) => {
          this.clearInvoiceDraft();

          if (res?.isOffline) {
            this.showToastMsg('Invoice saved offline! (Queued for sync)');
            this.closeModal();

            // 离线开单：装配完整离线发票与小票预览模型
            const offlineInv: any = {
              id: res.invoiceId,
              invoiceNumber: payload.invoiceNumber,
              docNo: payload.invoiceNumber,
              customerName: this.selectedCustomerDetail?.name || ('Customer #' + payload.customerId),
              customerId: payload.customerId,
              invoiceDate: payload.invoiceDate || new Date().toISOString(),
              totalAmount: res.totalAmount || 0,
              paidAmount: payload.paidAmount || 0,
              creditUsed: 0,
              balance: (res.totalAmount || 0) - (payload.paidAmount || 0),
              status: 'Offline Pending',
              termType: payload.termType,
              paymentMethod: payload.paymentMethod,
              remark: payload.remark || '',
              items: (payload.items || []).map((it: any) => {
                const prod = this.allProducts.find((p: any) => p.id == it.productId);
                return {
                  productId: it.productId,
                  productName: prod ? prod.name : ('Product #' + it.productId),
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                  remark: it.remark || ''
                };
              }),
              isOffline: true
            };

            const localPreviewData: any = {
              id: offlineInv.id,
              invoiceNumber: offlineInv.invoiceNumber,
              docNo: offlineInv.docNo,
              invoiceDate: offlineInv.invoiceDate,
              customerId: offlineInv.customerId,
              customerName: offlineInv.customerName,
              totalAmount: offlineInv.totalAmount,
              paidAmount: offlineInv.paidAmount,
              balance: offlineInv.balance,
              termType: offlineInv.termType,
              paymentMethod: offlineInv.paymentMethod,
              remark: offlineInv.remark,
              items: offlineInv.items,
              isOffline: true
            };

            this.selectedInvoice = offlineInv;
            this.previewData = localPreviewData;

            // 1. 将离线单追加至列表顶部
            this.invoices.unshift(offlineInv);
            this.filterInvoices();

            // 2. 检查蓝牙打印设置并立刻触发打印
            this.loadPrinterSettings();
            if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
              this.btPrint.printInvoice(offlineInv, localPreviewData, this.printerSettings, this.customers, this.allProducts);
            }

            // 3. 打开小票 Live Preview 弹窗
            this.showCheckPreview = true;
            this.cdr.detectChanges();
            return;
          }

          this.showToastMsg('Invoice created!');
          const createdInvoiceId = res?.invoiceId || res?.id;
          this.loadInvoices();
          this.loadCustomers();

          if (createdInvoiceId) {
            this.isLoading = true;
            this.isDirectEntry = false;
            this.isEditing = true;
            this.isEditMode = false;
            this.selectedInvoice = null;

            this.api.getInvoiceDetails(createdInvoiceId).subscribe({
              next: (invRes: any) => {
                this.selectedInvoice = invRes;
                this.selectedCustomerDetail = this.customers.find(c => c.id === invRes.customerId);
                const customerId = Number(invRes.customerId);
                if (customerId) {
                  this.loadCustomerProductPrices(customerId);
                }
                  const rawCreatedItems = (invRes.items || invRes.Items);
                  const hasCreatedItems = Array.isArray(rawCreatedItems) && rawCreatedItems.length > 0;
                  this.editForm = {
                    invoiceDate: invRes.invoiceDate || this.getMYSDate(),
                    remark: invRes.remark || '',
                    items: hasCreatedItems
                      ? rawCreatedItems.map((i: any) => ({
                        productId: i.productId ?? i.ProductId ?? 0,
                        quantity: i.quantity ?? i.Quantity ?? 1,
                        unitPrice: i.unitPrice ?? i.UnitPrice ?? null,
                        productName: i.productName ?? i.ProductName ?? this.getProductName(i.productId ?? i.ProductId),
                        returnedQuantity: i.returnedQuantity ?? i.ReturnedQuantity ?? 0,
                        remark: i.remark ?? i.Remark ?? ''
                      }))
                      : []
                  };
                this.showModal = true;

                this.api.previewInvoice(createdInvoiceId).subscribe({
                  next: (prevData: any) => {
                    this.previewData = prevData;
                    this.isLoading = false;
                    this.showCheckPreview = true;
                  },
                  error: () => {
                    this.previewData = null;
                    this.isLoading = false;
                    this.showCheckPreview = true;
                  }
                });
              },
              error: () => {
                this.isLoading = false;
                this.closeModal();
              }
            });
          } else {
            this.closeModal();
          }
        },
        error: (err: any) => this.handleInvoiceError(err)
      });
    }
  }

  executeUpdateInvoice() {
    if (!this.selectedInvoice) return;

    const updatedCustomerName = (this.editForm.customerName !== undefined && this.editForm.customerName !== null
      ? this.editForm.customerName
      : (this.selectedCustomerDetail?.name || this.selectedInvoice.customerName || '')).toString().trim();
    const updatedCustomerId = this.editForm.customerId !== undefined ? this.editForm.customerId : this.selectedInvoice.customerId;

    if (this.selectedInvoice.isOffline) {
      const calculatedTotal = (this.editForm.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
      this.selectedInvoice.items = this.editForm.items;
      this.selectedInvoice.remark = this.editForm.remark;
      this.selectedInvoice.termType = this.editForm.termType;
      this.selectedInvoice.customerId = updatedCustomerId;
      this.selectedInvoice.customerName = updatedCustomerName;
      this.selectedInvoice.totalAmount = Math.round((calculatedTotal + Number.EPSILON) * 100) / 100;
      this.selectedInvoice.balance = (this.selectedInvoice.totalAmount || 0) - (this.selectedInvoice.paidAmount || 0);

      const invInList = this.invoices.find(inv => inv.id === this.selectedInvoice.id);
      if (invInList) {
        invInList.customerId = updatedCustomerId;
        invInList.customerName = updatedCustomerName;
      }

      this.offlineStorage.setCache('inv_detail_' + this.selectedInvoice.id, this.selectedInvoice);

      this.offlineStorage.getQueueItemById(this.selectedInvoice.id).then(async (queueItem) => {
        if (queueItem) {
          queueItem.payload = {
            ...queueItem.payload,
            customerId: updatedCustomerId,
            customerName: updatedCustomerName,
            items: this.editForm.items,
            remark: this.editForm.remark,
            termType: this.editForm.termType,
            totalAmount: this.selectedInvoice.totalAmount
          };
          await this.offlineStorage.updateQueueItem(queueItem);
        }
      });

      this.showToastMsg('Offline invoice updated!');
      this.isEditMode = false;
      this.showEditItemModal = false;
      this.loadInvoices();
      this.cdr.detectChanges();
      return;
    }

    const payload = {
      ...this.editForm,
      customerId: updatedCustomerId,
      customerName: updatedCustomerName
    };

    const matchingCust = this.customers.find(c => c.id == updatedCustomerId);
    const updatedCustomerCode = matchingCust?.customerCode || matchingCust?.code || '';

    if (this.selectedInvoice && updatedCustomerId) {
      this.setCustomerOverride(this.selectedInvoice.id, updatedCustomerId, updatedCustomerName, updatedCustomerCode);
    }

    console.log('Update payload', JSON.stringify(payload));
    this.api.updateInvoice(this.selectedInvoice.id, payload).subscribe({
      next: (res: any) => {
        if (res?.isOffline) {
          this.showToastMsg('Invoice updated offline! (Queued for sync)');
        } else {
          this.showToastMsg('Invoice updated!');
        }

        if (this.selectedInvoice) {
          this.selectedInvoice.customerName = updatedCustomerName;
          this.selectedInvoice.customerId = updatedCustomerId;
          this.selectedInvoice.customerCode = updatedCustomerCode;
          this.selectedInvoice.items = payload.items;
          this.selectedInvoice.remark = payload.remark;
          this.selectedInvoice.termType = payload.termType;
          const calculatedTotal = (payload.items || []).reduce((sum: number, it: any) => sum + ((Number(it.unitPrice) || 0) * (Number(it.quantity) || 1)), 0);
          this.selectedInvoice.totalAmount = Math.round((calculatedTotal + Number.EPSILON) * 100) / 100;
          this.offlineStorage.setCache('inv_detail_' + this.selectedInvoice.id, this.selectedInvoice);
        }
        const invInList = this.invoices.find(inv => inv.id === this.selectedInvoice.id);
        if (invInList) {
          invInList.customerName = updatedCustomerName;
          invInList.customerId = updatedCustomerId;
          invInList.customerCode = updatedCustomerCode;
        }

        // 同步更新本地缓存
        this.offlineStorage.getCache<any[]>('invoices_list').then(cached => {
          if (cached && cached.length > 0) {
            const item = cached.find((c: any) => c.id === this.selectedInvoice?.id);
            if (item) {
              item.customerName = updatedCustomerName;
              item.customerId = updatedCustomerId;
              item.customerCode = updatedCustomerCode;
              this.offlineStorage.setCache('invoices_list', cached);
            }
          }
        });

        this.filterInvoices();
        this.isEditMode = false;
        this.showEditItemModal = false;
        this.loadInvoices();
        this.loadCustomers();
        if (!res?.isOffline) {
          this.api.getInvoiceDetails(this.selectedInvoice.id).subscribe({
            next: (detailRes: any) => {
              if (detailRes && detailRes.creditNotes) {
                detailRes.creditNotes = this.mergeInvoiceCreditNotes(detailRes.creditNotes);
              }
              this.selectedInvoice = detailRes;
              const newCustId = detailRes.customerId ?? detailRes.CustomerId ?? updatedCustomerId;
              this.selectedCustomerDetail = this.customers.find(c => c.id === newCustId);
              this.editForm = {
                customerId: newCustId,
                customerName: detailRes.customerName ?? detailRes.CustomerName ?? updatedCustomerName,
                invoiceDate: detailRes.invoiceDate || this.getMYSDate(),
                remark: detailRes.remark || '',
                termType: detailRes.termType || detailRes.TermType || 'CASH SALE',
                items: (detailRes.items || detailRes.Items || []).map((i: any) => ({
                  productId: i.productId ?? i.ProductId,
                  quantity: i.quantity ?? i.Quantity,
                  unitPrice: i.unitPrice ?? i.UnitPrice,
                  productName: i.productName ?? i.ProductName ?? this.getProductName(i.productId ?? i.ProductId),
                  remark: i.remark ?? i.Remark ?? ''
                }))
              };
              this.cdr.detectChanges();
            }
          });
        }
      },
      error: (err: any) => this.handleInvoiceError(err)
    });
  }

  handleInvoiceError(err: any) {
    let errBody = err.error;

    // If it's a structured error
    if (errBody?.type === 'STOCK_INSUFFICIENT') {
      this.stockIssues = errBody.stockIssues || [];
      this.showStockAlert = true;
    } else {
      let msg = errBody?.message || (typeof errBody === 'string' ? errBody : null) || err.message || 'error';

      // Auto-reformat "Insufficient stock for 'Product'. Available: X, Requested: Y"
      if (msg.toLowerCase().includes('insufficient stock for')) {
        const match = msg.match(/'([^']+)'/); // Extract product name between single quotes
        const productName = match ? match[1] : 'The product';
        msg = `${productName} doesn't have enough quantity as requested.`;
      }

      this.showToastMsg(msg);
    }
  }

  confirmDelete(invoice: any) { this.selectedInvoice = invoice; this.alertService.confirm('Delete Invoice', 'Delete ' + this.getDocNo(invoice) + '?').then(c => { if (c) this.deleteInvoice(); }); }

  async deleteInvoice() {
    if (!this.selectedInvoice) return;

    // 1. 如果是离线创建的单据：直接从本地同步队列移除
    if (this.selectedInvoice.isOffline) {
      await this.offlineStorage.removeQueueItem(this.selectedInvoice.id);
      this.showToastMsg('Offline invoice cancelled and removed!');
      this.closeModal();
      this.loadInvoices();
      return;
    }

    // 2. 如果是服务端单据，当前处于离线模式：加入待删除离线队列，并在本地列表中隐藏
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await this.offlineStorage.enqueue('DELETE_INVOICE', { invoiceId: this.selectedInvoice.id }, 'del_' + this.selectedInvoice.id);
      this.showToastMsg('Invoice marked for deletion (Will sync when online)');
      this.closeModal();
      this.loadInvoices();
      return;
    }

    // 3. 在线模式，发起网络删除请求
    this.api.deleteInvoice(this.selectedInvoice.id).subscribe({
      next: () => { this.showToastMsg('Invoice deleted!'); this.closeModal(); this.loadInvoices(); },
      error: async (err: any) => {
        if (err?.status === 0) {
          // 断网超时降级：加入离线待删除队列
          await this.offlineStorage.enqueue('DELETE_INVOICE', { invoiceId: this.selectedInvoice.id }, 'del_' + this.selectedInvoice.id);
          this.showToastMsg('Offline: deletion queued for sync');
          this.closeModal();
          this.loadInvoices();
        } else {
          this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'));
        }
      }
    });
  }

  confirmDeleteCNFromInvoice(cn: any) {
    this.alertService.confirm('Delete Credit Note', 'Are you sure you want to delete ' + (cn.cnNumber || 'CN-' + cn.id) + '?').then(c => {
      if (c) {
        const invId = this.selectedInvoice?.id || cn.invoiceId;
        this.api.deleteCreditNote(invId, cn.id).subscribe({
          next: () => {
            this.showToastMsg('Credit Note deleted!');
            if (this.selectedInvoice?.id) {
              this.api.getInvoiceDetails(this.selectedInvoice.id).subscribe({
                next: (res: any) => {
                  if (res && res.creditNotes) {
                    res.creditNotes = this.mergeInvoiceCreditNotes(res.creditNotes);
                  }
                  this.selectedInvoice = res;
                  this.loadInvoices();
                  this.cdr.detectChanges();
                }
              });
            } else {
              this.loadInvoices();
            }
          },
          error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
        });
      }
    });
  }

  toggleEditMode() {
    if (this.isEditMode) {
      this.saveInvoice();
    } else {
      this.isEditMode = true;
    }
  }

  confirmDeleteInModal() {
    if (this.selectedInvoice) {
      this.confirmDelete(this.selectedInvoice);
    }
  }

  getTotalCN(): number {
    if (!this.selectedInvoice?.creditNotes) return 0;
    // 只计算退货，不计算找零
    return this.selectedInvoice.creditNotes
      .filter((cn: any) => !(cn.cnNumber || '').startsWith('CN-CHG'))
      .reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getChangeCN(): number {
    if (!this.selectedInvoice?.creditNotes) return 0;
    // 只计算找零转入的点数
    return this.selectedInvoice.creditNotes
      .filter((cn: any) => (cn.cnNumber || '').startsWith('CN-CHG'))
      .reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getReceiptCreditNotes(): any[] {
    if (!this.selectedInvoice?.creditNotes) return [];
    // CN-CHG is an internal change-to-credit record, not shown on customer receipt
    return this.selectedInvoice.creditNotes.filter((cn: any) => !(cn.cnNumber || '').startsWith('CN-CHG'));
  }

  getReceiptTotalCN(): number {
    // Only count return CNs, not CN-CHG (change saved as credit)
    return this.getReceiptCreditNotes().reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  // ✅ 新增：判断 CN 的真实状态（抵债还是产生点数）
  getCNStatusLabel(cn: any, index: number): string {
    if (cn.isUsed) return "Credit Used";
    if (!this.selectedInvoice) return "Credit Active";
    
    // 计算在这笔 CN 之前（包括这笔）的总退款额
    const allCNs = this.selectedInvoice.creditNotes || [];
    let cumulativeCN = 0;
    for (let i = 0; i <= index; i++) {
      cumulativeCN += (allCNs[i].amount || 0);
    }

    const originalTotal = this.selectedInvoice.totalAmount || 0;
    const paidAmount = this.selectedInvoice.paidAmount || 0;
    
    // 如果“已付金额”还没有超过“折后余额”，说明这笔钱还在抵债阶段
    const balanceAfterCN = originalTotal - cumulativeCN;
    if (paidAmount <= balanceAfterCN) {
      return "Debt Offset";
    } else {
      return "Credit Active";
    }
  }

  getCNStatusColor(cn: any, index: number): string {
    const label = this.getCNStatusLabel(cn, index);
    if (label === "Credit Used") return "#e0e0e0";
    if (label === "Debt Offset") return "#ffeaa7"; // 暖黄色，表示抵债
    return "#00bcd4"; // 青色，表示活跃点数
  }

  getCNStatusTextColor(cn: any, index: number): string {
    const label = this.getCNStatusLabel(cn, index);
    if (label === "Credit Used") return "#888";
    if (label === "Debt Offset") return "#d35400"; // 深橙色
    return "#fff";
  }

  getCustomerCode(invoice: any) {
    const override = this.getCustomerOverride(invoice.id);
    if (override?.customerCode) return override.customerCode;
    if (invoice.customerCode) return invoice.customerCode;
    if (invoice.CustomerCode) return invoice.CustomerCode;
    if (invoice.customer_code) return invoice.customer_code;
    const custId = override?.customerId ?? invoice.customerId ?? invoice.CustomerId;
    const c = this.getCustomer(custId);
    if (c) return c.customerCode || c.code || 'NO CODE';
    return custId ? 'NO CODE' : 'CASH000001';
  }

  getInvoiceCustomerName(invoice: any): string {
    if (!invoice) return '';
    const override = this.getCustomerOverride(invoice.id);
    if (override?.customerName) return override.customerName;
    const custId = override?.customerId ?? invoice.customerId ?? invoice.CustomerId;
    const c = this.getCustomer(custId);
    if (c?.name) return c.name;
    return invoice.customerName || invoice.CustomerName || (custId ? ('Customer #' + custId) : 'Walk-in Cash');
  }

  getCustomerName(id: any) {
    const c = this.getCustomer(id);
    return c ? c.name : (id ? ('Customer #' + id) : 'Walk-in Cash');
  }

  getCustomer(id: any) {
    return this.customers.find((c: any) => c.id == id);
  }

  getCustomerFullAddress(id: any): string {
    const c = this.getCustomer(id);
    if (!c) return '';
    
    // Check for branch data
    const branch = (c.branches && c.branches.length > 0) 
      ? (c.branches.find((b: any) => b.isDefaultBranch) || c.branches[0]) 
      : null;
      
    if (branch) {
      const parts = [branch.address1, branch.city, branch.postcode, branch.state].filter(p => !!p);
      return parts.join(', ');
    }
    
    return c.address || '';
  }

  getCustomerFullAddressHtml(id: any): string {
    const c = this.getCustomer(id);
    if (!c) return '';
    
    const branch = (c.branches && c.branches.length > 0) 
      ? (c.branches.find((b: any) => b.isDefaultBranch) || c.branches[0]) 
      : null;
      
    if (branch) {
      const addr1 = branch.address1 || '';
      const city = branch.city || '';
      const postcode = branch.postcode || '';
      const state = branch.state || '';
      
      let lines = [];
      if (addr1) lines.push(addr1);
      const line2 = [city, postcode, state].filter(p => !!p).join(', ');
      if (line2) lines.push(line2);
      
      return lines.map(l => `<div style="margin-top:2px;">${l}</div>`).join('');
    }
    
    return c.address ? `<div style="margin-top:2px;">${c.address}</div>` : '';
  }

  getProductName(id: any) {
    const p = this.products.find((p: any) => p.id == id);
    return p ? p.name : 'Product #' + id;
  }

  getFormTotal(): number {
    if (!this.form.items || this.form.items.length === 0) return 0;
    const total = this.form.items.reduce((sum: number, item: any) => {
      return sum + ((item.unitPrice || 0) * (item.quantity || 0));
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  getEditFormTotal(): number {
    if (!this.editForm.items || this.editForm.items.length === 0) {
      return Number(this.selectedInvoice?.totalAmount || this.selectedInvoice?.TotalAmount || 0);
    }
    const total = this.editForm.items.reduce((sum: number, item: any) => {
      return sum + ((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0));
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  getEditFormTotalProducts(): number {
    return (this.editForm.items || []).length;
  }

  getCreditNoteId(cn: any): number | null {
    const id = cn?.id ?? cn?.Id;
    return id != null ? Number(id) : null;
  }

  toggleCreditSelection(cn: any) {
    const cnId = this.getCreditNoteId(cn);
    if (cnId == null) return;
    if (this.selectedCreditNoteId == cnId) {
      this.selectedCreditNoteId = null;
      this.form.useCreditBalance = false;
      this.termType = 'CASH SALE';
      this.onTermTypeChange();
    } else {
      if (!this.isCreditUsable(cn.amount)) {
        this.showToastMsg('Invoice total must be RM ' + cn.amount.toFixed(2) + ' or more to use this Credit Note');
        return;
      }
      this.selectedCreditNoteId = cnId;
      this.form.useCreditBalance = true;
      this.onTermTypeChange();
    }
  }

  getSelectedCreditAmount(): number {
    if (!this.selectedCreditNoteId) return 0;
    const cn = this.availableCredits.find(c => this.getCreditNoteId(c) == this.selectedCreditNoteId);
    return cn ? Math.round((cn.amount + Number.EPSILON) * 100) / 100 : 0;
  }

  getCustomerDiscount(): number {
    const c: any = this.selectedCustomerDetail;
    if (c && (c.enableDiscount === false || c.EnableDiscount === false)) return 0;
    return c?.discountPercent || c?.discount || c?.DiscountPercent || 0;
  }

  getOriginalUnitPrice(productId: any): number {
    const product = this.allProducts.find(p => p.id == productId);
    return product ? product.price : 0;
  }

  getCustomerSpecialPrice(productId: any): number | null {
    if (!this.customerProductPrices || this.customerProductPrices.length === 0) return null;
    const special = this.customerProductPrices.find(p => p.productId == productId);
    return special ? special.specialPrice : null;
  }

  getOriginalTotal(): number {
    if (!this.form.items || this.form.items.length === 0) return 0;
    const total = this.form.items.reduce((sum: number, item: any) => {
      return sum + (this.getOriginalUnitPrice(item.productId) * (item.quantity || 0));
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  getBaseTotal(): number {
    if (!this.form.items || this.form.items.length === 0) return 0;
    const total = this.form.items.reduce((sum: number, item: any) => {
      const product = this.allProducts.find(p => p.id == item.productId);
      if (!product) return sum;
      const specialPrice = this.customerProductPrices.find(p => p.productId == item.productId);
      const basePrice = specialPrice ? specialPrice.specialPrice : product.price;
      return sum + (basePrice * (item.quantity || 0));
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  getDiscountAmount(): number {
    const base = this.getBaseTotal();
    const discounted = this.getFormTotal();
    return Math.round((base - discounted + Number.EPSILON) * 100) / 100;
  }

  getNetTotal(): number {
    const gross = this.getFormTotal();
    const credit = this.getApplicableCreditAmount();
    const net = gross - credit;
    return net > 0 ? Math.round((net + Number.EPSILON) * 100) / 100 : 0;
  }

  isCreditInvalid(): boolean {
    return false; // ✅ 允许点数比物价多，反正后端会只扣需要的部分
  }

  isCreditUsable(creditAmount: number): boolean {
    const total = this.getFormTotal();
    return total > 0;
  }

  isStockInsufficient(item: any): boolean {
    return false;
  }

  getProductStock(productId: any): number {
    const product = this.allProducts.find(p => p.id == productId);
    return product ? product.stock : 0;
  }

  hasAnyStockIssue(): boolean {
    const items = this.isEditing ? this.editForm.items : this.form.items;
    return items.some((item: any) => this.isStockInsufficient(item));
  }

  noLeadingZero(event: KeyboardEvent, val: any) {
    if ((val === 0 || val === '' || val === null || val === undefined) && event.key === '0') {
      event.preventDefault();
    }
  }

  formatAmountPaid() {
    if (this.amountPaid) {
      this.amountPaid = Math.round((this.amountPaid + Number.EPSILON) * 100) / 100;
    }
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goBack() { this.navCtrl.navigateRoot('pages/billing'); }

  openCheckPreview() {
    if (!this.selectedInvoice) return;
    this.api.previewInvoice(this.selectedInvoice.id).subscribe({
      next: (data: any) => { this.previewData = data; this.showCheckPreview = true; },
      error: () => { this.previewData = null; this.showCheckPreview = true; }
    });
  }

  closeLivePreview() {
    this.showCheckPreview = false;
    this.previewData = null;
  }

  downloadReceipt() {
    this.loadPrinterSettings();

    // 针对离线发票，若尚未加载过 previewData，则自动现场生成
    if (this.selectedInvoice?.isOffline && !this.previewData) {
      this.previewData = {
        id: this.selectedInvoice.id,
        invoiceNumber: this.selectedInvoice.invoiceNumber,
        docNo: this.selectedInvoice.docNo,
        invoiceDate: this.selectedInvoice.invoiceDate,
        customerId: this.selectedInvoice.customerId,
        customerName: this.selectedInvoice.customerName,
        totalAmount: this.selectedInvoice.totalAmount,
        paidAmount: this.selectedInvoice.paidAmount,
        balance: this.selectedInvoice.balance,
        termType: this.selectedInvoice.termType,
        items: this.selectedInvoice.items,
        isOffline: true
      };
    }

    if (this.printerSettings?.printerInterface === 'Bluetooth' && this.btPrint.isAvailable()) {
      this.btPrint.printInvoice(this.selectedInvoice, this.previewData, this.printerSettings, this.customers, this.allProducts);
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
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: ${width}; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .due-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; } .due-label { display: block; font-size: 10px; letter-spacing: 3px; color: #888; margin-bottom: 6px; } .due-date { font-size: 18px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; } .cn-header { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #1a1a1a; margin: 8px 0; } .cn-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; } .cn-number { font-weight: 700; } .cn-amount { font-weight: 700; color: #1a1a1a; } .cn-deduct { color: #1a1a1a; font-weight: 700; }</style>`;

    const inv = this.selectedInvoice;
    const pd = this.previewData;
    const items = pd?.items || inv?.items || [];

    // 1. 公司抬头的条件化拼接
    let companyHeaderHtml = '';
    if (this.isOptionEnabled('Print Company Logo')) {
      companyHeaderHtml = `
        <div class="company">${pd?.companyName || 'B JAYA TRADING'}</div>
        <span class="co-reg">(${pd?.companyReg || '001188861-T'})</span>
        <span class="address">${pd?.companyAddress || 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,'}</span>
        <span class="address">${pd?.companyCity || '70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA'}</span>
        <span class="contact">TEL: ${pd?.companyTel || '012-6988080'} GST: ${pd?.companyGst || '000134806856'}</span>
      `;
    }

    // 2. 发件日期的条件化拼接
    const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
    const dateStr = invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    let dateHtml = '';
    if (this.isOptionEnabled('Print Issue Time')) {
      dateHtml = `<div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div>`;
    }

    // 3. 客户信息（电话与地址）条件化拼接
    let customerBoxHtml = '';
    if (this.isOptionEnabled('Print Customer Tel') || this.isOptionEnabled('Print Customer Add')) {
      let telHtml = '';
      let addrHtml = '';
      const c = this.getCustomer(inv?.customerId);
      if (c) {
        if (this.isOptionEnabled('Print Customer Tel') && c.phone) {
          telHtml = `<div style="margin-top:2px; font-weight:bold;">TEL: ${c.phone}</div>`;
        }
        if (this.isOptionEnabled('Print Customer Add')) {
          addrHtml = this.getCustomerFullAddressHtml(inv?.customerId);
        }
      }
      customerBoxHtml = `
        <div class="to-section">
          <span class="to-label">TO:</span>
          <div class="to-box">
            <strong>${inv?.customerName || this.getCustomerName(inv?.customerId)}</strong>
            ${telHtml}
            ${addrHtml}
          </div>
        </div>
      `;
    }

    // 4. 商品明细（支持商品编码/UOM开关）
    let itemsHtml = '';
    items.forEach((item: any, i: number) => {
      const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
      let prodName = item.productName || this.getProductName(item.productId);
      if (this.isOptionEnabled('Print Item Code')) {
        const product = this.allProducts.find(p => p.id == item.productId);
        const code = product?.productCode || product?.code || '';
        if (code) {
          prodName = `[${code}] ${prodName}`;
        }
      }
      const uom = this.isOptionEnabled('Print Item U.O.M.') ? ` (${item.uom || 'UNIT'})` : '';
      const remarkHtml = item.remark ? `<div style="font-size:10px; color:#555; font-style:italic; margin-top:2px;">* ${item.remark}</div>` : '';
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${prodName}${uom}</span><span>[${item.taxType || 'SR'}]</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>${subtotal}</span></div>${remarkHtml}</div>`;
    });

    const dueStr = pd?.paymentDue || invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const cns = this.getReceiptCreditNotes();
    
    const changeCNs = cns.filter((cn: any) => (cn.cnNumber || '').startsWith('CN-CHG'));
    const returnCNs = cns.filter((cn: any) => !(cn.cnNumber || '').startsWith('CN-CHG'));
    
    const totalChange = changeCNs.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
    const totalReturns = returnCNs.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);

    const returnsHtml = totalReturns > 0 ? `<div class="total-row cn-deduct"><span>RETURNS (CN)</span><span>- RM ${totalReturns.toFixed(2)}</span></div>` : '';
    const changeRowHtml = totalChange > 0 ? `<div class="total-row" style="color:#888;font-style:italic;"><span>CHANGE SAVED AS CREDIT</span><span>+ RM ${totalChange.toFixed(2)}</span></div>` : '';

    let cnListHtml = '';
    if (cns.length > 0) {
      cnListHtml = `<div class="divider-thin"></div><div class="cn-header">TRANSACTION DETAILS</div>`;
      cns.forEach((cn: any) => {
        const isCHG = (cn.cnNumber || '').startsWith('CN-CHG');
        const label = isCHG ? 'CHANGE SAVED' : 'RETURNED';
        cnListHtml += `<div class="cn-row"><span class="cn-number">${cn.cnNumber || 'CN-' + cn.id} [${label}]</span><span class="cn-amount">- RM ${(cn.amount || 0).toFixed(2)}</span></div>`;
        if (cn.items && cn.items.length > 0) {
          cn.items.forEach((item: any) => {
            cnListHtml += `<div style="font-size:10px;color:#666;padding-left:20px;margin-bottom:2px;">• ${item.productName} (${item.quantity} x ${item.unitPrice.toFixed(2)})</div>`;
          });
        }
      });
    }

    const netAmount = this.getReceiptNetAmount();
    const balance = this.getReceiptBalance();
    const displayedPaid = (inv?.paidAmount || 0) + totalChange;
    const paymentStatus = inv?.status === 'Paid' ? 'PAID' : inv?.status === 'Partial' ? 'PARTIALLY PAID' : 'UNPAID';
    
    const paymentDetailHtml = `<div style="padding:8px 20px;border:1px dashed #ddd;border-top:none;border-radius:0 0 8px 8px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>PAID AMOUNT</span><span>RM ${displayedPaid.toFixed(2)}</span></div>
        ${changeRowHtml}
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:6px 0 3px;border-top:1px solid #eee;margin-top:4px;"><span>BALANCE</span><span>RM ${balance.toFixed(2)}</span></div>
    </div>`;

    // 5. 期限日期条件化
    let termDateHtml = '';
    if (this.isOptionEnabled('Print Term Date')) {
      termDateHtml = `<div class="due-box"><span class="due-label">PAYMENT DUE</span><span class="due-date">${dueStr}</span></div>`;
    }

    // 6. 签收栏条件化（根据发票类型动态决定渲染）
    let sigBoxHtml = '';
    const showCashSig = inv?.termType === 'CASH SALE' && this.isOptionEnabled('Sign on Cash Invoice');
    const showCreditSig = inv?.termType === 'On Credit' && this.isOptionEnabled('Sign on Credit Invoice');
    const showCNSig = (totalReturns > 0) && this.isOptionEnabled('Sign on Credit Note');
    const showPaymentSig = (inv?.paidAmount > 0) && this.isOptionEnabled('Sign on Payment');

    if (showCashSig || showCreditSig || showCNSig || showPaymentSig) {
      let sigLabelText = 'SIGNATURE';
      if (showCashSig) sigLabelText = 'CASH RECEIVED SIGNATURE';
      else if (showCreditSig) sigLabelText = 'CREDIT RECEIVED SIGNATURE';
      else if (showCNSig) sigLabelText = 'CREDIT NOTE RECEIVED SIGNATURE';
      else if (showPaymentSig) sigLabelText = 'PAYMENT RECEIVED SIGNATURE';

      sigBoxHtml = `<div class="sig-box"><span class="sig-label">${sigLabelText}</span></div>`;
    }

    // 7. 页脚条件化
    let footerHtml = '';
    if (this.isOptionEnabled('Footer')) {
      footerHtml = `<div class="thanks">THANK YOU</div>`;
    }

    // 8. 底部安全留空行数处理
    let emptyLinesHtml = '';
    const linesCount = this.printerSettings?.bottomEmptyLine ?? 5;
    for (let l = 0; l < linesCount; l++) {
      emptyLinesHtml += `<div style="height: 20px;"></div>`;
    }

    const docNo = this.getDocNo(inv);
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${docNo}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">TAX INVOICE</span><div class="divider"></div>${companyHeaderHtml}<div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">DOC NO</span><span class="doc-value">: ${docNo}</span></div>${dateHtml}</div>${customerBoxHtml}<div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>GST SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div><div class="total-row"><span>GROSS TOTAL</span><span>RM ${(inv?.totalAmount || 0).toFixed(2)}</span></div>${returnsHtml}${cnListHtml}<div class="net-bar"><span class="net-label">NET AMOUNT</span><span class="net-value">RM ${netAmount.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;padding:12px 20px;border:1px dashed #ddd;border-radius:8px;margin-bottom:0;"><span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#888;">PAYMENT STATUS</span><span style="font-size:14px;font-weight:800;">${paymentStatus}</span></div>${paymentDetailHtml}${termDateHtml}${sigBoxHtml}${footerHtml}${emptyLinesHtml}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }

  getMYSDate() {
    const now = new Date();
    // Offset for Malaysia is UTC+8
    const mysOffset = 8 * 60 * 60 * 1000;
    const localNow = new Date(now.getTime() + mysOffset);
    return localNow.toISOString().split('.')[0];
  }

  formatAmountPaidDisplay(val: any): string {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val).toFixed(2);
  }

  onAmountPaidInput(event: any) {
    let inputVal = event.target.value;
    let digits = inputVal.replace(/\D/g, '');
    let amount = 0;
    if (digits) {
      amount = parseInt(digits, 10) / 100;
    }
    this.amountPaid = amount;
    event.target.value = amount.toFixed(2);
    
    // Force cursor to the end
    setTimeout(() => {
      if (event.target) {
        const len = event.target.value.length;
        event.target.setSelectionRange(len, len);
      }
    }, 0);
  }

  onAmountPaidFocus(event: any) {
    setTimeout(() => {
      if (event.target) {
        const len = event.target.value.length;
        event.target.setSelectionRange(len, len);
      }
    }, 0);
  }
} 