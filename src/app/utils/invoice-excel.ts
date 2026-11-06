import { Workbook, Worksheet } from 'exceljs';
import { getInvoicePaymentSummary } from './invoice-payment-summary';

/** Real XLSX cells: money stays numeric and customer text is never a formula. */
export function buildInvoiceWorkbook(invoices: any[], profile: any): Workbook {
  const workbook = new Workbook();
  workbook.creator = profile.companyName;
  workbook.created = new Date();
  const bills = workbook.addWorksheet('Invoices');
  const items = workbook.addWorksheet('Items');
  const credits = workbook.addWorksheet('Credit Notes');
  const setup = (sheet: Worksheet, headers: string[], widths: number[]) => {
    sheet.addRow([profile.companyName]);
    sheet.addRow([[profile.address, profile.city].filter(Boolean).join(', ')]);
    sheet.addRow(['Exported', new Date()]);
    sheet.getCell('B3').numFmt = 'dd/mm/yyyy hh:mm';
    sheet.addRow([]);
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
    headers.forEach((_, i) => sheet.getColumn(i + 1).width = widths[i] ?? 20);
    sheet.views = [{ state: 'frozen', ySplit: 5 }];
  };
  setup(bills, ['Invoice No', 'Customer', 'Invoice Date', 'Term', 'Gross Total', 'Returns (CN)', 'Credit Used', 'Net Amount', 'Amount Paid', 'Balance Due', 'Payment Status', 'Remark'], [24, 30, 16, 18, 18, 18, 18, 18, 18, 18, 25, 40]);
  setup(items, ['Invoice No', 'Product', 'Barcode', 'Quantity', 'Unit Price', 'Line Total', 'Remark'], [24, 36, 24, 14, 18, 18, 40]);
  setup(credits, ['Invoice No', 'CN No', 'Type', 'Amount', 'Reason'], [24, 28, 24, 18, 40]);
  for (const invoice of invoices) {
    const payment = getInvoicePaymentSummary(invoice);
    const number = String(invoice.docNo || invoice.invoiceNumber || invoice.id);
    const parsedDate = new Date(invoice.invoiceDate);
    const row = bills.addRow([number, invoice.customerName || invoice.customer?.name || '',
      Number.isNaN(parsedDate.getTime()) ? String(invoice.invoiceDate || '') : parsedDate,
      invoice.termType || '', payment.gross, payment.returns, payment.creditUsed, payment.net,
      payment.available ? payment.paid : null, payment.available ? payment.balance : null, payment.status, invoice.remark || '']);
    row.getCell(3).numFmt = 'dd/mm/yyyy';
    for (let column = 5; column <= 10; column++) row.getCell(column).numFmt = '"RM "#,##0.00';
    for (const item of invoice.items || []) {
      const quantity = Number(item.quantity || 0), price = Number(item.unitPrice || 0);
      const detail = items.addRow([number, item.productName || item.product?.name || '', String(item.barcode || ''), quantity, price,
        Math.round((quantity * price + Number.EPSILON) * 100) / 100, item.remark || '']);
      detail.getCell(5).numFmt = detail.getCell(6).numFmt = '"RM "#,##0.00';
    }
    for (const cn of invoice.creditNotes || []) {
      const isChange = cn.createdAfterPayment || String(cn.cnNumber || '').startsWith('CN-CHG');
      const credit = credits.addRow([number, cn.cnNumber || String(cn.id), isChange ? 'Change saved as credit' : 'Return', Number(cn.amount || 0), cn.reason || '']);
      credit.getCell(4).numFmt = '"RM "#,##0.00';
    }
  }
  bills.autoFilter = { from: 'A5', to: `L${5 + invoices.length}` };
  if (invoices.length) {
    const last = bills.rowCount;
    const totals = bills.addRow(['TOTAL', `${invoices.length} invoices`]);
    for (let column = 5; column <= 10; column++) {
      const letter = bills.getColumn(column).letter;
      const result = invoices.reduce((sum, inv) => {
        const payment = getInvoicePaymentSummary(inv);
        return sum + [payment.gross, payment.returns, payment.creditUsed, payment.net, payment.available ? payment.paid : 0, payment.available ? payment.balance : 0][column - 5];
      }, 0);
      totals.getCell(column).value = { formula: `SUM(${letter}6:${letter}${last})`, result: Math.round(result * 100) / 100 };
      totals.getCell(column).numFmt = '"RM "#,##0.00';
    }
    totals.font = { bold: true };
  }
  if (credits.rowCount === 5) workbook.removeWorksheet(credits.id);
  return workbook;
}
