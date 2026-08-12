'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import { LEAD_SOURCES, type Customer, type ServiceType } from '@/lib/types';

export default function NewJobForm({ customers, triggerClassName = 'btn-primary', triggerLabel = '+ New job', defaultDate, startOpen = false, onClose }: {
  customers: Pick<Customer, 'id' | 'name'>[];
  triggerClassName?: string;
  triggerLabel?: string;
  defaultDate?: string;        // YYYY-MM-DD — prefills scheduled_start to 9am that day
  startOpen?: boolean;         // render the form immediately (no trigger button) — for modal use
  onClose?: () => void;        // called on Cancel / after a successful save
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', customer_id: '', service: 'junk_removal' as ServiceType,
    description: '', address: '', estimated_value: '',
    scheduled_start: defaultDate ? `${defaultDate}T09:00` : '', lead_source: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await mutate({
      table: 'jobs', op: 'insert', label: 'job',
      payload: {
        title: form.title,
        customer_id: form.customer_id,
        service: form.service,
        description: form.description || null,
        address: form.address || null,
        estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
        scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : null,
        lead_source: form.lead_source || null,
        status: form.scheduled_start ? 'scheduled' : 'lead',
      },
    });
    setBusy(false);
    if (res.status === 'failed') { setError(res.error); return; }
    setOpen(false);
    onClose?.();
    router.refresh();
  }

  if (!open) return <button className={triggerClassName} onClick={() => setOpen(true)}>{triggerLabel}</button>;

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <input className="input" placeholder="Job title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select className="input" required value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
          <option value="">Select customer *</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}>
          <option value="junk_removal">Junk removal</option>
          <option value="landscaping">Landscaping</option>
          <option value="other">Other</option>
        </select>
        <input className="input" type="number" step="0.01" placeholder="Estimated value $" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} />
        <input className="input" placeholder="Job address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input className="input" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} />
        <select className="input" value={form.lead_source} onChange={(e) => setForm({ ...form, lead_source: e.target.value })}>
          <option value="">Lead source…</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <textarea className="input md:col-span-2" placeholder="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      {error && <p className="text-sm text-red-600">Couldn&apos;t save: {error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create job'}</button>
        <button type="button" className="btn-ghost" onClick={() => { setOpen(false); onClose?.(); }}>Cancel</button>
      </div>
    </form>
  );
}
