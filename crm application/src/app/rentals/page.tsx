import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Cluster, Cell } from '@/components/Hud';
import { money, prettyDate } from '@/lib/rentals/format';
import RentalsNav from './RentalsNav';

export const dynamic = 'force-dynamic';

const COLS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'booked', label: 'Booked', statuses: ['booked'] },
  { key: 'out', label: 'Delivered / out', statuses: ['delivered', 'out'] },
  { key: 'pickup', label: 'Pickup scheduled', statuses: ['pickup_scheduled'] },
  { key: 'returned', label: 'Returned', statuses: ['returned'] },
  { key: 'inspected', label: 'Inspected', statuses: ['inspected'] },
  { key: 'closed', label: 'Closed (30 days)', statuses: ['closed'] },
];

type Row = { id: string; rental_number: string; status: string; delivery_address: string; pickup_address: string | null; delivery_date: string; delivery_window: string; pickup_date: string; pickup_window: string | null; tote_count: number; dolly_count: number; balance_due: number; card_exp: string | null; disputed_at: string | null; junk_request_id: string | null; customers: { name: string; phone: string | null } | null; rental_charges: { status: string }[] };

export default async function RentalsBoard() {
  await requireStaff();
  const supabase = createClient();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: rows }, { count: pendingCount }, { data: requests }] = await Promise.all([
    supabase.from('rentals').select('id,rental_number,status,delivery_address,pickup_address,delivery_date,delivery_window,pickup_date,pickup_window,tote_count,dolly_count,balance_due,card_exp,disputed_at,junk_request_id,customers(name,phone),rental_charges(status)').in('status', ['booked', 'delivered', 'out', 'pickup_scheduled', 'returned', 'inspected', 'closed']).gte('updated_at', since).order('delivery_date'),
    supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('status', 'pending_payment'),
    supabase.from('rentals').select('id, rental_number, move_date, zone, total, created_at, customers(name, phone), rental_packages(name)').eq('status', 'awaiting_confirmation').order('created_at'),
  ]);
  const all = (rows ?? []) as unknown as Row[];
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' })).toISOString().slice(0, 10);
  const overdue = all.filter((r) => ['delivered', 'out', 'pickup_scheduled'].includes(r.status) && r.pickup_date < today);
  const flag = (r: Row) => {
    const f: string[] = [];
    if (['delivered', 'out', 'pickup_scheduled'].includes(r.status) && r.pickup_date < today) f.push('OVERDUE');
    if (r.rental_charges?.some((c) => c.status === 'failed' || c.status === 'requires_action')) f.push('PAYMENT FAILED');
    if (r.card_exp) { const [m, y] = r.card_exp.split('/'); if (new Date(Date.UTC(2000 + Number(y), Number(m), 0)) < new Date(`${r.pickup_date}T00:00:00Z`)) f.push('CARD EXPIRING'); }
    if (r.disputed_at) f.push('DISPUTE');
    return f;
  };
  const Card = ({ r }: { r: Row }) => {
    const flags = flag(r);
    const next = ['booked'].includes(r.status) ? `Deliver ${prettyDate(r.delivery_date)} ${r.delivery_window}` : ['delivered', 'out', 'pickup_scheduled'].includes(r.status) ? `Pick up ${prettyDate(r.pickup_date)} ${r.pickup_window ?? ''}` : `Picked up ${prettyDate(r.pickup_date)}`;
    return (
      <Link href={`/rentals/${r.id}`} className="card block space-y-1 p-3 hover:ring-2 hover:ring-brand-500">
        <div className="flex items-start justify-between gap-2"><p className="font-semibold">{r.rental_number} · {r.customers?.name}</p>{flags.length > 0 && <span className="badge bg-red-100 text-red-700">{flags.join(' · ')}</span>}</div>
        <p className="text-xs text-gray-500">{r.delivery_address}{r.pickup_address && r.pickup_address !== r.delivery_address ? ` → ${r.pickup_address}` : ''}</p>
        <p className="text-sm">{r.tote_count} totes{r.dolly_count ? ` + ${r.dolly_count} dolly` : ''} · {next}</p>
        {Number(r.balance_due) > 0 && <p className="text-sm font-medium text-amber-700">Balance {money(r.balance_due)}</p>}
        {r.junk_request_id && <span className="badge bg-emerald-50 text-emerald-700">Junk quote requested</span>}
      </Link>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="panel-label">Rentals</p><h1 className="text-2xl">Tote rentals</h1></div><a className="btn-primary" href="/rent" target="_blank" rel="noreferrer">+ Book for a customer</a></div>
      <RentalsNav active="/rentals" />
      {(requests ?? []).length > 0 && <section className="card space-y-2" style={{ border: '2px solid #f59e0b' }}>
        <p className="panel-label">Awaiting date confirmation ({requests!.length}) · text delivery windows, then set the date</p>
        <table className="w-full text-sm"><tbody>{(requests ?? []).map((q) => { const x = q as unknown as { id: string; rental_number: string; move_date: string | null; zone: string | null; total: number; customers: { name: string; phone: string | null } | null; rental_packages: { name: string } | null }; return (
          <tr key={x.id} className="border-t"><td className="p-1"><Link className="underline" href={`/rentals/${x.id}`}>{x.rental_number}</Link></td><td className="p-1">{x.customers?.name}</td><td className="p-1">{x.customers?.phone && <a className="underline" href={`sms:${x.customers.phone}`}>{x.customers.phone}</a>}</td><td className="p-1">moving {prettyDate(x.move_date) || '?'}</td><td className="p-1">{x.rental_packages?.name}</td><td className="p-1">{x.zone}</td><td className="p-1 text-right">{money(x.total)} at pickup</td></tr>); })}</tbody></table>
      </section>}
      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Out right now" value={String(all.filter((r) => ['delivered', 'out', 'pickup_scheduled'].includes(r.status)).length)} />
        <Cell label="Overdue" value={String(overdue.length)} tone={overdue.length ? 'var(--status-danger)' : undefined} />
        <Cell label="Balances due" value={money(all.reduce((s, r) => s + Number(r.balance_due), 0))} />
        <Cell label="Pending payment" value={String(pendingCount ?? 0)} sub="holds expire in 30 min" />
      </Cluster>
      {overdue.length > 0 && <section><p className="panel-label text-red-700">Overdue</p><div className="grid gap-2 md:grid-cols-3">{overdue.map((r) => <Card key={r.id} r={r} />)}</div></section>}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {COLS.map((c) => { const list = all.filter((r) => c.statuses.includes(r.status) && !(c.key !== 'closed' && overdue.includes(r))); return (
          <section key={c.key} className="space-y-2"><p className="panel-label">{c.label} ({list.length})</p>{list.map((r) => <Card key={r.id} r={r} />)}{!list.length && <p className="text-xs text-gray-400">Nothing here.</p>}</section>); })}
      </div>
    </div>
  );
}
