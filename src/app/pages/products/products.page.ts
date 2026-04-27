import { Component, OnInit } from '@angular/core';
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
  isLoading = false;
  showSearch = false;
  searchTerm = '';
  activeTab = 'ALL';
  showModal = false;
  isEditing = false;
  selectedProduct: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  form: any = {
    name: '',
    description: '',
    barcode: '',
    category: '',
    uom: 'UNIT',
    price: 0,
    rate: 1,
    cost: 0,
    lowestPrice: 0,
    stock: 0,
    includeTax: false
  };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteProduct() }
  ];

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() { this.loadProducts(); this.loadCategories(); }

  loadProducts() {
    this.isLoading = true;
    this.api.getProducts().subscribe({
      next: (res) => { this.products = Array.isArray(res) ? res : []; this.filteredProducts = [...this.products]; this.isLoading = false; },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load products'); }
    });
  }

  loadCategories() {
    this.api.getCategories().subscribe({
      next: (res) => { this.categories = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  filterProducts() {
    this.filteredProducts = this.products.filter(p =>
      (p.name || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      (p.barcode || '').toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  setTab(tab: string) {
    this.activeTab = tab;
    this.filteredProducts = tab === 'ALL' ? [...this.products] : this.products.filter(p => p.category === 'DEFAULT' || !p.category);
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredProducts = [...this.products]; }
  }

  openAddModal() {
    this.isEditing = false;
    this.selectedProduct = null;
    this.form = { name: '', description: '', barcode: '', category: '', uom: 'UNIT', price: 0, rate: 1, cost: 0, lowestPrice: 0, stock: 0, includeTax: false };
    this.showModal = true;
  }

  openEditModal(product: any) {
    this.isEditing = true;
    this.selectedProduct = product;
    this.form = {
      name: product.name || '',
      description: product.description || '',
      barcode: product.barcode || '',
      category: product.category || '',
      uom: product.uom || 'UNIT',
      price: product.price || 0,
      rate: product.rate || 1,
      cost: product.cost || 0,
      lowestPrice: product.lowestPrice || 0,
      stock: product.stock || 0,
      includeTax: product.includeTax || false
    };
    this.showModal = true;
  }

  closeModal() { this.showModal = false; }

  saveProduct() {
    if (!this.form.name) { this.showToastMsg('Product name is required'); return; }
    if (this.isEditing && this.selectedProduct) {
      this.api.editProduct(this.selectedProduct.id, this.form).subscribe({
        next: () => { this.showToastMsg('Product updated!'); this.closeModal(); this.loadProducts(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.createProduct(this.form).subscribe({
        next: () => { this.showToastMsg('Product created!'); this.closeModal(); this.loadProducts(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  confirmDelete(product: any) { this.selectedProduct = product; this.showDeleteAlert = true; }

  deleteProduct() {
    if (!this.selectedProduct) return;
    this.api.deleteProduct(this.selectedProduct.id).subscribe({
      next: () => { this.showToastMsg('Product deleted!'); this.loadProducts(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goBack() { this.router.navigate(['pages/home']); }
}
