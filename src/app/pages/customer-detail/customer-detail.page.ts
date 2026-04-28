import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-customer-detail',
  templateUrl: './customer-detail.page.html',
  styleUrls: ['./customer-detail.page.scss'],
})
export class CustomerDetailPage implements OnInit {
  customers: any[] = [];
  isLoading = false;
  showToast = false;
  toastMessage = '';
  selectedCustomer: any = null;
  customerInvoices: any[] = [];
  showInvoiceList = false;

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() { this.loadCustomers(); }

  loadCustomers() {
    this.isLoading = true;
    this.api.getAllCustomers().subscribe({
      next: (res) => {
        this.customers = Array.isArray(res) ? res : [];
        this.loadAllInvoices();
      },
      error: () => { this.isLoading = false; }
    });
  }

  allInvoices: any[] = [];

  loadAllInvoices() {
    this.api.getInvoices().subscribe({
      next: (res) => {
        this.allInvoices = Array.isArray(res) ? res : [];
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; }
    });
  }

  getCustomerInvoices(customerId: number) {
    return this.allInvoices.filter(inv => inv.customerId === customerId);
  }

  getTotalInvoice(customerId: number): number {
    return this.getCustomerInvoices(customerId).reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  }

  getTotalPaid(customerId: number): number {
    return this.getCustomerInvoices(customerId).reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
  }

  getBalance(customerId: number): number {
    return this.getTotalInvoice(customerId) - this.getTotalPaid(customerId);
  }

  openInvoiceList(customer: any) {
    this.selectedCustomer = customer;
    this.customerInvoices = this.getCustomerInvoices(customer.id);
    this.showInvoiceList = true;
  }

  closeInvoiceList() {
    this.showInvoiceList = false;
    this.selectedCustomer = null;
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goToInvoice(invoice: any) { this.router.navigate(['pages/invoices'], { queryParams: { id: invoice.id } }); }
  goBack() { this.router.navigate(['pages/home']); }
}
