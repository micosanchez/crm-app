import { createClient } from '@/lib/supabase/server';
import JobsDashboard from './JobsDashboard';
import KanbanBoard from './KanbanBoard';
import type { Job, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const supabase = createClient();
  const [{ data: jobs }, { data: customers }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').order('updated_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
    // Actual billed amounts per job (drafts excluded - a draft isn't a real bill).
    supabase.from('invoices').select('job_id,total').in('status', ['sent', 'paid']),
  ]);

  // A job's real revenue is what it was invoiced, not the original estimate. Sum the
  // job's sent/paid invoices; jobs never invoiced keep null and fall back to the estimate.
  const billed = new Map<string, number>();
  for (const inv of (invoices ?? []) as { job_id: string | null; total: number | string }[]) {
    if (!inv.job_id) continue;
    billed.set(inv.job_id, (billed.get(inv.job_id) ?? 0) + Number(inv.total));
  }
  const allJobs = ((jobs ?? []) as Job[]).map((j) => ({
    ...j,
    billed_value: billed.has(j.id) ? billed.get(j.id)! : null,
  }));

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
