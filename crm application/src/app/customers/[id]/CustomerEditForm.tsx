'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import type { Customer, CustomerTag } from '@/lib/types';

const TAGS: CustomerTag[] = ['residential', 'commercial', 'repeat', 'high_value'];

export default function CustomerEditForm({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    city: customer.city ?? '',
  });
  const [tags, setTags] = useState<CustomerTag[]>(customer.tags ?? []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await mutate({
      table: 'customers', op: 'update', id: customer.id, label: 'customer',
      payload: {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        tags,
      },
    });
    setBusy(false);
    if (res.status === 'failed') { setError(res.error); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>Edit customer</button>;

  return (
    <form onSubmit={submit} className="card grid gap-3 ring-2 ring-brand-500 md:grid-cols-2">
      <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className="input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input className="input" placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
      <input className="input md:col-span-2" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <div className="flex flex-wrap gap-2 md:col-span-2">
        {TAGS.map((t) => (
          <button key={t} type="button"
            className={`badge border px-3 py-1 ${tags.includes(t) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500'}`}
            onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 md:col-span-2">Couldn&apos;t save: {error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
