import type jsPDF from 'jspdf';

export interface InvoicePaymentSummary {
  gross: number;
  returns: number;
  creditUsed: number;
  net: number;
  paid: number;
  balance: number;
  changeCredit: number;
  status: 'UNPAID' | 'PARTIALLY PAID' | 'PAID IN FULL' | 'SETTLED' | 'PAYMENT NOT AVAILABLE';
  message: string;
  available: boolean;
}

export function getInvoicePaymentStatus(invoice: any): 'Paid' | 'Partial' | 'Unpaid' {
  const summary = getInvoicePaymentSummary(invoice);
  return summary.balance === 0 && summary.available ? 'Paid'
    : summary.paid > 0 || summary.creditUsed > 0 ? 'Partial' : 'Unpaid';
}

/** One monetary calculation for preview, HTML/PDF and ESC/POS receipts. */
export function getInvoicePaymentSummary(invoice: any, fallback?: any): InvoicePaymentSummary {
  const pick = (...keys: string[]): any => {
    for (const source of [invoice, fallback]) for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
  };
  const cents = (value: any): number => Math.max(0, Math.round(((Number(value) || 0) + Number.EPSILON) * 100));
  const notes: any[] = invoice?.creditNotes ?? invoice?.CreditNotes ?? fallback?.creditNotes ?? fallback?.CreditNotes ?? [];
  const isChange = (note: any) => !!(note.createdAfterPayment ?? note.CreatedAfterPayment) ||
    String(note.cnNumber ?? note.CNNumber ?? '').startsWith('CN-CHG');
  const returns = cents(pick('cnTotal', 'CNTotal', 'returnCreditNoteAmount', 'totalReturnCN') ??
    notes.filter(note => !isChange(note)).reduce((sum, note) => sum + Number(note.amount ?? note.Amount ?? 0), 0));
  const change = cents(notes.filter(isChange).reduce((sum, note) => sum + Number(note.amount ?? note.Amount ?? 0), 0));
  const rawGross = pick('totalAmount', 'TotalAmount');
  const items: any[] = invoice?.items ?? invoice?.Items ?? fallback?.items ?? fallback?.Items ?? [];
  const gross = cents(rawGross ?? items.reduce((sum, item) => sum + Number(item.quantity ?? item.Quantity ?? 0) * Number(item.unitPrice ?? item.UnitPrice ?? 0), 0));
  const credit = cents(pick('creditUsed', 'CreditUsed') ?? 0);
  const net = Math.max(0, gross - returns - credit);
  const rawPaid = pick('paidAmount', 'PaidAmount');
  const rawBalance = pick('balance', 'Balance');
  const paid = Math.min(net, rawPaid !== undefined ? cents(rawPaid) : rawBalance !== undefined ? Math.max(0, net - cents(rawBalance)) : 0);
  const balance = Math.max(0, net - paid);
  const available = (rawGross !== undefined || items.length > 0) && (rawPaid !== undefined || rawBalance !== undefined);
  const status: InvoicePaymentSummary['status'] = !available ? 'PAYMENT NOT AVAILABLE' : balance === 0
    ? paid > 0 || credit > 0 ? 'PAID IN FULL' : 'SETTLED'
    : paid > 0 || credit > 0 ? 'PARTIALLY PAID' : 'UNPAID';
  return {
    gross: gross / 100, returns: returns / 100, creditUsed: credit / 100, net: net / 100,
    paid: paid / 100, balance: balance / 100, changeCredit: change / 100, status, available,
    message: !available ? 'Payment details unavailable. Please refresh the invoice.' : balance > 0
      ? 'Remaining amount to pay: RM ' + (balance / 100).toFixed(2) : 'No outstanding balance.'
  };
}

export function invoicePaymentSummaryHtml(summary: InvoicePaymentSummary): string {
  const amount = (value: number) => summary.available ? 'RM ' + value.toFixed(2) : 'NOT AVAILABLE';
  return `<section class="invoice-payment-summary" style="border:2px solid #111;padding:12px;margin:14px 0;color:#111;break-inside:avoid;">
    <div style="font-size:14px;font-weight:800;text-align:center;margin-bottom:10px;">${summary.status}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;"><span>AMOUNT PAID</span><strong>${amount(summary.paid)}</strong></div>
    <div style="display:flex;justify-content:space-between;gap:8px;border-top:2px solid #111;padding-top:10px;font-size:17px;font-weight:800;"><span>BALANCE DUE</span><span>${amount(summary.balance)}</span></div>
    ${summary.changeCredit > 0 ? `<div style="font-size:11px;margin-top:8px;">CHANGE SAVED AS CREDIT: RM ${summary.changeCredit.toFixed(2)}</div>` : ''}
    <p style="font-size:12px;font-weight:700;margin:10px 0 0;">${summary.message}</p>
  </section>`;
}

/** Append an A4 PDF summary without splitting the payment box across pages. */
export function drawInvoicePaymentSummaryPdf(doc: jsPDF, summary: InvoicePaymentSummary, startY: number): void {
  const rows: [string, number][] = [['INVOICE TOTAL', summary.gross]];
  if (summary.returns > 0) rows.push(['RETURNS (CN)', -summary.returns]);
  if (summary.creditUsed > 0) rows.push(['CREDIT USED', -summary.creditUsed]);
  rows.push(['NET AMOUNT', summary.net]);
  const height = 54 + rows.length * 6 + (summary.changeCredit > 0 ? 6 : 0);
  const pageWidth = doc.internal.pageSize.getWidth();
  const width = pageWidth - 28;
  let y = startY;
  if (y + height > doc.internal.pageSize.getHeight() - 14) { doc.addPage(); y = 20; }
  doc.setTextColor(17, 17, 17);
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.6);
  doc.rect(14, y, width, height);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(summary.status, pageWidth / 2, y + 9, { align: 'center' });
  let line = y + 18;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  for (const [label, value] of rows) {
    doc.text(label, 20, line);
    doc.text('RM ' + value.toFixed(2), pageWidth - 20, line, { align: 'right' });
    line += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.text('AMOUNT PAID', 20, line + 1);
  doc.text(summary.available ? 'RM ' + summary.paid.toFixed(2) : 'NOT AVAILABLE', pageWidth - 20, line + 1, { align: 'right' });
  line += 6;
  if (summary.changeCredit > 0) {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('CHANGE SAVED AS CREDIT: RM ' + summary.changeCredit.toFixed(2), 20, line + 1);
    line += 6;
  }
  doc.line(20, line + 2, pageWidth - 20, line + 2);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('BALANCE DUE', 20, line + 11);
  doc.text(summary.available ? 'RM ' + summary.balance.toFixed(2) : 'NOT AVAILABLE', pageWidth - 20, line + 11, { align: 'right' });
  doc.setFontSize(10);
  doc.text(summary.message, 20, line + 21);
}
