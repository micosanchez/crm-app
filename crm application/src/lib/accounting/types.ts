/**
 * Accounting module — shared types.
 * Mirrors the tables in supabase/migrations/0018_accounting.sql.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalSide = 'debit' | 'credit';
export type JeSource =
  | 'manual' | 'invoice' | 'payment' | 'expense'
  | 'depreciation' | 'close' | 'opening' | 'adjustment';
export type JeStatus = 'posted' | 'void';
export type BankTxnDirection = 'debit' | 'credit'; // debit = money out, credit = money in
export type BankTxnStatus = 'unmatched' | 'matched' | 'ignored';
export type PeriodStatus = 'open' | 'closed';
export type AccountingBasis = 'cash' | 'accrual';

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

/** Normal balance side is fixed by account type (contra accounts are the exception). */
export const DEFAULT_NORMAL_SIDE: Record<AccountType, NormalSide> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  expense: 'debit',
};

export interface Account {
  id: string;
  number: string;
  name: string;
  type: AccountType;
  normal_side: NormalSide;
  parent_id: string | null;
  system_key: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AccountBalance extends Account {
  total_debit: number;
  total_credit: number;
  balance: number;
}

/** Row shape returned by the ledger_balances(from,to) RPC. */
export interface LedgerBalanceRow {
  account_id: string;
  number: string;
  name: string;
  type: AccountType;
  normal_side: NormalSide;
  system_key: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface JournalEntry {
  id: string;
  entry_no: number;
  entry_date: string;
  memo: string | null;
  source: JeSource;
  source_table: string | null;
  source_id: string | null;
  status: JeStatus;
  reconciled: boolean;
  is_closing: boolean;
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  journal_lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  memo: string | null;
  reconciled: boolean;
  bank_transaction_id: string | null;
  line_no: number;
  accounts?: Pick<Account, 'id' | 'number' | 'name' | 'type'>;
}

export interface BankTransaction {
  id: string;
  account_id: string;
  source: string;
  external_id: string | null;
  posted_date: string;
  description: string;
  amount: number;
  direction: BankTxnDirection;
  status: BankTxnStatus;
  matched_entry_id: string | null;
  matched_line_id: string | null;
  reconciliation_id: string | null;
  import_batch_id: string | null;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface Reconciliation {
  id: string;
  account_id: string;
  period_month: string;
  statement_start: string | null;
  statement_end: string;
  statement_ending_balance: number;
  book_balance: number;
  cleared_balance: number;
  difference: number;
  status: 'in_progress' | 'reconciled';
  override: boolean;
  note: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Period {
  id: string;
  period_month: string;
  status: PeriodStatus;
  closed_at: string | null;
  reopened_at: string | null;
  note: string | null;
}

export interface AccountingSettings {
  id: boolean;
  basis: AccountingBasis;
  equipment_treatment: 'expense' | 'capitalize' | 'ask';
  cash_account_id: string | null;
  ar_account_id: string | null;
  books_start_date: string | null;
}

/** A single journal line as sent from the client to the post-entry action. */
export interface DraftLine {
  account_id: string;
  debit: number;
  credit: number;
  memo?: string | null;
}

export const money = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** First day of the month (YYYY-MM-01) for a date string/Date. */
export const monthFirst = (d: string | Date) => {
  const dt = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`;
};
