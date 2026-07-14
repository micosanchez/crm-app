/**
 * Bank source factory. Given a filename + text, returns the right BankSource.
 * Add new providers (e.g. a Plaid feed) here — the rest of the app is agnostic.
 */
import type { BankSource, ColumnMapping } from './source';
import { CsvBankSource, parseCsv } from './csv';
import { OfxBankSource } from './ofx';

export * from './source';
export { CsvBankSource, parseCsv } from './csv';
export { OfxBankSource } from './ofx';

export function isOfx(filename: string, text: string): boolean {
  return /\.(ofx|qfx)$/i.test(filename) || /<OFX>/i.test(text.slice(0, 4000)) || /<STMTTRN>/i.test(text.slice(0, 8000));
}

export function bankSourceFor(filename: string, text: string, mapping?: ColumnMapping): BankSource {
  if (isOfx(filename, text)) return new OfxBankSource(text);
  return new CsvBankSource(parseCsv(text), mapping);
}
