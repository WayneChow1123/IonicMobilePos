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
  isModalLoading = false;
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
    totalCredit: 0,
    branchCode: '', branchName: '', branchAddress: '',
    branchPostcode: '', branchCity: '', branchState: '',
    isDefaultBranch: false
  };
  activeSubTab = 'MASTER';
  activeReport: string | null = null;
  customerInvoices: any[] = [];
  customerCNs: any[] = [];
  customerPayments: any[] = [];
  allInvoices: any[] = [];
  allPayments: any[] = [];
  allCNs: any[] = [];
  customerPrices: any[] = [];
  allProducts: any[] = [];
  showAddPriceForm = false;
  newPriceForm: any = { productId: null, specialPrice: null };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCustomer() }
  ];

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}

  ionViewWillEnter() {
    this.showModal = false;
    this.isEditMode = false;
    this.isEditing = false;
    this.showSearch = false;
    this.searchTerm = '';
    this.activeSubTab = 'MASTER';
    this.activeReport = null;
    this.loadCustomers();
    this.cdr.detectChanges();
    
    // Force another check after a short delay to fix potential "partial display" issues
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 100);
  }

  ngOnInit() { }

  loadCustomers() {
    this.isLoading = true;
    this.api.getAllCustomers().subscribe({
      next: (res) => { 
        this.customers = Array.isArray(res) ? res : []; 
        this.filteredCustomers = [...this.customers]; 
        this.isLoading = false; 
        this.loadAllRelatedData();
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load customers'); }
    });
  }

  loadAllRelatedData() {
    this.api.getInvoices().subscribe(res => {
      this.allInvoices = Array.isArray(res) ? res : [];
      if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
    });
    this.api.getPayments().subscribe(res => {
      this.allPayments = Array.isArray(res) ? res : [];
      if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
    });
    this.api.getAllCreditNotes().subscribe(res => {
      this.allCNs = Array.isArray(res) ? res : [];
      if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
    });
  }

  loadCustomerSpecificData(customerId: any) {
    const id = Number(customerId);
    const customerName = this.selectedCustomer?.name;
    
    // Helper to get ID from various possible field names
    const getCustId = (obj: any) => obj.customerId || obj.customer_id || obj.CustomerID || obj.CustomerId;
    const getInvId = (obj: any) => obj.invoiceId || obj.invoice_id || obj.InvoiceId || obj.InvoiceID;
    const getInvNo = (obj: any) => obj.invoiceNumber || obj.InvoiceNumber || obj.invoice_no;

    // 1. Invoices
    this.customerInvoices = this.allInvoices.filter(inv => {
      const cId = getCustId(inv);
      return (cId && Number(cId) === id);
    });
    
    // 2. Payments
    this.customerPayments = this.allPayments.filter(p => {
      const pCustId = getCustId(p);
      if (pCustId && Number(pCustId) === id) return true;
      
      const pCustName = p.customerName || p.CustomerName || p.customer_name;
      if (customerName && pCustName === customerName) return true;
      
      const pInvId = getInvId(p);
      if (pInvId) {
        const inv = this.allInvoices.find(i => i.id == pInvId || getInvId(i) == pInvId);
        if (inv && Number(getCustId(inv)) === id) return true;
      }
      
      const pInvNo = getInvNo(p);
      if (pInvNo) {
        const inv = this.allInvoices.find(i => i.invoiceNumber === pInvNo || getInvNo(i) === pInvNo);
        if (inv && Number(getCustId(inv)) === id) return true;
      }
      return false;
    });

    // 3. Credit Notes
    this.customerCNs = this.allCNs.filter(cn => {
      const cId = getCustId(cn);
      if (cId && Number(cId) === id) return true;
      
      const cName = cn.customerName || cn.CustomerName || cn.customer_name;
      if (customerName && cName === customerName) return true;
      
      const cInvId = getInvId(cn);
      if (cInvId) {
        const inv = this.allInvoices.find(i => i.id == cInvId || getInvId(i) == cInvId);
        if (inv && Number(getCustId(inv)) === id) return true;
      }
      
      const cInvNo = getInvNo(cn);
      if (cInvNo) {
        const inv = this.allInvoices.find(i => i.invoiceNumber === cInvNo || getInvNo(i) === cInvNo);
        if (inv && Number(getCustId(inv)) === id) return true;
      }
      return false;
    });
    
    const outstanding = this.customerInvoices.reduce((sum, inv) => {
      const bal = inv.balance !== undefined ? inv.balance : ((inv.totalAmount || 0) - (inv.paidAmount || 0) - (inv.creditUsed || 0));
      return sum + (bal > 0 ? bal : 0);
    }, 0);
    this.form.totalCredit = -outstanding; // negative = owes money
    
    this.cdr.detectChanges();
  }

  loadCustomerPrices(customerId: number) {
    if (!customerId) return;
    this.api.getCustomerProductPrices(customerId).subscribe({
      next: (res) => { this.customerPrices = Array.isArray(res) ? res : []; this.cdr.detectChanges(); },
      error: () => { this.customerPrices = []; }
    });
  }

  loadPriceProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.allProducts = Array.isArray(res) ? res : []; },
      error: () => { this.allProducts = []; }
    });
  }

  getProductName(productId: number): string {
    const p = this.allProducts.find(x => x.id === productId);
    return p ? p.name : 'Unknown Product';
  }

  getProductPrice(productId: number): number {
    const p = this.allProducts.find(x => x.id === productId);
    return p ? p.price : 0;
  }

  toggleAddPriceForm() {
    this.showAddPriceForm = !this.showAddPriceForm;
    this.newPriceForm = { productId: null, specialPrice: null };
  }

  addCustomerPrice() {
    if (!this.newPriceForm.productId || this.newPriceForm.specialPrice == null) {
      this.showToastMsg('Please select a product and enter a price');
      return;
    }
    const product = this.allProducts.find(p => p.id == this.newPriceForm.productId);
    const originalPrice = product ? product.price : 0;
    if (Number(this.newPriceForm.specialPrice) > originalPrice) {
      this.showToastMsg('Special Price cannot exceed Original Price (RM ' + originalPrice.toFixed(2) + ')');
      return;
    }
    this.api.createCustomerProductPrice(this.selectedCustomer.id, {
      productId: Number(this.newPriceForm.productId),
      specialPrice: Number(this.newPriceForm.specialPrice)
    }).subscribe({
      next: () => {
        this.showToastMsg('Price created!');
        this.showAddPriceForm = false;
        this.newPriceForm = { productId: null, specialPrice: null };
        this.loadCustomerPrices(this.selectedCustomer.id);
      },
      error: (err) => this.showToastMsg('Failed: ' + (err.error?.message || err.message))
    });
  }

  deleteCustomerPrice(productId: number) {
    this.alertService.confirm('Delete Price', 'Remove this special price?').then(ok => {
      if (!ok) return;
      this.api.deleteCustomerProductPrice(this.selectedCustomer.id, productId).subscribe({
        next: () => {
          this.showToastMsg('Price deleted!');
          this.loadCustomerPrices(this.selectedCustomer.id);
        },
        error: (err) => this.showToastMsg('Failed: ' + (err.error?.message || err.message))
      });
    });
  }

  getCustomerCredit(customerId: any): number {
    const invs = this.allInvoices.filter(inv => inv.customerId == customerId);
    const outstanding = invs.reduce((s, inv) => {
      const bal = inv.balance !== undefined ? inv.balance : ((inv.totalAmount || 0) - (inv.paidAmount || 0) - (inv.creditUsed || 0));
      return s + (bal > 0 ? bal : 0);
    }, 0);
    return -outstanding; // negative = owes money, 0 = paid
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
    this.activeReport = null;
    this.activeSubTab = 'MASTER';
    this.isModalLoading = true;
    this.showModal = true; // show modal immediately with loading spinner inside

    // Fetch FULL customer data (includes branches) via getCustomerById
    this.api.getCustomerById(customer.id).subscribe({
      next: (fullCustomer: any) => {
        this.isModalLoading = false;
        this.selectedCustomer = fullCustomer;
        const branch = (fullCustomer.branches && fullCustomer.branches.length > 0) ? fullCustomer.branches[0] : null;

        this.form = {
          name: fullCustomer.name || '',
          phone: fullCustomer.phone || '',
          email: fullCustomer.email || '',
          address: fullCustomer.address || '',
          code: fullCustomer.customerCode || '',
          term: fullCustomer.term || 'Cash Sale',
          sequence: fullCustomer.sequence || '',
          category: fullCustomer.customerCategory || 'DEFAULT',
          description: fullCustomer.description || '',
          processCompany: fullCustomer.processCompany || 'ALL COMPANY',
          taxStatus: fullCustomer.taxStatus || 'Un-Defined',
          taxDocNo: fullCustomer.taxDocNo || '',
          discount: fullCustomer.discountPercent || 0,
          requireDigitSign: fullCustomer.requireDigitSign || false,
          totalCredit: 0,
          branchCode: branch ? (branch.code || '') : '',
          branchName: branch ? (branch.name || '') : '',
          branchAddress: branch ? (branch.address1 || '') : (fullCustomer.address || ''),
          branchPostcode: branch ? (branch.postcode || '') : '',
          branchCity: branch ? (branch.city || '') : '',
          branchState: branch ? (branch.state || '') : '',
          isDefaultBranch: branch ? (branch.isDefaultBranch || false) : false,
          _hasBranch: !!branch
        };
        this.loadCustomerSpecificData(fullCustomer.id);
        this.loadCustomerPrices(fullCustomer.id);
        this.loadPriceProducts();
      },
      error: () => {
        this.isModalLoading = false;
        this.showModal = false;
        this.showToastMsg('Failed to load customer data');
      }
    });
  }


  toggleEditMode() {
    if (this.isEditMode) {
      this.saveCustomer();
    } else {
      this.isEditMode = true;
    }
  }

  closeModal() { this.showModal = false; this.isEditMode = false; this.activeReport = null; this.showAddPriceForm = false; this.customerPrices = []; }

  setActiveReport(report: string | null) {
    this.activeReport = report;
    if (report) this.showAddPriceForm = false;
  }

  viewAllInvoices() {
    if (this.selectedCustomer) {
      this.router.navigate(['pages/customer-detail'], { queryParams: { id: this.selectedCustomer.id } });
    }
  }

  saveCustomer() {
    if (!this.form.name) { this.showToastMsg('Customer name is required'); return; }
    
    // Build a clean payload with ONLY the fields the backend expects
    const branchPayload: any = {
      code: this.form.branchCode || '',
      name: this.form.branchName || '',
      address1: this.form.branchAddress || '',
      postcode: this.form.branchPostcode || '',
      city: this.form.branchCity || '',
      state: this.form.branchState || '',
      isDefaultBranch: this.form.isDefaultBranch || false
    };

    const payload: any = {
      customerCode: this.form.code || '',
      name: this.form.name,
      customerCategory: this.form.category || 'DEFAULT',
      term: this.form.term || 'Cash Sale',
      sequence: Number(this.form.sequence) || 0,
      description: this.form.description || '',
      processCompany: this.form.processCompany || 'ALL COMPANY',
      taxStatus: this.form.taxStatus || 'Un-Defined',
      taxDocNo: this.form.taxDocNo || '',
      discountPercent: Number(this.form.discount) || 0,
      requireDigitSign: this.form.requireDigitSign || false,
      phone: this.form.phone || '',
      email: this.form.email || '',
      address: this.form.address || ''
    };

    // Include branches if: (1) customer already has a branch, or (2) user filled in any branch field
    const hasAnyBranchData = !!(branchPayload.code || branchPayload.name || branchPayload.address || branchPayload.postcode || branchPayload.city || branchPayload.state);
    const alreadyHasBranch = !!this.form._hasBranch;

    if (hasAnyBranchData || alreadyHasBranch) {
      // Backend requires Code and Name for branches
      if (!branchPayload.code) { this.showToastMsg('Branch Code is required'); return; }
      if (!branchPayload.name) { this.showToastMsg('Branch Name is required'); return; }
      payload.branches = [branchPayload];
    }

    if (this.isEditing && this.selectedCustomer) {
      this.api.editCustomer(this.selectedCustomer.id, payload).subscribe({
        next: () => { this.showToastMsg('Customer updated!'); this.closeModal(); this.loadCustomers(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || JSON.stringify(err.error) || err.message || 'error'))
      });
    } else {
      this.api.createCustomer(payload).subscribe({
        next: () => { this.showToastMsg('Customer created!'); this.closeModal(); this.loadCustomers(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || JSON.stringify(err.error) || err.message || 'error'))
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



