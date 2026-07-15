import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { Account, AccountBalance, BankTransaction, Reconciliation as Recon } from '@/lib/accounting/types';
import type { CashLineCandidate } from '@/lib/accounting/matching';
import ReconciliationWorkspace from './Reconciliation';

export const dynamic = 'force-dynamic';

const monthFirst = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

type RawLine = {
  id: string; entry_id: string; debit: number; credit: number;
  journal_entries: { entry_date: string; memo: string | null; status: string } | null;
};

export default async function ReconciliationPage({ searchParams }: { searchParams: { account?: string } }) {
  await requireStaff();
  const supabase = createClient();

  const { data: settings } = await supabase.from('accounting_settings').select('cash_account_id').eq('id', true).maybeSingle();
  const cashId = settings?.cash_account_id ?? null;
  if (!cashId) {
    return <div className="card text-sm" style={{ color: 'var(--text-muted)' }}>No cash account configured. Run first-time setup.</div>;
  }
  const accountId = searchParams.account || cashId;

  const [{ data: acct }, { data: accounts }, { data: bankTxns }, { data: lines }, { data: recons }] = await Promise.all([
    supabase.from('account_balances').select('*').eq('account_id', accountId).maybeSingle(),
    supabase.from('accounts').select('id,number,name,type,normal_side,system_key').eq('is_active', true).order('number'),
    supabase.from('bank_transactions').select('*').eq('account_id', accountId).order('posted_date', { ascending: false }).limit(500),
    supabase.from('journal_lines')
      .select('id,entry_id,debit,credit,journal_entries!inner(entry_date,memo,status)')
      .eq('account_id', accountId).eq('reconciled', false).eq('journal_entries.status', 'posted').limit(500),
    supabase.from('reconciliations').select('*').eq('account_id', accountId).order('period_month', { ascending: false }).limit(12),
  ]);

  const candidates: CashLineCandidate[] = ((lines ?? []) as unknown as RawLine[])
    .filter((l) => l.journal_entries)
    .map((l) => ({
      entryId: l.entry_id, lineId: l.id, entryDate: l.journal_entries!.entry_date,
      debit: Number(l.debit), credit: Number(l.credit), memo: l.journal_entries!.memo ?? '',
    }));

  // Accounts you can reconcile against a statement: cash-like assets + credit cards.
  const all = (accounts ?? []) as Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side' | 'system_key'>[];
  const reconcilable = all.filter((a) => a.type === 'asset' || a.type === 'liability');

  return (
    <ReconciliationWorkspace
      cashAccountId={accountId}
      cashAccount={(acct ?? null) as AccountBalance | null}
      accounts={all}
      reconcilable={reconcilable}
      bankTxns={(bankTxns ?? []) as BankTransaction[]}
      candidates={candidates}
      reconciliations={(recons ?? []) as Recon[]}
      currentMonth={monthFirst(new Date())}
    />
  );
}
