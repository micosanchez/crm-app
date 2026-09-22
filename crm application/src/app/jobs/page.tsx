import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import JobsDashboard from './JobsDashboard';
import KanbanBoard from './KanbanBoard';
import StatusBadge from '@/components/StatusBadge';
import { getRole } from '@/lib/auth';
import { fmtDateTime } from '@/lib/dates';
import type { Job, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const supabase = createClient();
  const role = await getRole();

  // Technicians: just their assigned jobs — no dollar figures anywhere.
  if (role === 'technician') {
    const { data: mine } = await supabase.rpc('tech_my_jobs', {});
    const jobs = (mine ?? []) as { id: string; title: string; status: Job['status']; scheduled_start: string | null; address: string | null; customer_name: string | null }[];
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My jobs</h1>
        {jobs.length === 0 && <p className="text-gray-500">No jobs assigned to you yet.</p>}
        <div className="space-y-3">
          {jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card block space-y-1 hover:border-brand-500">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{j.title}</p>
                <StatusBadge status={j.status} />
              </div>
              <p className="text-sm text-gray-500">
                {j.customer_name}
                {j.scheduled_start && <> · {fmtDateTime(j.scheduled_start)}</>}
              </p>
              {j.address && <p className="text-sm text-gray-500">{j.address}</p>}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const [{ data: jobs }, { data: customers }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').order('updated_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
    // Live invoices per job. Billed value counts sent/paid only (a draft isn't a real bill);
    // the id map lets the board route "invoiced"/"paid" moves through the invoice.
    supabase.from('invoices').select('id,job_id,total,status').is('voided_at', null),
  ]);

  // A job's real revenue is what it was invoiced, not the original estimate. Sum the
  // job's sent/paid invoices; jobs never invoiced keep null and fall back to the estimate.
  const billed = new Map<string, number>();
  const invoiceByJob: Record<string, string> = {};
  for (const inv of (invoices ?? []) as { id: string; job_id: string | null; total: number | string; status: string }[]) {
    if (!inv.job_id) continue;
    invoiceByJob[inv.job_id] = inv.id;
    if (inv.status === 'sent' || inv.status === 'paid') billed.set(inv.job_id, (billed.get(inv.job_id) ?? 0) + Number(inv.total));
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
        <KanbanBoard jobs={allJobs} invoiceByJob={invoiceByJob} />
      </section>
    </div>
  );
}
