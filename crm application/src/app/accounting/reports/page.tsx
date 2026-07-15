import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { buildTrialBalance, buildArAging, buildCashFlow } from '@/lib/accounting/financials';
import type { CashActivityRow, LedgerBalanceRow } from '@/lib/accounting/types';
import Reports from './Reports';

export const dynamic = 'force-dynamic';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function ReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requireStaff();
  const supabase = createClient();

  const now = new Date();
  const to = searchParams.to || iso(now);
  const from = searchParams.from || iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const dayBefore = iso(new Date(new Date(from + 'T00:00:00').getTime() - 86_400_000));

  const { data: settings } = await supabase.from('accounting_settings').select('cash_account_id').eq('id', true).maybeSingle();
  const cashId = settings?.cash_account_id ?? null;

  const [{ data: asOfRows }, { data: openingRows }, { data: cashRows }, { data: invoices }] = await Promise.all([
    supabase.rpc('ledger_balances', { p_from: null, p_to: to }),
    supabase.rpc('ledger_balances', { p_from: null, p_to: dayBefore }),
    cashId ? supabase.rpc('cash_activity', { p_account: cashId, p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
    supabase.from('invoices').select('invoice_number,total,amount_paid,issued_at,customers(name)').eq('status', 'sent'),
  ]);

  const rows = (asOfRows ?? []) as LedgerBalanceRow[];
  const openCash = ((openingRows ?? []) as LedgerBalanceRow[]).find((r) => r.account_id === cashId);
  const closeCash = rows.find((r) => r.account_id === cashId);
  const openingCash = Number(openCash?.balance ?? 0);
  const closingCash = Number(closeCash?.balance ?? 0);

  const trialBalance = buildTrialBalance(rows, to);
  const aging = buildArAging(
    (invoices ?? []) as { invoice_number: number; total: number; amount_paid?: number | null; issued_at: string | null; customers?: { name?: string } | null }[],
    to,
  );
  const cashFlow = buildCashFlow((cashRows ?? []) as CashActivityRow[], from, to, openingCash, closingCash);

  return <Reports trialBalance={trialBalance} aging={aging} cashFlow={cashFlow} from={from} to={to} />;
}
