'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { TimeEntry, Job } from '@/lib/types';

function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Fire-and-forget clock notification to the owner (logged server-side). */
function notifyClock(event: 'clock_in' | 'clock_out', entryId: string) {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, entry_id: entryId }),
  }).catch(() => {});
}

/** Clock in/out for the logged-in worker. Labor is attributed to today's job.
 *  When jobs are assigned for the day the FIRST one is preselected — "General /
 *  no job" is a deliberate choice, so hours land against the right job by default. */
export default function ClockWidget({ userId, openEntry, jobs }: {
  userId: string; openEntry: TimeEntry | null; jobs: Pick<Job, 'id' | 'title'>[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState(jobs.length > 0 ? jobs[0].id : '');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // If the day's jobs load after first render, adopt the first as the default.
    setJobId((cur) => cur || (jobs.length > 0 ? jobs[0].id : ''));
  }, [jobs]);

  useEffect(() => {
    if (!openEntry) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [openEntry]);

  async function clockIn() {
    setBusy(true);
    const { data, error } = await createClient().from('time_entries')
      .insert({ user_id: userId, job_id: jobId || null }).select('id').single();
    setBusy(false);
    if (error) { alert(`Couldn't clock in: ${error.message}`); return; }
    if (data?.id) notifyClock('clock_in', data.id);
    router.refresh();
  }
  async function clockOut() {
    if (!openEntry) return;
    setBusy(true);
    const { error } = await createClient().from('time_entries').update({ ended_at: new Date().toISOString() }).eq('id', openEntry.id);
    setBusy(false);
    if (error) { alert(`Couldn't clock out: ${error.message}`); return; }
    notifyClock('clock_out', openEntry.id);
    router.refresh();
  }

  if (openEntry) {
    const elapsed = now - new Date(openEntry.started_at).getTime();
    return (
      <div className="card flex items-center justify-between" style={{ borderColor: 'var(--brand-accent)', boxShadow: '0 2px 10px rgba(141,29,57,0.12)' }}>
        <div>
          <p className="panel-label" style={{ color: 'var(--brand-text)' }}>On the clock</p>
          <p className="metric text-3xl font-bold text-gray-900">{fmtDur(elapsed)}</p>
          {openEntry.jobs?.title && <p className="mt-0.5 text-xs text-gray-500">{openEntry.jobs.title}</p>}
        </div>
        <button className="btn-primary btn-big w-auto px-6" disabled={busy} onClick={clockOut}>{busy ? '…' : 'Clock out'}</button>
      </div>
    );
  }
  return (
    <div className="card space-y-2">
      <p className="panel-label">Time clock</p>
      <div className="flex gap-2">
        <select className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          <option value="">General / no job</option>
        </select>
        <button className="btn-primary px-6" disabled={busy} onClick={clockIn}>{busy ? '…' : 'Clock in'}</button>
      </div>
    </div>
  );
}
