import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import OnMyWay from './OnMyWay';

export const dynamic = 'force-dynamic';

/** Today's deliveries and pickups sorted by window: navigate, call, text, on-my-way, open the stop. */
export default async function TodayRoute({ searchParams }: { searchParams: { day?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const today = searchParams.day ?? new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' })).toISOString().slice(0, 10);
  const { data } = await supabase.from('rentals').select('id, rental_number, status, delivery_address, pickup_address, delivery_date, delivery_window, pickup_date, pickup_window, tote_count, dolly_count, notes_customer, customers(name, phone)').in('status', ['booked', 'delivered', 'out', 'pickup_scheduled']).or(`delivery_date.eq.${today},pickup_date.eq.${today}`);
  type R = { id: string; rental_number: string; status: string; delivery_address: string; pickup_address: string | null; delivery_date: string; delivery_window: string; pickup_date: string; pickup_window: string | null; tote_count: number; dolly_count: number; notes_customer: string | null; customers: { name: string; phone: string | null } | null };
  const rs = (data ?? []) as unknown as R[];
  const stops = [...rs.filter((r) => r.delivery_date === today && r.status === 'booked').map((r) => ({ kind: 'Deliver', r, win: r.delivery_window, addr: r.delivery_address })), ...rs.filter((r) => r.pickup_date === today && r.status !== 'booked').map((r) => ({ kind: 'Pick up', r, win: r.pickup_window ?? '', addr: r.pickup_address ?? r.delivery_address }))].sort((a, b) => a.win.localeCompare(b.win));
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Today&apos;s route · {today}</h1></div>
      <RentalsNav active="/rentals/today" />
      {!stops.length && <p className="text-gray-500">No tote stops today.</p>}
      {stops.map((s, i) => (
        <div key={i} className="card space-y-2">
          <div className="flex justify-between"><p className="text-lg font-bold">{s.win} · {s.kind}</p><span className="badge">{s.r.rental_number}</span></div>
          <p>{s.r.customers?.name} · {s.r.tote_count} totes{s.r.dolly_count ? ` + ${s.r.dolly_count} dolly` : ''}</p>
          {s.r.notes_customer && <p className="text-sm text-gray-600">{s.r.notes_customer}</p>}
          <a className="btn-ghost btn-big" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.addr)}`} target="_blank" rel="noreferrer">Navigate — {s.addr}</a>
          <div className="grid grid-cols-3 gap-2">{s.r.customers?.phone && <a className="btn-ghost" href={`tel:${s.r.customers.phone}`}>Call</a>}{s.r.customers?.phone && <a className="btn-ghost" href={`sms:${s.r.customers.phone}`}>Text</a>}<OnMyWay rentalId={s.r.id} /></div>
          <Link className="btn-primary btn-big" href={`/rentals/${s.r.id}`}>{s.kind === 'Deliver' ? 'Check out totes' : 'Check in totes'}</Link>
        </div>
      ))}
    </div>
  );
}
