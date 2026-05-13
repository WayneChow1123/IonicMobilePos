import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute } from '@angular/router';

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
  isEditing = false;
  isEditMode = false;
  selectedInvoice: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  selectedCustomerDetail: any = null;
  showCheckPreview = false;
  previewData: any = null;
  form: any = { customerId: 0, invoiceDate: new Date().toISOString(), remark: '', useCreditBalance: false, items: [] };
  editForm: any = { invoiceDate: new Date().toISOString(), remark: '', items: [{ productId: 0, quantity: 1, unitPrice: 0 }] };
  showStockAlert = false;
  stockIssues: any[] = [];
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteInvoice() }
  ];

  constructor(private router: Router, private route: ActivatedRoute, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}

  ionViewWillEnter() {
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
      error: () => {}
    });
  }

  loadProducts() {
    this.api.getProducts().subscribe({
      next: (res) => {
        const all = Array.isArray(res) ? res : [];
        this.products = all.filter((p: any) => p.stock > 0 && p.isActive !== false);
      },
      error: () => {}
    });
  }

  loadAllProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.allProducts = (Array.isArray(res) ? res : []).filter((p: any) => p.isActive !== false); },
      error: () => {}
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
    this.filteredInvoices = this.invoices.filter(inv =>
      (inv.invoiceNumber || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      (inv.customerName || '').toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  onCustomerChange() {
    if (this.form.customerId) {
      const customer = this.customers.find((c: any) => c.id == this.form.customerId);
      this.selectedCustomerDetail = customer || null;
      this.form.useCreditBalance = false;
      this.selectedCreditNoteId = null;
      this.availableCredits = [];
      this.loadAvailableCredits(Number(this.form.customerId));
      this.applyCustomerDiscount();
    }
  }

  applyCustomerDiscount() {
    if (!this.selectedCustomerDetail) return;
    const discount = this.selectedCustomerDetail.discountPercent || this.selectedCustomerDetail.discount || 0;
    this.form.items.forEach((item: any) => {
      const product = this.allProducts.find(p => p.id == item.productId);
      if (product) {
        item.unitPrice = product.price * (1 - (discount / 100));
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
    const existingItem = this.form.items.find((i: any) => i.productId === product.id);
    if (existingItem) {
      existingItem.quantity += 1;
      this.showToastMsg('Increased quantity for ' + product.name);
    } else {
      const discount = this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
      const discountedPrice = product.price * (1 - (discount / 100));
      const newItem = {
        productId: product.id,
        productName: product.name,
        unitPrice: discountedPrice,
        quantity: 1,
        remark: ''
      };
      this.form.items.push(newItem);
    }
    this.showProductSelector = false;
  }


  onProductChange(item: any) {
    const product = this.products.find((p: any) => p.id == item.productId);
    if (product) item.unitPrice = product.price;
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
    this.form = {
      customerId: 0,
      invoiceDate: new Date().toISOString(),
      remark: '',
      useCreditBalance: false,
      items: []
    };
    if (this.customers.length > 0) {
      this.loadAvailableCredits(Number(this.customers[0].id));
    }
    this.showModal = true;
  }

  openEditModal(invoice: any) {
    this.isEditing = true;
    this.isEditMode = false;
    this.selectedInvoice = null;
    this.isLoading = true;
    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.isLoading = false;
        this.selectedInvoice = { ...res, customerName: res.customerName || invoice.customerName, customerId: res.customerId ?? invoice.customerId };
        this.editForm = {
          invoiceDate: res.invoiceDate || new Date().toISOString(),
          remark: res.remark || '',
          items: (res.items && res.items.length > 0)
            ? res.items.map((i: any) => ({ productId: i.productId || 0, quantity: i.quantity || 1, unitPrice: i.unitPrice || 0, productName: i.productName || '' }))
            : [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0, productName: '' }]
        };
        this.showModal = true;
      },
      error: () => {
        this.isLoading = false;
        this.selectedInvoice = invoice;
        this.editForm = { invoiceDate: invoice.invoiceDate || new Date().toISOString(), remark: invoice.remark || '', items: [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0, productName: '' }] };
        this.showModal = true;
      }
    });
  }

  closeModal() { 
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
  }

  openPaymentCollection() {
    const net = this.getNetTotal();
    if (this.form.useCreditBalance && net <= 0) {
      // Full credit payment
      this.amountPaid = 0;
      this.saveInvoice();
      return;
    }
    this.amountPaid = net;
    this.showPaymentCollection = true;
  }

  getChangeToReturn() {
    const total = this.getNetTotal();
    const paid = Number(this.amountPaid) || 0;
    const change = paid - total;
    return change > 0 ? change : 0;
  }

  confirmPayment() {
    // Here we would call the actual save logic
    this.saveInvoice();
    this.showPaymentCollection = false;
  }

  saveInvoice() {
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
      if (this.isCreditInvalid()) {
        this.showToastMsg('Invoice total is less than the selected Credit Note amount');
        return;
      }
      const payload = { 
        ...this.form, 
        selectedCreditNoteId: this.form.useCreditBalance ? this.selectedCreditNoteId : null,
        paidAmount: this.amountPaid,
        paymentMethod: this.paymentMethod,
        termType: this.termType
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

  confirmDelete(invoice: any) { this.selectedInvoice = invoice; this.alertService.confirm('Delete Invoice', 'Delete ' + (invoice.invoiceNumber || 'INV-'+invoice.id) + '?').then(c => { if(c) this.deleteInvoice(); }); }

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
    return this.selectedInvoice.creditNotes
      .filter((cn: any) => !cn.createdAfterPayment)
      .reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getReceiptCreditNotes(): any[] {
    if (!this.selectedInvoice?.creditNotes) return [];
    return this.selectedInvoice.creditNotes.filter((cn: any) => !cn.createdAfterPayment);
  }

  getReceiptTotalCN(): number {
    return this.getReceiptCreditNotes().reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
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

  getProductName(id: any) {
    const p = this.products.find((p: any) => p.id == id);
    return p ? p.name : 'Product #' + id;
  }

  getFormTotal(): number {
    if (!this.form.items || this.form.items.length === 0) return 0;
    return this.form.items.reduce((sum: number, item: any) => {
      return sum + ((item.unitPrice || 0) * (item.quantity || 0));
    }, 0);
  }

  toggleCreditSelection(cn: any) {
    if (this.selectedCreditNoteId === cn.id) {
      this.selectedCreditNoteId = null;
      this.form.useCreditBalance = false;
    } else {
      if (!this.isCreditUsable(cn.amount)) {
        this.showToastMsg('Invoice total must be RM ' + cn.amount.toFixed(2) + ' or more to use this Credit Note');
        return;
      }
      this.selectedCreditNoteId = cn.id;
      this.form.useCreditBalance = true;
    }
  }

  getSelectedCreditAmount(): number {
    if (!this.form.useCreditBalance || !this.selectedCreditNoteId) return 0;
    const cn = this.availableCredits.find(c => c.id === this.selectedCreditNoteId);
    return cn ? cn.amount : 0;
  }

  getCustomerDiscount(): number {
    return this.selectedCustomerDetail?.discountPercent || this.selectedCustomerDetail?.discount || 0;
  }

  getOriginalUnitPrice(productId: any): number {
    const product = this.allProducts.find(p => p.id == productId);
    return product ? product.price : 0;
  }

  getOriginalTotal(): number {
    if (!this.form.items || this.form.items.length === 0) return 0;
    return this.form.items.reduce((sum: number, item: any) => {
      return sum + (this.getOriginalUnitPrice(item.productId) * (item.quantity || 0));
    }, 0);
  }

  getDiscountAmount(): number {
    const original = this.getOriginalTotal();
    const discounted = this.getFormTotal();
    return original - discounted;
  }

  getNetTotal(): number {
    const gross = this.getFormTotal();
    const credit = this.getSelectedCreditAmount();
    const net = gross - credit;
    return net > 0 ? net : 0;
  }

  isCreditInvalid(): boolean {
    if (!this.form.useCreditBalance || !this.selectedCreditNoteId) return false;
    const creditAmount = this.getSelectedCreditAmount();
    const gross = this.getFormTotal();
    return gross < creditAmount;
  }

  isCreditUsable(creditAmount: number): boolean {
    const total = this.getFormTotal();
    return total > 0 && creditAmount <= total;
  }

  isStockInsufficient(item: any): boolean {
    const product = this.allProducts.find(p => p.id == item.productId);
    if (!product) return false;
    return (item.quantity || 0) > (product.stock || 0);
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
    const printWindow = window.open('', '_blank');
    if (!printWindow) { this.showToastMsg('Please allow pop-ups to download'); return; }
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .due-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; } .due-label { display: block; font-size: 10px; letter-spacing: 3px; color: #888; margin-bottom: 6px; } .due-date { font-size: 18px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; } .cn-header { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #1a1a1a; margin: 8px 0; } .cn-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; } .cn-number { font-weight: 700; } .cn-amount { font-weight: 700; color: #1a1a1a; } .cn-deduct { color: #1a1a1a; font-weight: 700; }</style>`;
    const inv = this.selectedInvoice;
    const pd = this.previewData;
    const items = pd?.items || inv?.items || [];
    let itemsHtml = '';
    items.forEach((item: any, i: number) => {
      const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
      const prodName = item.productName || this.getProductName(item.productId);
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${prodName} (${item.uom || 'UNIT'})</span><span>[${item.taxType || 'SR'}]</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>${subtotal}</span></div></div>`;
    });
    const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
    const dateStr = invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dueStr = pd?.paymentDue || invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const cns = this.getReceiptCreditNotes();
    const totalCN = this.getReceiptTotalCN();
    const cnHtml = totalCN > 0 ? `<div class="total-row cn-deduct"><span>CREDIT NOTE</span><span>- RM ${totalCN.toFixed(2)}</span></div>` : '';
    let cnListHtml = '';
    if (cns.length > 0) {
      cnListHtml = `<div class="divider-thin"></div><div class="cn-header">CREDIT NOTE(S)</div>`;
      cns.forEach((cn: any) => {
        cnListHtml += `<div class="cn-row"><span class="cn-number">${cn.cnNumber || 'CN-' + cn.id}${cn.reason ? ' (' + cn.reason + ')' : ''}</span><span class="cn-amount">- RM ${(cn.amount || 0).toFixed(2)}</span></div>`;
      });
    }
    const netAmount = (inv?.totalAmount || 0) - totalCN;
    const paidAmount = inv?.paidAmount || 0;
    const paymentStatus = inv?.status === 'Paid' ? 'PAID' : inv?.status === 'Partial' ? 'PARTIALLY PAID' : 'UNPAID';
    const paymentDetailHtml = inv?.status === 'Partial' ? `<div style="padding:8px 20px;border:1px dashed #ddd;border-top:none;border-radius:0 0 8px 8px;margin-bottom:16px;"><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:3px 0;"><span>PAID</span><span>RM ${paidAmount.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;padding:6px 0 3px;border-top:1px solid #eee;margin-top:4px;"><span>BALANCE</span><span>RM ${(netAmount - paidAmount).toFixed(2)}</span></div></div>` : '';
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv?.invoiceNumber || ''}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">TAX INVOICE</span><div class="divider"></div><div class="company">${pd?.companyName || 'B JAYA TRADING'}</div><span class="co-reg">(${pd?.companyReg || '001188861-T'})</span><span class="address">${pd?.companyAddress || 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,'}</span><span class="address">${pd?.companyCity || '70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA'}</span><span class="contact">TEL: ${pd?.companyTel || '012-6988080'} GST: ${pd?.companyGst || '000134806856'}</span><div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">DOC NO</span><span class="doc-value">: ${inv?.invoiceNumber || 'S001-' + inv?.id}</span></div><div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div></div><div class="to-section"><span class="to-label">TO:</span><div class="to-box"><strong>${inv?.customerName || this.getCustomerName(inv?.customerId)}</strong></div></div><div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>GST SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div><div class="total-row"><span>GROSS TOTAL</span><span>RM ${(inv?.totalAmount || 0).toFixed(2)}</span></div>${cnHtml}${cnListHtml}<div class="net-bar"><span class="net-label">NET AMOUNT</span><span class="net-value">RM ${netAmount.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;padding:12px 20px;border:1px dashed #ddd;border-radius:8px;margin-bottom:0;"><span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#888;">PAYMENT STATUS</span><span style="font-size:14px;font-weight:800;">${paymentStatus}</span></div>${paymentDetailHtml}<div class="due-box"><span class="due-label">PAYMENT DUE</span><span class="due-date">${dueStr}</span></div><div class="sig-box"><span class="sig-label">SIGNATURE</span></div><div class="thanks">THANK YOU</div></div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}

