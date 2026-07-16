import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute } from '@angular/router';
import { BluetoothPrintService } from '../../services/bluetooth-print.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-invoices',
  templateUrl: './invoices.page.html',
  styleUrls: ['./invoices.page.scss'],
})
export class InvoicesPage implements OnInit {
  invoices: any[] = [];
  filteredInvoices: any[] = [];
  customers: any[] = [];
  products: any[] = [];
  allProducts: any[] = [];
  availableCredits: any[] = [];
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
  editForm: any = { invoiceDate: this.getMYSDate(), remark: '', items: [{ productId: 0, quantity: 1, unitPrice: 0 }] };
  showStockAlert = false;
  stockIssues: any[] = [];
  showAvailableCredits = true;
  showInvoiceRemark = false;
  showActionsDropdown = false;

  printerSettings: any = null;

  loadPrinterSettings() {
    const saved = localStorage.getItem('printerSettings');
    if (saved) {
      try {
        this.printerSettings = JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    if (!this.printerSettings) {
      this.printerSettings = {
        paperWidth: 80,
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
          { name: 'Footer', enabled: true }
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
    const product = this.allProducts.find(p => p.id == productId);
    return product?.productCode || product?.code || '';
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
      .filter(inv => inv.status === 'Paid')
      .reduce((sum, inv) => sum + (inv.netTotal || inv.NetTotal || inv.totalAmount || 0), 0);
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

  constructor(private router: Router, private route: ActivatedRoute, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService, private btPrint: BluetoothPrintService) { }

  ionViewWillEnter() {
    this.loadPrinterSettings();
    this.cdr.detectChanges();
  }

  ngOnInit() {
    this.loadInvoices();
    this.loadCustomers();
    this.loadProducts();
    this.loadAllProducts();

    // Check for query parameters to auto-open form
    this.route.queryParams.subscribe(params => {
      if (params['action'] === 'new') {
        this.isDirectEntry = true;
        this.openAddModal();
      } else {
        this.isDirectEntry = false;
      }
    });
  }

  loadInvoices() {
    this.isLoading = true;
    this.api.getInvoices().subscribe({
      next: (res) => { this.invoices = Array.isArray(res) ? res : []; this.filteredInvoices = [...this.invoices]; this.isLoading = false; },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load invoices'); }
    });
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => {
        this.customers = Array.isArray(res) ? res : [];
        this.filteredCustomers = [...this.customers];
      },
      error: () => { }
    });
  }

  loadProducts() {
    this.api.getProducts().subscribe({
      next: (res) => {
        const all = Array.isArray(res) ? res : [];
        this.products = all.filter((p: any) => p.isActive !== false);
      },
      error: () => { }
    });
  }

  loadAllProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.allProducts = (Array.isArray(res) ? res : []).filter((p: any) => p.isActive !== false); },
      error: () => { }
    });
  }

  loadAvailableCredits(customerId: number) {
    this.api.getAvailableCredits(customerId).subscribe({
      next: (res: any) => { this.availableCredits = Array.isArray(res) ? res : []; },
      error: () => { this.availableCredits = []; }
    });
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredInvoices = [...this.invoices]; }
  }

  filterInvoices() {
    const term = this.searchTerm.toLowerCase();
    this.filteredInvoices = this.invoices.filter(inv => {
      // Search term filtering
      const matchesSearch = (inv.invoiceNumber || '').toLowerCase().includes(term) ||
        (inv.customerName || '').toLowerCase().includes(term);

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
        this.applyCustomerDiscount();
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

  selectCustomer(customer: any) {
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
    const term = this.productSearchTerm.toLowerCase();
    this.filteredProductsForSelection = this.products.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.code || '').toLowerCase().includes(term)
    );
  }

  selectProduct(product: any) {
    const existingItem = this.form.items.find((i: any) => i.productId == product.id);
    if (existingItem) {
      existingItem.quantity += 1;
      this.showToastMsg('Increased quantity for ' + product.name);
    } else {
      const discount = this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
      const specialPrice = this.customerProductPrices.find(p => p.productId == product.id);
      const basePrice = specialPrice ? specialPrice.specialPrice : product.price;
      const finalPrice = basePrice * (1 - (discount / 100));
      const newItem = {
        productId: product.id,
        productName: product.name,
        unitPrice: finalPrice,
        quantity: 1,
        remark: ''
      };
      this.form.items.push(newItem);
    }
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

  getCustomerCreditBalance(): number {
    if (!this.selectedCustomerDetail) return 0;
    return this.selectedCustomerDetail.creditBalance || 0;
  }

  openAddModal() {
    this.isEditing = false;
    this.isEditMode = true;
    this.selectedInvoice = null;
    this.selectedCustomerDetail = this.customers.length > 0 ? this.customers[0] : null;
    this.selectedCreditNoteId = null;
    this.availableCredits = [];
    this.customerProductPrices = [];
    const firstCustomerId = this.customers.length > 0 ? Number(this.customers[0].id) : 0;
    this.form = {
      customerId: firstCustomerId,
      invoiceDate: this.getMYSDate(),
      remark: '',
      useCreditBalance: false,
      items: []
    };
    if (this.customers.length > 0) {
      this.loadAvailableCredits(firstCustomerId);
      this.loadCustomerProductPrices(firstCustomerId);
    }
    this.showModal = true;
  }

  openEditModal(invoice: any) {
    this.showActionsDropdown = false;
    this.isEditing = true;
    this.isEditMode = false;
    this.selectedInvoice = null;
    this.isLoading = true;
    this.selectedCustomerDetail = this.customers.find(c => c.id === invoice.customerId);

    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.isLoading = false;
        this.selectedInvoice = { ...res, customerName: res.customerName || invoice.customerName, customerId: res.customerId ?? invoice.customerId };
        const customerId = Number(res.customerId ?? invoice.customerId);
        if (customerId) {
          this.loadCustomerProductPrices(customerId);
        }
        this.editForm = {
          invoiceDate: res.invoiceDate || this.getMYSDate(),
          remark: res.remark || '',
          items: ((res.items || res.Items) && (res.items || res.Items).length > 0)
            ? (res.items || res.Items).map((i: any) => ({
              productId: i.productId ?? i.ProductId ?? 0,
              quantity: i.quantity ?? i.Quantity ?? 1,
              unitPrice: i.unitPrice ?? i.UnitPrice ?? 0,
              productName: i.productName ?? i.ProductName ?? '',
              returnedQuantity: i.returnedQuantity ?? i.ReturnedQuantity ?? 0,
              remark: i.remark ?? i.Remark ?? ''
            }))
            : [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0, productName: '', returnedQuantity: 0 }]
        };
        this.showModal = true;
      },
      error: (err) => {
        this.isLoading = false;
        console.error(err);
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
    return this.selectedInvoice?.customerId ? 'NO CODE' : 'CASH000001';
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
        customerId: custId
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
    }
  }

  addItem() {
    if (this.isEditing) {
      const defaultProduct = this.products.length > 0 ? this.products[0] : null;
      this.editForm.items.push({ productId: defaultProduct?.id || 0, quantity: 1, unitPrice: defaultProduct?.price || 0 });
    } else {
      this.form.items.push({ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1 });
    }
  }

  removeItem(index: number) {
    if (this.isEditing) {
      this.editForm.items.splice(index, 1);
    } else {
      this.form.items.splice(index, 1);
    }
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
      if (this.selectedInvoice.status === 'Paid') { this.showToastMsg('Invoice is fully paid and cannot be modified'); return; }
      this.api.updateInvoice(this.selectedInvoice.id, this.editForm).subscribe({
        next: () => { this.showToastMsg('Invoice updated!'); this.closeModal(); this.loadInvoices(); this.loadCustomers(); },
        error: (err: any) => this.handleInvoiceError(err)
      });
    } else {
      if (!this.form.customerId) { this.showToastMsg('Please select a customer'); return; }
      
      const useCredit = !!this.selectedCreditNoteId;
      const payload = {
        ...this.form,
        useCreditBalance: useCredit,
        selectedCreditNoteId: this.selectedCreditNoteId,
        paidAmount: this.amountPaid,
        paymentMethod: this.paymentMethod,
        termType: this.termType,
        status: (this.termType === 'Net 30 Days' || this.termType === 'On Credit') ? 'Unpaid' : 'Paid'
      };
      this.api.createInvoice(payload).subscribe({
        next: () => { this.showToastMsg('Invoice created!'); this.closeModal(); this.loadInvoices(); this.loadCustomers(); },
        error: (err: any) => this.handleInvoiceError(err)
      });
    }
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

  confirmDelete(invoice: any) { this.selectedInvoice = invoice; this.alertService.confirm('Delete Invoice', 'Delete ' + (invoice.invoiceNumber || 'INV-' + invoice.id) + '?').then(c => { if (c) this.deleteInvoice(); }); }

  deleteInvoice() {
    if (!this.selectedInvoice) return;
    this.api.deleteInvoice(this.selectedInvoice.id).subscribe({
      next: () => { this.showToastMsg('Invoice deleted!'); this.closeModal(); this.loadInvoices(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
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
    if (invoice.customerCode) return invoice.customerCode;
    if (invoice.CustomerCode) return invoice.CustomerCode;
    if (invoice.customer_code) return invoice.customer_code;
    const c = this.getCustomer(invoice.customerId);
    if (c) return c.customerCode || c.code || 'NO CODE';
    return invoice.customerId ? 'NO CODE' : 'CASH000001';
  }

  getCustomerName(id: any) {
    const c = this.getCustomer(id);
    return c ? c.name : 'Customer #' + id;
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
    return this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
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

  downloadReceipt() {
    this.loadPrinterSettings();
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

    const width = this.printerSettings?.paperWidth === 58 ? '360px' : '480px';
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

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv?.invoiceNumber || ''}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">TAX INVOICE</span><div class="divider"></div>${companyHeaderHtml}<div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">DOC NO</span><span class="doc-value">: ${inv?.invoiceNumber || 'S001-' + inv?.id}</span></div>${dateHtml}</div>${customerBoxHtml}<div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>GST SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div><div class="total-row"><span>GROSS TOTAL</span><span>RM ${(inv?.totalAmount || 0).toFixed(2)}</span></div>${returnsHtml}${cnListHtml}<div class="net-bar"><span class="net-label">NET AMOUNT</span><span class="net-value">RM ${netAmount.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;padding:12px 20px;border:1px dashed #ddd;border-radius:8px;margin-bottom:0;"><span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#888;">PAYMENT STATUS</span><span style="font-size:14px;font-weight:800;">${paymentStatus}</span></div>${paymentDetailHtml}${termDateHtml}${sigBoxHtml}${footerHtml}${emptyLinesHtml}</div></body></html>`);
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