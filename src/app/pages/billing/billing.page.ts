import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

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
    this.cdr.detectChanges();
  }


  payments: any[] = [];
  filteredPayments: any[] = [];
  creditNotes: any[] = [];
  filteredCreditNotes: any[] = [];
  customers: any[] = [];
  invoices: any[] = [];
  isLoading = false;
  currentView = 'home';
  showDeletePaymentAlert = false;
  showDeleteCNAlert = false;
  showStockAlert = false;
  showToast = false;
  toastMessage = '';
  selectedPayment: any = null;
  selectedCN: any = null;
  selectedInvoiceDetail: any = null;
  selectedCNInvoiceDetail: any = null;
  cnFilteredInvoices: any[] = [];
  stockIssues: any[] = [];
  pendingPayload: any = null;
  waitingInvoiceId: number | null = null;
  paymentSearchTerm = '';
  cnSearchTerm = '';
  paymentForm: any = { customerId: 0, invoiceId: 0, amount: 0, method: 'Cash', referenceNo: '' };
  cnForm: any = { customerId: 0, invoiceId: 0, reason: '', items: [] };
  paymentMethods = ['Cash', 'Card', 'Online Transfer', 'Cheque'];

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
      // 允许增加到历史记录里的最大剩余量
      found.maxQuantity = item.remaining;
      if (found.returnQuantity > item.remaining) found.returnQuantity = item.remaining;
    } else {
      this.cnForm.items.push({
        productId: item.productId,
        productName: item.productName,
        maxQuantity: item.remaining, 
        returnedQuantity: item.totalReturned,
        returnQuantity: 1,
        returnToStock: false,
        isGlobal: true 
      });
    }
    
    // Force UI update
    this.cnForm.items = [...this.cnForm.items];
    this.showToastMsg(`Added ${item.productName} from history`);
    this.cdr.detectChanges();
  }

  constructor(private router: Router, private route: ActivatedRoute, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}




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
    this.api.getInvoices().subscribe({
      next: (res) => { 
        this.invoices = Array.isArray(res) ? res : []; 
        this.cnFilteredInvoices = [...this.invoices];
      },
      error: () => {}
    });
  }

  loadInvoicesByCustomer(customerId: any) {
    this.api.getInvoices({ customerId }).subscribe({
      next: (res) => { this.invoices = Array.isArray(res) ? res : []; },
      error: () => {}
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
    this.paymentForm = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceId: 0, amount: 0, method: 'Cash', referenceNo: '' };
    this.selectedInvoiceDetail = null;
    if (this.customers.length > 0) this.loadInvoicesByCustomer(this.customers[0].id);
    this.currentView = 'newPayment';
  }

  openNewCN() {
    this.loadAllInvoices();
    this.cnForm = { customerId: 0, invoiceId: 0, reason: '', items: [] };
    this.cnFilteredInvoices = [...this.invoices];
    this.selectedCNInvoiceDetail = null;
    this.currentView = 'newCN';
  }

  openPaymentList() { this.paymentSearchTerm = ''; this.loadPayments(); this.currentView = 'paymentList'; }
  openCNList() { this.cnSearchTerm = ''; this.loadCreditNotes(); this.currentView = 'cnList'; }

  onCustomerChange() {
    if (this.paymentForm.customerId) {
      this.loadInvoicesByCustomer(this.paymentForm.customerId);
      this.paymentForm.invoiceId = 0;
      this.selectedInvoiceDetail = null;
    }
  }

  onInvoiceChange() {
    if (this.paymentForm.invoiceId && this.paymentForm.invoiceId != 0) {
      this.api.getInvoiceDetails(Number(this.paymentForm.invoiceId)).subscribe({
        next: (res: any) => { this.selectedInvoiceDetail = res; },
        error: () => { this.selectedInvoiceDetail = null; }
      });
    } else {
      this.selectedInvoiceDetail = null;
    }
  }

  onCNCustomerChange() {
    this.cnForm.invoiceId = 0;
    this.cnForm.items = [];
    this.selectedCNInvoiceDetail = null;
    if (this.cnForm.customerId && this.cnForm.customerId != 0) {
      this.cnFilteredInvoices = this.invoices.filter((inv: any) => inv.customerId == this.cnForm.customerId);
    } else {
      this.cnFilteredInvoices = [...this.invoices];
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

  getTotalCNForPayment(): number {
    if (!this.selectedInvoiceDetail?.creditNotes) return 0;
    return this.selectedInvoiceDetail.creditNotes
      .reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getBalanceForPayment(): number {
    if (!this.selectedInvoiceDetail) return 0;
    const totalCN = this.getTotalCNForPayment();
    const netTotal = (this.selectedInvoiceDetail.totalAmount || 0) - totalCN;
    return netTotal - (this.selectedInvoiceDetail.paidAmount || 0);
  }

  useCreditNote(cn: any) {
    if (cn.isUsed) return;
    this.api.useCreditNote(Number(cn.invoiceId), Number(cn.id)).subscribe({
      next: () => {
        cn.isUsed = true;
        this.showToastMsg('Credit note marked as used!');
        this.loadCreditNotes();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  savePayment() {
    if (!this.paymentForm.customerId) { this.showToastMsg('Please select a customer'); return; }
    if (!this.paymentForm.invoiceId || this.paymentForm.invoiceId == 0) { this.showToastMsg('Please select an invoice'); return; }
    if (!this.paymentForm.amount || this.paymentForm.amount <= 0 || isNaN(this.paymentForm.amount)) { this.showToastMsg('Amount must be greater than 0'); return; }
    const payload = {
      customerId: Number(this.paymentForm.customerId),
      invoiceId: Number(this.paymentForm.invoiceId),
      amount: Number(this.paymentForm.amount),
      method: this.paymentForm.method,
      referenceNo: this.paymentForm.referenceNo || ''
    };
    this.api.createPayment(payload).subscribe({
      next: () => { this.showToastMsg('Payment created!'); this.openPaymentList(); },
      error: (err: any) => {
        const errBody = err.error;
        if (errBody?.type === 'STOCK_INSUFFICIENT') {
          this.stockIssues = errBody.stockIssues || [];
          this.pendingPayload = payload;
          this.showStockAlert = true;
        } else {
          this.showToastMsg('Failed: ' + (errBody?.message || errBody || err.message || 'error'));
        }
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
      const cid = this.cnForm.customerId || (this.selectedCNInvoiceDetail?.customerId) || 0;
      if (!cid || cid == 0) { this.showToastMsg('Customer ID is required for global return'); return; }

      this.api.createGlobalCreditNote(Number(cid), payload).subscribe({
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



