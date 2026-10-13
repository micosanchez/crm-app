'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Partner = { id?: string; name: string; brokerage: string | null; phone: string | null; email: string | null; referral_code: string; discount_type: string; discount_amount: number; active: boolean };
const EMPTY: Partner = { name: '', brokerage: '', phone: '', email: '', referral_code: '', discount_type: 'fixed', discount_amount: 0, active: true };

export default function PartnersManager({ partners }: { partners: Partner[] }) {
  const router = useRouter();
  const [p, setP] = useState<Partner | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!p) return;
    const { id, ...rest } = p; rest.referral_code = rest.referral_code.toUpperCase().trim();
    const { error } = id ? await createClient().from('rental_partners').update(rest).eq('id', id) : await createClient().from('rental_partners').insert(rest);
    if (error) { setErr(error.message); return; }
    setP(null); setErr(null); router.refresh();
  }
  return (
    <section className="card space-y-2">
      <div className="flex justify-between"><p className="panel-label">Partners</p><button className="btn-primary" onClick={() => setP({ ...EMPTY })}>+ Partner</button></div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {p && <div className="grid gap-2 md:grid-cols-4">
        <input className="input" placeholder="Name *" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /><input className="input" placeholder="Brokerage" value={p.brokerage ?? ''} onChange={(e) => setP({ ...p, brokerage: e.target.value })} /><input className="input" placeholder="Phone" value={p.phone ?? ''} onChange={(e) => setP({ ...p, phone: e.target.value })} /><input className="input" placeholder="Email" value={p.email ?? ''} onChange={(e) => setP({ ...p, email: e.target.value })} />
        <input className="input" placeholder="CODE *" value={p.referral_code} onChange={(e) => setP({ ...p, referral_code: e.target.value.toUpperCase() })} /><select className="input" value={p.discount_type} onChange={(e) => setP({ ...p, discount_type: e.target.value })}><option value="fixed">$ off</option><option value="percent">% off</option></select><input className="input" type="number" step="0.01" placeholder="Amount" value={p.discount_amount} onChange={(e) => setP({ ...p, discount_amount: Number(e.target.value) })} />
        <div className="flex gap-2"><button className="btn-primary" onClick={save} disabled={!p.name || !p.referral_code}>Save</button><button className="btn-ghost" onClick={() => setP(null)}>Cancel</button></div></div>}
      <table className="w-full text-sm"><tbody>{partners.map((x) => <tr key={x.id} className="border-t"><td className="py-1">{x.name}{x.brokerage ? ` · ${x.brokerage}` : ''} {!x.active && <span className="badge">inactive</span>}</td><td className="font-mono">{x.referral_code}</td><td>{x.discount_type === 'percent' ? `${x.discount_amount}% off` : `$${Number(x.discount_amount).toFixed(2)} off`}</td><td className="text-xs text-gray-500">{x.phone} {x.email}</td><td className="text-right text-xs"><button className="underline" onClick={() => setP(x)}>Edit</button> · <button className="underline" onClick={async () => { await createClient().from('rental_partners').update({ active: !x.active }).eq('id', x.id); router.refresh(); }}>{x.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table>
      <p className="text-xs text-gray-500">Share a link like <code>https://sanchezhaulco.com/totes?code=CODE</code>; the booking page fills the code in.</p>
    </section>
  );
}
