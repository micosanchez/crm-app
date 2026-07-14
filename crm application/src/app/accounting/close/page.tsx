import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { typeValue } from '@/lib/accounting/financials';
import type { LedgerBalanceRow, Period, Reconciliation } from '@/lib/accounting/types';
import CloseBooks from './CloseBooks';

export const dynamic = 'force-dynamic';

const monthFirst = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

export default async function ClosePage({ searchParams }: { searchParams: { month?: string } }) {
  await requireStaff();
  const supabase = createClient();

  const now = new Date();
  const month = searchParams.month || monthFirst(now);
  const md = new Date(month + 'T00:00:00');
  const monthEnd = new Date(md.getFullYear(), md.getMonth() + 1, 0).toISOString().slice(0, 10);

  const { data: settings } = await supabase.from('accounting_settings').select('cash_account_id').eq('id', true).maybeSingle();
  const cashId = settings?.cash_account_id ?? null;

  const [{ data: periods }, { data: recon }, { data: balances }, unmatched] = await Promise.all([
    supabase.from('periods').select('*').order('period_month', { ascending: false }).limit(24),
    supabase.from('reconciliations').select('*').eq('period_month', month).maybeSingle(),
    supabase.rpc('ledger_balances', { p_from: month, p_to: monthEnd }),
    cashId
      ? supabase.from('bank_transactions').select('id', { count: 'exact', head: true })
          .eq('account_id', cashId).eq('status', 'unmatched').gte('posted_date', month).lte('posted_date', monthEnd)
      : Promise.resolve({ count: 0 }),
  ]);

  const rows = (balances ?? []) as LedgerBalanceRow[];
  const revenue = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + typeValue(r), 0);
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + typeValue(r), 0);

  return (
    <CloseBooks
      month={month}
      monthEnd={monthEnd}
      periods={(periods ?? []) as Period[]}
      reconciliation={(recon ?? null) as Reconciliation | null}
      unmatchedCount={unmatched.count ?? 0}
      netIncome={Math.round((revenue - expense) * 100) / 100}
      revenue={Math.round(revenue * 100) / 100}
      expense={Math.round(expense * 100) / 100}
    />
  );
}
