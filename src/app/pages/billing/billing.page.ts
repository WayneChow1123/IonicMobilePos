import { Component, OnInit } from '@angular/core';
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
  payments: any[] = [];
  creditNotes: any[] = [];
  customers: any[] = [];
  invoices: any[] = [];
  isLoading = false;
  currentView = 'home';
  showDeletePaymentAlert = false;
  showDeleteCNAlert = false;
  showToast = false;
  toastMessage = '';
  selectedPayment: any = null;
  selectedCN: any = null;
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

  constructor(private router: Router, private api: ApiService) {}

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
      next: (res) => { this.payments = Array.isArray(res) ? res : []; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  loadCreditNotes() {
    this.isLoading = true;
    this.api.getAllCreditNotes().subscribe({
      next: (res) => { this.creditNotes = Array.isArray(res) ? res : []; this.isLoading = false; },
      error: () => { this.isLoading = false; }
    });
  }

  goHome() { this.currentView = 'home'; }

  openNewPayment() {
    this.paymentForm = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceId: 0, amount: 0, method: 'Cash', referenceNo: '' };
    if (this.customers.length > 0) this.loadInvoicesByCustomer(this.customers[0].id);
    this.currentView = 'newPayment';
  }

  openNewCN() {
    this.loadAllInvoices();
    this.cnForm = { invoiceId: 0, amount: 0, reason: '' };
    this.currentView = 'newCN';
  }

  openPaymentList() { this.loadPayments(); this.currentView = 'paymentList'; }
  openCNList() { this.loadCreditNotes(); this.currentView = 'cnList'; }

  onCustomerChange() {
    if (this.paymentForm.customerId) {
      this.loadInvoicesByCustomer(this.paymentForm.customerId);
    }
  }

  savePayment() {
    if (!this.paymentForm.customerId) { this.showToastMsg('Please select a customer'); return; }
    if (!this.paymentForm.invoiceId || this.paymentForm.invoiceId == 0) { this.showToastMsg('Please select an invoice'); return; }
    if (!this.paymentForm.amount || this.paymentForm.amount <= 0) { this.showToastMsg('Please enter valid amount'); return; }
    const payload = {
      customerId: Number(this.paymentForm.customerId),
      invoiceId: Number(this.paymentForm.invoiceId),
      amount: Number(this.paymentForm.amount),
      method: this.paymentForm.method,
      referenceNo: this.paymentForm.referenceNo || ''
    };
    this.api.createPayment(payload).subscribe({
      next: () => { this.showToastMsg('Payment created!'); this.openPaymentList(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  saveCreditNote() {
    if (!this.cnForm.invoiceId || this.cnForm.invoiceId == 0) { this.showToastMsg('Please select an invoice'); return; }
    if (!this.cnForm.amount || this.cnForm.amount <= 0) { this.showToastMsg('Please enter valid amount'); return; }
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

  confirmDeleteCN(cn: any) { this.selectedCN = cn; this.showDeleteCNAlert = true; }
  deleteCreditNote() {
    if (!this.selectedCN) return;
    this.api.deleteCreditNote(Number(this.selectedCN.invoiceId), Number(this.selectedCN.id)).subscribe({
      next: () => { this.showToastMsg('Credit Note deleted!'); this.loadCreditNotes(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goTo(path: string) { this.router.navigate([path]); }
  goBack() { this.router.navigate(['pages/home']); }
}
