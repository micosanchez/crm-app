/**
 * CSV bank source. Dependency-free RFC-4180-ish parser (handles quoted fields,
 * embedded commas/newlines, and CRLF) plus a BankSource wrapper that applies a
 * (possibly auto-detected) column mapping.
 */
import {
  applyMapping, detectMapping, type BankSource, type ColumnMapping, type NormalizedBankTxn,
} from './source';

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  // strip BOM
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) { record.push(field); if (record.length > 1 || record[0] !== '') rows.push(record); }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = rows[r][idx] ?? ''; });
    out.push(obj);
  }
  return { headers, rows: out };
}

export class CsvBankSource implements BankSource {
  readonly id = 'bluevine_csv';
  readonly label = 'Bluevine CSV';
  private mapping: ColumnMapping;

  constructor(private parsed: ParsedCsv, mapping?: ColumnMapping) {
    this.mapping = mapping ?? detectMapping(parsed.headers);
  }

  static fromText(text: string, mapping?: ColumnMapping): CsvBankSource {
    return new CsvBankSource(parseCsv(text), mapping);
  }

  get columnMapping(): ColumnMapping { return this.mapping; }
  get headers(): string[] { return this.parsed.headers; }

  async getTransactions(): Promise<NormalizedBankTxn[]> {
    const out: NormalizedBankTxn[] = [];
    for (const row of this.parsed.rows) {
      const txn = applyMapping(row, this.mapping);
      if (txn) out.push(txn);
    }
    return out;
  }
}
