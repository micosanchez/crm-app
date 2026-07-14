import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { AccountBalance } from '@/lib/accounting/types';
import ChartOfAccounts from './ChartOfAccounts';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase.from('account_balances').select('*');
  const accounts = ((data ?? []) as AccountBalance[]).sort(
    (a, b) => a.sort_order - b.sort_order || a.number.localeCompare(b.number),
  );
  return <ChartOfAccounts accounts={accounts} />;
}
