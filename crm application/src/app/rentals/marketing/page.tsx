import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Cluster, Cell } from '@/components/Hud';
import { prettyDate } from '@/lib/rentals/format';
import RentalsNav from '../RentalsNav';

export const dynamic = 'force-dynamic';

type Person = { id: string; name: string; email: string | null; phone: string | null; tote: boolean; junk: boolean; last: string; emailOk: boolean; textOk: boolean };
const VIEWS = [['email', 'Email opt-ins'], ['text', 'Text opt-ins'], ['all', 'All past customers']] as const;
const csvCell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** Everyone who rented totes or hired us, with the marketing opt-ins they gave at checkout. Export a CSV for any email or text tool. */
export default async function MarketingList({ searchParams }: { searchParams: { show?: string } }) {
  await requireStaff();
  const show = (VIEWS.find(([k]) => k === searchParams.show)?.[0] ?? 'email') as (typeof VIEWS)[number][0];
  const supabase = createClient();
  const [{ data: customers }, { data: rentals }, { data: jobs }, { data: optOuts }] = await Promise.all([
    supabase.from('customers').select('id, name, email, phone, created_at'),
    supabase.from('rentals').select('customer_id, status, created_at, marketing_email_consent_at, marketing_sms_consent_at').neq('status', 'pending_payment'),
    supabase.from('jobs').select('customer_id, created_at'),
    supabase.from('sms_opt_outs').select('phone'),
  ]);
  const stopped = new Set((optOuts ?? []).map((o) => o.phone));
  const byId = new Map<string, { id: string; name: string; email: string | null; phone: string | null }>();
  (customers ?? []).forEach((c) => byId.set(c.id, c));
  const people = new Map<string, Person>();
  const touch = (cid: string, at: string, f: (p: Person) => void) => {
    const c = byId.get(cid); if (!c) return;
    const p = people.get(cid) ?? { id: c.id, name: c.name, email: c.email, phone: c.phone, tote: false, junk: false, last: '', emailOk: false, textOk: false };
    if (at > p.last) p.last = at; f(p); people.set(cid, p);
  };
  // live checkouts (pending_payment) are skipped; an abandoned checkout still counts, the person ticked the offers box
  for (const r of rentals ?? []) touch(r.customer_id, r.created_at, (p) => { p.tote = true; if (r.marketing_email_consent_at) p.emailOk = true; if (r.marketing_sms_consent_at) p.textOk = true; });
  for (const j of jobs ?? []) touch(j.customer_id, j.created_at, (p) => { p.junk = true; });
  const all = Array.from(people.values()).sort((a, b) => b.last.localeCompare(a.last));
  for (const p of all) if (p.phone && stopped.has(p.phone)) p.textOk = false;
  const list = all.filter((p) => show === 'all' ? !!(p.email || p.phone) : show === 'email' ? p.emailOk && !!p.email : p.textOk && !!p.phone);
  const csv = ['name,email,phone,customer_type,last_activity,email_opt_in,text_opt_in', ...list.map((p) => [p.name, p.email ?? '', p.phone ?? '', [p.tote && 'tote rental', p.junk && 'junk removal'].filter(Boolean).join(' + '), p.last.slice(0, 10), p.emailOk ? 'yes' : 'no', p.textOk ? 'yes' : 'no'].map((v) => csvCell(String(v))).join(','))].join('\n');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="panel-label">Rentals</p><h1 className="text-2xl">Marketing list</h1></div>
        <a className="btn-primary" download={`sjhc-marketing-${show}-${new Date().toISOString().slice(0, 10)}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Download CSV ({list.length})</a></div>
      <RentalsNav active="/rentals/marketing" />
      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Customers" value={String(all.length)} />
        <Cell label="Email opt-ins" value={String(all.filter((p) => p.emailOk && p.email).length)} tone="var(--status-success)" />
        <Cell label="Text opt-ins" value={String(all.filter((p) => p.textOk && p.phone).length)} />
        <Cell label="Tote renters" value={String(all.filter((p) => p.tote).length)} />
      </Cluster>
      <nav className="flex flex-wrap gap-1 text-sm">{VIEWS.map(([k, label]) => <Link key={k} href={`/rentals/marketing?show=${k}`} className={`rounded-md px-3 py-1.5 ${show === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</Link>)}</nav>
      <p className="text-sm text-gray-500">{show === 'all'
        ? 'Past customers who did not opt in can still get a few emails from a business they hired, but every email needs an unsubscribe link and your mailing address, and texts need their opt-in. Use the opt-in lists for promotions.'
        : 'People who checked the offers box at tote checkout. Renters get the junk removal email automatically during the rental, with an unsubscribe link.'}</p>
      <div className="card overflow-x-auto p-0"><table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Phone</th><th className="p-2">Type</th><th className="p-2">Last</th><th className="p-2">Opted in</th></tr></thead>
        <tbody>{list.map((p) => <tr key={p.id} className="border-t"><td className="p-2"><Link className="underline" href={`/customers/${p.id}`}>{p.name}</Link></td><td className="p-2">{p.email}</td><td className="p-2">{p.phone}</td><td className="p-2">{[p.tote && 'Totes', p.junk && 'Junk'].filter(Boolean).join(' + ')}</td><td className="p-2">{prettyDate(p.last.slice(0, 10))}</td><td className="p-2">{[p.emailOk && 'email', p.textOk && 'text'].filter(Boolean).join(', ') || 'no'}</td></tr>)}
        {!list.length && <tr><td className="p-4 text-gray-500" colSpan={6}>Nobody here yet. The list fills as customers book totes and check the offers box.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}
