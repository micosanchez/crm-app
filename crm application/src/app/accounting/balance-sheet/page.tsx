import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { buildBalanceSheet } from '@/lib/accounting/financials';
import type { LedgerBalanceRow } from '@/lib/accounting/types';
import BalanceSheetView from './BalanceSheetView';

export const dynamic = 'force-dynamic';

export default async function BalanceSheetPage({ searchParams }: { searchParams: { asOf?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const asOf = searchParams.asOf || new Date().toISOString().slice(0, 10);

  const { data } = await supabase.rpc('ledger_balances', { p_from: null, p_to: asOf });
  const sheet = buildBalanceSheet((data ?? []) as LedgerBalanceRow[], asOf);

  return <BalanceSheetView sheet={sheet} asOf={asOf} />;
}
