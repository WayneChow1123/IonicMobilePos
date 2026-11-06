import { FileExportService } from '../../services/file-export.service';
import { inject } from '@angular/core';
import { ProfileSettingsService } from '../../services/profile-settings.service';
import { AlertService } from '../../services/alert.service';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { NavController } from '@ionic/angular';


import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { firstValueFrom, from } from 'rxjs';
import { map, mergeMap, toArray } from 'rxjs/operators';

@Component({
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  selector: 'app-preferences',
  templateUrl: './preferences.page.html',
  styleUrls: ['./preferences.page.scss'],
})
export class PreferencesPage implements OnInit {
  readonly profileSettings = inject(ProfileSettingsService);
  readonly fileExport = inject(FileExportService);
  isBackingUp = false;
  backupDownload: { id: string; fileName: string } | null = null;
  ionViewWillEnter() {
    this.showExportModal = false;
    this.cdr.detectChanges();
  }

  showToast = false;
  toastMessage = '';
  showExportModal = false;
  isLoading = false;
  exportType = 'all';
  customers: any[] = [];
  invoices: any[] = [];
  filteredInvoices: any[] = [];
  selectedCustomerId = '';
  selectedInvoiceId = '';
  searchTerm = '';

  constructor(private router: Router, private navCtrl: NavController, private api: ApiService, private cdr: ChangeDetectorRef, private alertService: AlertService) {}




  ngOnInit() { this.loadCustomers(); this.loadInvoices(); }

  loadCustomers() {
    this.api.getAllCustomers().subscribe({
      next: (res) => { this.customers = Array.isArray(res) ? res : []; },
      error: () => {}
    });
  }

  loadInvoices() {
    this.api.getInvoices().subscribe({
      next: (res) => { this.invoices = Array.isArray(res) ? res : []; this.filteredInvoices = [...this.invoices]; },
      error: () => {}
    });
  }

  filterInvoices() {
    let filtered = [...this.invoices];
    if (this.searchTerm) {
      filtered = filtered.filter(inv =>
        (inv.invoiceNumber || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (inv.docNo || '').toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (inv.customerName || '').toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }
    if (this.exportType === 'customer' && this.selectedCustomerId) {
      filtered = filtered.filter(inv => inv.customerId == this.selectedCustomerId);
    }
    this.filteredInvoices = filtered;
  }

  openExportModal() {
    this.exportType = 'all';
    this.selectedCustomerId = '';
    this.selectedInvoiceId = '';
    this.searchTerm = '';
    this.filteredInvoices = [...this.invoices];
    this.showExportModal = true;
  }

  closeExportModal() { this.showExportModal = false; }

  onExportTypeChange() {
    this.searchTerm = '';
    this.selectedCustomerId = '';
    this.selectedInvoiceId = '';
    this.filteredInvoices = [...this.invoices];
  }

  onCustomerChange() {
    this.filteredInvoices = this.invoices.filter(inv => inv.customerId == this.selectedCustomerId);
  }

  async exportExcel(singleInvoice?: any) {
    if (this.isLoading) return;
    let selected = singleInvoice ? [singleInvoice] : [...this.invoices];
    if (!singleInvoice && this.exportType === 'customer') {
      if (!this.selectedCustomerId) { this.showToastMsg('Please select a customer'); return; }
      selected = selected.filter(inv => String(inv.customerId) === String(this.selectedCustomerId));
    }
    if (!singleInvoice && this.exportType === 'single') {
      if (!this.selectedInvoiceId) { this.showToastMsg('Please select an invoice'); return; }
      selected = selected.filter(inv => String(inv.id) === String(this.selectedInvoiceId));
    }
    if (!selected.length) { this.showToastMsg('No invoices to export'); return; }
    this.isLoading = true;
    try {
      // Limit concurrent requests on large exports, preserving the selected order.
      const loaded = await firstValueFrom(from(selected.map((invoice, index) => ({ invoice, index }))).pipe(
        mergeMap(({ invoice, index }) => this.api.getInvoiceDetails(invoice.id).pipe(map(detail => {
          if (!detail || !Array.isArray(detail.items)) throw new Error('Invoice details unavailable for ' + (invoice.invoiceNumber || invoice.id) + '. Connect to the network and try again.');
          return { index, invoice: { ...invoice, ...detail } };
        })), 6), toArray()));
      loaded.sort((a, b) => a.index - b.index);
      const { buildInvoiceWorkbook } = await import('../../utils/invoice-excel');
      const workbook = buildInvoiceWorkbook(loaded.map(row => row.invoice), this.profileSettings.profile());
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const name = singleInvoice ? (singleInvoice.docNo || singleInvoice.invoiceNumber || 'invoice-' + singleInvoice.id) :
        'invoice-report-' + new Date().toISOString().slice(0, 10);
      await this.fileExport.save(blob, name + '.xlsx');
      this.showToastMsg('Excel file ready. Save it from the download or share window.');
    } catch (error: any) {
      this.showToastMsg('Excel export failed: ' + (error?.message || 'Please try again.'));
    } finally { this.isLoading = false; }
  }

  async backupFull() {
    if (this.isBackingUp) return;
    if (!this.api.isOnline()) { this.showToastMsg('Backup requires an internet connection.'); return; }
    this.isBackingUp = true;
    try {
      // Keep a completed backup for download retry; do not create another SQL backup.
      if (!this.backupDownload) {
        const result: any = await firstValueFrom(this.api.getFullBackup());
        if (!result?.backupId || !result?.fileName) throw new Error('The API did not return a backup file.');
        this.backupDownload = { id: String(result.backupId), fileName: result.fileName };
      }
      const backup = this.backupDownload;
      const blob = await firstValueFrom(this.api.downloadBackup(backup.id));
      if (!blob.size) throw new Error('The backup file is empty.');
      await this.fileExport.save(blob, backup.fileName);
      this.backupDownload = null;
      this.showToastMsg('Backup created. Save the .bak file from the download or share window.');
    } catch (error: any) {
      let body = error?.error;
      if (body instanceof Blob) {
        try { body = JSON.parse(await body.text()); } catch { body = null; }
      }
      const reason = body?.message || (typeof body === 'string' ? body : null) || error?.message || 'Please try again.';
      const prefix = this.backupDownload ? 'Backup created, but download failed. Tap Backup to retry downloading. ' : 'Backup failed: ';
      this.showToastMsg(prefix + (error?.status === 0 ? 'Cannot reach the API server.' : reason));
    } finally { this.isBackingUp = false; }
  }

  showToastMsg(msg: string) { const isWarn = msg.toLowerCase().includes('please') || msg.toLowerCase().includes('must') || msg.toLowerCase().includes('cannot') || msg.toLowerCase().includes('required') || msg.toLowerCase().includes('no '); const isErr = msg.toLowerCase().includes('fail') || msg.toLowerCase().includes('error'); this.alertService.toast(msg, isErr ? 'error' : (isWarn ? 'warning' : 'success')); }
  goTo(path: string) { this.navCtrl.navigateRoot(path); }

  goBack() { this.navCtrl.navigateRoot('pages/billing'); }
}


