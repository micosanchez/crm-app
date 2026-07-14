/**
 * Financial statement builders — pure functions over ledger balance rows.
 *
 * Sign convention: values are reported using the account TYPE's normal side
 * (assets & expenses = debit − credit; liabilities, equity & revenue =
 * credit − debit). This makes contra accounts (Accumulated Depreciation, an
 * asset with a credit balance; Owner Draws, equity with a debit balance) fall
 * out with the correct sign automatically, and guarantees the balance sheet
 * ties because total debits = total credits across a posted ledger.
 */
import type { AccountType, LedgerBalanceRow } from './types';

export interface StatementLine { accountId: string; number: string; label: string; amount: number; }
export interface StatementGroup { label: string; lines: StatementLine[]; total: number; }

export interface IncomeStatement {
  basis: 'cash' | 'accrual';
  from: string; to: string;
  revenue: StatementGroup;
  expenses: StatementGroup;
  netIncome: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: StatementGroup;
  liabilities: StatementGroup;
  equity: StatementGroup;           // includes a synthetic "Current period earnings" line
  totalLiabilitiesEquity: number;
  netIncome: number;
  balanced: boolean;
  difference: number;               // assets − (liabilities + equity)
}

/** Value of a row using its account TYPE's normal side. */
export function typeValue(row: Pick<LedgerBalanceRow, 'type' | 'debit' | 'credit'>): number {
  const debitNormal = row.type === 'asset' || row.type === 'expense';
  return debitNormal ? Number(row.debit) - Number(row.credit) : Number(row.credit) - Number(row.debit);
}

function group(rows: LedgerBalanceRow[], type: AccountType, label: string, dropZero = true): StatementGroup {
  const lines = rows
    .filter((r) => r.type === type)
    .map((r) => ({ accountId: r.account_id, number: r.number, label: r.name, amount: round(typeValue(r)) }))
    .filter((l) => !dropZero || l.amount !== 0)
    .sort((a, b) => a.number.localeCompare(b.number));
  return { label, lines, total: round(lines.reduce((s, l) => s + l.amount, 0)) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Accrual Income Statement straight from the ledger. */
export function buildAccrualIncomeStatement(rows: LedgerBalanceRow[], from: string, to: string): IncomeStatement {
  const revenue = group(rows, 'revenue', 'Revenue');
  const expenses = group(rows, 'expense', 'Expenses');
  return { basis: 'accrual', from, to, revenue, expenses, netIncome: round(revenue.total - expenses.total) };
}

/** Cash Income Statement from actual cash events (payments in / expenses out). */
export function buildCashIncomeStatement(
  payments: { amount: number; paid_at: string }[],
  expenses: { amount: number; category: string; incurred_on: string }[],
  from: string, to: string,
): IncomeStatement {
  const revTotal = round(payments.reduce((s, p) => s + Number(p.amount), 0));
  const revenue: StatementGroup = {
    label: 'Revenue',
    lines: revTotal ? [{ accountId: 'cash-rev', number: '4000', label: 'Hauling Income (cash received)', amount: revTotal }] : [],
    total: revTotal,
  };
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount));
  const lines = Array.from(byCat.entries())
    .map(([cat, amt]) => ({ accountId: 'cash-' + cat, number: cat, label: cat.replace(/_/g, ' '), amount: round(amt) }))
    .sort((a, b) => b.amount - a.amount);
  const expenses2: StatementGroup = { label: 'Expenses', lines, total: round(lines.reduce((s, l) => s + l.amount, 0)) };
  return { basis: 'cash', from, to, revenue, expenses: expenses2, netIncome: round(revenue.total - expenses2.total) };
}

/** Balance Sheet as of a date. Current-period P&L rolls into equity so it ties. */
export function buildBalanceSheet(rows: LedgerBalanceRow[], asOf: string): BalanceSheet {
  const assets = group(rows, 'asset', 'Assets');
  const liabilities = group(rows, 'liability', 'Liabilities');
  const equityBase = group(rows, 'equity', 'Equity');

  const revenueTotal = round(rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + typeValue(r), 0));
  const expenseTotal = round(rows.filter((r) => r.type === 'expense').reduce((s, r) => s + typeValue(r), 0));
  const netIncome = round(revenueTotal - expenseTotal);

  const equity: StatementGroup = {
    label: 'Equity',
    lines: [...equityBase.lines, { accountId: 'current-earnings', number: '3950', label: 'Current period earnings', amount: netIncome }],
    total: round(equityBase.total + netIncome),
  };

  const totalLiabilitiesEquity = round(liabilities.total + equity.total);
  const difference = round(assets.total - totalLiabilitiesEquity);
  return {
    asOf, assets, liabilities, equity, totalLiabilitiesEquity, netIncome,
    balanced: Math.abs(difference) < 0.01, difference,
  };
}

/** CSV export for either statement. */
export function incomeStatementCsv(is: IncomeStatement): string {
  const rows: string[][] = [['Income Statement', `${is.from} to ${is.to}`, `${is.basis} basis`]];
  rows.push([], ['Revenue', '']);
  is.revenue.lines.forEach((l) => rows.push([l.label, l.amount.toFixed(2)]));
  rows.push(['Total Revenue', is.revenue.total.toFixed(2)], [], ['Expenses', '']);
  is.expenses.lines.forEach((l) => rows.push([l.label, l.amount.toFixed(2)]));
  rows.push(['Total Expenses', is.expenses.total.toFixed(2)], [], ['Net Income', is.netIncome.toFixed(2)]);
  return toCsv(rows);
}

export function balanceSheetCsv(bs: BalanceSheet): string {
  const rows: string[][] = [['Balance Sheet', `As of ${bs.asOf}`]];
  const section = (g: StatementGroup) => {
    rows.push([], [g.label, '']);
    g.lines.forEach((l) => rows.push([l.label, l.amount.toFixed(2)]));
    rows.push([`Total ${g.label}`, g.total.toFixed(2)]);
  };
  section(bs.assets);
  section(bs.liabilities);
  section(bs.equity);
  rows.push([], ['Total Liabilities + Equity', bs.totalLiabilitiesEquity.toFixed(2)], ['Balanced', bs.balanced ? 'YES' : `NO (off ${bs.difference.toFixed(2)})`]);
  return toCsv(rows);
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}
