'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { act } from '@/lib/rentals/client';

type Asset = { id: string; asset_tag: string; asset_type: string; status: string; condition_notes: string | null; purchase_cost: number | null; purchase_date: string | null; on: { id: string; rental_number: string; customer: string } | null };
const STATUSES = ['available', 'reserved', 'out', 'returned_dirty', 'damaged', 'lost', 'retired'];

export default function InventoryManager({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [bulk, setBulk] = useState({ prefix: 'T-', from: '', to: '', type: 'tote', cost: '' });
  const [err, setErr] = useState<string | null>(null);
  const list = assets.filter((a) => filter === 'all' || a.status === filter);
  async function mark(a: Asset, status: string) {
    const note = ['damaged', 'lost', 'retired'].includes(status) ? prompt(`Mark ${a.asset_tag} ${status}. Note:`) : null;
    if (['damaged', 'lost', 'retired'].includes(status) && note === null) return;
    try { await act('update_asset', { asset_id: a.id, status, condition_notes: note ?? undefined }); router.refresh(); } catch (e) { setErr((e as Error).message); }
  }
  async function addBulk() {
    const from = Number(bulk.from), to = Number(bulk.to);
    if (!from || !to || to < from) { setErr('Give a from/to number, e.g. 41 to 60.'); return; }
    const pad = bulk.type === 'tote' ? 3 : 2;
    const tags = Array.from({ length: to - from + 1 }, (_, i) => `${bulk.prefix}${String(from + i).padStart(pad, '0')}`);
    try { const r = await act<{ added: number }>('bulk_add_assets', { tags, asset_type: bulk.type, purchase_cost: bulk.cost ? Number(bulk.cost) : null, purchase_date: new Date().toISOString().slice(0, 10) }); setErr(null); alert(`Added ${r.added} ${bulk.type}(s).`); router.refresh(); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="card grid gap-2 md:grid-cols-6"><p className="panel-label md:col-span-6">Bulk add</p>
        <select className="input" value={bulk.type} onChange={(e) => setBulk({ ...bulk, type: e.target.value, prefix: e.target.value === 'tote' ? 'T-' : e.target.value === 'dolly' ? 'D-' : 'X-' })}><option value="tote">tote</option><option value="dolly">dolly</option><option value="zip_ties">zip ties</option><option value="labels">labels</option><option value="other">other</option></select>
        <input className="input" value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} placeholder="T-" /><input className="input" placeholder="from 41" value={bulk.from} onChange={(e) => setBulk({ ...bulk, from: e.target.value })} /><input className="input" placeholder="to 60" value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })} /><input className="input" placeholder="cost each $" value={bulk.cost} onChange={(e) => setBulk({ ...bulk, cost: e.target.value })} />
        <button className="btn-primary" onClick={addBulk}>Add</button></div>
      <div className="flex flex-wrap gap-1">{['all', ...STATUSES].map((s) => <button key={s} className={`badge ${filter === s ? 'bg-brand-500 text-white' : 'bg-gray-100'}`} onClick={() => setFilter(s)}>{s.replace('_', ' ')}</button>)}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th>Tag</th><th>Type</th><th>Status</th><th>On rental</th><th>Notes</th><th>Cost</th><th /></tr></thead><tbody>
        {list.map((a) => (<tr key={a.id} className="border-t"><td className="py-1 font-mono">{a.asset_tag}</td><td>{a.asset_type}</td><td><span className={`badge ${a.status === 'available' ? 'bg-emerald-50 text-emerald-700' : ['damaged', 'lost'].includes(a.status) ? 'bg-red-50 text-red-700' : 'bg-gray-100'}`}>{a.status.replace('_', ' ')}</span></td>
          <td>{a.on ? <Link className="underline" href={`/rentals/${a.on.id}`}>{a.on.rental_number} {a.on.customer}</Link> : '—'}</td><td className="text-xs text-gray-500">{a.condition_notes}</td><td>{a.purchase_cost != null ? `$${Number(a.purchase_cost).toFixed(2)}` : ''}</td>
          <td className="text-right"><select className="input w-auto py-0" value="" onChange={(e) => e.target.value && mark(a, e.target.value)}><option value="">mark…</option>{STATUSES.filter((s) => s !== a.status && s !== 'out').map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></td></tr>))}
      </tbody></table></div>
    </div>
  );
}
