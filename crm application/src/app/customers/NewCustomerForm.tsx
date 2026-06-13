'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import type { CustomerTag } from '@/lib/types';

const TAGS: CustomerTag[] = ['residential', 'commercial', 'repeat', 'high_value'];

export default function NewCustomerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', city: '' });
  const [tags, setTags] = useState<CustomerTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await mutate({ table: 'customers', op: 'insert', label: 'customer', payload: { ...form, tags } });
    setBusy(false);
    if (res.status === 'failed') { setError(res.error); return; }
    setOpen(false);
    setForm({ name: '', phone: '', email: '', address: '', city: '' });
    setTags([]);
    router.refresh();
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>+ New customer</button>;

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <input className="input" placeholder="Name *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input className="input" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input className="input md:col-span-2" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2">
        {TAGS.map((t) => (
          <button key={t} type="button"
            className={`badge border px-3 py-1 ${tags.includes(t) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500'}`}
            onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">Couldn&apos;t save: {error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
