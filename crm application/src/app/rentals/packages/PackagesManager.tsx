'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pkg = { id?: string; name: string; description: string | null; tote_count: number; rental_days_included: number; price: number | null; extra_week_price: number | null; deposit_amount: number | null; active: boolean; sort_order: number };
type Addon = { id?: string; name: string; asset_type: string; price: number | null; per: string; max_qty: number; active: boolean; sort_order: number };
const EMPTY_PKG: Pkg = { name: '', description: '', tote_count: 20, rental_days_included: 14, price: null, extra_week_price: null, deposit_amount: null, active: true, sort_order: 0 };
const EMPTY_ADDON: Addon = { name: '', asset_type: 'dolly', price: null, per: 'rental', max_qty: 2, active: true, sort_order: 0 };
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

export default function PackagesManager({ packages, addons }: { packages: Pkg[]; addons: Addon[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [editingAddon, setEditingAddon] = useState<Addon | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();
  const num = (v: string) => (v === '' ? null : Number(v));
  async function save(table: 'rental_packages' | 'rental_addons', row: any) {
    const { id, ...rest } = row;
    const { error } = id ? await supabase.from(table).update(rest).eq('id', id) : await supabase.from(table).insert(rest);
    if (error) { setErr(error.message); return; }
    setEditing(null); setEditingAddon(null); setErr(null); router.refresh();
  }
  async function move(table: 'rental_packages' | 'rental_addons', list: any[], i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    await supabase.from(table).update({ sort_order: j }).eq('id', list[i].id);
    await supabase.from(table).update({ sort_order: i }).eq('id', list[j].id);
    router.refresh();
  }
  return (
    <div className="space-y-6">
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <section className="space-y-2"><div className="flex justify-between"><p className="panel-label">Packages</p><button className="btn-primary" onClick={() => setEditing({ ...EMPTY_PKG, sort_order: packages.length })}>+ Package</button></div>
        {editing && <form className="card grid gap-2 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); save('rental_packages', editing); }}>
          <input className="input md:col-span-2" placeholder="Name *" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input className="input md:col-span-2" placeholder="Description" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <label className="text-xs">Totes<input className="input" type="number" value={editing.tote_count} onChange={(e) => setEditing({ ...editing, tote_count: Number(e.target.value) })} /></label>
          <label className="text-xs">Days included<input className="input" type="number" value={editing.rental_days_included} onChange={(e) => setEditing({ ...editing, rental_days_included: Number(e.target.value) })} /></label>
          <label className="text-xs">Price $<input className="input" type="number" step="0.01" value={editing.price ?? ''} onChange={(e) => setEditing({ ...editing, price: num(e.target.value) })} /></label>
          <label className="text-xs">Extra week $<input className="input" type="number" step="0.01" value={editing.extra_week_price ?? ''} onChange={(e) => setEditing({ ...editing, extra_week_price: num(e.target.value) })} /></label>
          <label className="text-xs">Deposit $<input className="input" type="number" step="0.01" value={editing.deposit_amount ?? ''} onChange={(e) => setEditing({ ...editing, deposit_amount: num(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
          <div className="flex gap-2 md:col-span-2"><button className="btn-primary">Save</button><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>}
        <div className="grid gap-3 md:grid-cols-2">{packages.map((p, i) => (
          <div key={p.id} className="card flex gap-3">
            <div className="flex-1"><p className="font-semibold">{p.name} {!p.active && <span className="badge">inactive</span>}{p.price == null && <span className="badge bg-amber-50 text-amber-700">no price</span>}</p><p className="text-sm text-gray-500">{p.tote_count} totes · {p.rental_days_included} days · {money(p.price)} · extra week {money(p.extra_week_price)} · deposit {money(p.deposit_amount)}</p>
              <div className="mt-2 flex gap-2 text-xs"><button className="underline" onClick={() => setEditing(p)}>Edit</button><button className="underline" onClick={() => save('rental_packages', { id: p.id, active: !p.active })}>{p.active ? 'Deactivate' : 'Activate'}</button><button className="underline" onClick={() => move('rental_packages', packages, i, -1)}>↑</button><button className="underline" onClick={() => move('rental_packages', packages, i, 1)}>↓</button></div></div>
            <Preview p={p} />
          </div>))}</div>
      </section>
      <section className="space-y-2"><div className="flex justify-between"><p className="panel-label">Add-ons (dolly is always an add-on)</p><button className="btn-primary" onClick={() => setEditingAddon({ ...EMPTY_ADDON, sort_order: addons.length })}>+ Add-on</button></div>
        {editingAddon && <form className="card grid gap-2 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); save('rental_addons', editingAddon); }}>
          <input className="input md:col-span-2" placeholder="Name *" required value={editingAddon.name} onChange={(e) => setEditingAddon({ ...editingAddon, name: e.target.value })} />
          <select className="input" value={editingAddon.asset_type} onChange={(e) => setEditingAddon({ ...editingAddon, asset_type: e.target.value })}>{['dolly', 'zip_ties', 'labels', 'tote', 'other'].map((t) => <option key={t}>{t}</option>)}</select>
          <input className="input" type="number" step="0.01" placeholder="Price $" value={editingAddon.price ?? ''} onChange={(e) => setEditingAddon({ ...editingAddon, price: num(e.target.value) })} />
          <select className="input" value={editingAddon.per} onChange={(e) => setEditingAddon({ ...editingAddon, per: e.target.value })}><option value="rental">per rental</option><option value="day">per day</option></select>
          <input className="input" type="number" placeholder="Max qty" value={editingAddon.max_qty} onChange={(e) => setEditingAddon({ ...editingAddon, max_qty: Number(e.target.value) })} />
          <div className="flex gap-2 md:col-span-6"><button className="btn-primary">Save</button><button type="button" className="btn-ghost" onClick={() => setEditingAddon(null)}>Cancel</button></div>
        </form>}
        <table className="w-full text-sm"><tbody>{addons.map((a, i) => <tr key={a.id} className="border-t"><td className="py-1">{a.name} {!a.active && <span className="badge">inactive</span>}</td><td>{a.asset_type}</td><td>{money(a.price)} / {a.per}</td><td>max {a.max_qty}</td><td className="text-right text-xs"><button className="underline" onClick={() => setEditingAddon(a)}>Edit</button> · <button className="underline" onClick={() => save('rental_addons', { id: a.id, active: !a.active })}>{a.active ? 'Deactivate' : 'Activate'}</button> · <button className="underline" onClick={() => move('rental_addons', addons, i, -1)}>↑</button> <button className="underline" onClick={() => move('rental_addons', addons, i, 1)}>↓</button></td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

/** How the package card looks on the public booking page. */
function Preview({ p }: { p: Pkg }) {
  return (
    <div className="w-44 shrink-0 rounded-xl p-3 text-white" style={{ background: '#4a1024', fontFamily: 'Barlow Condensed, system-ui, sans-serif' }}>
      <p className="text-xs uppercase tracking-widest opacity-60">Preview</p>
      <p className="text-lg font-bold leading-tight" style={{ fontFamily: 'Bebas Neue, Barlow Condensed, sans-serif' }}>{p.name || 'Package name'}</p>
      <p className="text-xs opacity-80">{p.tote_count} totes · {p.rental_days_included} days{p.description ? ` · ${p.description}` : ''}</p>
      <p className="mt-1 text-2xl" style={{ fontFamily: 'Bebas Neue, sans-serif' }}>{money(p.price)}</p>
      {p.extra_week_price ? <p className="text-xs opacity-70">Extra week {money(p.extra_week_price)}{p.deposit_amount ? ` · deposit ${money(p.deposit_amount)}` : ''}</p> : null}
    </div>
  );
}
