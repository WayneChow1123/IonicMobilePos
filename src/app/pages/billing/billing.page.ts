import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router } from '@angular/router';
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
  stockIssues: any[] = [];
  pendingPayload: any = null;
  waitingInvoiceId: number | null = null;
  paymentSearchTerm = '';
  cnSearchTerm = '';
  paymentForm: any = { customerId: 0, invoiceId: 0, amount: 0, method: 'Cash', referenceNo: '' };
  cnForm: any = { invoiceId: 0, amount: 0, reason: '' };
  paymentMethods = ['Cash', 'Card', 'Online Transfer', 'Cheque'];

  deletePaymentButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deletePayment() }
  ];
  deleteCNButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCreditNote() }
  ];

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef) {}




  ngOnInit() { this.loadCustomers(); }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  loadAllInvoices() {
    this.api.getInvoices().subscribe({
      next: (res) => { this.invoices = Array.isArray(res) ? res : []; },
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
    this.cnForm = { invoiceId: 0, amount: 0, reason: '' };
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

  getTotalCNForPayment(): number {
    if (!this.selectedInvoiceDetail?.creditNotes) return 0;
    return this.selectedInvoiceDetail.creditNotes
      .filter((cn: any) => !cn.createdAfterPayment)
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
    if (!this.cnForm.invoiceId || this.cnForm.invoiceId == 0) { this.showToastMsg('Please select an invoice'); return; }
    if (!this.cnForm.amount || this.cnForm.amount <= 0 || isNaN(this.cnForm.amount)) { this.showToastMsg('Amount must be greater than 0'); return; }
    if (!this.cnForm.reason) { this.showToastMsg('Please enter reason'); return; }
    const payload = { amount: Number(this.cnForm.amount), reason: this.cnForm.reason };
    this.api.createCreditNote(Number(this.cnForm.invoiceId), payload).subscribe({
      next: () => { this.showToastMsg('Credit Note created!'); this.openCNList(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  confirmDeletePayment(payment: any) { this.selectedPayment = payment; this.showDeletePaymentAlert = true; }
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
    this.showDeleteCNAlert = true;
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

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goTo(path: string) { this.navCtrl.navigateRoot(path); }

  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}
