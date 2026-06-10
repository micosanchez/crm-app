import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import type { Job, ActivityEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const supabase = createClient();

  const [{ count: customerCount }, { count: openJobs }, { data: unpaid }, { data: todayJobs }, { data: activity }] =
    await Promise.all([
      supabase.from('customers').select('*', { count: 'exact', head: true }),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).in('status', ['lead', 'scheduled', 'in_progress']),
      supabase.from('invoices').select('total').in('status', ['draft', 'sent']),
      supabase.from('jobs').select('*, customers(id,name,phone,address)')
        .gte('scheduled_start', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .lte('scheduled_start', new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
        .order('scheduled_start'),
      supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(12),
    ]);

  const outstanding = (unpaid ?? []).reduce((s, i) => s + Number(i.total), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Customers" value={String(customerCount ?? 0)} href="/customers" />
        <Stat label="Open jobs" value={String(openJobs ?? 0)} href="/jobs" />
        <Stat label="Jobs today" value={String(todayJobs?.length ?? 0)} href="/schedule" />
        <Stat label="Outstanding" value={`$${outstanding.toFixed(0)}`} href="/invoices" />
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Today&apos;s jobs</h2>
        {(todayJobs as Job[] | null)?.length ? (
          <div className="space-y-2">
            {(todayJobs as Job[]).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
                <div>
                  <p className="font-medium">{j.title}</p>
                  <p className="text-sm text-gray-500">{j.customers?.name} · {j.address ?? 'no address'}</p>
                </div>
                <StatusBadge status={j.status} />
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">Nothing scheduled today.</p>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Recent activity <span className="text-xs font-normal text-gray-400">(memory log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {(activity as ActivityEntry[] | null)?.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span><b className="capitalize">{a.entity_type}</b> {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No activity yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="card hover:border-brand-500">
      <p className="text-2xl font-bold text-brand-700">{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </Link>
  );
}
