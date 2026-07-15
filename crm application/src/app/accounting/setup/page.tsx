import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { Account, AccountingSettings, DepreciationSchedule } from '@/lib/accounting/types';
import SetupClient from './SetupClient';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  await requireStaff();
  const supabase = createClient();

  const [{ data: settings }, { data: accounts }, { data: schedules }] = await Promise.all([
    supabase.from('accounting_settings').select('*').eq('id', true).maybeSingle(),
    supabase.from('accounts').select('id,number,name,type,normal_side,system_key').eq('is_active', true).order('number'),
    supabase.from('depreciation_schedules').select('*').order('created_at', { ascending: false }),
  ]);

  return (
    <SetupClient
      settings={(settings ?? null) as AccountingSettings | null}
      accounts={(accounts ?? []) as Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side' | 'system_key'>[]}
      schedules={(schedules ?? []) as DepreciationSchedule[]}
    />
  );
}
