'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Estimate } from '@/lib/types';

export default function EstimateEditor({ estimate }: { estimate: Estimate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState({ description: '', details: '', quantity: '1', unit_price: '' });
  const [extras, setExtras] = useState({
    payment_instructions: estimate.payment_instructions ?? '',
    comments: estimate.comments ?? '',
  });

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.from('estimate_items').insert({
      estimate_id: estimate.id,
      description: item.description,
      details: item.details || null,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    });
    setItem({ description: '', details: '', quantity: '1', unit_price: '' });
    setBusy(false);
    router.refresh();
  }

  async function removeItem(id: string) {
    const supabase = createClient();
    await supabase.from('estimate_items').delete().eq('id', id);
    router.refresh();
  }

  async function saveExtras() {
    setBusy(true);
    const supabase = createClient();
    await supabase.from('estimates').update({
      payment_instructions: extras.payment_instructions || null,
      comments: extras.comments || null,
    }).eq('id', estimate.id);
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

  const editable = estimate.status === 'draft' || estimate.status === 'sent';

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

      {editable && (
        <>
          <form onSubmit={addItem} className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Add line item</p>
            <div className="grid gap-2 md:grid-cols-4">
              <input className="input md:col-span-2" placeholder="Item name * (e.g. MEDICAL CHAIR REMOVAL)" required value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
              <input className="input" type="number" step="0.01" min="0" placeholder="Qty" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
              <div className="flex gap-2">
                <input className="input" type="number" step="0.01" min="0" placeholder="Price *" required value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} />
                <button className="btn-primary" disabled={busy}>+</button>
              </div>
            </div>
            <input className="input" placeholder="Details shown under the item (e.g. 1 item, first floor — loaded, hauled, disposed at licensed facility)" value={item.details} onChange={(e) => setItem({ ...item, details: e.target.value })} />
            {estimate.estimate_items && estimate.estimate_items.length > 0 && (
              <div className="space-y-1 pt-1">
                {estimate.estimate_items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-xs text-gray-500">
                    <span>{it.description}</span>
                    <button type="button" className="text-red-400 hover:text-red-600" onClick={() => removeItem(it.id)}>remove</button>
                  </div>
                ))}
              </div>
            )}
          </form>

          <div className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Payment instructions &amp; comments</p>
            <input className="input" placeholder="Payment instructions (e.g. Venmo — sanchezjunknhaul)" value={extras.payment_instructions} onChange={(e) => setExtras({ ...extras, payment_instructions: e.target.value })} />
            <textarea className="input" rows={2} placeholder="Comments / terms (e.g. Additional items may be negotiated at pickup. Payment due on completion.)" value={extras.comments} onChange={(e) => setExtras({ ...extras, comments: e.target.value })} />
            <button className="btn-ghost" disabled={busy} onClick={saveExtras}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}
