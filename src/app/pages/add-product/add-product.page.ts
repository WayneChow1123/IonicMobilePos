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
  selector: 'app-add-product',
  templateUrl: './add-product.page.html',
  styleUrls: ['./add-product.page.scss'],
})
export class AddProductPage implements OnInit {
  categories: any[] = [];
  isLoading = false;
  showModal = false;
  isEditing = false;
  selectedCategory: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  form: any = { categoryName: '', code: '' };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCategory() }
  ];

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef) {}

  ionViewWillEnter() {
    this.cdr.detectChanges();
  }

  ngOnInit() { this.loadCategories(); }

  loadCategories() {
    this.isLoading = true;
    this.api.getCategories().subscribe({
      next: (res) => { this.categories = Array.isArray(res) ? res : []; this.isLoading = false; },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load categories'); }
    });
  }

  openAddModal() {
    this.isEditing = false;
    this.selectedCategory = null;
    this.form = { categoryName: '', code: '' };
    this.showModal = true;
  }

  openEditModal(category: any) {
    this.isEditing = true;
    this.selectedCategory = category;
    this.form = { categoryName: category.categoryName || category.name || '', code: category.code || '' };
    this.showModal = true;
  }

  closeModal() { this.showModal = false; }

  saveCategory() {
    if (!this.form.categoryName) { this.showToastMsg('Category name is required'); return; }
    if (this.isEditing && this.selectedCategory) {
      this.api.editCategory(this.selectedCategory.id, this.form).subscribe({
        next: () => { this.showToastMsg('Category updated!'); this.closeModal(); this.loadCategories(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      this.api.createCategory(this.form).subscribe({
        next: () => { this.showToastMsg('Category created!'); this.closeModal(); this.loadCategories(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  confirmDelete(category: any) { this.selectedCategory = category; this.showDeleteAlert = true; }

  deleteCategory() {
    if (!this.selectedCategory) return;
    this.api.deleteCategory(this.selectedCategory.id).subscribe({
      next: () => { this.showToastMsg('Category deleted!'); this.loadCategories(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goBack() { this.navCtrl.navigateRoot('pages/home'); }
}
