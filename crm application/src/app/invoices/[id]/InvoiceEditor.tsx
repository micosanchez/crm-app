'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutate } from '@/lib/offline/sync';
import PaymentPanel from './PaymentPanel';
import type { Invoice, InvoiceItem, PaymentMethod } from '@/lib/types';

const METHODS: PaymentMethod[] = ['cash', 'venmo', 'card', 'check', 'other'];

function toDateInput(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

/**
 * Invoice editing surface — present on EVERY invoice, whatever its status.
 * No record is permanently frozen: line items, tip, dates, payment method,
 * and status (including paid → sent) are all correctable in place. Raising a
 * paid invoice's total reopens it with the balance owing (DB trigger);
 * lowering it below what was collected surfaces the overpayment.
 */
export default function InvoiceEditor({ invoice, canEdit = true }: { invoice: Invoice; canEdit?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState({ kind: 'labor', description: '', details: '', quantity: '1', unit_price: '' });
  const [tip, setTip] = useState(invoice.tip != null ? String(invoice.tip) : '0');
  const [method, setMethod] = useState<PaymentMethod>(invoice.payment_method ?? 'venmo');
  const [editOpen, setEditOpen] = useState(false);
  const [editItems, setEditItems] = useState<Record<string, { description: string; details: string; quantity: string; unit_price: string }>>({});
  const [dates, setDates] = useState({
    issued_at: toDateInput(invoice.issued_at),
    due_at: toDateInput(invoice.due_at),
    paid_at: toDateInput(invoice.paid_at),
  });
  const [voidReason, setVoidReason] = useState('');
  const [extras, setExtras] = useState({
    payment_instructions: invoice.payment_instructions ?? '',
    comments: invoice.comments ?? '',
  });

  const overpaid = Number(invoice.amount_paid ?? 0) - Number(invoice.total);
  const isVoid = !!invoice.voided_at;

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

  function beginEditItem(it: InvoiceItem) {
    setEditItems((m) => ({
      ...m,
      [it.id]: { description: it.description, details: it.details ?? '', quantity: String(it.quantity), unit_price: String(it.unit_price) },
    }));
  }

  async function saveItem(id: string) {
    const f = editItems[id];
    if (!f) return;
    await run(
      () => mutate({
        table: 'invoice_items', op: 'update', id, label: 'invoice item',
        payload: { description: f.description, details: f.details || null, quantity: Number(f.quantity) || 1, unit_price: Number(f.unit_price) || 0 },
      }),
      () => setEditItems((m) => { const n = { ...m }; delete n[id]; return n; })
    );
  }

  async function deleteItem(id: string) {
    if (!confirm('Remove this line item? The invoice total recalculates.')) return;
    await run(() => mutate({ table: 'invoice_items', op: 'delete', id, label: 'invoice item' }));
  }

  async function saveTip() {
    await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'tip', payload: { tip: Number(tip) || 0 } }));
  }

  async function saveDates() {
    await run(() => mutate({
      table: 'invoices', op: 'update', id: invoice.id, label: 'invoice dates',
      payload: {
        issued_at: dates.issued_at ? new Date(dates.issued_at + 'T12:00:00').toISOString() : null,
        due_at: dates.due_at ? new Date(dates.due_at + 'T12:00:00').toISOString() : null,
        paid_at: dates.paid_at ? new Date(dates.paid_at + 'T12:00:00').toISOString() : null,
      },
    }));
  }

  async function saveMethod(m: PaymentMethod) {
    setMethod(m);
    await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'payment method', payload: { payment_method: m } }));
  }

  async function saveExtras() {
    await run(() => mutate({
      table: 'invoices', op: 'update', id: invoice.id, label: 'invoice',
      payload: { payment_instructions: extras.payment_instructions || null, comments: extras.comments || null },
    }));
  }

  async function setStatus(status: 'draft' | 'sent' | 'paid') {
    const patch: Record<string, unknown> = { status };
    if (status === 'sent' && !invoice.issued_at) patch.issued_at = new Date().toISOString();
    // Mark paid = paid in full: settle amount_paid so the balance-due panel agrees with the "paid" badge.
    if (status === 'paid') { patch.paid_at = new Date().toISOString(); patch.payment_method = method; patch.amount_paid = Number(invoice.total); }
    if (status !== 'paid' && invoice.status === 'paid') patch.paid_at = null;
    const ok = await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'invoice', payload: patch }));
    if (ok && invoice.job_id) {
      if (status === 'paid') await mutate({ table: 'jobs', op: 'update', id: invoice.job_id, label: 'job', payload: { status: 'paid' } });
      if (status !== 'paid' && invoice.status === 'paid') await mutate({ table: 'jobs', op: 'update', id: invoice.job_id, label: 'job', payload: { status: 'invoiced' } });
      router.refresh();
    }
  }

  async function voidInvoice() {
    const reason = voidReason.trim();
    if (!reason) { setError('Give a short reason for the void — it goes on the record.'); return; }
    if (!confirm(`Void invoice #${invoice.invoice_number}? It stays visible but drops out of every revenue number.`)) return;
    await run(() => mutate({
      table: 'invoices', op: 'update', id: invoice.id, label: 'invoice',
      payload: { voided_at: new Date().toISOString(), void_reason: reason },
    }));
  }

  async function unvoid() {
    await run(() => mutate({ table: 'invoices', op: 'update', id: invoice.id, label: 'invoice', payload: { voided_at: null, void_reason: null } }));
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
      {isVoid && (
        <div className="rounded-lg border border-gray-300 bg-gray-100 p-3 text-sm">
          <b>VOID</b> — {invoice.void_reason ?? 'no reason recorded'} · excluded from all revenue totals.
          <button className="btn-ghost ml-3" disabled={busy} onClick={unvoid}>Restore into the books</button>
        </div>
      )}
      {overpaid > 0.005 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <b>Overpaid by ${overpaid.toFixed(2)}</b> — the customer paid more than the current total.
          Refund it, or fold it into the tip so the books balance.
        </div>
      )}

      <PaymentPanel invoice={invoice} />

      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.print()}>Export PDF</button>
        {invoice.public_token && (
          <button className="btn-ghost" onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/sign/invoice/${invoice.public_token}`);
            alert('Customer link copied! Text or email it — they can view and sign without logging in.');
          }}>Copy customer link</button>
        )}
        <button className="btn-ghost" onClick={() => setEditOpen(!editOpen)}>{editOpen ? 'Close editor' : 'Edit invoice'}</button>
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

      {invoice.status === 'sent' && !isVoid && (
        <div className="card flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Mark paid via</span>
          <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn-primary" disabled={busy} onClick={() => setStatus('paid')}>Mark paid</button>
          <span className="text-xs text-gray-400">Cash too — just pick cash so the books know.</span>
        </div>
      )}

      {/* Tip — recordable at ANY status, paid included; the total follows automatically. */}
      <div className="card flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Tip</span>
        <input className="input w-28" type="number" step="0.01" min="0" value={tip} onChange={(e) => setTip(e.target.value)} />
        <button className="btn-ghost" disabled={busy} onClick={saveTip}>Save tip</button>
        <span className="text-xs text-gray-400">
          Shows as its own line on the invoice.{invoice.status === 'paid' ? ' Adding a tip to a paid invoice reopens the balance until you record the extra money.' : ''}
        </span>
      </div>

      {editOpen && (
        <div className="space-y-4">
          {/* Line items — editable at any status */}
          <div className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Line items</p>
            {(invoice.invoice_items ?? []).map((it) => {
              const f = editItems[it.id];
              return f ? (
                <div key={it.id} className="grid gap-2 rounded-lg border border-brand-200 p-2 md:grid-cols-5">
                  <input className="input md:col-span-2" value={f.description} onChange={(e) => setEditItems((m) => ({ ...m, [it.id]: { ...f, description: e.target.value } }))} />
                  <input className="input" type="number" step="0.01" value={f.quantity} onChange={(e) => setEditItems((m) => ({ ...m, [it.id]: { ...f, quantity: e.target.value } }))} />
                  <input className="input" type="number" step="0.01" value={f.unit_price} onChange={(e) => setEditItems((m) => ({ ...m, [it.id]: { ...f, unit_price: e.target.value } }))} />
                  <div className="flex gap-2">
                    <button className="btn-primary" disabled={busy} onClick={() => saveItem(it.id)}>Save</button>
                    <button className="btn-ghost" onClick={() => setEditItems((m) => { const n = { ...m }; delete n[it.id]; return n; })}>✕</button>
                  </div>
                  <input className="input md:col-span-5" placeholder="Details under the item" value={f.details} onChange={(e) => setEditItems((m) => ({ ...m, [it.id]: { ...f, details: e.target.value } }))} />
                </div>
              ) : (
                <div key={it.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{it.description} — {Number(it.quantity)} × ${Number(it.unit_price).toFixed(2)}</span>
                  <span className="flex shrink-0 gap-2">
                    <button className="btn-ghost" onClick={() => beginEditItem(it)}>Edit</button>
                    <button className="btn-ghost" style={{ color: 'var(--status-danger)' }} onClick={() => deleteItem(it.id)}>Delete</button>
                  </span>
                </div>
              );
            })}
            <form onSubmit={addItem} className="grid gap-2 md:grid-cols-5">
              <select className="input" value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>
                <option value="labor">Labor</option>
                <option value="disposal">Disposal</option>
                <option value="materials">Materials</option>
                <option value="other">Other</option>
              </select>
              <input className="input md:col-span-2" placeholder="Add item — name *" required value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
              <input className="input" type="number" step="0.01" min="0" placeholder="Qty" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
              <div className="flex gap-2">
                <input className="input" type="number" step="0.01" min="0" placeholder="Price *" required value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} />
                <button className="btn-primary" disabled={busy}>+</button>
              </div>
            </form>
            {invoice.status === 'paid' && (
              <p className="text-xs text-gray-400">This invoice is paid — changing its total above what was collected reopens it with the balance owing. Below what was collected flags it overpaid.</p>
            )}
          </div>

          {/* Dates + payment method */}
          <div className="card grid gap-3 md:grid-cols-4">
            <div>
              <label className="panel-label mb-1 block">Issued</label>
              <input className="input" type="date" value={dates.issued_at} onChange={(e) => setDates({ ...dates, issued_at: e.target.value })} />
            </div>
            <div>
              <label className="panel-label mb-1 block">Due</label>
              <input className="input" type="date" value={dates.due_at} onChange={(e) => setDates({ ...dates, due_at: e.target.value })} />
            </div>
            <div>
              <label className="panel-label mb-1 block">Paid on</label>
              <input className="input" type="date" value={dates.paid_at} onChange={(e) => setDates({ ...dates, paid_at: e.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn-ghost" disabled={busy} onClick={saveDates}>Save dates</button>
            </div>
            <div className="md:col-span-2">
              <label className="panel-label mb-1 block">Payment method</label>
              <select className="input" value={method} onChange={(e) => saveMethod(e.target.value as PaymentMethod)}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Status corrections */}
          <div className="card flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Status</span>
            {invoice.status === 'paid' && (
              <button className="btn-ghost" disabled={busy}
                onClick={() => confirm('Revert this invoice to unpaid? Its payments stay on record; the balance reopens and the job drops back to invoiced.') && setStatus('sent')}>
                Revert to sent (unpaid)
              </button>
            )}
            {invoice.status === 'sent' && (
              <button className="btn-ghost" disabled={busy} onClick={() => setStatus('draft')}>Back to draft</button>
            )}
            {!isVoid && (
              <span className="flex items-center gap-2">
                <input className="input w-56" placeholder="Void reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                <button className="btn-ghost" style={{ color: 'var(--status-danger)' }} disabled={busy} onClick={voidInvoice}>Void invoice</button>
              </span>
            )}
          </div>

          <div className="card space-y-2">
            <p className="text-xs font-bold uppercase text-gray-400">Payment instructions &amp; comments</p>
            <input className="input" placeholder="Payment instructions (e.g. Venmo — sanchezjunknhaul)" value={extras.payment_instructions} onChange={(e) => setExtras({ ...extras, payment_instructions: e.target.value })} />
            <textarea className="input" rows={2} placeholder="Comments / terms" value={extras.comments} onChange={(e) => setExtras({ ...extras, comments: e.target.value })} />
            <button className="btn-ghost" disabled={busy} onClick={saveExtras}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
