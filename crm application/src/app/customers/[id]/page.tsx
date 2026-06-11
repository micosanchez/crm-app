import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import NoteForm from '@/components/NoteForm';
import CustomerEditForm from './CustomerEditForm';
import BookAgainButton from './BookAgainButton';
import type { Customer, Job, ActivityEntry, Note } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: customer }, { data: jobs }, { data: notes }, { data: activity }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', params.id).single(),
    supabase.from('jobs').select('*').eq('customer_id', params.id).order('created_at', { ascending: false }),
    supabase.from('notes').select('*').eq('entity_type', 'customer').eq('entity_id', params.id).order('created_at', { ascending: false }),
    supabase.from('activity_log').select('*').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(50),
  ]);

  if (!customer) return <p>Customer not found.</p>;
  const c = customer as Customer;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-brand-600 hover:underline">← Customers</Link>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-gray-500">{c.phone ?? '—'} · {c.email ?? '—'} · {c.address ?? ''} {c.city ?? ''}</p>
        <div className="mt-1 flex gap-1">
          {c.tags.map((t) => <span key={t} className="badge bg-brand-50 text-brand-700">{t.replace('_', ' ')}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BookAgainButton customer={c} />
          <CustomerEditForm customer={c} />
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Job history ({jobs?.length ?? 0})</h2>
        <div className="space-y-2">
          {(jobs as Job[] | null)?.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
              <div>
                <p className="font-medium">{j.title}</p>
                <p className="text-xs text-gray-500">{new Date(j.created_at).toLocaleDateString()} · {j.service.replace('_', ' ')}</p>
              </div>
              <StatusBadge status={j.status} />
            </Link>
          ))}
          {!jobs?.length && <p className="text-sm text-gray-500">No jobs yet.</p>}
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
