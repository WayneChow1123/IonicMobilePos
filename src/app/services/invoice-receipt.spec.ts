import jsPDF from 'jspdf';
import { getInvoicePaymentSummary as summary, invoicePaymentSummaryHtml, drawInvoicePaymentSummaryPdf } from '../utils/invoice-payment-summary';
import { BluetoothPrintService } from './bluetooth-print.service';

describe('Invoice receipt payment amounts', () => {
  it('shows RM50 remaining on a RM100 invoice despite stale Paid status', () => {
    const result = summary({ totalAmount: 100, paidAmount: 50, status: 'Paid', balance: 0 });
    expect(result.balance).toBe(50);
    expect(result.status).toBe('PARTIALLY PAID');
    expect(invoicePaymentSummaryHtml(result)).toContain('BALANCE DUE');
    expect(result.message).toContain('RM 50.00');
  });
  it('shows full payment despite stale Unpaid status', () => {
    const result = summary({ totalAmount: 100, paidAmount: 100, status: 'Unpaid' });
    expect(result.status).toBe('PAID IN FULL');
    expect(result.balance).toBe(0);
  });
  it('shows an unpaid invoice', () => {
    expect(summary({ totalAmount: 100, paidAmount: 0 }).status).toBe('UNPAID');
  });
  it('deducts returns and applied credit once', () => {
    const result = summary({ totalAmount: 100, paidAmount: 50, creditUsed: 10, creditNotes: [{ amount: 20 }] });
    expect(result.net).toBe(70);
    expect(result.balance).toBe(20);
  });
  it('keeps change credits separate from returns and invoice payment', () => {
    const result = summary({ totalAmount: 100, paidAmount: 120, creditNotes: [{ cnNumber: 'CN-CHG-1', amount: 20 }] });
    expect(result.returns).toBe(0);
    expect(result.paid).toBe(100);
    expect(result.changeCredit).toBe(20);
  });
  it('supports numeric strings and API PascalCase', () => {
    expect(summary({ TotalAmount: '100', PaidAmount: '50' }).balance).toBe(50);
  });
  it('keeps one cent outstanding', () => {
    expect(summary({ totalAmount: 100, paidAmount: 99.99 }).balance).toBe(0.01);
  });
  it('does not claim missing payment data is fully paid', () => {
    expect(summary({ totalAmount: 100 }).status).toBe('PAYMENT NOT AVAILABLE');
  });
  it('uses fresh detail before cached list amounts', () => {
    expect(summary({ totalAmount: 100, paidAmount: 50 }, { totalAmount: 100, paidAmount: 0 }).balance).toBe(50);
  });
  it('shows an invoice settled entirely with credit', () => {
    const result = summary({ totalAmount: 100, paidAmount: 0, creditUsed: 100 });
    expect(result.status).toBe('PAID IN FULL');
    expect(result.balance).toBe(0);
  });
  it('renders a real PDF summary and moves the box to a new page when needed', () => {
    const doc = new jsPDF();
    drawInvoicePaymentSummaryPdf(doc, summary({ totalAmount: 100, paidAmount: 50 }), 270);
    expect(doc.getNumberOfPages()).toBe(2);
    const output = doc.output();
    expect(output).toContain('BALANCE DUE');
    expect(output).toContain('PARTIALLY PAID');
    expect(output).toContain('RM 50.00');
  });
  for (const paperWidth of [48, 58, 80]) {
    it(`prints payment status and remaining balance in the ${paperWidth}mm ESC/POS buffer`, () => {
      const printer: any = Object.create(BluetoothPrintService.prototype);
      printer.profileSettings = { profile: () => ({ companyName: 'Test Company', address: 'Address', city: 'City' }) };
      const buffer = printer.buildInvoiceBuffer({ totalAmount: 100, paidAmount: 50, items: [], invoiceNumber: 'TEST', status: 'Paid' }, {}, { paperWidth }, [], []);
      const output = new TextDecoder().decode(buffer);
      expect(output).toContain('PARTIALLY PAID');
      expect(output).toContain('AMOUNT PAID');
      expect(output).toContain('BALANCE DUE');
      expect(output).toContain('RM 50.00');
    });
  }
});
