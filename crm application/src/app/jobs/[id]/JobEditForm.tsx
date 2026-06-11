'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { mutate } from '@/lib/offline/sync';
import type { Job, ServiceType } from '@/lib/types';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Edit job details incl. reschedule + end time, with double-booking warning. */
export default function JobEditForm({ job }: { job: Job }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: job.title,
    description: job.description ?? '',
    address: job.address ?? '',
    service: job.service,
    estimated_value: job.estimated_value != null ? String(job.estimated_value) : '',
    scheduled_start: toLocalInput(job.scheduled_start),
    scheduled_end: toLocalInput(job.scheduled_end ?? null),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const start = form.scheduled_start ? new Date(form.scheduled_start) : null;
    const end = form.scheduled_end ? new Date(form.scheduled_end) : start ? new Date(start.getTime() + 2 * 3600_000) : null;

    // Conflict detection: other jobs overlapping this window
    if (start && end && navigator.onLine) {
      const supabase = createClient();
      const { data: others } = await supabase
        .from('jobs')
        .select('id,title,scheduled_start,scheduled_end')
        .neq('id', job.id)
        .not('scheduled_start', 'is', null)
        .gte('scheduled_start', new Date(start.getTime() - 12 * 3600_000).toISOString())
        .lte('scheduled_start', new Date(end.getTime() + 12 * 3600_000).toISOString());
      const conflicts = (others ?? []).filter((o) => {
        const oStart = new Date(o.scheduled_start!);
        const oEnd = o.scheduled_end ? new Date(o.scheduled_end) : new Date(oStart.getTime() + 2 * 3600_000);
        return start < oEnd && end > oStart;
      });
      if (conflicts.length > 0) {
        const ok = confirm(`Schedule conflict: overlaps "${conflicts[0].title}" (${new Date(conflicts[0].scheduled_start!).toLocaleString()}). Book anyway?`);
        if (!ok) { setBusy(false); return; }
      }
    }

    await mutate({
      table: 'jobs', op: 'update', id: job.id,
      payload: {
        title: form.title,
        description: form.description || null,
        address: form.address || null,
        service: form.service,
        estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
        scheduled_start: start ? start.toISOString() : null,
        scheduled_end: form.scheduled_end ? new Date(form.scheduled_end).toISOString() : null,
      },
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>Edit / Reschedule</button>;

  return (
    <form onSubmit={submit} className="card grid gap-3 ring-2 ring-brand-500 md:grid-cols-2">
      <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <select className="input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}>
        <option value="junk_removal">Junk removal</option>
        <option value="landscaping">Landscaping</option>
        <option value="other">Other</option>
      </select>
      <input className="input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <input className="input" type="number" step="0.01" placeholder="Estimated value $" value={form.estimated_value} onChange={(e) => setForm({ ...form, estimated_value: e.target.value })} />
      <div>
        <label className="panel-label mb-1 block">Starts</label>
        <input className="input" type="datetime-local" value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} />
      </div>
      <div>
        <label className="panel-label mb-1 block">Ends (for conflict checks)</label>
        <input className="input" type="datetime-local" value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} />
      </div>
      <textarea className="input md:col-span-2" rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
