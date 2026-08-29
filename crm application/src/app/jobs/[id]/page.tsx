import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import PhotoSection from '@/components/PhotoSection';
import JobActions from './JobActions';
import JobEditForm from './JobEditForm';
import CrewAssign from './CrewAssign';
import { getRole } from '@/lib/auth';
import type { Job, Note, UserProfile, Invoice, Expense } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function JobDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const role = await getRole();
  const isStaff = role === 'admin' || role === 'dispatcher';

  // Technicians: redacted, assigned-only view via the RPC (no money anywhere).
  if (!isStaff) {
    const [{ data: tj }, { data: notes }] = await Promise.all([
      supabase.rpc('tech_job', { p_id: params.id }),
      supabase.from('notes').select('*').eq('entity_type', 'job').eq('entity_id', params.id).order('created_at', { ascending: false }),
    ]);
    const t = ((tj ?? []) as {
      id: string; title: string; description: string | null; status: Job['status'];
      service: Job['service']; scheduled_start: string | null; scheduled_end: string | null;
      address: string | null; photos: Job['photos']; customer_id: string | null;
      customer_name: string | null; customer_phone: string | null;
    }[])[0];
    if (!t) return <p>Job not found (or not assigned to you).</p>;
    const tJob = {
      id: t.id, customer_id: t.customer_id ?? '', title: t.title, description: t.description,
      service: t.service, status: t.status, scheduled_start: t.scheduled_start,
      scheduled_end: t.scheduled_end, address: t.address, estimated_value: null,
      photos: t.photos ?? [], created_at: '', updated_at: '',
      customers: t.customer_id ? { id: t.customer_id, name: t.customer_name ?? '', phone: t.customer_phone, address: t.address } : undefined,
    } as Job;
    return (
      <div className="space-y-6">
        <div>
          <Link href="/jobs" className="text-sm text-brand-600 hover:underline">← My jobs</Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{t.title}</h1>
            <StatusBadge status={t.status} />
          </div>
          <p className="text-sm text-gray-500">
            {t.customer_name}{' · '}{t.service.replace('_', ' ')} · {t.address ?? 'no address'}
            {t.scheduled_start && <> · {new Date(t.scheduled_start).toLocaleString()}</>}
          </p>
          {t.description && <p className="mt-2 text-sm">{t.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {t.address && (
            <a className="btn-ghost" href={`https://maps.apple.com/?q=${encodeURIComponent(t.address)}`} target="_blank" rel="noreferrer">Directions</a>
          )}
          {t.customer_phone && <a className="btn-ghost" href={`tel:${t.customer_phone}`}>Call {t.customer_name}</a>}
          <JobActions job={tJob} hasInvoice={false} isStaff={false} />
        </div>
        <section>
          <h2 className="mb-2 font-semibold">Photos ({tJob.photos?.length ?? 0})</h2>
          <PhotoSection job={tJob} />
        </section>
        <section>
          <h2 className="mb-2 font-semibold">Notes</h2>
          <NoteForm entityType="job" entityId={t.id} />
          <div className="mt-2 space-y-2">
            {(notes as Note[] | null)?.map((n) => (
              <div key={n.id} className="card py-2 text-sm">
                <p>{n.body}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const [{ data: job }, { data: history }, { data: notes }, { data: invoice }, { data: team }, { data: assignments }, { data: expenses }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').eq('id', params.id).single(),
    supabase.from('job_status_history').select('*').eq('job_id', params.id).order('changed_at', { ascending: false }),
    supabase.from('notes').select('*').eq('entity_type', 'job').eq('entity_id', params.id).order('created_at', { ascending: false }),
    supabase.from('invoices').select('id,invoice_number,status,total,amount_paid').eq('job_id', params.id).is('voided_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('users').select('id,full_name,email').eq('is_active', true).order('full_name'),
    supabase.from('job_assignments').select('user_id').eq('job_id', params.id),
    supabase.from('expenses').select('id,category,amount,vendor,description,incurred_on,receipt_url').eq('job_id', params.id).order('incurred_on', { ascending: false }),
  ]);

  if (!job) return <p>Job not found.</p>;
  const j = job as Job;
  const inv = invoice as Pick<Invoice, 'id' | 'invoice_number' | 'status' | 'total' | 'amount_paid'> | null;
  const jobExpenses = (expenses as Pick<Expense, 'id' | 'category' | 'amount' | 'vendor' | 'description' | 'incurred_on' | 'receipt_url'>[] | null) ?? [];

  // ----- Job P&L -----
  const collected = inv?.status === 'paid' ? Number(inv.total) : Number(inv?.amount_paid ?? 0);
  const billed = inv ? Number(inv.total) : 0;
  const costs = jobExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const profit = collected - costs;
  const margin = collected > 0 ? Math.round((profit / collected) * 100) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-brand-600 hover:underline">← Jobs</Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{j.title}</h1>
          <StatusBadge status={j.status} />
        </div>
        <p className="text-sm text-gray-500">
          <Link href={`/customers/${j.customer_id}`} className="text-brand-600 hover:underline">{j.customers?.name}</Link>
          {' · '}{j.service.replace('_', ' ')} · {j.address ?? 'no address'}
          {j.scheduled_start && <> · {new Date(j.scheduled_start).toLocaleString()}</>}
          {j.lead_source && <> · source: {j.lead_source.replace(/_/g, ' ')}</>}
        </p>
        {j.description && <p className="mt-2 text-sm">{j.description}</p>}
        {j.estimated_value != null && <p className="mt-1 font-semibold text-brand-700">Est. ${Number(j.estimated_value).toFixed(2)}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <JobActions job={j} hasInvoice={!!inv} isStaff />
        <JobEditForm job={j} />
      </div>

      <CrewAssign job={j}
        team={(team ?? []) as Pick<UserProfile, 'id' | 'full_name' | 'email'>[]}
        assigned={(assignments ?? []).map((a) => a.user_id)} />

      {inv && (
        <Link href={`/invoices/${inv.id}`} className="card flex items-center justify-between hover:border-brand-500">
          <span className="font-medium">Invoice #{inv.invoice_number}</span>
          <span className="flex items-center gap-2">
            <StatusBadge status={inv.status} /> ${Number(inv.total).toFixed(2)}
          </span>
        </Link>
      )}

      {/* Job P&L — staff only (keeps cost data off technician screens) */}
      {isStaff && (
        <section>
          <h2 className="mb-2 font-semibold">Job P&amp;L</h2>
          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--border-subtle)' }}>
              <div className="flex flex-col gap-1 bg-surface px-4 py-3.5">
                <p className="panel-label">Collected</p>
                <p className="metric text-[22px] font-bold leading-none" style={{ color: 'var(--brand-text)' }}>{money(collected)}</p>
                {billed > collected && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{money(billed)} billed</p>}
              </div>
              <div className="flex flex-col gap-1 bg-surface px-4 py-3.5">
                <p className="panel-label">Job costs</p>
                <p className="metric text-[22px] font-bold leading-none" style={{ color: 'var(--status-danger)' }}>{money(costs)}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{jobExpenses.length} expense{jobExpenses.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex flex-col gap-1 bg-surface px-4 py-3.5">
                <p className="panel-label">Profit</p>
                <p className="metric text-[22px] font-bold leading-none" style={{ color: profit >= 0 ? 'var(--status-success)' : 'var(--status-danger)' }}>{money(profit)}</p>
                {margin != null && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{margin}% margin</p>}
              </div>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {jobExpenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{e.category.replace(/_/g, ' ')}{e.vendor && <span className="font-normal text-gray-500"> · {e.vendor}</span>}</p>
                    <p className="truncate text-xs text-gray-500">{e.incurred_on}{e.description && ` · ${e.description}`}</p>
                  </div>
                  <span className="shrink-0 font-semibold text-red-700">-{money2(Number(e.amount))}</span>
                </div>
              ))}
            </div>

            <Link href="/expenses" className="block border-t px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-gray-50" style={{ borderColor: 'var(--border-subtle)' }}>
              + Add an expense to this job
            </Link>
          </div>
          {!inv && <p className="mt-1 px-1 text-xs text-gray-500">No invoice yet — collected shows $0 until this job is invoiced and paid.</p>}
          {costs === 0 && (
            <p className="mt-1 px-1 text-xs" style={{ color: 'var(--status-warning)' }}>
              No costs linked to this job yet. If the dump fee, fuel, or crew pay for this job are logged as overhead, this profit is overstated — add them above so the margin is real.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Photos ({j.photos?.length ?? 0})</h2>
        <PhotoSection job={j} />
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Notes</h2>
        <NoteForm entityType="job" entityId={j.id} />
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
        <h2 className="mb-2 font-semibold">Status history <span className="text-xs font-normal text-gray-400">(immutable)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {history?.map((h) => (
            <div key={h.id} className="flex justify-between px-4 py-2 text-sm">
              <span>{h.from_status ? `${h.from_status} → ` : ''}<b>{h.to_status}</b></span>
              <span className="text-xs text-gray-400">{new Date(h.changed_at).toLocaleString()}</span>
            </div>
          ))}
          {!history?.length && <p className="px-4 py-3 text-sm text-gray-400">No status changes yet — the trail starts when this job moves through its stages.</p>}
        </div>
      </section>
    </div>
  );
}
