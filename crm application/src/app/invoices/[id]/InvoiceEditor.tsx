'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import type { Invoice, PaymentMethod } from '@/lib/types';

const METHODS: PaymentMethod[] = ['cash', 'venmo', 'card', 'check', 'other'];

export default function InvoiceEditor({ invoice, canEdit = true }: { invoice: Invoice; canEdit?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState({ kind: 'labor', description: '', details: '', quantity: '1', unit_price: '' });
  const [tip, setTip] = useState(invoice.tip != null ? String(invoice.tip) : '0');
  const [method, setMethod] = useState<PaymentMethod>(invoice.payment_method ?? 'venmo');
  const [extras, setExtras] = useState({
    payment_instructions: invoice.payment_instructions ?? '',
    comments: invoice.comments ?? '',
  });

  /** Run a queued mutation; surface the error and stop on failure. */
  async function run(fn: () => Promise<{ status: string; error?: string }>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.status === 'failed') { setError(res.error ?? 'Could not save'); return false; }
    after?.();
    router.refresh();
    return true;
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () => mutate({
        table: 'invoice_items', op: 'insert', label: 'invoice item',
        payload: {
          invoice_id: invoice.id,
          kind: item.kind,
          description: item.description,
          details: item.details || null,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        },
      }),
      () => setItem({ kind: 'labor', description: '', details: '', quantity: '1', unit_price: '' })
    );
  }

  async function saveTip() {
    await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'tip', payload: { tip: Number(tip) || 0 } }));
  }

  async function saveExtras() {
    await run(() => mutate({
      table: 'invoices', op: 'update', id: invoice.id, label: 'invoice',
      payload: { payment_instructions: extras.payment_instructions || null, comments: extras.comments || null },
    }));
  }

  async function setStatus(status: 'sent' | 'paid') {
    const patch: Record<string, unknown> = { status };
    if (status === 'sent') patch.issued_at = new Date().toISOString();
    if (status === 'paid') { patch.paid_at = new Date().toISOString(); patch.payment_method = method; }
    const ok = await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'invoice', payload: patch }));
    if (ok && status === 'paid') {
      await mutate({ table: 'jobs', op: 'update', id: invoice.job_id, label: 'job', payload: { status: 'paid' } });
      router.refresh();
    }
  }

  if (!canEdit) {
    return (
      <div className="no-print rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
        You have read-only access to invoices. Ask an admin or dispatcher to make changes.
      </div>
    );
  }

  return (
    <div className="no-print space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
        {invoice.public_token && (
          <button className="btn-ghost" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/sign/invoice/${invoice.public_token}`);
            alert('Customer link copied! Text or email it — they can view and sign without logging in.');
          }}>Copy customer link</button>
        )}
        {invoice.viewed_at ? (
          <span className="badge self-center bg-blue-50 text-blue-700">
            Viewed {invoice.view_count && invoice.view_count > 1 ? `${invoice.view_count}× — first ` : ''}{new Date(invoice.viewed_at).toLocaleString()}
          </span>
        ) : (
          <span className="badge self-center bg-gray-100 text-gray-500">Not viewed yet</span>
        )}
        {invoice.signed_at && <span className="badge self-center bg-brand-50 text-brand-700">✓ Signed by {invoice.signed_name}</span>}
        {invoice.status === 'draft' && <button className="btn-primary" disabled={busy} onClick={() => setStatus('sent')}>Mark sent</button>}
        {invoice.payment_method && <span className="badge self-center bg-emerald-50 capitalize text-emerald-700">paid via {invoice.payment_method}</span>}
      </div>

      {error && <p className="text-sm text-red-600">Couldn&apos;t save: {error}</p>}

      {invoice.status === 'sent' && (
        <div className="card flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Mark paid via</span>
          <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn-primary" disabled={busy} onClick={() => setStatus('paid')}>Mark paid</button>
          <span className="text-xs text-gray-400">Cash too — just pick cash so the books know.</span>
        </div>
      )}

      {invoice.status !== 'paid' && (
        <div className="card flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Tip</span>
          <input className="input w-28" type="number" step="0.01" min="0" value={tip} onChange={(e) => setTip(e.target.value)} />
          <button className="btn-ghost" disabled={busy} onClick={saveTip}>Save tip</button>
          <span className="text-xs text-gray-400">Customer paid extra? Log it here — it adds to the total and counts as revenue.</span>
        </div>
      )}

      {invoice.status === 'draft' && (
        <>
          <form onSubmit={addItem} className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Add line item</p>
            <div className="grid gap-2 md:grid-cols-5">
              <select className="input" value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>
                <option value="labor">Labor</option>
                <option value="disposal">Disposal</option>
                <option value="materials">Materials</option>
                <option value="other">Other</option>
              </select>
              <input className="input md:col-span-2" placeholder="Item name *" required value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
              <input className="input" type="number" step="0.01" min="0" placeholder="Qty" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
              <div className="flex gap-2">
                <input className="input" type="number" step="0.01" min="0" placeholder="Price *" required value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} />
                <button className="btn-primary" disabled={busy}>+</button>
              </div>
            </div>
            <input className="input" placeholder="Details shown under the item" value={item.details} onChange={(e) => setItem({ ...item, details: e.target.value })} />
          </form>

          <div className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Payment instructions &amp; comments</p>
            <input className="input" placeholder="Payment instructions (e.g. Venmo — sanchezjunknhaul)" value={extras.payment_instructions} onChange={(e) => setExtras({ ...extras, payment_instructions: e.target.value })} />
            <textarea className="input" rows={2} placeholder="Comments / terms" value={extras.comments} onChange={(e) => setExtras({ ...extras, comments: e.target.value })} />
            <button className="btn-ghost" disabled={busy} onClick={saveExtras}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}
