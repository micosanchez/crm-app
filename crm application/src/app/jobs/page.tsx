import { createClient } from '@/lib/supabase/server';
import KanbanBoard from './KanbanBoard';
import NewJobForm from './NewJobForm';
import type { Job, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const supabase = createClient();
  const [{ data: jobs }, { data: customers }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').order('updated_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Job pipeline</h1>
      <NewJobForm customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]} />
      <KanbanBoard jobs={(jobs ?? []) as Job[]} />
    </div>
  );
}
