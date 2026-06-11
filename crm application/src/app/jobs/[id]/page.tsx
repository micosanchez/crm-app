import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import PhotoSection from '@/components/PhotoSection';
import JobActions from './JobActions';
import JobEditForm from './JobEditForm';
import CrewAssign from './CrewAssign';
import type { Job, Note, UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function JobDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: job }, { data: history }, { data: notes }, { data: invoice }, { data: team }, { data: assignments }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)').eq('id', params.id).single(),
    supabase.from('job_status_history').select('*').eq('job_id', params.id).order('changed_at', { ascending: false }),
    supabase.from('notes').select('*').eq('entity_type', 'job').eq('entity_id', params.id).order('created_at', { ascending: false }),
    supabase.from('invoices').select('id,invoice_number,status,total').eq('job_id', params.id).maybeSingle(),
    supabase.from('users').select('id,full_name').eq('is_active', true).order('full_name'),
    supabase.from('job_assignments').select('user_id').eq('job_id', params.id),
  ]);

  if (!job) return <p>Job not found.</p>;
  const j = job as Job;

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
        </p>
        {j.description && <p className="mt-2 text-sm">{j.description}</p>}
        {j.estimated_value != null && <p className="mt-1 font-semibold text-brand-700">Est. ${Number(j.estimated_value).toFixed(2)}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <JobActions job={j} hasInvoice={!!invoice} />
        <JobEditForm job={j} />
      </div>

      <CrewAssign jobId={j.id}
        team={(team ?? []) as Pick<UserProfile, 'id' | 'full_name'>[]}
        assigned={(assignments ?? []).map((a) => a.user_id)} />

      {invoice && (
        <Link href={`/invoices/${invoice.id}`} className="card flex items-center justify-between hover:border-brand-500">
          <span className="font-medium">Invoice #{invoice.invoice_number}</span>
          <span className="flex items-center gap-2">
            <StatusBadge status={invoice.status} /> ${Number(invoice.total).toFixed(2)}
          </span>
        </Link>
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
        </div>
      </section>
    </div>
  );
}
