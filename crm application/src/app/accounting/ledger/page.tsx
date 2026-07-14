import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { Account, JournalEntry } from '@/lib/accounting/types';
import GeneralLedger from './GeneralLedger';

export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  await requireStaff();
  const supabase = createClient();

  const [{ data: entries }, { data: accounts }] = await Promise.all([
    supabase
      .from('journal_entries')
      .select('*, journal_lines(*, accounts(id,number,name,type))')
      .order('entry_date', { ascending: false })
      .order('entry_no', { ascending: false })
      .limit(150),
    supabase.from('accounts').select('id,number,name,type,normal_side,is_active').eq('is_active', true).order('number'),
  ]);

  return (
    <GeneralLedger
      entries={(entries ?? []) as unknown as JournalEntry[]}
      accounts={(accounts ?? []) as Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side'>[]}
    />
  );
}
