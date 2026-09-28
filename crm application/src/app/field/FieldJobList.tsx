'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import StatusBadge from '@/components/StatusBadge';
import PhotoSection from '@/components/PhotoSection';
import { createClient } from '@/lib/supabase/client';
import { HAULING_UNITS, SERVICE_TYPES, type Job, type JobServiceType } from '@/lib/types';

/**
 * One-handed field UI. All actions go through the offline queue —
 * works in dead zones, syncs when signal returns.
 */
export default function FieldJobList({ jobs: initial, isStaff = false }: { jobs: Job[]; isStaff?: boolean }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState<Job | null>(null);
  const [co, setCo] = useState({ service_type: '' as JobServiceType | '', hauling_unit: 'trailer_6x12', load_fraction: '', crew_size: '1', owner_hours: '', dump_cost: '', dump_site: '', mattress_count: '' });
  const [missing, setMissing] = useState<string[] | null>(null);

  // Close-out: the 60 seconds at the curb that make the job costable. Owner hours,
  // load size and the dump ticket go straight to job_close_out (online only — it's
  // one RPC, and the status change still queues offline if this is skipped).
  async function closeOut() {
    if (!closing) return;
    const p: Record<string, unknown> = { hauling_unit: co.hauling_unit, review_requested: false };
    if (co.service_type) p.service_type = co.service_type;
    if (co.load_fraction) p.load_fraction = Number(co.load_fraction);
    if (co.crew_size) p.crew_size = Number(co.crew_size);
    if (co.owner_hours) p.owner_hours = Number(co.owner_hours);
    if (co.mattress_count) p.mattress_count = Number(co.mattress_count);
    if (co.dump_cost) p.dump_ticket = { cost: Number(co.dump_cost), site: co.dump_site || 'Other' };
    const supabase = createClient();
    const { data, error } = await supabase.rpc('job_close_out', { p_job_id: closing.id, p });
    if (error) { alert(`Saved the status, but the close-out details failed: ${error.message}`); }
    else setMissing(((data as { still_missing?: string[] } | null)?.still_missing) ?? []);
    await setStatus(closing, 'completed');
    setClosing(null);
  }

  async function setStatus(job: Job, status: Job['status']) {
    const prev = job.status;
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status } : j)));
    const res = await mutate({ table: 'jobs', op: 'update', id: job.id, label: 'job', payload: { status } });
    if (res.status === 'failed') {
      setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status: prev } : j)));
      alert(`Couldn't update job: ${res.error}`);
      return;
    }
    router.refresh();
  }

  async function addNote(jobId: string) {
    if (!note.trim()) return;
    const res = await mutate({ table: 'notes', op: 'insert', label: 'note', payload: { entity_type: 'job', entity_id: jobId, body: note } });
    if (res.status === 'failed') { alert(`Couldn't save note: ${res.error}`); return; }
    setNote('');
    setNoteFor(null);
    router.refresh();
  }

  if (!jobs.length) return <p className="text-gray-500">No jobs assigned for today.</p>;

  return (
    <div className="space-y-4">
      {jobs.map((j) => (
        <div key={j.id} className="card space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-bold">{j.title}</p>
              <p className="text-sm text-gray-500">{j.customers?.name}</p>
              {j.scheduled_start && (
                <p className="text-sm font-medium text-brand-700">
                  {new Date(j.scheduled_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
            </div>
            <StatusBadge status={j.status} />
          </div>

          {j.address && (
            <a className="btn-ghost btn-big" href={`https://maps.apple.com/?q=${encodeURIComponent(j.address)}`} target="_blank" rel="noreferrer">
              Directions — {j.address}
            </a>
          )}
          {j.customers?.phone && (
            <a className="btn-ghost btn-big" href={`tel:${j.customers.phone}`}>Call {j.customers.name}</a>
          )}

          {j.status === 'scheduled' && (
            <button className="btn-primary btn-big" onClick={() => setStatus(j, 'in_progress')}>Start job</button>
          )}
          {j.status === 'in_progress' && closing?.id !== j.id && (
            <button className="btn-primary btn-big" onClick={() => isStaff ? (setClosing(j), setCo((c) => ({ ...c, service_type: (j.service_type ?? '') as JobServiceType | '' }))) : setStatus(j, 'completed')}>✓ Complete job</button>
          )}
          {closing?.id === j.id && (
            <div className="space-y-2 rounded-lg p-3 ring-2 ring-brand-500">
              <p className="text-sm font-semibold">Close-out (60 seconds)</p>
              <select className="input" value={co.service_type} onChange={(e) => setCo({ ...co, service_type: e.target.value as JobServiceType })}>
                <option value="">What kind of job?</option>
                {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={co.hauling_unit} onChange={(e) => setCo({ ...co, hauling_unit: e.target.value })}>
                  {HAULING_UNITS.map((u) => <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>)}
                </select>
                <input className="input" type="number" step="0.25" inputMode="decimal" placeholder="Loads (0.5, 1, 2)" value={co.load_fraction} onChange={(e) => setCo({ ...co, load_fraction: e.target.value })} />
                <input className="input" type="number" step="1" inputMode="numeric" placeholder="Crew size" value={co.crew_size} onChange={(e) => setCo({ ...co, crew_size: e.target.value })} />
                <input className="input" type="number" step="0.25" inputMode="decimal" placeholder="Your hours" value={co.owner_hours} onChange={(e) => setCo({ ...co, owner_hours: e.target.value })} />
                <input className="input" type="number" step="0.01" inputMode="decimal" placeholder="Dump ticket $" value={co.dump_cost} onChange={(e) => setCo({ ...co, dump_cost: e.target.value })} />
                <input className="input" placeholder="Dump site" value={co.dump_site} onChange={(e) => setCo({ ...co, dump_site: e.target.value })} />
                <input className="input" type="number" step="1" inputMode="numeric" placeholder="Mattresses" value={co.mattress_count} onChange={(e) => setCo({ ...co, mattress_count: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary btn-big flex-1" onClick={closeOut}>✓ Save &amp; complete</button>
                <button className="btn-ghost" onClick={() => { setClosing(null); setStatus(j, 'completed'); }}>Skip</button>
              </div>
            </div>
          )}
          {missing && missing.length > 0 && j.status === 'completed' && (
            <p className="text-xs text-amber-700">Still missing for a full cost picture: {missing.join(', ').replace(/_/g, ' ')}</p>
          )}

          <PhotoSection job={j} big />

          {noteFor === j.id ? (
            <div className="flex gap-2">
              <input className="input" autoFocus placeholder="Quick note…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary" onClick={() => addNote(j.id)}>Save</button>
            </div>
          ) : (
            <button className="btn-ghost btn-big" onClick={() => setNoteFor(j.id)}>Add note</button>
          )}
        </div>
      ))}
    </div>
  );
}
