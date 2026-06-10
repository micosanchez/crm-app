import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import NewEstimateForm from './NewEstimateForm';
import type { Estimate, Customer } from '@/lib/types';

export const dynamic = 'force-dynamic';

const COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-brand-100 text-brand-700', declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

export default async function EstimatesPage() {
  const supabase = createClient();
  const [{ data: estimates }, { data: customers }] = await Promise.all([
    supabase.from('estimates').select('*, customers(id,name)').order('created_at', { ascending: false }),
    supabase.from('customers').select('id,name').order('name'),
  ]);

  const all = (estimates ?? []) as Estimate[];
  const sent = all.filter((e) => e.status !== 'draft').length;
  const accepted = all.filter((e) => e.status === 'accepted').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Estimates</h1>
        {sent > 0 && <span className="badge bg-brand-50 text-brand-700">Acceptance: {Math.round((accepted / sent) * 100)}% ({accepted}/{sent})</span>}
      </div>
      <NewEstimateForm customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]} />
      <div className="card divide-y divide-gray-100 p-0">
        {all.map((e) => (
          <Link key={e.id} href={`/estimates/${e.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
            <div>
              <p className="font-medium">#{e.estimate_number} · {e.customers?.name ?? 'No customer'}</p>
              <p className="text-xs text-gray-500">{new Date(e.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`badge ${COLORS[e.status]}`}>{e.status}</span>
              <span className="font-semibold">${Number(e.total).toFixed(2)}</span>
            </div>
          </Link>
        ))}
        {!all.length && <p className="p-4 text-sm text-gray-500">No estimates yet.</p>}
      </div>
    </div>
  );
}
