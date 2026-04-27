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
  customers: any[] = [];
  invoices: any[] = [];
  isLoading = false;
  showModal = false;
  showPaymentList = false;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  selectedPayment: any = null;
  form: any = {
    customerId: 0,
    invoiceId: null,
    amount: 0,
    method: 'Cash',
    referenceNo: ''
  };
  paymentMethods = ['Cash', 'Card', 'Online Transfer', 'Cheque'];
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deletePayment() }
  ];

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() { this.loadCustomers(); }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
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
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load payments'); }
    });
  }

  onCustomerChange() {
    if (this.form.customerId) {
      this.loadInvoicesByCustomer(this.form.customerId);
    }
  }

  openNewPayment() {
    this.form = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceId: null, amount: 0, method: 'Cash', referenceNo: '' };
    if (this.customers.length > 0) this.loadInvoicesByCustomer(this.customers[0].id);
    this.showModal = true;
    this.showPaymentList = false;
  }

  openPaymentList() {
    this.loadPayments();
    this.showPaymentList = true;
    this.showModal = false;
  }

  closeModal() { this.showModal = false; }
  closePaymentList() { this.showPaymentList = false; }

  savePayment() {
    if (!this.form.customerId) { this.showToastMsg('Please select a customer'); return; }
    if (!this.form.invoiceId) { this.showToastMsg('Please select an invoice'); return; }
    if (!this.form.amount || this.form.amount <= 0) { this.showToastMsg('Please enter valid amount'); return; }
    this.api.createPayment(this.form).subscribe({
      next: () => { this.showToastMsg('Payment created!'); this.closeModal(); this.loadPayments(); this.showPaymentList = true; },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  confirmDelete(payment: any) { this.selectedPayment = payment; this.showDeleteAlert = true; }

  deletePayment() {
    if (!this.selectedPayment) return;
    this.api.deletePayment(this.selectedPayment.id).subscribe({
      next: () => { this.showToastMsg('Payment deleted!'); this.loadPayments(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  getCustomerName(id: any) {
    const c = this.customers.find(c => c.id == id);
    return c ? c.name : 'Customer #' + id;
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goTo(path: string) { this.router.navigate([path]); }
  goBack() { this.router.navigate(['pages/home']); }
}
