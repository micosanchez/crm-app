'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Estimate } from '@/lib/types';

export default function EstimateEditor({ estimate }: { estimate: Estimate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState({ description: '', quantity: '1', unit_price: '' });

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.from('estimate_items').insert({
      estimate_id: estimate.id,
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    });
    setItem({ description: '', quantity: '1', unit_price: '' });
    setBusy(false);
    router.refresh();
  }

  async function setStatus(status: 'sent' | 'accepted' | 'declined') {
    setBusy(true);
    const supabase = createClient();
    const patch: Record<string, unknown> = { status };
    if (status === 'accepted') patch.accepted_at = new Date().toISOString();
    if (status === 'declined') patch.declined_at = new Date().toISOString();
    await supabase.from('estimates').update(patch).eq('id', estimate.id);

    if (status === 'accepted' && !estimate.job_id && estimate.customer_id) {
      // Convert to a scheduled-ready job carrying the estimate value
      const { data: job } = await supabase.from('jobs').insert({
        customer_id: estimate.customer_id,
        title: `Estimate #${estimate.estimate_number} job`,
        status: 'lead',
        estimated_value: estimate.total,
      }).select().single();
      if (job) await supabase.from('estimates').update({ job_id: job.id }).eq('id', estimate.id);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="no-print space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.print()}>⬇ Export PDF</button>
        {estimate.public_token && (
          <button className="btn-ghost" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/sign/estimate/${estimate.public_token}`);
            alert('Customer link copied! Text or email it — they can view and sign without logging in.');
          }}>🔗 Copy customer link</button>
        )}
        {estimate.viewed_at ? (
          <span className="badge self-center bg-blue-50 text-blue-700">
            👁 Viewed {estimate.view_count && estimate.view_count > 1 ? `${estimate.view_count}× — first ` : ''}{new Date(estimate.viewed_at).toLocaleString()}
          </span>
        ) : (
          <span className="badge self-center bg-gray-100 text-gray-500">Not viewed yet</span>
        )}
        {estimate.signed_at && <span className="badge self-center bg-brand-50 text-brand-700">✓ Signed by {estimate.signed_name}</span>}
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
      </div>

      {(estimate.status === 'draft' || estimate.status === 'sent') && (
        <form onSubmit={addItem} className="card grid gap-2 md:grid-cols-4">
          <input className="input md:col-span-2" placeholder="Line item description *" required value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
          <input className="input" type="number" step="0.01" min="0" placeholder="Qty" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
          <div className="flex gap-2">
            <input className="input" type="number" step="0.01" min="0" placeholder="Price *" required value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} />
            <button className="btn-primary" disabled={busy}>+</button>
          </div>
        </form>
      )}
    </div>
  );
}
