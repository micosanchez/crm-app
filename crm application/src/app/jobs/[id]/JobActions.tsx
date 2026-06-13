'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import { JOB_PIPELINE, type Job, type JobStatus } from '@/lib/types';

export default function JobActions({ job, hasInvoice }: { job: Job; hasInvoice: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const idx = JOB_PIPELINE.indexOf(job.status);
  const next: JobStatus | undefined = JOB_PIPELINE[idx + 1];

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

  return (
    <div className="flex flex-wrap gap-2">
      {next && (
        <button className="btn-primary" onClick={advance} disabled={busy}>
          {busy ? 'Working…' : next === 'invoiced' && !hasInvoice ? 'Generate invoice' : `Mark ${next.replace('_', ' ')}`}
        </button>
      )}
    </div>
  );
}
