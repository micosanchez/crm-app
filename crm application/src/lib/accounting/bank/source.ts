/**
 * Pluggable bank data-source abstraction.
 *
 * Everything downstream (the matching engine, the reconciliation UI, the
 * server import action) consumes `NormalizedBankTxn[]`. It never knows or
 * cares whether the rows came from a Bluevine CSV, an OFX file, or — later —
 * a Plaid API feed. To add Plaid you implement `BankSource.getTransactions()`
 * and return the same normalized shape; nothing else changes.
 */

export type Direction = 'debit' | 'credit'; // debit = money OUT, credit = money IN

export interface NormalizedBankTxn {
  /** ISO date, YYYY-MM-DD */
  postedDate: string;
  description: string;
  /** magnitude, always > 0 */
  amount: number;
  direction: Direction;
  /** stable id for dedupe — OFX FITID, provider id, or a content hash */
  externalId: string;
  /** original parsed row, kept for audit */
  raw: Record<string, unknown>;
}

export interface BankSource {
  /** stable source id stored on bank_transactions.source */
  readonly id: string;
  readonly label: string;
  getTransactions(): Promise<NormalizedBankTxn[]>;
}

/** Maps raw columns → normalized fields. Two shapes are supported:
 *  - a single signed `amount` column, or
 *  - separate `credit` (money in) and `debit` (money out) columns. */
export interface ColumnMapping {
  date: string;
  description: string;
  amount?: string;
  credit?: string;
  debit?: string;
  externalId?: string;
  /** how to read the sign of a single amount column */
  amountSign?: 'standard' | 'inverted'; // standard: negative = money out
}

/** djb2 — deterministic, dependency-free hash for dedupe external ids. */
export function contentHash(parts: (string | number)[]): string {
  const s = parts.join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(36);
}

/** Parse a number out of messy bank text: "$1,234.56", "(45.00)", "-45". */
export function parseAmount(v: unknown): number {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s) || s.includes('-');
  s = s.replace(/[()]/g, '').replace(/[^0-9.]/g, '');
  if (!s) return NaN;
  const n = parseFloat(s);
  return negative ? -n : n;
}

/** Normalize varied date formats to YYYY-MM-DD. Accepts ISO, M/D/YYYY, M/D/YY. */
export function normalizeDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = '20' + yr;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s; // leave as-is; caller can flag
}

const HINT = {
  date: ['date', 'posted', 'posting date', 'transaction date', 'trans date'],
  description: ['description', 'memo', 'name', 'details', 'payee', 'narrative'],
  amount: ['amount', 'value', 'transaction amount'],
  credit: ['credit', 'deposit', 'money in', 'paid in', 'inflow'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out', 'outflow'],
  externalId: ['transaction id', 'id', 'reference', 'ref', 'fitid'],
};

/** Best-effort guess of a column mapping from CSV headers. */
export function detectMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const find = (hints: string[]) => {
    for (const hint of hints) {
      const i = lower.findIndex((h) => h === hint);
      if (i >= 0) return headers[i];
    }
    for (const hint of hints) {
      const i = lower.findIndex((h) => h.includes(hint));
      if (i >= 0) return headers[i];
    }
    return undefined;
  };
  const mapping: ColumnMapping = {
    date: find(HINT.date) ?? headers[0] ?? 'Date',
    description: find(HINT.description) ?? headers[1] ?? 'Description',
    amountSign: 'standard',
  };
  const credit = find(HINT.credit);
  const debit = find(HINT.debit);
  const amount = find(HINT.amount);
  if (credit && debit) {
    mapping.credit = credit;
    mapping.debit = debit;
  } else if (amount) {
    mapping.amount = amount;
  } else if (credit || debit) {
    mapping.amount = credit ?? debit;
  }
  mapping.externalId = find(HINT.externalId);
  return mapping;
}

/** Turn a raw row object into a normalized txn using a column mapping. */
export function applyMapping(row: Record<string, string>, m: ColumnMapping): NormalizedBankTxn | null {
  const postedDate = normalizeDate(row[m.date]);
  const description = (row[m.description] ?? '').toString().trim() || '(no description)';

  let signed: number;
  if (m.credit || m.debit) {
    const cr = m.credit ? parseAmount(row[m.credit]) : NaN;
    const dr = m.debit ? parseAmount(row[m.debit]) : NaN;
    if (!isNaN(cr) && cr !== 0) signed = Math.abs(cr);
    else if (!isNaN(dr) && dr !== 0) signed = -Math.abs(dr);
    else return null;
  } else if (m.amount) {
    const a = parseAmount(row[m.amount]);
    if (isNaN(a) || a === 0) return null;
    signed = m.amountSign === 'inverted' ? -a : a;
  } else {
    return null;
  }

  const direction: Direction = signed < 0 ? 'debit' : 'credit';
  const amount = Math.abs(signed);
  const externalId =
    (m.externalId && row[m.externalId]) ? String(row[m.externalId]) : contentHash([postedDate, amount, description, direction]);

  return { postedDate, description, amount, direction, externalId, raw: row };
}
