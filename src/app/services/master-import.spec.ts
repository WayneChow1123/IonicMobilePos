import { Workbook } from 'exceljs';
import { buildMasterExport, buildMasterTemplate, readMasterExcel } from '../utils/master-data-excel';
import { getInvoicePaymentStatus } from '../utils/invoice-payment-summary';
import { PreferencesPage } from '../pages/preferences/preferences.page';
import { of, throwError } from 'rxjs';

describe('Master data Excel import', () => {
  it('exports products in import-compatible format with text barcode, existing code and actual stock', async () => {
    const products = [{ name: 'P', code: 'P001', barcode: '00123', price: 10, rate: 1, cost: 5, lowestPrice: 8, stock: -2, includeTax: false }];
    const buffer = await buildMasterExport('products', products).xlsx.writeBuffer();
    const rows = await readMasterExcel(buffer as any, 'products', []);
    expect(rows[0].state).toBe('ready');
    expect(rows[0].data.barcode).toBe('00123');
    expect(rows[0].data.stock).toBe(-2);
    expect(rows[0].data.code).toBe('P001');
    expect((await readMasterExcel(buffer as any, 'products', products))[0].state).toBe('duplicate');
  });
  it('exports customers in import-compatible format preserving phone, code and boolean options', async () => {
    const customers = [{ name: 'C', customerCode: 'C001', phone: '0123456789', term: 'On Credit', discountPercent: 5, enableDiscount: false, requireDigitSign: true }];
    const buffer = await buildMasterExport('customers', customers).xlsx.writeBuffer();
    const rows = await readMasterExcel(buffer as any, 'customers', []);
    expect(rows[0].state).toBe('ready');
    expect(rows[0].data.phone).toBe('0123456789');
    expect(rows[0].data.customerCode).toBe('C001');
    expect(rows[0].data.enableDiscount).toBeFalse();
    expect(rows[0].data.requireDigitSign).toBeTrue();
    expect((await readMasterExcel(buffer as any, 'customers', customers))[0].state).toBe('duplicate');
  });
  async function parse(kind: 'products' | 'customers', row: any[], existing: any[] = []) {
    const workbook = buildMasterTemplate(kind);
    workbook.worksheets[0].addRow(row);
    return readMasterExcel(await workbook.xlsx.writeBuffer() as any, kind, existing);
  }
  it('round-trips the product template, numeric price and leading-zero barcode', async () => {
    const rows = await parse('products', ['Product', '00123', 'DEFAULT', 'UNIT', 10, 1, 5, 8, 20, 'No']);
    expect(rows[0].state).toBe('ready');
    expect(rows[0].data.barcode).toBe('00123');
    expect(rows[0].data.price).toBe(10);
    expect(rows[0].data.stock).toBe(20);
  });
  it('skips existing products and duplicates inside one file', async () => {
    const workbook = buildMasterTemplate('products');
    workbook.worksheets[0].addRows([['P', '123', '', '', 10], ['Q', '123', '', '', 10]]);
    const rows = await readMasterExcel(await workbook.xlsx.writeBuffer() as any, 'products', []);
    expect(rows.map(row => row.state)).toEqual(['ready', 'duplicate']);
    expect((await parse('products', ['P', '123', '', '', 10], [{ barcode: '123' }]))[0].state).toBe('duplicate');
  });
  it('validates required price, invalid stock and unsupported formulas', async () => {
    expect((await parse('products', ['P', '123']))[0].state).toBe('invalid');
    expect((await parse('products', ['P', '123', '', '', 10, 1, 0, 0, 1.5]))[0].message).toContain('whole number');
    expect((await parse('products', ['P', '123', '', '', { formula: '1+1', result: 2 }]))[0].message).toContain('formulas');
  });
  it('rejects numeric phone/barcode values that may have lost leading zeros', async () => {
    expect((await parse('customers', ['Customer', 123]))[0].state).toBe('invalid');
    expect((await parse('products', ['P', 123, '', '', 10]))[0].state).toBe('invalid');
  });
  it('loads customers with correct term and discount options', async () => {
    const rows = await parse('customers', ['Customer', '0123456789', 'test@example.com', 'Address', 'DEFAULT', 'On Credit', 10, 'Yes', 'No']);
    expect(rows[0].state).toBe('ready');
    expect(rows[0].data.phone).toBe('0123456789');
    expect(rows[0].data.discountPercent).toBe(10);
    expect(rows[0].data.enableDiscount).toBeTrue();
  });
  it('rejects invalid discount and malformed email', async () => {
    const row = (await parse('customers', ['C', '', 'invalid', '', '', '', 101]))[0];
    expect(row.state).toBe('invalid');
    expect(row.message).toContain('Email');
    expect(row.message).toContain('Discount');
  });
  it('does not save invalid rows or resend previously completed rows', async () => {
    const page: any = Object.create(PreferencesPage.prototype);
    Object.assign(page, { isImportBusy: false, importKind: 'products', importRows: [
      { row: 2, name: 'Done', data: { name: 'Done' }, state: 'saved' },
      { row: 3, name: 'New', data: { name: 'New' }, state: 'ready' }],
      api: { getProducts: () => of([]), createProduct: jasmine.createSpy().and.returnValue(of({ isOffline: true })) },
      showToastMsg: () => {}, loadCustomers: () => {} });
    await page.confirmImport();
    expect(page.api.createProduct.calls.count()).toBe(1);
    expect(page.importRows[1].state).toBe('queued');
    await page.confirmImport();
    expect(page.api.createProduct.calls.count()).toBe(1);
  });
  it('retains failed rows for retry without claiming success', async () => {
    const page: any = Object.create(PreferencesPage.prototype);
    Object.assign(page, { isImportBusy: false, importKind: 'customers', importRows: [
      { row: 2, name: 'C', data: { name: 'C' }, state: 'ready' }],
      api: { getAllCustomers: () => of([]), createCustomer: () => throwError(() => ({ error: 'Rejected' })) },
      showToastMsg: () => {}, loadCustomers: () => {} });
    await page.confirmImport();
    expect(page.importRows[0].state).toBe('failed');
    expect(page.importRows[0].message).toBe('Rejected');
  });
});

describe('Invoice payment status is independent of terms', () => {
  it('keeps a paid On Credit invoice paid and an unpaid Cash invoice unpaid', () => {
    expect(getInvoicePaymentStatus({ totalAmount: 100, paidAmount: 100, termType: 'On Credit' })).toBe('Paid');
    expect(getInvoicePaymentStatus({ totalAmount: 100, paidAmount: 0, termType: 'CASH SALE', status: 'Paid' })).toBe('Unpaid');
    expect(getInvoicePaymentStatus({ totalAmount: 100, paidAmount: 40, termType: 'On Credit' })).toBe('Partial');
    expect(getInvoicePaymentStatus({ totalAmount: 100, paidAmount: 0, creditUsed: 100 })).toBe('Paid');
  });
});
