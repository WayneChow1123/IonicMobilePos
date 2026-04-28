import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-invoices',
  templateUrl: './invoices.page.html',
  styleUrls: ['./invoices.page.scss'],
})
export class InvoicesPage implements OnInit {
  invoices: any[] = [];
  filteredInvoices: any[] = [];
  customers: any[] = [];
  products: any[] = [];
  isLoading = false;
  showModal = false;
  showSearch = false;
  searchTerm = '';
  isEditing = false;
  selectedInvoice: any = null;
  showDeleteAlert = false;
  showToast = false;
  toastMessage = '';
  form: any = { customerId: 0, invoiceDate: new Date().toISOString(), remark: '', items: [{ productId: 0, quantity: 1 }] };
  editForm: any = { invoiceDate: new Date().toISOString(), remark: '', items: [{ productId: 0, quantity: 1, unitPrice: 0 }] };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteInvoice() }
  ];

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() { this.loadInvoices(); this.loadCustomers(); this.loadProducts(); }

  loadInvoices() {
    this.isLoading = true;
    this.api.getInvoices().subscribe({
      next: (res) => {
        this.invoices = Array.isArray(res) ? res : [];
        this.filteredInvoices = [...this.invoices];
        this.isLoading = false;
      },
      error: () => { this.isLoading = false; this.showToastMsg('Failed to load invoices'); }
    });
  }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  loadProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.products = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) { this.searchTerm = ''; this.filteredInvoices = [...this.invoices]; }
  }

  filterInvoices() {
    this.filteredInvoices = this.invoices.filter(inv =>
      (inv.invoiceNumber || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
      (inv.customerName || '').toLowerCase().includes(this.searchTerm.toLowerCase())
    );
  }

  openAddModal() {
    this.isEditing = false;
    this.selectedInvoice = null;
    this.form = { customerId: this.customers.length > 0 ? this.customers[0].id : 0, invoiceDate: new Date().toISOString(), remark: '', items: [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1 }] };
    this.showModal = true;
  }

  openEditModal(invoice: any) {
    this.isEditing = true;
    this.selectedInvoice = null;
    this.isLoading = true;
    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.isLoading = false;
        this.selectedInvoice = res;
        this.editForm = {
          invoiceDate: res.invoiceDate || new Date().toISOString(),
          remark: res.remark || '',
          items: (res.items && res.items.length > 0)
            ? res.items.map((i: any) => ({ productId: i.productId || 0, quantity: i.quantity || 1, unitPrice: i.unitPrice || 0 }))
            : [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0 }]
        };
        this.showModal = true;
      },
      error: () => {
        this.isLoading = false;
        this.selectedInvoice = invoice;
        this.editForm = { invoiceDate: invoice.invoiceDate || new Date().toISOString(), remark: invoice.remark || '', items: [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0 }] };
        this.showModal = true;
      }
    });
  }

  closeModal() { this.showModal = false; }

  addItem() {
    if (this.isEditing) {
      this.editForm.items.push({ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0 });
    } else {
      this.form.items.push({ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1 });
    }
  }

  removeItem(index: number) {
    if (this.isEditing) {
      if (this.editForm.items.length > 1) this.editForm.items.splice(index, 1);
    } else {
      if (this.form.items.length > 1) this.form.items.splice(index, 1);
    }
  }

  saveInvoice() {
    // Validate items
    const items = this.isEditing ? this.editForm.items : this.form.items;
    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) { this.showToastMsg("Quantity must be greater than 0"); return; }
      if (this.isEditing && item.unitPrice !== undefined && item.unitPrice <= 0) { this.showToastMsg("Unit price must be greater than 0"); return; }
    }
    if (this.isEditing && this.selectedInvoice) {
      this.api.updateInvoice(this.selectedInvoice.id, this.editForm).subscribe({
        next: () => { this.showToastMsg('Invoice updated!'); this.closeModal(); this.loadInvoices(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      if (!this.form.customerId) { this.showToastMsg('Please select a customer'); return; }
      this.api.createInvoice(this.form).subscribe({
        next: () => { this.showToastMsg('Invoice created!'); this.closeModal(); this.loadInvoices(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    }
  }

  confirmDelete(invoice: any) { this.selectedInvoice = invoice; this.showDeleteAlert = true; }

  deleteInvoice() {
    if (!this.selectedInvoice) return;
    this.api.deleteInvoice(this.selectedInvoice.id).subscribe({
      next: () => { this.showToastMsg('Invoice deleted!'); this.loadInvoices(); },
      error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
    });
  }

  getTotalCN(): number {
    if (!this.selectedInvoice?.creditNotes) return 0;
    return this.selectedInvoice.creditNotes.reduce((sum: number, cn: any) => sum + (cn.amount || 0), 0);
  }

  getCustomerName(id: any) {
    const c = this.customers.find(c => c.id == id);
    return c ? c.name : 'Customer #' + id;
  }

  getProductName(id: any) {
    const p = this.products.find(p => p.id == id);
    return p ? p.name : 'Product #' + id;
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goBack() { this.router.navigate(['pages/billing']); }
}
