import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AppComponent } from '../../app.component';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-billing',
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
})
export class BillingPage implements OnInit {
  ionViewWillEnter() {
    this.currentView = 'home';
    this.loadCustomers();
    this.loadAllInvoices();
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
  selectedInvoiceDetail: any = null;
  selectedCNInvoiceDetail: any = null;
  customerProductPrices: any[] = [];

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

  getSelectedCustomerDiscount(): number {
    if (!this.cnForm.customerId) return 0;
    const customer = this.customers.find((c: any) => c.id == this.cnForm.customerId);
    return customer ? (customer.discountPercent || customer.discount || 0) : 0;
  }

  getDiscountedPrice(price: number): number {
    const discount = this.getSelectedCustomerDiscount();
    if (discount <= 0) return price;
    return Math.round(price * (1 - discount / 100) * 100) / 100;
  }

  loadAllProducts() {
    this.isLoading = true;
    this.api.getProducts().subscribe({
      next: (res: any) => {
        this.allProducts = res || [];
        this.filteredProductsSelection = [...this.allProducts];
        this.showProductModal = true;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load products'); }
    });
  }

  filterProductsForSelection() {
    const term = this.productSearchTerm.toLowerCase();
    this.filteredProductsSelection = this.allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(term) ||
      (p.productCode || p.code || '').toLowerCase().includes(term)
    );
  }

  selectProduct(product: any) {
    this.showProductModal = false;

    // Check if item already exists in the list
    const found = this.cnForm.items.find((i: any) => i.productId === product.id);
    if (found) {
      found.returnQuantity += 1;
    } else {
      this.cnForm.items.push({
        productId: product.id,
        productName: product.name,
        maxQuantity: 9999, // Allow large return if selected from all products
        returnedQuantity: 0,
        returnQuantity: 0,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.cnForm.items = [...this.cnForm.items];
    this.showToastMsg(`Added ${product.name}`);
    this.cdr.detectChanges();
  }

  loadPurchaseHistory() {
    if (!this.cnForm.customerId || this.cnForm.customerId == 0) {
      this.showToastMsg('Please select a customer first');
      return;
    }
    this.isLoading = true;
    this.api.getCustomerPurchaseHistory(this.cnForm.customerId).subscribe({
      next: (res: any) => {
        this.purchaseHistory = res || [];
        this.filteredHistory = [...this.purchaseHistory];
        this.showHistoryModal = true;
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load history'); }
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
    this.cnForm.items = [...this.cnForm.items];
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
    private appComponent: AppComponent
  ) {}

  ionViewWillLeave() {
  }




  ngOnInit() { 
    this.loadCustomers(); 
    this.loadAllInvoices();

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
          this.onCNInvoiceChange();
        }, 300);
      }
    });
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
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

  loadCreditNotes() {
    this.isLoading = true;
    this.api.getAllCreditNotes().subscribe({
      next: (res) => { this.creditNotes = Array.isArray(res) ? res : []; this.filteredCreditNotes = [...this.creditNotes]; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  filterPayments() {
    this.filteredPayments = this.payments.filter(p =>
      (p.customerName || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.invoiceNumber || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase()) ||
      (p.referenceNo || '').toLowerCase().includes(this.paymentSearchTerm.toLowerCase())
    );
  }

  filterCreditNotes() {
    this.filteredCreditNotes = this.creditNotes.filter(cn =>
      (cn.cnNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
      (cn.invoiceNumber || '').toLowerCase().includes(this.cnSearchTerm.toLowerCase()) ||
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
        (inv.invoiceNumber || '').toLowerCase().includes(term)
      );
    }
    this.cdr.detectChanges();
  }

  openNewCN() {
    this.loadAllInvoices();
    this.cnForm = { customerId: 0, invoiceId: 0, reason: '', items: [] };
    this.cnFilteredInvoices = [...this.invoices];
    this.selectedCNInvoiceDetail = null;
    this.currentView = 'newCN';
  }

  openPaymentList() { this.paymentSearchTerm = ''; this.loadPayments(); this.currentView = 'paymentList'; }
  viewPaymentDetails(payment: any) {
    this.isLoading = true;
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
  openCNList() { this.cnSearchTerm = ''; this.loadCreditNotes(); this.currentView = 'cnList'; }

  onCustomerChange() {
    if (this.paymentForm.customerId) {
      this.loadInvoicesByCustomer(this.paymentForm.customerId);
      this.paymentForm.invoiceIds = [];
      this.selectedInvoicesList = [];
    }
  }

  onInvoiceChange() {
    // Legacy onInvoiceChange not needed for multiple selection.
  }

  onCNCustomerChange() {
    this.cnForm.invoiceId = 0;
    this.cnForm.items = [];
    this.selectedCNInvoiceDetail = null;
    if (this.cnForm.customerId && this.cnForm.customerId != 0) {
      this.cnFilteredInvoices = this.invoices.filter((inv: any) => inv.customerId == this.cnForm.customerId);
      this.loadCustomerProductPrices(Number(this.cnForm.customerId));
    } else {
      this.cnFilteredInvoices = [...this.invoices];
      this.customerProductPrices = [];
    }
  }

  onCNInvoiceChange() {
    if (this.cnForm.invoiceId && this.cnForm.invoiceId != 0) {
      this.api.getInvoiceDetails(Number(this.cnForm.invoiceId)).subscribe({
        next: (res: any) => {
          this.selectedCNInvoiceDetail = res;
          // ✅ 双重保险：优先取顶层 customerId，取不到就取 res.customer.id
          const cid = res.customerId || (res.customer ? res.customer.id : 0);
          this.cnForm.customerId = Number(cid); 
          this.loadCustomerProductPrices(Number(cid));
          this.cnForm.items = [];
          if (res.items && res.items.length > 0) {
            res.items.forEach((item: any) => {
              const remainingQty = item.quantity - (item.returnedQuantity || 0);
              if (remainingQty > 0) {
                this.cnForm.items.push({
                  productId: item.productId,
                  productName: item.productName,
                  maxQuantity: remainingQty,
                  returnedQuantity: item.returnedQuantity || 0,
                  returnQuantity: 0,
                  returnToStock: false
                });
              }
            });
          }
        },
        error: () => { this.selectedCNInvoiceDetail = null; }
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
    
    if (!this.cnForm.reason) { this.showToastMsg('Please enter reason'); return; }
    
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
      quantity: Number(i.returnQuantity),
      returnToStock: i.returnToStock
    }));

    const payload = { reason: this.cnForm.reason, items: payloadItems };

    // ✅ 智能切换：如果列表里有来自“历史记录”的商品，或者根本没选发票，就走全局接口
    const hasGlobalItems = itemsToReturn.some((i: any) => i.isGlobal);
    const useGlobalMode = !this.cnForm.invoiceId || this.cnForm.invoiceId == 0 || hasGlobalItems;

    if (!useGlobalMode) {
      // 纯单号模式：所有商品都来自当前选中的发票
      this.api.createCreditNote(Number(this.cnForm.invoiceId), payload).subscribe({
        next: () => { this.showToastMsg('Credit Note created!'); this.openCNList(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.error || err.message || 'error'))
      });
    } else {
      // 智能全局模式：支持跨单退货
      const payloadGlobal = { 
        reason: this.cnForm.reason, 
        items: payloadItems, 
        isManual: true,
        preferredInvoiceId: this.cnForm.invoiceId && this.cnForm.invoiceId != 0 ? Number(this.cnForm.invoiceId) : null
      };
      const cid = this.cnForm.customerId || (this.selectedCNInvoiceDetail?.customerId) || 0;
      if (!cid || cid == 0) { this.showToastMsg('Customer ID is required for global return'); return; }

      this.api.createGlobalCreditNote(Number(cid), payloadGlobal).subscribe({
        next: () => { this.showToastMsg('Global Credit Note created successfully!'); this.openCNList(); },
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
    if (cn.isUsed) { this.showToastMsg('This credit note has been used and cannot be deleted'); return; }
    this.selectedCN = cn;
    this.alertService.confirm('Delete Credit Note', 'Are you sure?').then(c => { if(c) this.deleteCreditNote(); });
  }
  deleteCreditNote() {
    if (!this.selectedCN) return;
    this.api.deleteCreditNote(Number(this.selectedCN.invoiceId), Number(this.selectedCN.id)).subscribe({
      next: () => { this.showToastMsg('Credit Note deleted!'); this.loadCreditNotes(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
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



