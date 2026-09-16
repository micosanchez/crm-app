import { createClient } from '@/lib/supabase/server';
import EstimatesDashboard from './EstimatesDashboard';
import RequestsTabs from './RequestsTabs';
import { requireStaff } from '@/lib/auth';
import { flags } from '@/lib/flags';
import type { Estimate, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EstimatesPage() {
  await requireStaff();
  const supabase = createClient();
  const [{ data: estimates }, { data: customers }] = await Promise.all([
    supabase.from('estimates').select('*, customers(id,name)').order('created_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  let newCount = 0;
  if (flags.requests) {
    const { count } = await supabase
      .from('estimate_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');
    newCount = count ?? 0;
  }

  return (
    <div className="space-y-5">
      {flags.requests && <RequestsTabs active="estimates" newCount={newCount} />}
      <EstimatesDashboard
        estimates={(estimates ?? []) as Estimate[]}
        customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]}
      />
    </div>
  );
}
