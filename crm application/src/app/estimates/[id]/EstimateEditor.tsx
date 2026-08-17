'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { mutate } from '@/lib/offline/sync';
import DeleteRecordButton from '@/components/DeleteRecordButton';
import type { Estimate } from '@/lib/types';

/* Status + actions bar for a quote. All FIELD editing now lives in QuoteComposer;
   this only drives the lifecycle: copy link, mark sent, accept → job, decline. */
export default function EstimateEditor({ estimate }: { estimate: Estimate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = !!estimate.valid_until && estimate.valid_until < new Date().toISOString().slice(0, 10) && estimate.status !== 'accepted';

  async function setStatus(status: 'sent' | 'accepted' | 'declined') {
    setBusy(true);
    setError(null);
    const patch: Record<string, unknown> = { status };
    if (status === 'accepted') patch.accepted_at = new Date().toISOString();
    if (status === 'declined') patch.declined_at = new Date().toISOString();

    // Accepting spawns a job and links it back — multi-step, needs connectivity.
    if (status === 'accepted' && !estimate.job_id && estimate.customer_id) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setBusy(false);
        setError('Accepting an estimate creates a job — you need to be online for this step.');
        return;
      }
      const supabase = createClient();
      const { error: upErr } = await supabase.from('estimates').update(patch).eq('id', estimate.id);
      if (upErr) { setBusy(false); setError(upErr.message); return; }
      const { data: job, error: jobErr } = await supabase.from('jobs').insert({
        customer_id: estimate.customer_id,
        title: `Estimate #${estimate.estimate_number} job`,
        status: 'lead',
        estimated_value: estimate.total,
      }).select().single();
      if (jobErr) { setBusy(false); setError(`Estimate accepted, but job creation failed: ${jobErr.message}`); return; }
      if (job) await supabase.from('estimates').update({ job_id: job.id }).eq('id', estimate.id);
      setBusy(false);
      router.refresh();
      return;
    }

    const res = await mutate({ table: 'estimates', op: 'update', id: estimate.id, label: 'estimate', payload: patch });
    setBusy(false);
    if (res.status === 'failed') { setError(res.error); return; }
    router.refresh();
  }

  return (
    <div className="no-print space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
        {estimate.public_token && (
          <button className="btn-ghost" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/sign/estimate/${estimate.public_token}`);
            alert('Customer link copied! Text or email it — they can view and sign without logging in.');
          }}>Copy customer link</button>
        )}
        {estimate.viewed_at ? (
          <span className="badge self-center bg-blue-50 text-blue-700">
            Viewed {estimate.view_count && estimate.view_count > 1 ? `${estimate.view_count}× — first ` : ''}{new Date(estimate.viewed_at).toLocaleString()}
          </span>
        ) : (
          <span className="badge self-center bg-gray-100 text-gray-500">Not viewed yet</span>
        )}
        {estimate.signed_at && <span className="badge self-center bg-brand-50 text-brand-700">✓ Signed by {estimate.signed_name}</span>}
        {expired && <span className="badge self-center bg-red-50 text-red-700">Expired {new Date(estimate.valid_until! + 'T12:00:00').toLocaleDateString()}</span>}
        {estimate.status === 'draft' && <button className="btn-primary" disabled={busy} onClick={() => setStatus('sent')}>Mark sent</button>}
        {estimate.status === 'sent' && (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => setStatus('accepted')}>Accept → create job</button>
            <button className="btn-ghost" disabled={busy} onClick={() => setStatus('declined')}>Declined</button>
          </>
        )}
        {estimate.status === 'accepted' && estimate.job_id && (
          <a className="btn-ghost" href={`/jobs/${estimate.job_id}`}>View job →</a>
        )}
        {(estimate.status === 'accepted' || estimate.status === 'declined' || estimate.status === 'expired') && (
          <>
            <button className="btn-ghost" disabled={busy} onClick={() => setStatus('sent')}>Reopen to edit</button>
            {estimate.status !== 'declined' && (
              <button className="btn-ghost" disabled={busy} onClick={() => setStatus('declined')}>Mark declined</button>
            )}
          </>
        )}
        {estimate.status !== 'accepted' && (
          <DeleteRecordButton table="estimates" id={estimate.id} redirectTo="/estimates" label="quote"
            confirmMessage="Delete this quote for good? This can’t be undone." />
        )}
      </div>
      {estimate.status === 'accepted' && (
        <p className="text-xs text-gray-400">Accepted quotes can’t be deleted — they’re tied to a job. Delete the job first if you need to remove it.</p>
      )}
      {(estimate.status === 'accepted' || estimate.status === 'declined' || estimate.status === 'expired') && (
        <p className="text-xs text-gray-400">Use "Reopen to edit" to put this quote back to sent so you can change it or accept it again, or "Mark declined" if the customer canceled. Reopening an accepted quote leaves its job in place - cancel that from the Jobs tab if you no longer need it.</p>
      )}
      {error && <p className="text-sm text-red-600">Couldn&apos;t save: {error}</p>}
    </div>
  );
}
