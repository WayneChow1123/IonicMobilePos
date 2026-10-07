import { AlertService } from '../../services/alert.service';
import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NavController, Platform } from '@ionic/angular';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { OfflineStorageService } from '../../services/offline-storage.service';
import { SyncService } from '../../services/sync.service';
import { Subscription } from 'rxjs';
import Swal from 'sweetalert2';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-customers',
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
})
export class CustomersPage implements OnInit, OnDestroy {
  customers: any[] = [];
  filteredCustomers: any[] = [];
  displayedCustomers: any[] = [];
  pageSize = 30;
  currentPage = 1;
  isLoadingMore = false;
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
    taxDocNo: '', discount: null, requireDigitSign: false,
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

  // Product Selection Modal
  showProductSelectModal = false;
  searchText = '';
  matchedProducts: any[] = [];
  otherProducts: any[] = [];
  selectedTempProduct: any = null;

  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCustomer() }
  ];

  pendingOfflineCount: number = 0;
  isSyncing: boolean = false;
  private backButtonSub?: Subscription;
  private queueCountSub?: Subscription;
  private syncingSub?: Subscription;

  constructor(
    private router: Router,
    private navCtrl: NavController,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private alertService: AlertService,
    private platform: Platform,
    private offlineStorage: OfflineStorageService,
    private syncService: SyncService
  ) { }

  ionViewWillEnter() {
    this.registerBackButton();
    this.showModal = false;
    this.isEditMode = false;
    this.isEditing = false;
    this.showSearch = false;
    this.searchTerm = '';
    this.activeSubTab = 'MASTER';
    this.activeReport = null;

    this.queueCountSub?.unsubscribe();
    this.queueCountSub = this.offlineStorage.queueCount$.subscribe(count => {
      this.pendingOfflineCount = count;
      this.cdr.detectChanges();
    });

    this.syncingSub?.unsubscribe();
    this.syncingSub = this.syncService.isSyncing$.subscribe(syncing => {
      this.isSyncing = syncing;
      this.cdr.detectChanges();
    });

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
        this.currentPage = 1;
        this.displayedCustomers = this.filteredCustomers.slice(0, this.pageSize);
        this.isLoading = false;
        this.loadAllRelatedData();
        this.api.getAllCustomerProductPrices().subscribe({ error: () => {} });
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load customers'); }
    });
  }

  updateDisplayedCustomers() {
    this.currentPage = 1;
    this.displayedCustomers = this.filteredCustomers.slice(0, this.pageSize);
  }

  loadMore() {
    if (this.displayedCustomers.length >= this.filteredCustomers.length) return;
    this.isLoadingMore = true;
    setTimeout(() => {
      this.currentPage++;
      this.displayedCustomers = this.filteredCustomers.slice(0, this.currentPage * this.pageSize);
      this.isLoadingMore = false;
      this.cdr.detectChanges();
    }, 300);
  }

  onInfinite(event: any) {
    if (this.displayedCustomers.length >= this.filteredCustomers.length) { event.target.complete(); return; }
    this.currentPage++;
    setTimeout(() => {
      this.displayedCustomers = this.filteredCustomers.slice(0, this.currentPage * this.pageSize);
      event.target.complete();
      this.cdr.detectChanges();
    }, 400);
  }

  loadAllRelatedData() {
    this.api.getInvoices().subscribe({
      next: res => {
        this.allInvoices = Array.isArray(res) ? res : [];
        if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
      },
      error: () => {}
    });
    this.api.getPayments().subscribe({
      next: res => {
        this.allPayments = Array.isArray(res) ? res : [];
        if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
      },
      error: () => {}
    });
    this.api.getAllCreditNotes().subscribe({
      next: res => {
        this.allCNs = Array.isArray(res) ? res : [];
        if (this.selectedCustomer) this.loadCustomerSpecificData(this.selectedCustomer.id);
      },
      error: () => {}
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

  switchSubTab(tab: string) {
    this.activeSubTab = tab;
    if (tab === 'PRICE' && this.selectedCustomer) {
      const cid = this.selectedCustomer.id || this.selectedCustomer.Id;
      if (cid) {
        this.loadCustomerPrices(cid);
        this.loadPriceProducts();
      }
    }
    this.cdr.detectChanges();
  }

  loadCustomerPrices(customerId: number) {
    if (!customerId) return;
    this.api.getCustomerProductPrices(customerId).subscribe({
      next: (res) => {
        this.customerPrices = Array.isArray(res) ? res : [];
        this.cdr.detectChanges();
      },
      error: () => {
        this.customerPrices = [];
        this.cdr.detectChanges();
      }
    });
  }

  loadPriceProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.allProducts = Array.isArray(res) ? res : []; },
      error: () => { this.allProducts = []; }
    });
  }

  getProductName(productId: number): string {
    const p = this.allProducts.find(x => (x.id ?? x.Id) == productId);
    return p ? (p.name || p.Name || p.productName || p.ProductName || 'Unknown Product') : 'Unknown Product';
  }

  getProductPrice(productId: number): number {
    const p = this.allProducts.find(x => (x.id ?? x.Id) == productId);
    return p ? Number(p.price ?? p.Price ?? 0) : 0;
  }

  openProductSelectModal() {
    this.searchText = '';
    this.selectedTempProduct = this.allProducts.find(p => (p.id ?? p.Id) === this.newPriceForm.productId) || null;
    if (!this.allProducts || this.allProducts.length === 0) {
      this.loadPriceProducts();
    }
    this.onSearch();
    this.showProductSelectModal = true;
    this.cdr.detectChanges();
  }

  closeProductSelectModal() {
    this.showProductSelectModal = false;
    this.cdr.detectChanges();
  }

  selectProductDirectly(product: any) {
    if (!product) return;
    this.selectedTempProduct = product;
    this.newPriceForm.productId = product.id ?? product.Id;
    this.showProductSelectModal = false;
    this.cdr.detectChanges();
  }

  selectTempProduct(product: any) {
    this.selectedTempProduct = product;
    this.cdr.detectChanges();
  }

  confirmProductSelection() {
    if (this.selectedTempProduct) {
      this.newPriceForm.productId = this.selectedTempProduct.id ?? this.selectedTempProduct.Id;
    }
    this.showProductSelectModal = false;
    this.cdr.detectChanges();
  }

  // =========================
  // SEARCH (Case-Insensitive & Multi-Token & Flexible Key)
  // =========================
  onSearch(event?: any) {
    if (event?.target && event.target.value !== undefined) {
      this.searchText = event.target.value;
    }
    const raw = (this.searchText || '').trim().toLowerCase();
    const tokens = raw.split(/\s+/).filter(t => t.length > 0);

    // =========================
    // NO SEARCH
    // =========================
    if (tokens.length === 0) {
      this.matchedProducts = [];
      this.otherProducts = [...this.allProducts];
      this.cdr.detectChanges();
      return;
    }

    // =========================
    // FIND MATCHING PRODUCTS
    // =========================
    this.matchedProducts = this.allProducts.filter(p => {
      const name = String(p.name || p.Name || p.productName || p.ProductName || '').toLowerCase();
      const code = String(p.code || p.Code || p.productCode || p.ProductCode || '').toLowerCase();
      const barcode = String(p.barcode || p.Barcode || '').toLowerCase();
      const sku = String(p.sku || p.Sku || '').toLowerCase();
      const category = String(p.category || p.Category || p.categoryName || p.CategoryName || '').toLowerCase();
      const desc = String(p.description || p.Description || '').toLowerCase();

      const combined = `${name} ${code} ${barcode} ${sku} ${category} ${desc}`;
      const cleanCode = code.replace(/[-_\s]/g, '');
      const cleanBarcode = barcode.replace(/[-_\s]/g, '');

      return tokens.every(token => {
        const cleanToken = token.replace(/[-_\s]/g, '');
        return combined.includes(token) || 
               (cleanCode.length > 0 && cleanCode.includes(cleanToken)) ||
               (cleanBarcode.length > 0 && cleanBarcode.includes(cleanToken));
      });
    });

    this.otherProducts = [];
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchText = '';
    this.onSearch();
  }

  getHighlightedText(text: any): string {
    const str = String(text ?? '');
    if (!this.searchText || !str) return str;
    const raw = this.searchText.trim();
    if (!raw) return str;
    const tokens = raw.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return str;

    const escaped = tokens
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return str.replace(regex, '<span class="search-highlight" style="background:#fef08a;color:#854d0e;padding:0 2px;border-radius:2px;font-weight:700;">$1</span>');
  }

  getHighlightedName(name: any): string {
    return this.getHighlightedText(name);
  }

  toggleAddPriceForm() {
    this.showAddPriceForm = !this.showAddPriceForm;
    this.newPriceForm = { productId: null, specialPrice: null };
  }

  isSavingPrice = false;

  addCustomerPrice() {
    if (this.isSavingPrice) return;
    if (!this.newPriceForm.productId || this.newPriceForm.specialPrice == null) {
      this.showToastMsg('Please select a product and enter a price');
      return;
    }
    const product = this.allProducts.find(p => p.id == this.newPriceForm.productId);
    const originalPrice = product ? product.price : 0;

    if (!this.isEditing) {
      // Local mode (when creating customer)
      const existsIndex = this.customerPrices.findIndex(p => p.productId == this.newPriceForm.productId);
      const newPriceItem = {
        productId: Number(this.newPriceForm.productId),
        productName: product ? product.name : 'Unknown Product',
        productCode: product ? product.productCode || product.code : '',
        originalPrice: originalPrice,
        specialPrice: Number(this.newPriceForm.specialPrice)
      };
      if (existsIndex > -1) {
        this.customerPrices[existsIndex] = newPriceItem;
      } else {
        this.customerPrices.push(newPriceItem);
      }
      this.showToastMsg('Price added locally');
      this.showAddPriceForm = false;
      this.newPriceForm = { productId: null, specialPrice: null };
      this.cdr.detectChanges();
      return;
    }

    const exists = this.customerPrices.some(p => p.productId == this.newPriceForm.productId);
    this.isSavingPrice = true;

    if (exists) {
      this.api.updateCustomerProductPrice(this.selectedCustomer.id, Number(this.newPriceForm.productId), {
        specialPrice: Number(this.newPriceForm.specialPrice)
      }).subscribe({
        next: () => {
          this.showToastMsg('Price updated!');
          this.showAddPriceForm = false;
          this.newPriceForm = { productId: null, specialPrice: null };
          this.loadCustomerPrices(this.selectedCustomer.id);
          this.isSavingPrice = false;
        },
        error: (err) => {
          this.showToastMsg('Failed: ' + (err.error?.message || err.message));
          this.isSavingPrice = false;
        }
      });
    } else {
      this.api.createCustomerProductPrice(this.selectedCustomer.id, {
        productId: Number(this.newPriceForm.productId),
        specialPrice: Number(this.newPriceForm.specialPrice)
      }).subscribe({
        next: () => {
          this.showToastMsg('Price created!');
          this.showAddPriceForm = false;
          this.newPriceForm = { productId: null, specialPrice: null };
          this.loadCustomerPrices(this.selectedCustomer.id);
          this.isSavingPrice = false;
        },
        error: (err) => {
          this.showToastMsg('Failed: ' + (err.error?.message || err.message));
          this.isSavingPrice = false;
        }
      });
    }
  }

  deleteCustomerPrice(productId: number) {
    this.alertService.confirm('Delete Price', 'Remove this special price?').then(ok => {
      if (!ok) return;
      if (!this.isEditing) {
        // Local mode delete
        this.customerPrices = this.customerPrices.filter(p => p.productId != productId);
        this.showToastMsg('Price removed locally');
        this.cdr.detectChanges();
        return;
      }
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
    this.updateDisplayedCustomers();
  }

  setTab(tab: string) {
    this.activeTab = tab;
    this.filteredCustomers = tab === 'ALL' ? [...this.customers] : this.customers.filter(c => !c.category || c.category === 'DEFAULT');
    this.updateDisplayedCustomers();
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredCustomers = [...this.customers]; this.updateDisplayedCustomers(); }
  }

  openAddModal() {
    this.isEditing = false;
    this.isEditMode = true;
    this.selectedCustomer = null;
    this.customerPrices = [];
    this.form = {
      name: '', phone: '', email: '', address: '',
      code: '', term: 'Cash Sale', sequence: '', category: 'DEFAULT',
      description: '', processCompany: 'ALL COMPANY', taxStatus: 'Un-Defined',
    taxDocNo: '', discount: null, enableDiscount: true, requireDigitSign: false,
      totalCredit: 0.00,
      branchCode: '', branchName: '', branchAddress: '',
      branchPostcode: '', branchCity: '', branchState: '',
      isDefaultBranch: false
    };
    this.showModal = true;
    this.loadPriceProducts();
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
          enableDiscount: fullCustomer.enableDiscount != null ? fullCustomer.enableDiscount : (fullCustomer.discountPercent > 0),
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
        // Fallback to customer passed from list so offline edit modal can still open
        if (customer) {
          this.isModalLoading = false;
          this.selectedCustomer = customer;
          const branch = (customer.branches && customer.branches.length > 0) ? customer.branches[0] : null;
          this.form = {
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            address: customer.address || '',
            code: customer.customerCode || '',
            term: customer.term || 'Cash Sale',
            sequence: customer.sequence || '',
            category: customer.customerCategory || 'DEFAULT',
            description: customer.description || '',
            processCompany: customer.processCompany || 'ALL COMPANY',
            taxStatus: customer.taxStatus || 'Un-Defined',
            taxDocNo: customer.taxDocNo || '',
            discount: customer.discountPercent || 0,
            enableDiscount: customer.enableDiscount != null ? customer.enableDiscount : (customer.discountPercent > 0),
            requireDigitSign: customer.requireDigitSign || false,
            totalCredit: 0,
            branchCode: branch ? (branch.code || '') : '',
            branchName: branch ? (branch.name || '') : '',
            branchAddress: branch ? (branch.address1 || '') : (customer.address || ''),
            branchPostcode: branch ? (branch.postcode || '') : '',
            branchCity: branch ? (branch.city || '') : '',
            branchState: branch ? (branch.state || '') : '',
            isDefaultBranch: branch ? (branch.isDefaultBranch || false) : false,
            _hasBranch: !!branch
          };
          this.loadCustomerSpecificData(customer.id);
          this.loadCustomerPrices(customer.id);
          this.loadPriceProducts();
        } else {
          this.isModalLoading = false;
          this.showModal = false;
          this.showToastMsg('Failed to load customer data');
        }
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
      enableDiscount: this.form.enableDiscount != null ? !!this.form.enableDiscount : true,
      requireDigitSign: this.form.requireDigitSign || false,
      phone: this.form.phone || '',
      email: this.form.email || '',
      address: this.form.address || ''
    };

    // Include branches if: (1) user explicitly provided a branch code/name, or (2) customer already had a branch
    const hasBranchInput = !!(branchPayload.code || branchPayload.name);
    const hasOtherBranchDetails = !!(branchPayload.address1 || branchPayload.postcode || branchPayload.city || branchPayload.state);
    const alreadyHasBranch = !!this.form._hasBranch;

    if (hasBranchInput || (hasOtherBranchDetails && !alreadyHasBranch) || alreadyHasBranch) {
      // Auto-fill branch code and name from customer name if left empty
      if (!branchPayload.code) {
        branchPayload.code = this.form.code || 'MAIN';
      }
      if (!branchPayload.name) {
        branchPayload.name = this.form.name || 'HQ';
      }
      payload.branches = [branchPayload];
    }

    if (this.isEditing && this.selectedCustomer) {
      this.api.editCustomer(this.selectedCustomer.id, payload).subscribe({
        next: (res: any) => {
          this.showToastMsg(res?.isOffline ? 'Customer updated offline! (Queued for sync)' : 'Customer updated!');
          this.closeModal();
          this.loadCustomers();
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || JSON.stringify(err.error) || err.message || 'error'))
      });
    } else {
      this.api.createCustomer(payload).subscribe({
        next: (res: any) => {
          const isOffline = !!res?.isOffline;
          const newCustomerId = res?.data?.id || res?.id;
          if (newCustomerId && this.customerPrices.length > 0) {
            let hasError = false;
            const saveNext = (index: number) => {
              if (index >= this.customerPrices.length) {
                if (hasError) {
                  this.showToastMsg(isOffline ? 'Customer saved offline, but failed to save some special prices.' : 'Customer created, but failed to save some special prices.');
                } else {
                  this.showToastMsg(isOffline ? 'Customer saved offline with special prices! (Queued for sync)' : 'Customer created with special prices!');
                }
                this.closeModal();
                this.loadCustomers();
                return;
              }
              const cp = this.customerPrices[index];
              this.api.createCustomerProductPrice(newCustomerId, {
                productId: cp.productId,
                specialPrice: cp.specialPrice
              }).subscribe({
                next: () => {
                  saveNext(index + 1);
                },
                error: () => {
                  hasError = true;
                  saveNext(index + 1);
                }
              });
            };
            saveNext(0);
          } else {
            this.showToastMsg(isOffline ? 'Customer saved offline! (Queued for sync)' : 'Customer created!');
            this.closeModal();
            this.loadCustomers();
          }
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || JSON.stringify(err.error) || err.message || 'error'))
      });
    }
  }

  confirmDelete(customer: any) { this.selectedCustomer = customer; this.alertService.confirm('Delete Customer', 'Delete ' + (customer.name || '') + '?').then(c => { if (c) this.deleteCustomer(); }); }

  deleteCustomer() {
    if (!this.selectedCustomer) return;
    this.api.deleteCustomer(this.selectedCustomer.id).subscribe({
      next: (res: any) => {
        this.showToastMsg(res?.isOffline ? 'Customer deleted offline! (Queued for sync)' : 'Customer deleted!');
        this.loadCustomers();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  formatSpecialPrice(val: any): string {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val).toFixed(2);
  }

  onSpecialPriceInput(event: any) {
    let inputVal = event.target.value;
    let digits = inputVal.replace(/\D/g, '');
    let amount = 0;
    if (digits) {
      amount = parseInt(digits, 10) / 100;
    }
    this.newPriceForm.specialPrice = amount;
    event.target.value = amount.toFixed(2);

    // Force cursor to the end
    setTimeout(() => {
      if (event.target) {
        const len = event.target.value.length;
        event.target.setSelectionRange(len, len);
      }
    }, 0);
  }

  onSpecialPriceFocus(event: any) {
    setTimeout(() => {
      if (event.target) {
        const len = event.target.value.length;
        event.target.setSelectionRange(len, len);
      }
    }, 0);
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goBack() {
    if (this.showProductSelectModal) {
      this.closeProductSelectModal();
      this.cdr.detectChanges();
      return;
    }
    if (this.showAddPriceForm) {
      this.showAddPriceForm = false;
      this.cdr.detectChanges();
      return;
    }
    if (this.activeReport) {
      this.activeReport = null;
      this.cdr.detectChanges();
      return;
    }
    if (this.showModal) {
      this.closeModal();
      this.cdr.detectChanges();
      return;
    }
    if (this.showSearch) {
      this.showSearch = false;
      this.searchTerm = '';
      this.filterCustomers();
      this.cdr.detectChanges();
      return;
    }
    this.navCtrl.navigateRoot('pages/home');
  }

  isOfflineCustomer(id: any): boolean {
    return typeof id === 'string' && id.startsWith('cust_off_');
  }

  async manualSync() {
    if (this.isSyncing) return;
    this.showToastMsg('Syncing offline data...');
    const res = await this.syncService.syncPendingInvoices(true);
    if (res.successCount > 0) {
      this.showToastMsg(`Synced ${res.successCount} item(s) successfully!`);
      this.loadCustomers();
    } else if (res.failCount > 0) {
      this.alertService.confirm(
        'Sync Failed',
        `Server temporarily returned an error while syncing ${res.failCount} task(s). Your offline data is safely preserved. Clear from queue only if you want to permanently discard it.`,
        'Retry Sync',
        'Clear Queue'
      ).then(retry => {
        if (retry) {
          this.manualSync();
        } else {
          this.offlineStorage.clearQueue().then(() => {
            this.showToastMsg('Queue cleared.');
            this.loadCustomers();
          });
        }
      });
    } else {
      this.showToastMsg('All offline items are already synchronized.');
    }
  }

  ionViewWillLeave() {
    this.unregisterBackButton();
    this.queueCountSub?.unsubscribe();
    this.syncingSub?.unsubscribe();
  }

  ngOnDestroy() {
    this.unregisterBackButton();
    this.queueCountSub?.unsubscribe();
    this.syncingSub?.unsubscribe();
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
}



