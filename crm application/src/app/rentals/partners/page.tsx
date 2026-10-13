import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import PartnersManager from './PartnersManager';
import { money } from '@/lib/rentals/client';

export const dynamic = 'force-dynamic';

/** Realtor partners and promo codes, plus a monthly statement of referred rentals per partner. */
export default async function PartnersPage({ searchParams }: { searchParams: { month?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const month = searchParams.month ?? new Date().toISOString().slice(0, 7);
  const [{ data: partners }, { data: rentals }] = await Promise.all([
    supabase.from('rental_partners').select('*').order('name'),
    supabase.from('rentals').select('id, rental_number, partner_id, delivery_date, total, discount_amount, status, customers(name)').not('partner_id', 'is', null).gte('delivery_date', `${month}-01`).lt('delivery_date', nextMonth(month)).not('status', 'in', '("cancelled","pending_payment")'),
  ]);
  type R = { id: string; rental_number: string; partner_id: string; delivery_date: string; total: number; discount_amount: number; status: string; customers: { name: string } | null };
  const rs = (rentals ?? []) as unknown as R[];
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Partners &amp; promo codes</h1></div>
      <RentalsNav active="/rentals/partners" />
      <PartnersManager partners={partners ?? []} />
      <section className="card space-y-2"><div className="flex items-center justify-between"><p className="panel-label">Monthly statement</p><form><input className="input w-auto" type="month" name="month" defaultValue={month} /> <button className="btn-ghost">Go</button></form></div>
        {(partners ?? []).map((p) => { const list = rs.filter((r) => r.partner_id === p.id); if (!list.length) return null; return (
          <div key={p.id} className="border-t pt-2"><p className="font-semibold">{p.name}{p.brokerage ? ` · ${p.brokerage}` : ''} · code {p.referral_code} · {list.length} rental(s) · {money(list.reduce((s, r) => s + Number(r.total), 0))} booked · {money(list.reduce((s, r) => s + Number(r.discount_amount), 0))} in discounts</p>
            <table className="w-full text-sm"><tbody>{list.map((r) => <tr key={r.id} className="border-t"><td className="py-1">{r.rental_number}</td><td>{r.customers?.name}</td><td>{r.delivery_date}</td><td>{r.status}</td><td className="text-right">{money(r.total)}</td></tr>)}</tbody></table></div>); })}
        {!rs.length && <p className="text-sm text-gray-500">No referred rentals in {month}.</p>}
      </section>
    </div>
  );
}
function nextMonth(m: string) { const [y, mm] = m.split('-').map(Number); return `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`; }
