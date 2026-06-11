'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import StatusBadge from '@/components/StatusBadge';
import PhotoSection from '@/components/PhotoSection';
import type { Job } from '@/lib/types';

/**
 * One-handed field UI. All actions go through the offline queue —
 * works in dead zones, syncs when signal returns.
 */
export default function FieldJobList({ jobs: initial }: { jobs: Job[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initial);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function setStatus(job: Job, status: Job['status']) {
    setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, status } : j)));
    await mutate({ table: 'jobs', op: 'update', id: job.id, payload: { status } });
    router.refresh();
  }

  async function addNote(jobId: string) {
    if (!note.trim()) return;
    await mutate({ table: 'notes', op: 'insert', payload: { entity_type: 'job', entity_id: jobId, body: note } });
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
          {j.status === 'in_progress' && (
            <button className="btn-primary btn-big" onClick={() => setStatus(j, 'completed')}>✓ Complete job</button>
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
