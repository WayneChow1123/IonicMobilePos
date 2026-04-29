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
  selectedCustomerDetail: any = null;
  showCheckPreview = false;
  previewData: any = null;
  allProducts: any[] = [];

  loadAllProducts() {
    this.api.getProducts().subscribe({
      next: (res) => { this.allProducts = (Array.isArray(res) ? res : []).filter((p: any) => p.isActive !== false); },
      error: () => {}
    });
  }
  form: any = { customerId: 0, invoiceDate: new Date().toISOString(), remark: '', useCreditBalance: false, items: [{ productId: 0, quantity: 1 }] };
  editForm: any = { invoiceDate: new Date().toISOString(), remark: '', items: [{ productId: 0, quantity: 1, unitPrice: 0 }] };
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteInvoice() }
  ];

  constructor(private router: Router, private api: ApiService) {}

  ngOnInit() { this.loadInvoices(); this.loadCustomers(); this.loadProducts(); this.loadAllProducts(); }

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
      next: (res) => {
        const all = Array.isArray(res) ? res : [];
        this.products = all.filter((p: any) => p.stock > 0 && p.isActive !== false);
      },
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

  onCustomerChange() {
    if (this.form.customerId) {
      const customer = this.customers.find((c: any) => c.id == this.form.customerId);
      this.selectedCustomerDetail = customer || null;
      this.form.useCreditBalance = false;
    }
  }

  getCustomerCreditBalance(): number {
    if (!this.selectedCustomerDetail) return 0;
    return this.selectedCustomerDetail.creditBalance || 0;
  }

  openAddModal() {
    this.isEditing = false;
    this.selectedInvoice = null;
    this.selectedCustomerDetail = this.customers.length > 0 ? this.customers[0] : null;
    this.form = {
      customerId: this.customers.length > 0 ? this.customers[0].id : 0,
      invoiceDate: new Date().toISOString(),
      remark: '',
      useCreditBalance: false,
      items: [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1 }]
    };
    this.showModal = true;
  }

  openEditModal(invoice: any) {
    this.isEditing = true;
    this.selectedInvoice = null;
    this.isLoading = true;
    this.api.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.isLoading = false;
        this.selectedInvoice = {
          ...res,
          customerName: res.customerName || invoice.customerName,
          customerId: res.customerId ?? invoice.customerId,
        };
        this.editForm = {
          invoiceDate: res.invoiceDate || new Date().toISOString(),
          remark: res.remark || '',
          items: (res.items && res.items.length > 0)
            ? res.items.map((i: any) => ({ productId: i.productId || 0, quantity: i.quantity || 1, unitPrice: i.unitPrice || 0, productName: i.productName || '' }))
            : [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0, productName: '' }]
        };
        this.showModal = true;
      },
      error: () => {
        this.isLoading = false;
        this.selectedInvoice = invoice;
        this.editForm = { invoiceDate: invoice.invoiceDate || new Date().toISOString(), remark: invoice.remark || '', items: [{ productId: this.products.length > 0 ? this.products[0].id : 0, quantity: 1, unitPrice: 0, productName: '' }] };
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
    const items = this.isEditing ? this.editForm.items : this.form.items;
    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) { this.showToastMsg('Quantity must be greater than 0'); return; }
      if (this.isEditing && item.unitPrice !== undefined && item.unitPrice <= 0) { this.showToastMsg('Unit price must be greater than 0'); return; }
    }
    if (this.isEditing && this.selectedInvoice) {
      if (this.selectedInvoice.status === 'Paid') { this.showToastMsg('Invoice is fully paid and cannot be modified'); return; }
      this.api.updateInvoice(this.selectedInvoice.id, this.editForm).subscribe({
        next: () => { this.showToastMsg('Invoice updated!'); this.closeModal(); this.loadInvoices(); this.loadCustomers(); },
        error: (err: any) => this.showToastMsg('Failed: ' + (err.error?.message || err.message || 'error'))
      });
    } else {
      if (!this.form.customerId) { this.showToastMsg('Please select a customer'); return; }
      this.api.createInvoice(this.form).subscribe({
        next: () => { this.showToastMsg('Invoice created!'); this.closeModal(); this.loadInvoices(); this.loadCustomers(); },
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
    const c = this.customers.find((c: any) => c.id == id);
    return c ? c.name : 'Customer #' + id;
  }

  getCustomer(id: any) {
    return this.customers.find((c: any) => c.id == id);
  }

  getProductName(id: any) {
    const p = this.products.find((p: any) => p.id == id);
    return p ? p.name : 'Product #' + id;
  }

  showToastMsg(msg: string) { this.toastMessage = msg; this.showToast = true; }
  goBack() { this.router.navigate(['pages/billing']); }

  openCheckPreview() {
    if (!this.selectedInvoice) return;
    this.api.previewInvoice(this.selectedInvoice.id).subscribe({
      next: (data: any) => { this.previewData = data; this.showCheckPreview = true; },
      error: () => { this.previewData = null; this.showCheckPreview = true; }
    });
  }

  downloadReceipt() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { this.showToastMsg('Please allow pop-ups to download'); return; }
    const styles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', monospace; background: #F0EBE3; display: flex; justify-content: center; padding: 40px 20px; } .receipt { background: #fff; border-radius: 24px; padding: 40px 36px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); } .receipt-type { display: block; text-align: center; font-size: 13px; letter-spacing: 6px; color: #888; margin-bottom: 16px; } .divider { height: 1px; background: #1a1a1a; margin: 12px 0; } .divider-thin { height: 1px; background: #ddd; margin: 12px 0; } .company { text-align: center; font-size: 22px; font-weight: 700; margin: 12px 0 4px; } .co-reg { display: block; text-align: center; font-size: 12px; color: #888; margin-bottom: 8px; } .address { display: block; text-align: center; font-size: 11px; color: #666; line-height: 1.6; } .contact { display: block; text-align: center; font-size: 11px; color: #888; margin-top: 6px; } .doc-row { display: flex; gap: 12px; margin: 4px 0; } .doc-label { font-size: 12px; font-weight: 700; min-width: 70px; } .doc-value { font-size: 12px; font-weight: 700; } .to-section { margin: 16px 0; } .to-label { font-size: 12px; font-style: italic; color: #888; } .to-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 6px; font-size: 12px; line-height: 1.6; } .table-header { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; font-style: italic; } .item-row { margin: 12px 0; } .item-desc { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; } .item-calc { font-size: 11px; color: #888; margin-top: 2px; display: flex; justify-content: space-between; } .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; } .net-bar { background: #1a1a1a; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin: 16px 0; } .net-label { font-size: 12px; font-weight: 700; font-style: italic; } .net-value { font-size: 20px; font-weight: 700; } .due-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0; } .due-label { display: block; font-size: 10px; letter-spacing: 3px; color: #888; margin-bottom: 6px; } .due-date { font-size: 18px; font-weight: 700; } .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; min-height: 100px; margin: 16px 0; } .sig-label { font-size: 11px; color: #ccc; font-style: italic; } .thanks { text-align: center; font-size: 12px; letter-spacing: 6px; color: #ccc; margin-top: 20px; } .cn-header { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #1a1a1a; margin: 8px 0; } .cn-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; } .cn-number { font-weight: 700; } .cn-amount { font-weight: 700; color: #1a1a1a; } .cn-deduct { color: #1a1a1a; font-weight: 700; }</style>`;
    const inv = this.selectedInvoice;
    const pd = this.previewData;
    const items = pd?.items || inv?.items || [];
    let itemsHtml = '';
    items.forEach((item: any, i: number) => {
      const subtotal = ((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2);
      const prodName = item.productName || this.getProductName(item.productId);
      itemsHtml += `<div class="item-row"><div class="item-desc"><span>${i + 1}. ${prodName} (${item.uom || 'UNIT'})</span><span>[${item.taxType || 'SR'}]</span></div><div class="item-calc"><span>${item.quantity} x ${(item.unitPrice || 0).toFixed(2)}</span><span>${subtotal}</span></div></div>`;
    });
    const invoiceDate = inv?.invoiceDate ? new Date(inv.invoiceDate) : new Date();
    const dateStr = invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dueStr = pd?.paymentDue || invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const cns = inv?.creditNotes || [];
    const totalCN = cns.reduce((s: number, c: any) => s + (c.amount || 0), 0);
    let cnHtml = '';
    if (cns.length > 0) {
      cnHtml = '<div class="divider-thin"></div><div class="cn-header">CREDIT NOTE(S)</div>';
      cns.forEach((cn: any) => {
        cnHtml += `<div class="cn-row"><span class="cn-number">${cn.cnNumber || 'CN-' + cn.id}${cn.reason ? ' (' + cn.reason + ')' : ''}</span><span class="cn-amount">- RM ${(cn.amount || 0).toFixed(2)}</span></div>`;
      });
      cnHtml += `<div class="divider-thin"></div><div class="total-row"><span>SUBTOTAL</span><span>RM ${(inv?.totalAmount || 0).toFixed(2)}</span></div><div class="total-row cn-deduct"><span>CREDIT NOTE</span><span>- RM ${totalCN.toFixed(2)}</span></div>`;
    }
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv?.invoiceNumber || ''}</title>${styles}</head><body><div class="receipt"><span class="receipt-type">TAX INVOICE</span><div class="divider"></div><div class="company">${pd?.companyName || 'B JAYA TRADING'}</div><span class="co-reg">(${pd?.companyReg || '001188861-T'})</span><span class="address">${pd?.companyAddress || 'NO. 467, JALAN PALAS 13, TAMAN PELANGI,'}</span><span class="address">${pd?.companyCity || '70400 SEREMBAN N.S, SEREMBAN, N.S, MALAYSIA'}</span><span class="contact">TEL: ${pd?.companyTel || '012-6988080'} GST: ${pd?.companyGst || '000134806856'}</span><div style="margin-top:20px;"><div class="doc-row"><span class="doc-label">DOC NO</span><span class="doc-value">: ${inv?.invoiceNumber || 'S001-' + inv?.id}</span></div><div class="doc-row"><span class="doc-label">DATE</span><span class="doc-value">: ${dateStr}</span></div></div><div class="to-section"><span class="to-label">TO:</span><div class="to-box"><strong>${inv?.customerName || this.getCustomerName(inv?.customerId)}</strong></div></div><div class="divider-thin"></div><div class="table-header"><span>DESCRIPTION</span><span>GST SUBTOTAL</span></div><div class="divider-thin"></div>${itemsHtml}<div class="divider-thin"></div><div class="total-row"><span>GROSS TOTAL</span><span>RM ${(inv?.totalAmount || 0).toFixed(2)}</span></div><div class="total-row"><span>TAX TOTAL</span><span>RM ${pd?.taxTotal || '0.00'}</span></div>${cnHtml}<div class="net-bar"><span class="net-label">NET AMOUNT</span><span class="net-value">RM ${((inv?.totalAmount || 0) - totalCN).toFixed(2)}</span></div><div class="due-box"><span class="due-label">PAYMENT DUE</span><span class="due-date">${dueStr}</span></div><div class="sig-box"><span class="sig-label">SIGNATURE</span></div><div class="thanks">THANK YOU</div></div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}

