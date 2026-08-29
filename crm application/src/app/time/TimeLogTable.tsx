'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export interface TimeRow {
  id: string;
  user_id: string;
  job_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  users?: { id: string; full_name: string } | null;
  jobs?: { id: string; title: string } | null;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function hours(row: TimeRow): number {
  const end = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
  return Math.round(((end - new Date(row.started_at).getTime()) / 36e5) * 100) / 100;
}

export default function TimeLogTable({ rows }: { rows: TimeRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ started_at: '', ended_at: '' });
  const [error, setError] = useState<string | null>(null);

  async function save(id: string) {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().from('time_entries').update({
      started_at: form.started_at ? new Date(form.started_at).toISOString() : undefined,
      ended_at: form.ended_at ? new Date(form.ended_at).toISOString() : null,
    }).eq('id', id);
    setBusy(false);
    if (e) { setError(e.message); return; }
    setEditing(null);
    router.refresh();
  }

  async function clockOutNow(id: string) {
    setBusy(true);
    const { error: e } = await createClient().from('time_entries').update({ ended_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (e) { setError(e.message); return; }
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm('Remove this clock entry? Its unpaid auto-created labor cost is removed with it.')) return;
    setBusy(true);
    const { error: e } = await createClient().from('time_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (e) { setError(e.message); return; }
    router.refresh();
  }

  if (!rows.length) return <p className="text-gray-500">No clock entries in this range.</p>;

  const totalHrs = Math.round(rows.reduce((s, r) => s + hours(r), 0) * 100) / 100;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-gray-500">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} · {totalHrs}h total</p>
      <div className="card divide-y divide-gray-100 p-0">
        {rows.map((r) => {
          const running = !r.ended_at;
          const forgotten = running && hours(r) > 12;
          return (
            <div key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.users?.full_name ?? 'Unknown'}
                    <span className="ml-2 text-sm font-normal text-gray-500">{r.jobs?.title ?? 'General / no job'}</span>
                    {running && <span className={`badge ml-2 ${forgotten ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{forgotten ? 'FORGOT TO CLOCK OUT?' : 'ON THE CLOCK'}</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(r.started_at).toLocaleString()} → {r.ended_at ? new Date(r.ended_at).toLocaleString() : 'still running'} · {hours(r)}h
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {running && <button className="btn-ghost" disabled={busy} onClick={() => clockOutNow(r.id)}>Clock out now</button>}
                  <button className="btn-ghost" onClick={() => {
                    setEditing(editing === r.id ? null : r.id);
                    setForm({ started_at: toLocalInput(r.started_at), ended_at: toLocalInput(r.ended_at) });
                  }}>Edit</button>
                  <button className="btn-ghost" style={{ color: 'var(--status-danger)' }} disabled={busy} onClick={() => remove(r.id)}>Remove</button>
                </div>
              </div>
              {editing === r.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2">
                  <div>
                    <label className="panel-label mb-1 block">Clock in</label>
                    <input className="input" type="datetime-local" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })} />
                  </div>
                  <div>
                    <label className="panel-label mb-1 block">Clock out</label>
                    <input className="input" type="datetime-local" value={form.ended_at} onChange={(e) => setForm({ ...form, ended_at: e.target.value })} />
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={() => save(r.id)}>{busy ? 'Saving…' : 'Save'}</button>
                  <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
