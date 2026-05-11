import { AlertService } from '../../services/alert.service';
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
  selector: 'app-customers',
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
})
export class CustomersPage implements OnInit {
  customers: any[] = [];
  filteredCustomers: any[] = [];
  isLoading = false;
  showSearch = false;
  searchTerm = '';
  activeTab = 'ALL';
  showModal = false;
  isEditing = false;
  isEditMode = false;
  selectedCustomer: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  form: any = { 
    name: '', phone: '', email: '', address: '', 
    code: '', term: 'Cash Sale', sequence: '', category: 'DEFAULT', 
    description: '', processCompany: 'ALL COMPANY', taxStatus: 'Un-Defined', 
    taxDocNo: '', discount: 0, requireDigitSign: false,
    totalCredit: -23744.66,
    branchCode: 'BILLING', branchName: 'BILLING', branchAddress: 'NO 2-1 JALAN TTDI GROVE 1/2. TAMAN TTDI GROVE',
    branchPostcode: '43000', branchCity: 'kajang', branchState: 'Selangor',
    isDefaultBranch: true
  };
  activeSubTab = 'MASTER';
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCustomer() }
  ];

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}

  ionViewWillEnter() {
    this.cdr.detectChanges();
  }

  ngOnInit() { this.loadCustomers(); }

  loadCustomers() {
    this.isLoading = true;
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; this.filteredCustomers = [...this.customers]; this.isLoading = false; },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load customers'); }
    });
  }

  filterCustomers() {
    this.filteredCustomers = this.customers.filter(c =>
      (c.name || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      (c.phone || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  setTab(tab: string) {
    this.activeTab = tab;
    this.filteredCustomers = tab === 'ALL' ? [...this.customers] : this.customers.filter(c => !c.category || c.category === 'DEFAULT');
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredCustomers = [...this.customers]; }
  }

  openAddModal() {
    this.isEditing = false;
    this.isEditMode = true;
    this.selectedCustomer = null;
    this.form = { 
      name: '', phone: '', email: '', address: '', 
      code: '', term: 'Cash Sale', sequence: '', category: 'DEFAULT', 
      description: '', processCompany: 'ALL COMPANY', taxStatus: 'Un-Defined', 
      taxDocNo: '', discount: 0, requireDigitSign: false,
      totalCredit: 0.00,
      branchCode: '', branchName: '', branchAddress: '', 
      branchPostcode: '', branchCity: '', branchState: '',
      isDefaultBranch: false
    };
    this.showModal = true;
  }

  openEditModal(customer: any) {
    this.isEditing = true;
    this.isEditMode = false;
    this.selectedCustomer = customer;
    this.form = {
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      code: customer.code || '',
      term: customer.term || 'Cash Sale',
      sequence: customer.sequence || '',
      category: customer.category || 'DEFAULT',
      description: customer.description || '',
      processCompany: customer.processCompany || 'ALL COMPANY',
      taxStatus: customer.taxStatus || 'Un-Defined',
      taxDocNo: customer.taxDocNo || '',
      discount: customer.discount || 0,
      requireDigitSign: customer.requireDigitSign || false,
      totalCredit: customer.totalCredit || 0,
      branchCode: customer.branchCode || 'BILLING',
      branchName: customer.branchName || 'BILLING',
      branchAddress: customer.branchAddress || 'NO 2-1 JALAN TTDI GROVE 1/2. TAMAN TTDI GROVE',
      branchPostcode: customer.branchPostcode || '43000',
      branchCity: customer.branchCity || 'kajang',
      branchState: customer.branchState || 'Selangor',
      isDefaultBranch: customer.isDefaultBranch !== undefined ? customer.isDefaultBranch : true
    };
    this.showModal = true;
  }

  toggleEditMode() {
    if (this.isEditMode) {
      this.saveCustomer();
    } else {
      this.isEditMode = true;
    }
  }

  closeModal() { this.showModal = false; this.isEditMode = false; }

  viewAllInvoices() {
    if (this.selectedCustomer) {
      this.router.navigate(['pages/customer-detail'], { queryParams: { id: this.selectedCustomer.id } });
    }
  }

  saveCustomer() {
    if (!this.form.name) { this.showToastMsg('Customer name is required'); return; }
    if (this.isEditing && this.selectedCustomer) {
      this.api.editCustomer(this.selectedCustomer.id, this.form).subscribe({
        next: () => { this.showToastMsg('Customer updated!'); this.closeModal(); this.loadCustomers(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.createCustomer(this.form).subscribe({
        next: () => { this.showToastMsg('Customer created!'); this.closeModal(); this.loadCustomers(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  confirmDelete(customer: any) { this.selectedCustomer = customer; this.alertService.confirm('Delete Customer', 'Delete ' + (customer.name || '') + '?').then(c => { if(c) this.deleteCustomer(); }); }

  deleteCustomer() {
    if (!this.selectedCustomer) return;
    this.api.deleteCustomer(this.selectedCustomer.id).subscribe({
      next: () => { this.showToastMsg('Customer deleted!'); this.loadCustomers(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}



