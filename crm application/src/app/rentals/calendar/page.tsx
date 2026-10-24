import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import { prettyDate } from '@/lib/rentals/format';

export const dynamic = 'force-dynamic';

/** Week / day view of every delivery and pickup, merged with junk-removal jobs so conflicts are obvious. */
export default async function RentalCalendar({ searchParams }: { searchParams: { week?: string; day?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const todayD = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const anchor = searchParams.day ?? searchParams.week ?? todayD.toISOString().slice(0, 10);
  const dayMode = !!searchParams.day;
  const start = new Date(`${anchor}T12:00:00Z`);
  if (!dayMode) start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = Array.from({ length: dayMode ? 1 : 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const from = days[0], to = days[days.length - 1];
  const [{ data: rentals }, { data: jobs }] = await Promise.all([
    supabase.from('rentals').select('id, rental_number, status, delivery_address, pickup_address, delivery_date, delivery_window, pickup_date, pickup_window, tote_count, customers(name, phone)').in('status', ['booked', 'delivered', 'out', 'pickup_scheduled']).or(`delivery_date.gte.${from},pickup_date.gte.${from}`).or(`delivery_date.lte.${to},pickup_date.lte.${to}`),
    supabase.from('jobs').select('id, title, address, scheduled_start, status, customers(name)').gte('scheduled_start', `${from}T00:00:00`).lte('scheduled_start', `${to}T23:59:59`).not('status', 'in', '("cancelled","paid","invoiced")'),
  ]);
  type R = { id: string; rental_number: string; status: string; delivery_address: string; pickup_address: string | null; delivery_date: string; delivery_window: string; pickup_date: string; pickup_window: string | null; tote_count: number; customers: { name: string; phone: string | null } | null };
  type J = { id: string; title: string; address: string | null; scheduled_start: string; status: string; customers: { name: string } | null };
  const rs = (rentals ?? []) as unknown as R[]; const js = (jobs ?? []) as unknown as J[];
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const shift = (n: number) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + n * (dayMode ? 1 : 7)); return `/rentals/calendar?${dayMode ? 'day' : 'week'}=${d.toISOString().slice(0, 10)}`; };
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Calendar</h1></div>
      <RentalsNav active="/rentals/calendar" />
      <div className="flex flex-wrap items-center gap-2 text-sm"><Link className="btn-ghost" href={shift(-1)}>‹ Prev</Link><Link className="btn-ghost" href={shift(1)}>Next ›</Link><Link className="btn-ghost" href={dayMode ? `/rentals/calendar?week=${anchor}` : `/rentals/calendar?day=${todayD.toISOString().slice(0, 10)}`}>{dayMode ? 'Week view' : 'Day view'}</Link><span className="text-gray-500">{prettyDate(from)}{dayMode ? '' : ` – ${prettyDate(to)}`} · <span className="badge bg-emerald-100 text-emerald-800">delivery</span> <span className="badge bg-sky-100 text-sky-800">pickup</span> <span className="badge bg-gray-100">junk job</span></span></div>
      <div className={`grid gap-2 ${dayMode ? '' : 'md:grid-cols-7'}`}>
        {days.map((d) => {
          const del = rs.filter((r) => r.delivery_date === d); const pick = rs.filter((r) => r.pickup_date === d);
          const dayJobs = js.filter((j) => new Date(j.scheduled_start).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === d);
          const stops = [...del.map((r) => ({ kind: 'delivery', r, win: r.delivery_window, addr: r.delivery_address })), ...pick.map((r) => ({ kind: 'pickup', r, win: r.pickup_window ?? '', addr: r.pickup_address ?? r.delivery_address }))];
          return (
            <section key={d} className={`card space-y-1 p-2 ${d === todayD.toISOString().slice(0, 10) ? 'ring-2 ring-brand-500' : ''}`}>
              <p className="panel-label"><Link href={`/rentals/calendar?day=${d}`}>{prettyDate(d)}</Link></p>
              {stops.sort((a, b) => a.win.localeCompare(b.win)).map((s, i) => { const same = dayJobs.find((j) => norm(j.address) && norm(s.addr).includes(norm(j.address).slice(0, 12))); return (
                <Link key={i} href={`/rentals/${s.r.id}`} className={`block rounded px-2 py-1 text-xs ${s.kind === 'delivery' ? 'bg-emerald-100 text-emerald-900' : 'bg-sky-100 text-sky-900'}`}><b>{s.win}</b> {s.kind} · {s.r.customers?.name} · {s.r.tote_count} totes<br /><span className="opacity-70">{s.addr}</span>{same && <span className="badge mt-1 bg-amber-100 text-amber-800">same address as junk job: one trip</span>}</Link>); })}
              {dayJobs.map((j) => <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded bg-gray-100 px-2 py-1 text-xs"><b>{new Date(j.scheduled_start).toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' })}</b> job · {j.customers?.name} · {j.title}<br /><span className="opacity-70">{j.address}</span></Link>)}
              {!stops.length && !dayJobs.length && <p className="text-xs text-gray-400">—</p>}
            </section>);
        })}
      </div>
      <p className="text-xs text-gray-500">To move a stop, open the rental and use Reschedule; availability is re-checked and the customer gets the new window by text.</p>
    </div>
  );
}
