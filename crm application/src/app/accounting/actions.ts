'use server';
/**
 * Accounting server actions. Every financial write lands here — server-side,
 * staff-gated, RLS-guarded. No financial data is ever trusted from or stored in
 * the client. Heavy/atomic operations (seed, backfill, close) run as Postgres
 * functions; this layer orchestrates and revalidates.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { AccountType, DraftLine } from '@/lib/accounting/types';
import type { NormalizedBankTxn } from '@/lib/accounting/bank/source';

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
const bump = () => revalidatePath('/accounting', 'layout');

async function db() {
  await requireStaff();
  return createClient();
}

// ---------------------------------------------------------------- setup
export async function seedChartOfAccounts(): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc('seed_chart_of_accounts');
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function runBackfill(): Promise<Result<{ created: number }>> {
  const supabase = await db();
  const { data, error } = await supabase.rpc('backfill_ledger');
  if (error) return { ok: false, error: error.message };
  const created = Array.isArray(data) ? Number(data[0]?.entries_created ?? 0) : Number(data ?? 0);
  bump();
  return { ok: true, data: { created } };
}

export async function updateSettings(input: {
  basis?: 'cash' | 'accrual';
  equipment_treatment?: 'expense' | 'capitalize' | 'ask';
  books_start_date?: string | null;
}): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from('accounting_settings')
    .update({ ...input, updated_at: new Date().toISOString() }).eq('id', true);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- chart of accounts
export async function createAccount(input: {
  number: string; name: string; type: AccountType; normal_side: 'debit' | 'credit';
  description?: string | null; sort_order?: number;
}): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from('accounts').insert({
    number: input.number.trim(), name: input.name.trim(), type: input.type,
    normal_side: input.normal_side, description: input.description || null,
    sort_order: input.sort_order ?? 500,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function updateAccount(id: string, input: {
  number?: string; name?: string; type?: AccountType; normal_side?: 'debit' | 'credit';
  description?: string | null; is_active?: boolean; sort_order?: number;
}): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from('accounts').update(input).eq('id', id);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function deleteAccount(id: string): Promise<Result> {
  const supabase = await db();
  const { data: acct } = await supabase.from('accounts').select('system_key').eq('id', id).single();
  if (acct?.system_key) return { ok: false, error: 'This is a system account — deactivate it instead of deleting.' };
  const { count } = await supabase.from('journal_lines').select('id', { count: 'exact', head: true }).eq('account_id', id);
  if (count && count > 0) return { ok: false, error: `Account has ${count} journal line(s). Deactivate it instead.` };
  const { error } = await supabase.from('accounts').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function reorderAccounts(orders: { id: string; sort_order: number }[]): Promise<Result> {
  const supabase = await db();
  for (const o of orders) {
    const { error } = await supabase.from('accounts').update({ sort_order: o.sort_order }).eq('id', o.id);
    if (error) return { ok: false, error: error.message };
  }
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- journal
export async function createJournalEntry(input: {
  entry_date: string; memo: string; lines: DraftLine[]; source?: 'manual' | 'adjustment';
}): Promise<Result<{ entryId: string }>> {
  const supabase = await db();
  const lines = input.lines
    .map((l) => ({ account_id: l.account_id, debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0), memo: l.memo ?? null }))
    .filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
  if (lines.length < 2) return { ok: false, error: 'An entry needs at least two lines.' };
  for (const l of lines) if (l.debit > 0 && l.credit > 0) return { ok: false, error: 'A line cannot have both a debit and a credit.' };
  const totalDr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (totalDr !== totalCr) return { ok: false, error: `Out of balance: debits ${totalDr} ≠ credits ${totalCr}.` };

  const { data, error } = await supabase.rpc('post_entry', {
    p_date: input.entry_date, p_memo: input.memo || 'Manual entry',
    p_source: input.source ?? 'manual', p_source_table: null, p_source_id: null,
    p_lines: lines, p_is_closing: false,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true, data: { entryId: String(data) } };
}

export async function voidJournalEntry(id: string, reason: string): Promise<Result> {
  const supabase = await db();
  // Release any bank matches first so the transactions return to "unmatched".
  await supabase.from('bank_transactions')
    .update({ status: 'unmatched', matched_entry_id: null, matched_line_id: null })
    .eq('matched_entry_id', id);
  await supabase.from('journal_lines').update({ reconciled: false, bank_transaction_id: null }).eq('entry_id', id);
  const { error } = await supabase.from('journal_entries')
    .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason || 'voided', reconciled: false })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- bank import
export async function importBankTransactions(input: {
  accountId: string; source: string; filename: string; txns: NormalizedBankTxn[];
}): Promise<Result<{ inserted: number; duplicates: number }>> {
  const supabase = await db();
  if (!input.txns.length) return { ok: false, error: 'No transactions found in the file.' };

  const { data: batch, error: bErr } = await supabase.from('bank_import_batches')
    .insert({ account_id: input.accountId, source: input.source, filename: input.filename, row_count: input.txns.length })
    .select('id').single();
  if (bErr) return { ok: false, error: bErr.message };

  // De-collide identical content-hash ids so genuine same-day duplicates (e.g. two
  // $20 fuel stops) both import, while re-importing the same file still dedupes.
  const seen = new Map<string, number>();
  const rows = input.txns.map((t) => {
    const n = (seen.get(t.externalId) ?? 0) + 1;
    seen.set(t.externalId, n);
    return {
      account_id: input.accountId, source: input.source,
      external_id: n === 1 ? t.externalId : `${t.externalId}#${n}`,
      posted_date: t.postedDate, description: t.description, amount: t.amount, direction: t.direction,
      raw: t.raw ?? {}, import_batch_id: batch.id,
    };
  });

  const { data: inserted, error } = await supabase.from('bank_transactions')
    .upsert(rows, { onConflict: 'account_id,source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, error: error.message };

  const insertedCount = inserted?.length ?? 0;
  const duplicates = input.txns.length - insertedCount;
  await supabase.from('bank_import_batches')
    .update({ inserted_count: insertedCount, duplicate_count: duplicates }).eq('id', batch.id);
  bump();
  return { ok: true, data: { inserted: insertedCount, duplicates } };
}

// ---------------------------------------------------------------- matching
export async function confirmMatch(bankTxnId: string, lineId: string): Promise<Result> {
  const supabase = await db();
  const { data: line } = await supabase.from('journal_lines').select('id,entry_id').eq('id', lineId).single();
  if (!line) return { ok: false, error: 'Journal line not found.' };
  const upd = await supabase.from('bank_transactions')
    .update({ status: 'matched', matched_entry_id: line.entry_id, matched_line_id: lineId }).eq('id', bankTxnId);
  if (upd.error) return { ok: false, error: upd.error.message };
  await supabase.from('journal_lines').update({ reconciled: true, bank_transaction_id: bankTxnId }).eq('id', lineId);
  await supabase.from('journal_entries').update({ reconciled: true }).eq('id', line.entry_id);
  bump();
  return { ok: true };
}

export async function unmatch(bankTxnId: string): Promise<Result> {
  const supabase = await db();
  const { data: txn } = await supabase.from('bank_transactions').select('matched_line_id,matched_entry_id').eq('id', bankTxnId).single();
  if (txn?.matched_line_id) await supabase.from('journal_lines').update({ reconciled: false, bank_transaction_id: null }).eq('id', txn.matched_line_id);
  if (txn?.matched_entry_id) await supabase.from('journal_entries').update({ reconciled: false }).eq('id', txn.matched_entry_id);
  const { error } = await supabase.from('bank_transactions')
    .update({ status: 'unmatched', matched_entry_id: null, matched_line_id: null }).eq('id', bankTxnId);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function setTransactionIgnored(bankTxnId: string, ignored: boolean): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from('bank_transactions')
    .update({ status: ignored ? 'ignored' : 'unmatched' }).eq('id', bankTxnId);
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

/** One-click: create the missing journal entry for an unmatched bank txn and match it. */
export async function createEntryFromBankTxn(input: {
  bankTxnId: string; offsetAccountId: string; memo?: string;
}): Promise<Result> {
  const supabase = await db();
  const { data: txn } = await supabase.from('bank_transactions')
    .select('id,account_id,posted_date,description,amount,direction').eq('id', input.bankTxnId).single();
  if (!txn) return { ok: false, error: 'Bank transaction not found.' };

  const cash = txn.account_id;
  const amount = Number(txn.amount);
  // credit (money in): Dr Cash / Cr offset. debit (money out): Dr offset / Cr Cash.
  const lines = txn.direction === 'credit'
    ? [{ account_id: cash, debit: amount, credit: 0, memo: 'Bluevine cash' },
       { account_id: input.offsetAccountId, debit: 0, credit: amount, memo: input.memo || txn.description }]
    : [{ account_id: input.offsetAccountId, debit: amount, credit: 0, memo: input.memo || txn.description },
       { account_id: cash, debit: 0, credit: amount, memo: 'Bluevine cash' }];

  const { data: entryId, error } = await supabase.rpc('post_entry', {
    p_date: txn.posted_date, p_memo: input.memo || txn.description,
    p_source: 'manual', p_source_table: 'bank_transactions', p_source_id: txn.id,
    p_lines: lines, p_is_closing: false,
  });
  if (error) return { ok: false, error: error.message };

  // Match the cash line back to the bank txn.
  const { data: cashLine } = await supabase.from('journal_lines')
    .select('id').eq('entry_id', String(entryId)).eq('account_id', cash).single();
  if (cashLine) {
    await supabase.from('journal_lines').update({ reconciled: true, bank_transaction_id: txn.id }).eq('id', cashLine.id);
    await supabase.from('bank_transactions')
      .update({ status: 'matched', matched_entry_id: String(entryId), matched_line_id: cashLine.id }).eq('id', txn.id);
    await supabase.from('journal_entries').update({ reconciled: true }).eq('id', String(entryId));
  }
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- reconciliation
export async function saveReconciliation(input: {
  accountId: string; periodMonth: string; statementStart?: string | null;
  statementEnd: string; statementEndingBalance: number; note?: string | null; override?: boolean;
}): Promise<Result<{ status: string; difference: number }>> {
  const supabase = await db();

  // Book balance of the cash account as of statement end (posted ledger = source of truth).
  const { data: balances, error: bErr } = await supabase.rpc('ledger_balances', { p_from: null, p_to: input.statementEnd });
  if (bErr) return { ok: false, error: bErr.message };
  const cashRow = (balances as { account_id: string; balance: number }[] | null)?.find((b) => b.account_id === input.accountId);
  const bookBalance = round2(Number(cashRow?.balance ?? 0));

  // Cleared balance = sum of matched (cleared) bank txns up to statement end.
  const { data: cleared } = await supabase.from('bank_transactions')
    .select('amount,direction,status,posted_date').eq('account_id', input.accountId).lte('posted_date', input.statementEnd);
  const clearedBalance = round2((cleared ?? []).filter((t) => t.status === 'matched')
    .reduce((s, t) => s + (t.direction === 'credit' ? Number(t.amount) : -Number(t.amount)), 0));

  const difference = round2(input.statementEndingBalance - bookBalance);
  const reconciled = Math.abs(difference) < 0.01 || !!input.override;

  const payload = {
    account_id: input.accountId, period_month: input.periodMonth,
    statement_start: input.statementStart || null, statement_end: input.statementEnd,
    statement_ending_balance: round2(input.statementEndingBalance),
    book_balance: bookBalance, cleared_balance: clearedBalance, difference,
    status: reconciled ? 'reconciled' : 'in_progress', override: !!input.override,
    note: input.note || null, completed_at: reconciled ? new Date().toISOString() : null,
  };

  // Upsert the month's reconciliation for this account.
  const { data: existing } = await supabase.from('reconciliations')
    .select('id').eq('account_id', input.accountId).eq('period_month', input.periodMonth).maybeSingle();
  const res = existing
    ? await supabase.from('reconciliations').update(payload).eq('id', existing.id)
    : await supabase.from('reconciliations').insert(payload);
  if (res.error) return { ok: false, error: res.error.message };
  bump();
  return { ok: true, data: { status: payload.status, difference } };
}

// ---------------------------------------------------------------- close
export async function closePeriod(month: string, override: boolean, note: string): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc('close_period', { p_month: month, p_override: override, p_note: note || null });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function reopenPeriod(month: string): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc('reopen_period', { p_month: month });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- opening balances
export async function setOpeningBalances(input: {
  asOf: string; lines: { account_id: string; balance: number }[];
}): Promise<Result> {
  const supabase = await db();
  const lines = input.lines
    .filter((l) => l.account_id && Number(l.balance) !== 0)
    .map((l) => ({ account_id: l.account_id, balance: round2(Number(l.balance)) }));
  const { error } = await supabase.rpc('set_opening_balances', { p_as_of: input.asOf, p_lines: lines });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- batched / fee-aware deposit match
/** Match one bank deposit to several book cash lines (e.g. a Stripe payout that
 *  bundles multiple payments), booking any shortfall to a fee account so book
 *  cash nets down to the actual deposit. Works for a single line too. */
export async function matchDepositBatch(input: {
  bankTxnId: string; lineIds: string[]; feeAccountId?: string; feeAmount?: number;
}): Promise<Result> {
  const supabase = await db();
  if (!input.lineIds.length) return { ok: false, error: 'Select at least one entry to match.' };
  const { data: txn } = await supabase.from('bank_transactions')
    .select('id,account_id,amount,direction,posted_date').eq('id', input.bankTxnId).single();
  if (!txn) return { ok: false, error: 'Bank transaction not found.' };
  const cash = txn.account_id;

  const { data: lines } = await supabase.from('journal_lines').select('id,entry_id').in('id', input.lineIds);
  const entryIds = Array.from(new Set((lines ?? []).map((l) => l.entry_id)));
  for (const lineId of input.lineIds) {
    await supabase.from('journal_lines').update({ reconciled: true, bank_transaction_id: input.bankTxnId }).eq('id', lineId);
  }
  for (const eid of entryIds) await supabase.from('journal_entries').update({ reconciled: true }).eq('id', eid);

  const fee = round2(Number(input.feeAmount) || 0);
  if (fee > 0 && input.feeAccountId) {
    // Deposit was net of a fee: Dr Fees / Cr Cash reduces book cash to the deposited amount.
    const feeLines = [
      { account_id: input.feeAccountId, debit: fee, credit: 0, memo: 'Processing / merchant fee' },
      { account_id: cash, debit: 0, credit: fee, memo: 'Fee deducted from deposit' },
    ];
    const { data: feeEntry, error } = await supabase.rpc('post_entry', {
      p_date: txn.posted_date, p_memo: 'Deposit fee adjustment', p_source: 'adjustment',
      p_source_table: 'bank_transactions', p_source_id: txn.id, p_lines: feeLines, p_is_closing: false,
    });
    if (error) return { ok: false, error: error.message };
    const { data: feeCashLine } = await supabase.from('journal_lines')
      .select('id').eq('entry_id', String(feeEntry)).eq('account_id', cash).single();
    if (feeCashLine) await supabase.from('journal_lines').update({ reconciled: true, bank_transaction_id: txn.id }).eq('id', feeCashLine.id);
  }

  await supabase.from('bank_transactions')
    .update({ status: 'matched', matched_entry_id: entryIds[0] ?? null }).eq('id', input.bankTxnId);
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- depreciation
export async function createDepreciationSchedule(input: {
  asset_name: string; asset_account_id: string; accum_account_id: string; expense_account_id: string;
  cost: number; salvage: number; useful_life_months: number; start_date: string;
}): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.from('depreciation_schedules').insert({
    asset_name: input.asset_name.trim(), asset_account_id: input.asset_account_id,
    accum_account_id: input.accum_account_id, expense_account_id: input.expense_account_id,
    cost: round2(input.cost), salvage: round2(input.salvage || 0),
    useful_life_months: Math.max(1, Math.round(input.useful_life_months)), start_date: input.start_date,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function postDepreciation(scheduleId: string, month: string): Promise<Result> {
  const supabase = await db();
  const { error } = await supabase.rpc('post_depreciation', { p_schedule_id: scheduleId, p_month: month });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ---------------------------------------------------------------- edit (void + repost, audit-preserving)
export async function repostJournalEntry(oldId: string, input: {
  entry_date: string; memo: string; lines: DraftLine[];
}): Promise<Result<{ entryId: string }>> {
  const v = await voidJournalEntry(oldId, 'edited — superseded');
  if (!v.ok) return v;
  return createJournalEntry({ entry_date: input.entry_date, memo: input.memo, lines: input.lines, source: 'adjustment' });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
