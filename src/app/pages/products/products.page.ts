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
  selector: 'app-products',
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
})
export class ProductsPage implements OnInit {
  products: any[] = [];
  filteredProducts: any[] = [];
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
  form: any = { name: '', description: '', barcode: '', code: '', category: 'DEFAULT', uom: 'UNIT', price: 0, rate: null, cost: 0, lowestPrice: 0, stock: null, includeTax: false, salesDefault: false, returnDefault: false };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteProduct() }
  ];

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}

  ionViewWillEnter() {
    this.cdr.detectChanges();
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
    if (payload.stock < 0) { this.showToastMsg('Stock cannot be negative'); return; }
    if (!payload.category) payload.category = 'DEFAULT';
    if (this.isEditing && this.selectedProduct) {
      this.api.editProduct(this.selectedProduct.id, payload).subscribe({
        next: () => { 
          this.showToastMsg('Product updated!'); 
          this.isEditMode = false; 
          this.loadProducts(); 
        },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.createProduct(payload).subscribe({
        next: () => { 
          this.showToastMsg('Product created!'); 
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
        next: () => { this.showToastMsg(product.name + ' deactivated!'); this.loadProducts(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.activateProduct(product.id).subscribe({
        next: () => { this.showToastMsg(product.name + ' activated!'); this.loadProducts(); },
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
        this.showToastMsg('Stock added! New stock: ' + res.newStock);
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
      next: () => { this.showToastMsg('Product deleted!'); this.loadProducts(); },
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
  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}



