import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import DeleteRecordButton from '@/components/DeleteRecordButton';
import type { Customer, Job, ActivityEntry, Note, Invoice, Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data: jobs }, { data: invoices }, { data: estimates }, { data: notes }, { data: activity }] =
    await Promise.all([
      supabase.from('customers').select('*').eq('id', params.id).single(),
      supabase.from('jobs').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id,invoice_number,status,total,amount_paid,paid_at,created_at,due_at,voided_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('estimates').select('id,estimate_number,status,total,created_at').eq('customer_id', params.id).order('created_at', { ascending: false }),
      supabase.from('notes').select('*').eq('entity_type', 'customer').eq('entity_id', params.id).order('created_at', { ascending: false }),
      supabase.from('activity_log').select('*').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(50),
    ]);

  if (!customer) return <p>Customer not found.</p>;
  const c = customer as Customer;
  const jobList = (jobs as Job[] | null) ?? [];
  const invList = (invoices as Invoice[] | null) ?? [];
  const estList = (estimates as Estimate[] | null) ?? [];

  // ----- Customer 360 rollups -----
  const paidInvoices = invList.filter((i) => i.status === 'paid' && !i.voided_at);
  const lifetimeRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
  const balanceOwed = invList
    .filter((i) => i.status === 'sent')
    .reduce((s, i) => s + (i.voided_at ? 0 : Number(i.total) - Number(i.amount_paid ?? 0)), 0);
  const paidJobsCount = jobList.filter((j) => j.status === 'paid').length;
  const avgTicket = paidInvoices.length ? lifetimeRevenue / paidInvoices.length : 0;
  // Most recent lead source recorded on any of this customer's jobs.
  const leadSource = jobList.map((j) => j.lead_source).find(Boolean) ?? null;
  const lastActivity = [
    ...jobList.map((j) => j.created_at),
    ...invList.map((i) => i.paid_at ?? i.created_at),
  ].filter(Boolean).sort().pop();

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: 'Lifetime revenue', value: money(lifetimeRevenue), tone: 'var(--brand-text)' },
    { label: 'Balance owed', value: money(balanceOwed), tone: balanceOwed > 0 ? 'var(--status-danger)' : undefined },
    { label: 'Jobs', value: String(jobList.length) },
    { label: 'Avg ticket', value: money(avgTicket) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-gray-500">
          {c.phone ? <a href={`tel:${c.phone}`} className="text-brand-600 hover:underline">{c.phone}</a> : '—'}
          {' · '}
          {c.email ? <a href={`mailto:${c.email}`} className="text-brand-600 hover:underline">{c.email}</a> : '—'}
          {(c.address || c.city) && <> · {c.address ?? ''} {c.city ?? ''}</>}
          {leadSource && <> · source: {String(leadSource).replace(/_/g, ' ')}</>}
        </p>
        <div className="mt-1 flex gap-1">
          {c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BookAgainButton customer={c} />
          <CustomerEditForm customer={c} />
          <DeleteRecordButton table="customers" id={c.id} redirectTo="/customers" label="customer"
            confirmMessage={`Delete ${c.name} for good? This can’t be undone.`}
            linkedHint="Delete their jobs, quotes, and invoices first." />
        </div>
      </div>

      {/* Customer 360 rollup */}
      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: 'var(--border-subtle)' }}>
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-1 bg-surface px-4 py-3.5">
              <p className="panel-label">{s.label}</p>
              <p className="metric text-[22px] font-bold leading-none" style={{ color: s.tone ?? 'var(--text-primary)' }}>{s.value}</p>
            </div>
          ))}
        </div>
        {(lastActivity || paidJobsCount > 0) && (
          <p className="border-t px-4 py-2 text-xs text-gray-500" style={{ borderColor: 'var(--border-subtle)' }}>
            {paidJobsCount} paid job{paidJobsCount === 1 ? '' : 's'}
            {lastActivity && <> · last activity {new Date(lastActivity).toLocaleDateString()}</>}
          </p>
        )}
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Job history ({jobList.length})</h2>
        <div className="space-y-2">
          {jobList.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleDateString()} · {j.service.replace('_', ' ')}</p>
              </div>
              <StatusBadge status={j.status} />
            </Link>
          ))}
          {!jobList.length && <p className="text-sm text-gray-500">No jobs yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Estimates ({estList.length})</h2>
        <div className="space-y-2">
          {estList.map((e) => (
            <Link key={e.id} href={`/estimates/${e.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Estimate #{e.estimate_number}</p>
                <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><span className="badge bg-gray-100 capitalize text-gray-700">{e.status}</span> {money(Number(e.total))}</span>
            </Link>
          ))}
          {!estList.length && <p className="text-sm text-gray-500">No estimates yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Invoices ({invList.length})</h2>
        <div className="space-y-2">
          {invList.map((i) => (
            <Link key={i.id} href={`/invoices/${i.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">Invoice #{i.invoice_number}</p>
                <p className="text-xs text-gray-500">{new Date(i.created_at).toLocaleDateString()}</p>
              </div>
              <span className="flex items-center gap-2 text-sm"><StatusBadge status={i.status} /> {money(Number(i.total))}</span>
            </Link>
          ))}
          {!invList.length && <p className="text-sm text-gray-500">No invoices yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Notes</h2>
        <NoteForm entityType="customer" entityId={c.id} />
        <div className="mt-2 space-y-2">
          {(notes as Note[] | null)?.map((n) => (
            <div key={n.id} className="card py-2 text-sm">
              <p>{n.body}</p>
              <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Full timeline <span className="text-xs font-normal text-gray-400">(activity log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {(activity as ActivityEntry[] | null)?.map((a) => (
            <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{a.entity_type} {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No recorded activity.</p>}
        </div>
      </section>
    </div>
  );
}
