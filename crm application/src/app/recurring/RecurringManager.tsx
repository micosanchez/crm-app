'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { JobRecurrence, Customer, ServiceType } from '@/lib/types';

const INTERVALS = [
  { label: 'Weekly', days: 7 },
  { label: 'Every 2 weeks', days: 14 },
  { label: 'Monthly', days: 30 },
  { label: 'Quarterly', days: 90 },
];

const EMPTY = {
  customer_id: '', title: '', service: 'landscaping' as ServiceType,
  estimated_value: '', address: '', interval_days: '7', next_run: '',
};

export default function RecurringManager({ recurrences, customers }: {
  recurrences: JobRecurrence[];
  customers: Pick<Customer, 'id' | 'name'>[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id || !form.title.trim() || !form.next_run) { setError('Customer, title, and start date are required.'); return; }
    setBusy(true); setError(null);
    const { error } = await createClient().from('job_recurrence').insert({
      customer_id: form.customer_id,
      title: form.title.trim(),
      service: form.service,
      estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
      address: form.address.trim() || null,
      interval_days: Number(form.interval_days),
      next_run: form.next_run,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setForm(EMPTY); setOpen(false); router.refresh();
  }

  async function stop(id: string) {
    if (!confirm('Stop this recurring job?')) return;
    await createClient().from('job_recurrence').update({ active: false }).eq('id', id);
    router.refresh();
  }

  const intervalLabel = (d: number) => INTERVALS.find((i) => i.days === d)?.label ?? `Every ${d} days`;

  return (
    <div className="space-y-4">
      {!open ? (
        <button className="btn-primary" onClick={() => setOpen(true)}>+ New recurring job</button>
      ) : (
        <form onSubmit={save} className="card grid gap-3 md:grid-cols-2">
          <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Select customer *</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input" placeholder="Job title * (e.g. Lawn mow)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}>
            <option value="landscaping">Landscaping</option>
            <option value="junk_removal">Junk removal</option>
            <option value="other">Other</option>
          </select>
          <input className="input" type="number" step="0.01" placeholder="Value per visit $" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} />
          <select className="input" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })}>
            {INTERVALS.map((i) => <option key={i.days} value={i.days}>{i.label}</option>)}
          </select>
          <div>
            <label className="panel-label mb-1 block">First visit</label>
            <input className="input" type="date" value={form.next_run} onChange={(e) => setForm({ ...form, next_run: e.target.value })} />
          </div>
          <input className="input md:col-span-2" placeholder="Address (optional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
          <div className="flex gap-2 md:col-span-2">
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setForm(EMPTY); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        {recurrences.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900">{r.title} <span className="panel-label">{intervalLabel(r.interval_days)}</span></p>
              <p className="truncate text-xs text-gray-500">{r.customers?.name ?? 'Customer'} · next {new Date(r.next_run + 'T12:00:00').toLocaleDateString()}{r.estimated_value != null && ` · $${Number(r.estimated_value).toFixed(0)}/visit`}</p>
            </div>
            <button className="shrink-0 text-xs text-gray-500 hover:text-red-600" onClick={() => stop(r.id)}>Stop</button>
          </div>
        ))}
        {!recurrences.length && <p className="px-4 py-8 text-center text-sm text-gray-500">No recurring jobs yet.</p>}
      </div>
    </div>
  );
}
