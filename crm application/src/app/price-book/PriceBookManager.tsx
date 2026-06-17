'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ServiceItem } from '@/lib/types';

const KINDS: ServiceItem['kind'][] = ['labor', 'disposal', 'materials', 'other'];
const EMPTY = { name: '', default_price: '', kind: 'labor' as ServiceItem['kind'], description: '' };

export default function PriceBookManager({ items }: { items: ServiceItem[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true); setError(null);
    const supabase = createClient();
    const payload = {
      name: form.name.trim(),
      default_price: Number(form.default_price) || 0,
      kind: form.kind,
      description: form.description.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from('service_items').update(payload).eq('id', editingId)
      : await supabase.from('service_items').insert(payload);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setForm(EMPTY); setEditingId(null); router.refresh();
  }

  async function remove(id: string) {
    if (!confirm('Remove this item from the price book?')) return;
    await createClient().from('service_items').update({ active: false }).eq('id', id);
    if (editingId === id) { setEditingId(null); setForm(EMPTY); }
    router.refresh();
  }

  function edit(it: ServiceItem) {
    setEditingId(it.id);
    setForm({ name: it.name, default_price: String(it.default_price), kind: it.kind, description: it.description ?? '' });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="card grid gap-3 md:grid-cols-2">
        <input className="input" placeholder="Item name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" type="number" step="0.01" min="0" placeholder="Default price $" value={form.default_price} onChange={(e) => setForm({ ...form, default_price: e.target.value })} />
        <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ServiceItem['kind'] })}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="input" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
        <div className="flex gap-2 md:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save item' : 'Add item'}</button>
          {editingId && <button type="button" className="btn-ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel</button>}
        </div>
      </form>

      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{it.name} <span className="panel-label">{it.kind}</span></p>
              {it.description && <p className="truncate text-xs text-gray-500">{it.description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="metric font-semibold text-white">${Number(it.default_price).toFixed(2)}</span>
              <button className="text-xs text-gray-500 hover:text-brand-700" onClick={() => edit(it)}>Edit</button>
              <button className="text-xs text-gray-500 hover:text-red-600" onClick={() => remove(it.id)}>Remove</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="px-4 py-8 text-center text-sm text-gray-500">No saved items yet. Add your common jobs above.</p>}
      </div>
    </div>
  );
}
