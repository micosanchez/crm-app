import { createClient } from '@/lib/supabase/server';
import JobsDashboard from './JobsDashboard';
import KanbanBoard from './KanbanBoard';
import type { Job, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const supabase = createClient();
  const [{ data: jobs }, { data: customers }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').order('updated_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  const allJobs = (jobs ?? []) as Job[];

  return (
    <div className="space-y-8">
      <JobsDashboard jobs={allJobs} customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]} />
      <section className="space-y-3">
        <h2 className="panel-label">Pipeline board</h2>
        <KanbanBoard jobs={allJobs} />
      </section>
    </div>
  );
}
