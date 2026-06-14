import { createClient } from '@/lib/supabase/server';
import EstimatesDashboard from './EstimatesDashboard';
import type { Estimate, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EstimatesPage() {
  const supabase = createClient();
  const [{ data: estimates }, { data: customers }] = await Promise.all([
    supabase.from('estimates').select('*, customers(id,name)').order('created_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  return (
    <EstimatesDashboard
      estimates={(estimates ?? []) as Estimate[]}
      customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]}
    />
  );
}
