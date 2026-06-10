'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Invoice } from '@/lib/types';

/** Invoice management: add line items, advance status, export PDF (print). */
export default function InvoiceEditor({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState({ kind: 'labor', description: '', quantity: '1', unit_price: '' });

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.from('invoice_items').insert({
      invoice_id: invoice.id,
      kind: item.kind,
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    });
    setItem({ kind: 'labor', description: '', quantity: '1', unit_price: '' });
    setBusy(false);
    router.refresh();
  }

  async function setStatus(status: 'sent' | 'paid') {
    setBusy(true);
    const supabase = createClient();
    const patch: Record<string, unknown> = { status };
    if (status === 'sent') patch.issued_at = new Date().toISOString();
    if (status === 'paid') patch.paid_at = new Date().toISOString();
    await supabase.from('invoices').update(patch).eq('id', invoice.id);
    if (status === 'paid') await supabase.from('jobs').update({ status: 'paid' }).eq('id', invoice.job_id);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="no-print space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => window.print()}>⬇ Export PDF</button>
        {invoice.status === 'draft' && <button className="btn-primary" disabled={busy} onClick={() => setStatus('sent')}>Mark sent</button>}
        {invoice.status === 'sent' && <button className="btn-primary" disabled={busy} onClick={() => setStatus('paid')}>Mark paid</button>}
      </div>

      {invoice.status === 'draft' && (
        <form onSubmit={addItem} className="card grid gap-2 md:grid-cols-5">
          <select className="input" value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}>
            <option value="labor">Labor</option>
            <option value="disposal">Disposal</option>
            <option value="materials">Materials</option>
            <option value="other">Other</option>
          </select>
          <input className="input md:col-span-2" placeholder="Description *" required value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
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
