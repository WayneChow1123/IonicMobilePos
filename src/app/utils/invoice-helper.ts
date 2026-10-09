/**
 * Helper utilities for formatting and generating invoice document numbers (DOC NO).
 * Format rule: [Year][Month without leading 0][Day][2-digit sequence of that day]
 * Example for 2026-09-14:
 * 1st invoice: 202691401
 * 2nd invoice: 202691402
 */

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

export const cachedDocNoMap = new Map<any, string>();
let cachedInvoicesList: any[] = [];

/**
 * Normalizes ISO date string by stripping trailing UTC markers ('Z', '.000Z', '+00:00')
 * so that dates saved as local time are parsed correctly as local time rather than being shifted.
 */
export function normalizeInvoiceDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}T${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  }
  if (typeof val === 'number') {
    const dt = new Date(val);
    if (!isNaN(dt.getTime())) {
      return normalizeInvoiceDate(dt);
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.replace(/(\.\d+)?(z|[+-]00:?00)$/i, '');
  }
  return String(val);
}

export function getInvoiceNormalizedDate(inv: any): string {
  if (!inv) return '';
  const numStr = String(inv.invoiceNumber || inv.docNo || (typeof inv === 'string' ? inv : ''));
  // Match 14-digit timestamp YYYYMMDDHHmmss inside invoice number (e.g. INV-T715-20261008143321-62 or INV-20261008143321)
  const match = numStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    const hour = match[4];
    const min = match[5];
    const sec = match[6];
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }
  return normalizeInvoiceDate(inv.invoiceDate || inv.InvoiceDate || inv.createdAt || inv.CreatedAt || inv);
}

/**
 * Extracts Year, Month (1-12, unpadded), and Date from an invoice object or timestamp.
 */
export function extractInvoiceDateParts(inv: any): DateParts {
  let y = 2026;
  let m = 9;
  let d = 14;

  if (!inv) return { y, m, d };

  const numStr = String(inv.invoiceNumber || '');
  const match = numStr.match(/(\d{4})(\d{2})(\d{2})/);
  if (match) {
    const parsedY = parseInt(match[1], 10);
    if (parsedY >= 2020 && parsedY <= 2099) {
      y = parsedY;
      m = parseInt(match[2], 10); // 09 -> 9
      d = parseInt(match[3], 10); // 14 -> 14, 04 -> 4
      return { y, m, d };
    }
  }

  const rawDate = getInvoiceNormalizedDate(inv);
  if (rawDate) {
    const dt = new Date(rawDate);
    if (!isNaN(dt.getTime())) {
      y = dt.getFullYear();
      m = dt.getMonth() + 1;
      d = dt.getDate();
      return { y, m, d };
    }
  }

  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/**
 * Updates the global cache and attaches .docNo to every invoice in the array.
 * Invoices accumulate continuously: 01, 02, 03, 04... across all days without resetting daily.
 */
export function updateInvoiceDocNos(invoices: any[]): void {
  if (!Array.isArray(invoices)) return;
  cachedInvoicesList = [...invoices];

  // Sort ascending by date / timestamp / ID so earliest created is index 1
  const sorted = [...invoices].sort((a, b) => {
    const timeA = new Date(a.invoiceDate || a.createdAt || 0).getTime();
    const timeB = new Date(b.invoiceDate || b.createdAt || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    const numA = Number(a.id);
    const numB = Number(b.id);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  cachedDocNoMap.clear();

  sorted.forEach((inv, index) => {
    const { y, m, d } = extractInvoiceDateParts(inv);
    const seq = String(index + 1).padStart(2, '0');
    const docNo = `${y}${m}${d}${seq}`;

    inv.docNo = docNo;

    if (inv.id !== undefined && inv.id !== null) {
      cachedDocNoMap.set(Number(inv.id), docNo);
    }
    if (inv.invoiceNumber) {
      cachedDocNoMap.set(String(inv.invoiceNumber), docNo);
    }
  });
}

/**
 * Formats an invoice object or invoice number string into the desired DOC NO.
 * (e.g. "INV-20260911132149" -> "202691139", or new invoice on 2026-09-14 -> "202691440")
 */
export function formatDocNo(inv: any, allInvoices?: any[]): string {
  if (!inv) return '';

  // Handle string input
  if (typeof inv === 'string') {
    const trimmed = inv.trim();
    if (!trimmed) return '';

    // Already in new format: e.g. "202691401"
    if (/^\d{8,11}$/.test(trimmed)) return trimmed;

    // Prefixed with INV-: e.g. "INV-202691401"
    const invMatch = trimmed.match(/^INV-(\d{8,11})$/i);
    if (invMatch) return invMatch[1];

    // Check cache
    if (cachedDocNoMap.has(trimmed)) {
      return cachedDocNoMap.get(trimmed)!;
    }

    inv = { invoiceNumber: trimmed };
  }

  // Already computed
  if (inv.docNo) return String(inv.docNo);

  // Check cache by ID
  if (inv.id !== undefined && inv.id !== null && cachedDocNoMap.has(Number(inv.id))) {
    const cached = cachedDocNoMap.get(Number(inv.id))!;
    inv.docNo = cached;
    return cached;
  }

  // Check cache by invoiceNumber
  if (inv.invoiceNumber && cachedDocNoMap.has(String(inv.invoiceNumber))) {
    const cached = cachedDocNoMap.get(String(inv.invoiceNumber))!;
    inv.docNo = cached;
    return cached;
  }

  // Already formatted invoiceNumber
  if (inv.invoiceNumber && /^\d{8,11}$/.test(String(inv.invoiceNumber).trim())) {
    return String(inv.invoiceNumber).trim();
  }
  const matchInv = String(inv.invoiceNumber || '').match(/^INV-(\d{8,11})$/i);
  if (matchInv) {
    return matchInv[1];
  }

  const { y, m, d } = extractInvoiceDateParts(inv);
  const prefix = `${y}${m}${d}`;

  const invoices = (Array.isArray(allInvoices) && allInvoices.length > 0)
    ? allInvoices
    : cachedInvoicesList;

  if (invoices && invoices.length > 0) {
    const sorted = [...invoices].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

    const idx = sorted.findIndex(i =>
      (inv.id && i.id === inv.id) ||
      (inv.invoiceNumber && i.invoiceNumber === inv.invoiceNumber)
    );

    if (idx !== -1) {
      const docNo = `${prefix}${String(idx + 1).padStart(2, '0')}`;
      inv.docNo = docNo;
      return docNo;
    }

    // New invoice being created (cumulative counter is total existing + 1)
    const docNo = `${prefix}${String(sorted.length + 1).padStart(2, '0')}`;
    inv.docNo = docNo;
    return docNo;
  }

  return `${prefix}01`;
}
