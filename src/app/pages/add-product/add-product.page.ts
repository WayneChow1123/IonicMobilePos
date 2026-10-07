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
  selector: 'app-add-product',
  templateUrl: './add-product.page.html',
  styleUrls: ['./add-product.page.scss'],
})
export class AddProductPage implements OnInit, OnDestroy {
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

  confirmDelete(category: any) { this.selectedCategory = category; this.alertService.confirm('Delete Category', 'Delete ' + (category.categoryName || category.name || '') + '?').then(c => { if(c) this.deleteCategory(); }); }

  deleteCategory() {
    if (!this.selectedCategory) return;
    this.api.deleteCategory(this.selectedCategory.id).subscribe({
      next: () => { this.showToastMsg('Category deleted!'); this.loadCategories(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }

  goBack() {
    if (this.showModal) {
      this.closeModal();
      this.cdr.detectChanges();
      return;
    }
    this.navCtrl.navigateRoot('pages/home');
  }
}
