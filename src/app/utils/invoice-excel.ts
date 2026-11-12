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
  const colors = { navy: 'FF17365D', teal: 'FF117C83', green: 'FF237A57', line: 'FFD5DFEA', ink: 'FF24364B' };
  const setup = (sheet: Worksheet, headers: string[], widths: number[]) => {
    sheet.addRow([profile.companyName]);
    sheet.addRow([[profile.address, profile.city].filter(Boolean).join(', ')]);
    sheet.addRow(['Exported', new Date()]);
    sheet.getCell('B3').numFmt = 'dd/mm/yyyy hh:mm';
    sheet.addRow([]);
    sheet.addRow(headers);
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.mergeCells(2, 1, 2, headers.length);
    sheet.getRow(1).height = 38;
    sheet.getCell('A1').font = { name: 'Calibri', bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
    sheet.getCell('A1').alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(2).height = 32;
    sheet.getCell('A2').font = { name: 'Calibri', size: 11, color: { argb: colors.ink } };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F8' } };
    sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(3).height = 24;
    sheet.getRow(3).font = { name: 'Calibri', size: 10, color: { argb: 'FF52657A' } };
    sheet.getRow(3).alignment = { vertical: 'middle' };
    headers.forEach((_, i) => sheet.getColumn(i + 1).width = widths[i] ?? 20);
    sheet.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' };
  };
  setup(bills, ['Invoice No', 'Customer', 'Invoice Date', 'Term', 'Gross Total', 'Returns (CN)', 'Credit Used', 'Net Amount', 'Amount Paid', 'Balance Due', 'Payment Status', 'Remark'], [24, 30, 16, 18, 18, 18, 18, 18, 18, 18, 25, 40]);
  setup(items, ['Invoice No', 'Product', 'Barcode', 'Quantity', 'Unit Price', 'Line Total', 'Remark'], [24, 36, 24, 14, 18, 18, 40]);
  setup(credits, ['Invoice No', 'CN No', 'Type', 'Amount', 'Reason'], [24, 28, 24, 18, 40]);
  for (const invoice of invoices) {
    const payment = getInvoicePaymentSummary(invoice);
    const status = payment.status === 'SETTLED' || payment.status === 'PAID IN FULL' ? 'Paid'
      : payment.status === 'UNPAID' ? 'Unpaid' : payment.status === 'PARTIALLY PAID' ? 'Partially Paid' : 'Payment Not Available';
    const number = String(invoice.docNo || invoice.invoiceNumber || invoice.id);
    const parsedDate = new Date(invoice.invoiceDate);
    const row = bills.addRow([number, invoice.customerName || invoice.customer?.name || '',
      Number.isNaN(parsedDate.getTime()) ? String(invoice.invoiceDate || '') : parsedDate,
      invoice.termType || '', payment.gross, payment.returns, payment.creditUsed, payment.net,
      payment.available ? payment.paid : null, payment.available ? payment.balance : null, status, invoice.remark || '']);
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
    totals.height = 30;
    for (let column = 1; column <= 12; column++) {
      const cell = totals.getCell(column);
      cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: colors.navy } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCECF2' } };
      cell.alignment = { vertical: 'middle', horizontal: column >= 5 && column <= 10 ? 'right' : 'left' };
      cell.border = { top: { style: 'double', color: { argb: colors.teal } }, bottom: { style: 'thin', color: { argb: colors.line } } };
    }
  }
  const formatTable = (sheet: Worksheet, name: string, lastDataRow: number, columnCount: number) => {
    const headers = Array.from({ length: columnCount }, (_, i) => String(sheet.getRow(5).getCell(i + 1).value));
    const rows = Array.from({ length: lastDataRow - 5 }, (_, row) =>
      Array.from({ length: columnCount }, (_, column) => sheet.getRow(row + 6).getCell(column + 1).value));
    sheet.addTable({ name, ref: 'A5', headerRow: true, totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true, showColumnStripes: false },
      columns: headers.map(header => ({ name: header, filterButton: true })), rows });
    sheet.getRow(5).height = 32;
    for (let row = 5; row <= lastDataRow; row++) {
      if (row > 5) sheet.getRow(row).height = 28;
      for (let column = 1; column <= columnCount; column++) {
        const cell = sheet.getRow(row).getCell(column);
        cell.border = { top: { style: 'thin', color: { argb: colors.line } }, bottom: { style: 'thin', color: { argb: colors.line } },
          left: { style: 'thin', color: { argb: colors.line } }, right: { style: 'thin', color: { argb: colors.line } } };
        cell.font = { name: 'Calibri', size: 11, color: { argb: row === 5 ? 'FFFFFFFF' : colors.ink }, bold: row === 5 };
        cell.alignment = { vertical: 'middle', wrapText: true, horizontal: row === 5 ? 'center' : 'left' };
        let fill = row % 2 === 0 ? 'FFF1F6FC' : 'FFFFFFFF';
        if (row === 5) fill = colors.navy;
        if (sheet === bills) {
          if (column >= 5 && column <= 8) fill = row === 5 ? colors.teal : row % 2 === 0 ? 'FFE7F4F3' : 'FFF3FAF9';
          if (column >= 9 && column <= 10) fill = row === 5 ? colors.green : row % 2 === 0 ? 'FFEAF5ED' : 'FFF5FAF6';
          if (column === 3 || column === 4 || column === 11) cell.alignment.horizontal = 'center';
          if (row > 5 && column >= 5 && column <= 10) cell.alignment.horizontal = 'right';
          if (row > 5 && column === 10 && Number(cell.value) > 0) {
            fill = 'FFFFE7C2';
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF9A4B08' } };
          }
          if (row > 5 && column === 11) {
            const status = String(cell.value);
            const paid = status === 'Paid';
            fill = paid ? 'FFDFF1E6' : status === 'Partially Paid' ? 'FFFFEDCC' : 'FFFBE4E4';
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: paid ? 'FF206742' : status === 'Partially Paid' ? 'FF8A5200' : 'FFA13030' } };
          }
        } else if (row > 5) {
          const numeric = sheet === items ? [4, 5, 6] : [4];
          if (numeric.includes(column)) cell.alignment.horizontal = 'right';
        }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      }
    }
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(columnCount).letter}${sheet.rowCount}`;
  };
  formatTable(bills, 'InvoiceRegister', 5 + invoices.length, 12);
  formatTable(items, 'InvoiceItems', items.rowCount, 7);
  if (credits.rowCount === 5) workbook.removeWorksheet(credits.id);
  else formatTable(credits, 'InvoiceCreditNotes', credits.rowCount, 5);
  return workbook;
}
