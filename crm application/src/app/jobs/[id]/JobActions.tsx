'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import DeleteRecordButton from '@/components/DeleteRecordButton';
import { JOB_PIPELINE, type Job, type JobStatus } from '@/lib/types';

export default function JobActions({ job, hasInvoice, isStaff = true }: { job: Job; hasInvoice: boolean; isStaff?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const idx = JOB_PIPELINE.indexOf(job.status);
  let next: JobStatus | undefined = job.status === 'cancelled' ? undefined : JOB_PIPELINE[idx + 1];
  // Technicians move a job through the field stages only — invoicing is back office.
  if (!isStaff && next && !['in_progress', 'completed'].includes(next)) next = undefined;

  async function advance() {
    if (!next) return;
    setBusy(true);
    if (next === 'invoiced' && !hasInvoice) {
      // Generate invoice server-side (requires connectivity; invoicing is a back-office step)
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id }),
      });
      if (!res.ok) alert('Could not generate invoice — are you online?');
    } else {
      const res = await mutate({ table: 'jobs', op: 'update', id: job.id, label: 'job', payload: { status: next } });
      if (res.status === 'failed') { setBusy(false); alert(`Couldn't update job: ${res.error}`); return; }
    }
    setBusy(false);
    router.refresh();
  }

  async function setStatus(status: JobStatus, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    const res = await mutate({ table: 'jobs', op: 'update', id: job.id, label: 'job', payload: { status } });
    setBusy(false);
    if (res.status === 'failed') { alert(`Couldn't update job: ${res.error}`); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {next && (
        <button className="btn-primary" onClick={advance} disabled={busy}>
          {busy ? 'Working…' : next === 'invoiced' && !hasInvoice ? 'Generate invoice' : `Mark ${next.replace('_', ' ')}`}
        </button>
      )}
      {/* Couldn't do the job (no access, customer bailed, etc.) — keep the record, drop it from the pipeline */}
      {isStaff && job.status !== 'cancelled' && job.status !== 'paid' && (
        <button
          className="btn-ghost"
          style={{ color: 'var(--status-danger)' }}
          disabled={busy}
          onClick={() => setStatus('cancelled', 'Cancel this job? It stays on the record but leaves the pipeline, field list, and revenue numbers.')}>
          Cancel job
        </button>
      )}
      {isStaff && job.status === 'cancelled' && (
        <button className="btn-ghost" disabled={busy} onClick={() => setStatus('scheduled')}>
          Reopen job
        </button>
      )}
      {isStaff && job.status === 'paid' && (
        <button className="btn-ghost" disabled={busy}
          onClick={() => setStatus('in_progress', 'Reopen this closed job for correction? Its invoice and payments stay as they are.')}>
          Reopen for correction
        </button>
      )}
      {isStaff && !hasInvoice && job.status !== 'paid' && (
        <DeleteRecordButton table="jobs" id={job.id} redirectTo="/jobs" label="job"
          confirmMessage="Delete this job for good? This can’t be undone. (To just drop it from the pipeline, use Cancel job instead.)"
          linkedHint="If it has an invoice, delete that first." />
      )}
    </div>
  );
}
