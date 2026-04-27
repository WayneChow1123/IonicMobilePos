import { Component, OnInit } from '@angular/core';
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
  selectedCustomer: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  form: any = { name: '', phone: '', email: '', address: '' };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCustomer() }
  ];

  constructor(private router: Router, private api: ApiService) {}

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
    this.selectedCustomer = null;
    this.form = { name: '', phone: '', email: '', address: '' };
    this.showModal = true;
  }

  openEditModal(customer: any) {
    this.isEditing = true;
    this.selectedCustomer = customer;
    this.form = {
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || ''
    };
    this.showModal = true;
  }

  closeModal() { this.showModal = false; }

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

  confirmDelete(customer: any) { this.selectedCustomer = customer; this.showDeleteAlert = true; }

  deleteCustomer() {
    if (!this.selectedCustomer) return;
    this.api.deleteCustomer(this.selectedCustomer.id).subscribe({
      next: () => { this.showToastMsg('Customer deleted!'); this.loadCustomers(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goBack() { this.router.navigate(['pages/home']); }
}
