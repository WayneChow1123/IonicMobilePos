/**
 * Helper utilities for formatting and generating invoice document numbers (DOC NO).
 * Format rule: [Year (4 digits)][Month (2 digits padded)][Day (2 digits padded)][2-digit daily sequence]
 * Example for 2026-10-13:
 * 1st invoice: 2026101301
 * 2nd invoice: 2026101302
 * Example for September (month 09):
 * 1st invoice: 2026091301
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
 * Extracts Year, Month (1-12), and Date from an invoice object or timestamp.
 */
export function extractInvoiceDateParts(inv: any): DateParts {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  let d = now.getDate();

  if (!inv) return { y, m, d };

  // First try parsing from normalized invoice date
  const rawDate = getInvoiceNormalizedDate(inv);
  if (rawDate) {
    const dt = new Date(rawDate);
    if (!isNaN(dt.getTime())) {
      return {
        y: dt.getFullYear(),
        m: dt.getMonth() + 1,
        d: dt.getDate()
      };
    }
  }

  const numStr = String(inv.invoiceNumber || inv.docNo || (typeof inv === 'string' ? inv : ''));

  // 10-digit format: YYYY(4) MM(2) DD(2) SS(2)
  const match10 = numStr.match(/(\d{4})(\d{2})(\d{2})\d{2}$/);
  if (match10) {
    const parsedY = parseInt(match10[1], 10);
    const parsedM = parseInt(match10[2], 10);
    const parsedD = parseInt(match10[3], 10);
    if (parsedY >= 2020 && parsedY <= 2099 && parsedM >= 1 && parsedM <= 12 && parsedD >= 1 && parsedD <= 31) {
      return { y: parsedY, m: parsedM, d: parsedD };
    }
  }

  // 8-digit date match: YYYYMMDD
  const match8 = numStr.match(/(\d{4})(\d{2})(\d{2})/);
  if (match8) {
    const parsedY = parseInt(match8[1], 10);
    const parsedM = parseInt(match8[2], 10);
    const parsedD = parseInt(match8[3], 10);
    if (parsedY >= 2020 && parsedY <= 2099 && parsedM >= 1 && parsedM <= 12 && parsedD >= 1 && parsedD <= 31) {
      return { y: parsedY, m: parsedM, d: parsedD };
    }
  }

  // Old single-digit month pattern (e.g. 202691301)
  const matchOld = numStr.match(/(\d{4})([1-9])(\d{2})/);
  if (matchOld) {
    const parsedY = parseInt(matchOld[1], 10);
    const parsedM = parseInt(matchOld[2], 10);
    const parsedD = parseInt(matchOld[3], 10);
    if (parsedY >= 2020 && parsedY <= 2099 && parsedM >= 1 && parsedM <= 12 && parsedD >= 1 && parsedD <= 31) {
      return { y: parsedY, m: parsedM, d: parsedD };
    }
  }

  return { y, m, d };
}

/**
 * Updates the global cache and attaches .docNo to every invoice in the array.
 * Invoices reset per day: 01, 02, 03... for each unique date (YYYYMMDD).
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

  const dailyCounters = new Map<string, number>();

  sorted.forEach((inv) => {
    const { y, m, d } = extractInvoiceDateParts(inv);
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const dateKey = `${y}${mm}${dd}`;

    const count = (dailyCounters.get(dateKey) || 0) + 1;
    dailyCounters.set(dateKey, count);

    const seq = String(count).padStart(2, '0');
    const docNo = `${dateKey}${seq}`;

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
 * Formats an invoice object or invoice number string into the desired DOC NO:
 * [YYYY][MM(padded)][DD(padded)][daily sequence(2-digit)].
 * (e.g. 1st invoice on 2026-10-13 -> "2026101301", on 2026-09-13 -> "2026091301")
 */
export function formatDocNo(inv: any, allInvoices?: any[]): string {
  if (!inv) return '';

  // Handle string input
  if (typeof inv === 'string') {
    const trimmed = inv.trim();
    if (!trimmed) return '';

    // Check cache first
    if (cachedDocNoMap.has(trimmed)) {
      return cachedDocNoMap.get(trimmed)!;
    }

    // Already in 10-digit format (e.g. "2026101301")
    if (/^\d{10}$/.test(trimmed)) return trimmed;

    // Prefixed with INV-: e.g. "INV-2026101301"
    const invMatch = trimmed.match(/^INV-(\d{10})$/i);
    if (invMatch) return invMatch[1];

    inv = { invoiceNumber: trimmed };
  }

  // Already computed and matches standard 10-digit format
  if (inv.docNo && /^\d{10}$/.test(String(inv.docNo))) return String(inv.docNo);

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
  if (inv.invoiceNumber && /^\d{10}$/.test(String(inv.invoiceNumber).trim())) {
    return String(inv.invoiceNumber).trim();
  }
  const matchInv = String(inv.invoiceNumber || '').match(/^INV-(\d{10})$/i);
  if (matchInv) {
    return matchInv[1];
  }

  const { y, m, d } = extractInvoiceDateParts(inv);
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const dateKey = `${y}${mm}${dd}`;

  const invoices = (Array.isArray(allInvoices) && allInvoices.length > 0)
    ? allInvoices
    : cachedInvoicesList;

  if (invoices && invoices.length > 0) {
    const sameDayInvoices = invoices.filter(item => {
      const parts = extractInvoiceDateParts(item);
      const itemKey = `${parts.y}${String(parts.m).padStart(2, '0')}${String(parts.d).padStart(2, '0')}`;
      return itemKey === dateKey;
    }).sort((a, b) => {
      const timeA = new Date(a.invoiceDate || a.createdAt || 0).getTime();
      const timeB = new Date(b.invoiceDate || b.createdAt || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const numA = Number(a.id);
      const numB = Number(b.id);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const idx = sameDayInvoices.findIndex(i =>
      (inv.id && i.id === inv.id) ||
      (inv.invoiceNumber && i.invoiceNumber === inv.invoiceNumber)
    );

    if (idx !== -1) {
      const docNo = `${dateKey}${String(idx + 1).padStart(2, '0')}`;
      inv.docNo = docNo;
      return docNo;
    }

    // New invoice being created on that day
    const docNo = `${dateKey}${String(sameDayInvoices.length + 1).padStart(2, '0')}`;
    inv.docNo = docNo;
    return docNo;
  }

  return `${dateKey}01`;
}
