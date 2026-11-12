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
import type { ImportKind, ImportRow } from '../../utils/master-data-excel';

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
  showImportModal = false;
  importKind: ImportKind = 'products';
  importRows: ImportRow[] = [];
  importFileName = '';
  isImportBusy = false;
  importMessage = '';
  ionViewWillEnter() {
    this.showExportCustomerModal = false;
    if (!this.isImportBusy) this.showImportModal = false;
    this.showExportModal = false;
    this.loadCustomers(); this.loadInvoices();
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
  showExportCustomerModal = false;
  exportCustomerSearch = '';
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

  closeExportModal() { this.showExportModal = false; this.showExportCustomerModal = false; }

  get selectedExportCustomerName(): string {
    const customer = this.customers.find(c => String(c.id) === String(this.selectedCustomerId));
    return customer?.name || 'Select Customer';
  }

  get exportCustomerOptions(): any[] {
    const term = this.exportCustomerSearch.trim().toLowerCase();
    if (!term) return this.customers;
    return this.customers.filter(c => String(c.name || '').toLowerCase().includes(term) ||
      String(c.customerCode || c.code || '').toLowerCase().includes(term))
      .sort((a, b) => Number(String(b.name || '').toLowerCase().startsWith(term)) - Number(String(a.name || '').toLowerCase().startsWith(term)) ||
        String(a.name || '').localeCompare(String(b.name || '')));
  }

  openExportCustomerSelector() {
    this.exportCustomerSearch = '';
    this.showExportCustomerModal = true;
  }

  selectExportCustomer(customer: any) {
    this.selectedCustomerId = String(customer.id);
    this.onCustomerChange();
    this.showExportCustomerModal = false;
  }

  onExportTypeChange() {
    this.searchTerm = '';
    this.selectedCustomerId = '';
    this.selectedInvoiceId = '';
    this.filteredInvoices = [...this.invoices];
  }

  onCustomerChange() {
    this.filteredInvoices = this.invoices.filter(inv => inv.customerId == this.selectedCustomerId);
  }

  openImport() {
    this.showImportModal = true;
    this.importRows = []; this.importFileName = ''; this.importMessage = '';
  }

  resetImport() { this.importRows = []; this.importFileName = ''; this.importMessage = ''; }
  get importReadyCount() { return this.importRows.filter(row => row.state === 'ready' || row.state === 'failed').length; }
  get importInvalidCount() { return this.importRows.filter(row => row.state === 'invalid').length; }
  get importDuplicateCount() { return this.importRows.filter(row => row.state === 'duplicate').length; }

  async downloadImportTemplate() {
    if (this.isImportBusy) return;
    this.isImportBusy = true;
    try {
      const { buildMasterTemplate } = await import('../../utils/master-data-excel');
      const buffer = await buildMasterTemplate(this.importKind).xlsx.writeBuffer();
      await this.fileExport.save(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), this.importKind + '-import-template.xlsx');
    } catch (error: any) { this.showToastMsg('Template download failed: ' + error.message); }
    finally { this.isImportBusy = false; }
  }

  async exportMasterData() {
    if (this.isImportBusy) return;
    this.isImportBusy = true;
    try {
      const records = await firstValueFrom(this.importKind === 'products' ? this.api.getProducts(true) : this.api.getAllCustomers(true));
      if (!Array.isArray(records) || !records.length) { this.showToastMsg('No ' + this.importKind + ' to export'); return; }
      const { buildMasterExport } = await import('../../utils/master-data-excel');
      const buffer = await buildMasterExport(this.importKind, records).xlsx.writeBuffer();
      await this.fileExport.save(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        this.importKind + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
      this.showToastMsg('Export Excel File Successfully');
    } catch (error: any) { this.showToastMsg('Excel export failed: ' + error.message); }
    finally { this.isImportBusy = false; }
  }

  async selectImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.isImportBusy) return;
    this.resetImport();
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 10 * 1024 * 1024) {
      this.showToastMsg('Please select an .xlsx file smaller than 10 MB.'); return;
    }
    this.isImportBusy = true;
    try {
      const existing = await firstValueFrom(this.importKind === 'products' ? this.api.getProducts(true) : this.api.getAllCustomers(true));
      const { readMasterExcel } = await import('../../utils/master-data-excel');
      this.importRows = await readMasterExcel(await file.arrayBuffer(), this.importKind, Array.isArray(existing) ? existing : []);
      this.importFileName = file.name;
    } catch (error: any) { this.showToastMsg('Import preview failed: ' + error.message); }
    finally { this.isImportBusy = false; }
  }

  async confirmImport() {
    if (this.isImportBusy || !this.importReadyCount || this.importInvalidCount) return;
    this.isImportBusy = true;
    try {
      const { isExistingMaster } = await import('../../utils/master-data-excel');
      const existing = await firstValueFrom(this.importKind === 'products' ? this.api.getProducts(true) : this.api.getAllCustomers(true));
      const known = Array.isArray(existing) ? [...existing] : [];
      const pending = this.importRows.filter(row => row.state === 'ready' || row.state === 'failed');
      for (let i = 0; i < pending.length; i++) {
        const row = pending[i];
        this.importMessage = `Importing ${i + 1} / ${pending.length}...`;
        if (isExistingMaster(this.importKind, row.data, known)) {
          row.state = 'duplicate'; row.message = 'Already exists — skipped'; continue;
        }
        try {
          const result = await firstValueFrom(this.importKind === 'products' ? this.api.createProduct(row.data) : this.api.createCustomer(row.data));
          row.state = result?.isOffline ? 'queued' : 'saved';
          row.message = result?.isOffline ? 'Saved on device — pending API sync' : 'Saved to API';
          known.push(row.data);
        } catch (error: any) {
          row.state = 'failed';
          row.message = typeof error?.error === 'string' ? error.error : error?.error?.message || error.message || 'Import failed';
        }
      }
      const saved = this.importRows.filter(row => row.state === 'saved').length;
      const queued = this.importRows.filter(row => row.state === 'queued').length;
      const failed = this.importRows.filter(row => row.state === 'failed').length;
      this.importMessage = `${saved} saved to API, ${queued} pending sync, ${this.importDuplicateCount} skipped, ${failed} failed.`;
      this.showToastMsg((failed ? 'Import completed with errors. ' : 'Import completed. ') + this.importMessage);
      this.loadCustomers();
    } catch (error: any) { this.showToastMsg('Import failed: ' + error.message); }
    finally { this.isImportBusy = false; }
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
      this.showToastMsg('Export Excel File Successfully');
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


