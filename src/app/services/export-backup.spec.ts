import { Workbook } from 'exceljs';
import { of, throwError } from 'rxjs';
import { PreferencesPage } from '../pages/preferences/preferences.page';
import { buildInvoiceWorkbook } from '../utils/invoice-excel';
import { ApiService } from './api.service';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ProfileSettingsService } from './profile-settings.service';
import { FileExportService } from './file-export.service';
import { AlertService } from './alert.service';

describe('Excel bill export and backup', () => {
  const profile = { companyName: 'Test Company', address: 'Line 1', city: 'Line 2' };
  const invoice = { id: 1, invoiceNumber: 'INV-1', customerId: 1, customerName: '=Not a formula',
    invoiceDate: '2026-11-06', totalAmount: 100, paidAmount: 50, termType: 'On Credit',
    items: [{ productName: 'Product', barcode: '00123', quantity: 2, unitPrice: 50, remark: 'Item remark' }] };
  let page: any;
  beforeEach(() => {
    page = Object.create(PreferencesPage.prototype);
    Object.assign(page, { isLoading: false, isBackingUp: false, backupDownload: null,
      exportType: 'all', invoices: [invoice], profileSettings: { profile: () => profile },
      fileExport: { save: jasmine.createSpy().and.resolveTo() },
      api: { getInvoiceDetails: jasmine.createSpy().and.returnValue(of(invoice)), isOnline: () => true,
        getFullBackup: jasmine.createSpy().and.returnValue(of({ backupId: 7, fileName: 'test.bak' })),
        downloadBackup: jasmine.createSpy().and.returnValue(of(new Blob(['backup']))) },
      showToastMsg: jasmine.createSpy() });
  });

  it('round-trips a real XLSX with numeric amounts, dates, item detail and safe customer text', async () => {
    const workbook = buildInvoiceWorkbook([invoice], profile);
    const restored = new Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const bills = restored.getWorksheet('Invoices')!;
    expect(bills.getCell('B6').value).toBe('=Not a formula');
    expect(bills.getCell('C6').value instanceof Date).toBeTrue();
    expect(bills.getCell('I6').value).toBe(50);
    expect(bills.getCell('J6').value).toBe(50);
    expect(bills.getCell('K6').value).toBe('PARTIALLY PAID');
    expect((bills.getCell('J7').value as any).result).toBe(50);
    expect(restored.getWorksheet('Items')!.getCell('C6').value).toBe('00123');
    expect(restored.getWorksheet('Items')!.getCell('F6').value).toBe(100);
  });
  it('separates returns from change credit and applied credit', () => {
    const workbook = buildInvoiceWorkbook([{ ...invoice, creditUsed: 10, creditNotes: [
      { cnNumber: 'CN-1', amount: 20 }, { cnNumber: 'CN-CHG-1', amount: 5, createdAfterPayment: true }] }], profile);
    const bills = workbook.getWorksheet('Invoices')!;
    expect(bills.getCell('F6').value).toBe(20);
    expect(bills.getCell('H6').value).toBe(70);
    expect(bills.getCell('J6').value).toBe(20);
    expect(workbook.getWorksheet('Credit Notes')!.rowCount).toBe(7);
  });
  it('exports all invoices as an Excel blob', async () => {
    await page.exportExcel();
    const [blob, name] = page.fileExport.save.calls.mostRecent().args;
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(name).toMatch(/\.xlsx$/);
    expect(page.isLoading).toBeFalse();
  });
  it('exports only the selected customer', async () => {
    page.exportType = 'customer'; page.selectedCustomerId = '1';
    page.invoices = [invoice, { ...invoice, id: 2, customerId: 2 }];
    await page.exportExcel();
    expect(page.api.getInvoiceDetails.calls.count()).toBe(1);
    expect(page.api.getInvoiceDetails).toHaveBeenCalledWith(1);
  });
  it('exports a single invoice using the same Excel flow', async () => {
    await page.exportExcel(invoice);
    expect(page.fileExport.save.calls.mostRecent().args[1]).toBe('INV-1.xlsx');
  });
  it('reports missing detail rather than silently exporting an incomplete workbook', async () => {
    page.api.getInvoiceDetails.and.returnValue(of(null));
    await page.exportExcel();
    expect(page.fileExport.save).not.toHaveBeenCalled();
    expect(page.showToastMsg).toHaveBeenCalledWith(jasmine.stringMatching('details unavailable'));
    expect(page.isLoading).toBeFalse();
  });
  it('prevents duplicate export taps', async () => {
    page.isLoading = true;
    await page.exportExcel();
    expect(page.api.getInvoiceDetails).not.toHaveBeenCalled();
  });
  it('creates, downloads and saves the backup instead of only showing success', async () => {
    await page.backupFull();
    expect(page.api.downloadBackup).toHaveBeenCalledWith('7');
    expect(page.fileExport.save).toHaveBeenCalledWith(jasmine.any(Blob), 'test.bak');
    expect(page.backupDownload).toBeNull();
    expect(page.isBackingUp).toBeFalse();
  });
  it('blocks a server backup while offline', async () => {
    page.api.isOnline = () => false;
    await page.backupFull();
    expect(page.api.getFullBackup).not.toHaveBeenCalled();
  });
  it('shows the actionable server error', async () => {
    page.api.getFullBackup.and.returnValue(throwError(() => ({ status: 500, error: { message: 'SQL Server needs folder write permission.' } })));
    await page.backupFull();
    expect(page.showToastMsg).toHaveBeenCalledWith(jasmine.stringMatching('folder write permission'));
    expect(page.fileExport.save).not.toHaveBeenCalled();
  });
  it('retries download without creating a second backup', async () => {
    page.api.downloadBackup.and.returnValue(throwError(() => ({ status: 0 })));
    await page.backupFull();
    expect(page.backupDownload.id).toBe('7');
    page.api.downloadBackup.and.returnValue(of(new Blob(['backup'])));
    await page.backupFull();
    expect(page.api.getFullBackup.calls.count()).toBe(1);
    expect(page.backupDownload).toBeNull();
  });
  it('requests backup files as binary instead of trying to parse .bak as JSON', async () => {
    const http = { get: jasmine.createSpy().and.returnValue(of(new Blob(['backup']))) };
    const api: any = Object.create(ApiService.prototype);
    api.http = http; api.baseUrl = 'https://test.invalid';
    api.downloadBackup('7').subscribe();
    expect(http.get).toHaveBeenCalledWith('https://test.invalid/api/backup/download/7', { responseType: 'blob' });
  });
  it('centers the Export Bills heading independently of the back button', async () => {
    page.api.getAllCustomers = () => of([]);
    page.api.getInvoices = () => of([invoice]);
    await TestBed.configureTestingModule({ imports: [PreferencesPage], providers: [
      { provide: ApiService, useValue: page.api }, { provide: ProfileSettingsService, useValue: page.profileSettings },
      { provide: FileExportService, useValue: page.fileExport }, { provide: Router, useValue: {} },
      { provide: NavController, useValue: {} }, { provide: AlertService, useValue: {} }
    ] }).compileComponents();
    const fixture = TestBed.createComponent(PreferencesPage);
    fixture.componentInstance.showExportModal = true;
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.export-header');
    const title = header.querySelector('h1');
    const box = header.getBoundingClientRect(), label = title.getBoundingClientRect();
    expect(title.textContent).toBe('Export Bills');
    expect(box.width).toBeGreaterThan(200);
    expect(Math.abs((box.left + box.width / 2) - (label.left + label.width / 2))).toBeLessThan(1);
    fixture.destroy();
  });
});
