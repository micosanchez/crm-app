import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { buildAccrualIncomeStatement, buildCashIncomeStatement } from '@/lib/accounting/financials';
import type { LedgerBalanceRow } from '@/lib/accounting/types';
import IncomeStatementView from './IncomeStatementView';

export const dynamic = 'force-dynamic';

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; basis?: string };
}) {
  await requireStaff();
  const supabase = createClient();

  const { data: settings } = await supabase.from('accounting_settings').select('basis').eq('id', true).maybeSingle();
  const def = defaultRange();
  const from = searchParams.from || def.from;
  const to = searchParams.to || def.to;
  const basis = (searchParams.basis || settings?.basis || 'cash') as 'cash' | 'accrual';

  let statement;
  if (basis === 'accrual') {
    const { data } = await supabase.rpc('ledger_balances', { p_from: from, p_to: to });
    statement = buildAccrualIncomeStatement((data ?? []) as LedgerBalanceRow[], from, to);
  } else {
    const [{ data: payments }, { data: expenses }] = await Promise.all([
      supabase.from('payments').select('amount,paid_at').gte('paid_at', from).lte('paid_at', to + 'T23:59:59'),
      supabase.from('expenses').select('amount,category,incurred_on').gte('incurred_on', from).lte('incurred_on', to),
    ]);
    statement = buildCashIncomeStatement(
      (payments ?? []) as { amount: number; paid_at: string }[],
      (expenses ?? []) as { amount: number; category: string; incurred_on: string }[],
      from, to,
    );
  }

  return <IncomeStatementView statement={statement} from={from} to={to} basis={basis} />;
}
