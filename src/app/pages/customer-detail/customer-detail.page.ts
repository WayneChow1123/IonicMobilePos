import { AlertService } from '../../services/alert.service';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NavController, Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-customer-detail',
  templateUrl: './customer-detail.page.html',
  styleUrls: ['./customer-detail.page.scss'],
})
export class CustomerDetailPage implements OnInit, OnDestroy {
  customers: any[] = [];
  isLoading = false;
  showToast = false;
  toastMessage = '';
  selectedCustomer: any = null;
  customerInvoices: any[] = [];
  showInvoiceList = false;

  private backButtonSub?: Subscription;

  constructor(
    private router: Router,
    private navCtrl: NavController,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private alertService: AlertService,
    private platform: Platform
  ) {}

  ionViewWillEnter() {
    this.registerBackButton();
    this.cdr.detectChanges();
  }

  ionViewWillLeave() {
    this.unregisterBackButton();
  }

  ngOnDestroy() {
    this.unregisterBackButton();
  }

  registerBackButton() {
    this.unregisterBackButton();
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
      if (Swal.isVisible()) {
        Swal.close();
        return;
      }
      this.goBack();
    });
  }

  unregisterBackButton() {
    if (this.backButtonSub) {
      this.backButtonSub.unsubscribe();
      this.backButtonSub = undefined;
    }
  }

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

  getBalance(customerId: number): number {
    return this.getCustomerInvoices(customerId).reduce((sum, inv) => {
      const bal = inv.balance !== undefined ? inv.balance : ((inv.totalAmount || 0) - (inv.paidAmount || 0) - (inv.creditUsed || 0));
      return sum + (bal > 0 ? bal : 0);
    }, 0);
  }

  getTotalPaid(customerId: number): number {
    return this.getTotalInvoice(customerId) - this.getBalance(customerId);
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

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goToInvoice(invoice: any) { this.navCtrl.navigateRoot('pages/invoices', { queryParams: { id: invoice.id } }); }
  goBack() {
    if (this.showInvoiceList) {
      this.closeInvoiceList();
      this.cdr.detectChanges();
      return;
    }
    this.navCtrl.navigateRoot('pages/home');
  }
}
