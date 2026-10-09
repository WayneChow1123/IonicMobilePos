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
  selector: 'app-products',
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
})
export class ProductsPage implements OnInit, OnDestroy {
  products: any[] = [];
  filteredProducts: any[] = [];
  displayedProducts: any[] = [];
  pageSize = 30;
  currentPage = 1;
  isLoadingMore = false;
  categories: any[] = [];
  categoryTabs: string[] = ['ALL', 'DEFAULT'];
  isLoading = false;
  showSearch = false;
  searchTerm = '';
  activeTab = 'ALL';
  showModal = false;
  showAddStockModal = false;
  isEditing = false;
  isEditMode = false;
  selectedProduct: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  addStockQty = 0;
  pendingOfflineCount: number = 0;
  isSyncing: boolean = false;
  form: any = { name: '', description: '', barcode: '', code: '', category: 'DEFAULT', uom: 'UNIT', price: 0, rate: null, cost: 0, lowestPrice: 0, stock: null, includeTax: false, salesDefault: false, returnDefault: false };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteProduct() }
  ];

  private backButtonSub?: Subscription;
  private queueCountSub?: Subscription;
  private syncingSub?: Subscription;
  private syncCompletedSub?: Subscription;

  constructor(
    private router: Router,
    private navCtrl: NavController,
    private api: ApiService,
    private offlineStorage: OfflineStorageService,
    private syncService: SyncService,
    private cdr: ChangeDetectorRef,
    private alertService: AlertService,
    private platform: Platform
  ) {}

  ionViewWillEnter() {
    this.registerBackButton();
    this.initSyncSubscriptions();
    this.offlineStorage.refreshQueueCount();
    this.loadProducts();
    this.loadCategories();
    this.cdr.detectChanges();
  }

  ionViewWillLeave() {
    this.unregisterBackButton();
    this.unsubscribeSync();
  }

  ngOnDestroy() {
    this.unregisterBackButton();
    this.unsubscribeSync();
  }

  private initSyncSubscriptions() {
    this.unsubscribeSync();
    this.queueCountSub = this.offlineStorage.queueCount$.subscribe(count => {
      this.pendingOfflineCount = count;
      this.cdr.detectChanges();
    });
    this.syncingSub = this.syncService.isSyncing$.subscribe(syncing => {
      this.isSyncing = syncing;
      this.cdr.detectChanges();
    });
    this.syncCompletedSub = this.syncService.syncCompleted$.subscribe(() => {
      this.loadProducts();
      this.loadCategories();
      this.cdr.detectChanges();
    });
  }

  private unsubscribeSync() {
    this.queueCountSub?.unsubscribe();
    this.queueCountSub = undefined;
    this.syncingSub?.unsubscribe();
    this.syncingSub = undefined;
    this.syncCompletedSub?.unsubscribe();
    this.syncCompletedSub = undefined;
  }

  async manualSync() {
    if (this.isSyncing) return;
    this.showToastMsg('Syncing offline data...');
    const res = await this.syncService.syncPendingOrders(true);
    if (res.successCount > 0) {
      this.showToastMsg(`Synced ${res.successCount} item(s) successfully!`);
      this.loadProducts();
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
            this.loadProducts();
          });
        }
      });
    } else {
      this.showToastMsg('All offline items are already synchronized.');
    }
  }

  registerBackButton() {
    this.unregisterBackButton();
    this.backButtonSub = this.platform.backButton.subscribeWithPriority(10, () => {
      if (Swal.isVisible()) {
        Swal.close();
        return;
      }
      if (this.showAddStockModal) {
        this.closeAddStockModal();
        this.cdr.detectChanges();
        return;
      }
      if (this.showModal) {
        this.closeModal();
        this.cdr.detectChanges();
        return;
      }
      if (this.showSearch) {
        this.toggleSearch();
        this.cdr.detectChanges();
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

  ngOnInit() { this.loadProducts(); this.loadCategories(); }

  loadProducts() {
    this.isLoading = true;
    this.api.getProducts().subscribe({
      next: (res) => { this.products = Array.isArray(res) ? res : []; this.filterProducts(); this.isLoading = false; },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load products'); }
    });
  }

  loadCategories() {
    this.api.getCategories().subscribe({
      next: (res) => {
        this.categories = Array.isArray(res) ? res : [];
        const catNames = this.categories.map((c: any) => c.categoryName || c.name).filter(c => c && c !== 'DEFAULT');
        this.categoryTabs = ['ALL', 'DEFAULT', ...catNames];
      },
      error: () => {}
    });
  }

  filterProducts() {
    let filtered = [...this.products];
    if (this.activeTab !== 'ALL') {
      filtered = filtered.filter(p => (p.category || 'DEFAULT') === this.activeTab);
    }
    if (this.searchTerm) {
      filtered = filtered.filter(p =>
        (p.name || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (p.barcode || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (p.code || '').toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    this.filteredProducts = filtered;
    this.currentPage = 1;
    this.displayedProducts = this.filteredProducts.slice(0, this.pageSize);
  }

  loadMore() {
    if (this.displayedProducts.length >= this.filteredProducts.length) return;
    this.isLoadingMore = true;
    setTimeout(() => {
      this.currentPage++;
      this.displayedProducts = this.filteredProducts.slice(0, this.currentPage * this.pageSize);
      this.isLoadingMore = false;
      this.cdr.detectChanges();
    }, 300);
  }

  onInfinite(event: any) {
    if (this.displayedProducts.length >= this.filteredProducts.length) {
      event.target.complete();
      return;
    }
    this.currentPage++;
    setTimeout(() => {
      this.displayedProducts = this.filteredProducts.slice(0, this.currentPage * this.pageSize);
      event.target.complete();
      this.cdr.detectChanges();
    }, 400);
  }

  setTab(tab: string) { this.activeTab = tab; this.filterProducts(); }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filterProducts(); }
  }

  openAddModal() {
    this.isEditing = false;
    this.isEditMode = true;
    this.selectedProduct = null;
    this.form = { name: '', description: '', barcode: '', code: '', category: 'DEFAULT', uom: 'UNIT', price: 0, rate: null, cost: 0, lowestPrice: 0, stock: null, includeTax: false, salesDefault: false, returnDefault: false };
    this.showModal = true;
  }

  openEditModal(product: any) {
    this.isEditing = true;
    this.isEditMode = false;
    this.selectedProduct = product;
    this.form = {
      name: product.name || '',
      description: product.description || '',
      barcode: product.barcode || '',
      code: product.code || '',
      category: product.category || 'DEFAULT',
      uom: product.uom || 'UNIT',
      price: product.price || 0,
      rate: product.rate || 1,
      cost: product.cost || 0,
      lowestPrice: product.lowestPrice || 0,
      stock: product.stock || 0,
      includeTax: product.includeTax || false,
      salesDefault: product.salesDefault || false,
      returnDefault: product.returnDefault || false
    };
    this.showModal = true;
  }

  toggleEditMode() {
    if (this.isEditMode) {
      this.saveProduct();
    } else {
      this.isEditMode = true;
    }
  }

  closeModal() { this.showModal = false; this.isEditMode = false; }

  saveProduct() {
    if (!this.form.name) { this.showToastMsg('Product name is required'); return; }
    const payload = {
      ...this.form,
      stock: this.form.stock == null ? 0 : Number(this.form.stock),
      rate: this.form.rate == null ? 1 : Number(this.form.rate)
    };
    if (payload.price < 0) { this.showToastMsg('Price cannot be negative'); return; }
    if (!payload.category) payload.category = 'DEFAULT';
    if (this.isEditing && this.selectedProduct) {
      this.api.editProduct(this.selectedProduct.id, payload).subscribe({
        next: (res: any) => { 
          this.showToastMsg(res?.isOffline ? 'Product updated offline! (Queued for sync)' : 'Product updated!'); 
          this.isEditMode = false; 
          this.closeModal(); 
          this.loadProducts(); 
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.createProduct(payload).subscribe({
        next: (res: any) => { 
          this.showToastMsg(res?.isOffline ? 'Product created offline! (Queued for sync)' : 'Product created!'); 
          this.isEditMode = false; 
          this.closeModal(); 
          this.loadProducts(); 
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  toggleActive(product: any) {
    if (product.isActive) {
      this.api.deactivateProduct(product.id).subscribe({
        next: (res: any) => { 
          this.showToastMsg(res?.isOffline ? (product.name + ' deactivated offline! (Queued for sync)') : (product.name + ' deactivated!')); 
          this.loadProducts(); 
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.activateProduct(product.id).subscribe({
        next: (res: any) => { 
          this.showToastMsg(res?.isOffline ? (product.name + ' activated offline! (Queued for sync)') : (product.name + ' activated!')); 
          this.loadProducts(); 
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  openAddStockModal(product: any) {
    this.selectedProduct = product;
    this.addStockQty = 0;
    this.showAddStockModal = true;
  }

  closeAddStockModal() { this.showAddStockModal = false; }

  submitAddStock() {
    if (!this.addStockQty || this.addStockQty <= 0) { this.showToastMsg('Quantity must be greater than 0'); return; }
    this.api.addStock(this.selectedProduct.id, { quantity: this.addStockQty }).subscribe({
      next: (res: any) => {
        this.showToastMsg(res?.isOffline ? ('Stock added offline! New stock: ' + res.newStock + ' (Queued for sync)') : ('Stock added! New stock: ' + res.newStock));
        this.closeAddStockModal();
        this.loadProducts();
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  confirmDelete(product: any) { this.selectedProduct = product; this.alertService.confirm('Delete Product', 'Delete ' + (product.name || '') + '?').then(c => { if(c) this.deleteProduct(); }); }

  deleteProduct() {
    if (!this.selectedProduct) return;
    this.api.deleteProduct(this.selectedProduct.id).subscribe({
      next: (res: any) => { 
        this.showToastMsg(res?.isOffline ? 'Product deleted offline! (Queued for sync)' : 'Product deleted!'); 
        this.loadProducts(); 
      },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  noLeadingZero(event: KeyboardEvent, val: any) {
    if ((val === 0 || val === "" || val === null || val === undefined) && event.key === "0") {
      event.preventDefault();
    }
  }

  formatValue(val: any): string {
    if (val === null || val === undefined || isNaN(val)) return '0.00';
    return Number(val).toFixed(2);
  }

  onCurrencyInput(event: any, field: 'price' | 'cost' | 'lowestPrice') {
    let inputVal = event.target.value;
    let digits = inputVal.replace(/\D/g, '');
    let amount = 0;
    if (digits) {
      amount = parseInt(digits, 10) / 100;
    }
    this.form[field] = amount;
    event.target.value = amount.toFixed(2);
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }

  goBack() {
    if (this.showAddStockModal) {
      this.closeAddStockModal();
      this.cdr.detectChanges();
      return;
    }
    if (this.showModal) {
      this.closeModal();
      this.cdr.detectChanges();
      return;
    }
    if (this.showSearch) {
      this.toggleSearch();
      this.cdr.detectChanges();
      return;
    }
    this.navCtrl.navigateRoot('pages/home');
  }
}



