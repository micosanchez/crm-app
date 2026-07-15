'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { mutate } from '@/lib/offline/sync';
import { EXPENSE_CATEGORIES, PAID_WITH_OPTIONS, type Expense, type ExpenseCategory, type Job, type PaidWith } from '@/lib/types';

const EMPTY = {
  category: 'dump_fees' as ExpenseCategory, amount: '', incurred_on: new Date().toISOString().slice(0, 10),
  vendor: '', description: '', job_id: '', paid_with: 'bluevine' as PaidWith,
};

export default function ExpenseManager({ expenses, jobs }: { expenses: Expense[]; jobs: Pick<Job, 'id' | 'title'>[] }) {
  const router = useRouter();
  const receiptRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  async function viewReceipt(path: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { alert('Could not open receipt.'); return; }
    window.open(data.signedUrl, '_blank');
  }

  function startEdit(x: Expense) {
    setEditingId(x.id);
    setForm({
      category: x.category, amount: String(x.amount), incurred_on: x.incurred_on,
      vendor: x.vendor ?? '', description: x.description ?? '', job_id: x.job_id ?? '',
      paid_with: x.paid_with ?? 'bluevine',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    // Receipt photo → private documents bucket. Needs connectivity; if a file
    // is attached while offline, tell the user rather than dropping it.
    let receiptPath: string | undefined;
    const file = receiptRef.current?.files?.[0];
    if (file) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setBusy(false);
        alert('Receipt photos need a connection. Reconnect, or save the expense without the photo for now.');
        return;
      }
      const supabase = createClient();
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `receipts/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
      if (upErr) { setBusy(false); alert(`Receipt upload failed: ${upErr.message}`); return; }
      receiptPath = path;
    }

    const payload: Record<string, unknown> = {
      category: form.category,
      amount: Number(form.amount),
      incurred_on: form.incurred_on,
      vendor: form.vendor || null,
      description: form.description || null,
      job_id: form.job_id || null,
      paid_with: form.paid_with,
    };
    if (receiptPath) payload.receipt_url = receiptPath;

    const res = editingId
      ? await mutate({ table: 'expenses', op: 'update', id: editingId, label: 'expense', payload })
      : await mutate({ table: 'expenses', op: 'insert', label: 'expense', payload });
    setBusy(false);
    if (res.status === 'failed') { alert(`Couldn't save expense: ${res.error}`); return; }

    setEditingId(null);
    setForm(EMPTY);
    if (receiptRef.current) receiptRef.current.value = '';
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm('Delete this expense? (It stays in the audit log.)')) return;
    setBusy(true);
    const res = await mutate({ table: 'expenses', op: 'delete', id, label: 'expense' });
    setBusy(false);
    if (res.status === 'failed') { alert(`Couldn't delete expense: ${res.error}`); return; }
    if (editingId === id) { setEditingId(null); setForm(EMPTY); }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className={`card grid gap-3 md:grid-cols-6 ${editingId ? 'ring-2 ring-brand-500' : ''}`}>
        {editingId && (
          <p className="md:col-span-6 -mb-1 text-xs font-semibold text-brand-700">
            Editing expense — <button type="button" className="underline" onClick={() => { setEditingId(null); setForm(EMPTY); }}>cancel</button>
          </p>
        )}
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        <input className="input" type="number" step="0.01" min="0.01" placeholder="Amount $ *" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input className="input" type="date" value={form.incurred_on} onChange={(e) => setForm({ ...form, incurred_on: e.target.value })} />
        <input className="input" placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        <select className="input" value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })}>
          <option value="">No job (overhead)</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        <select className="input" title="Paid with" value={form.paid_with} onChange={(e) => setForm({ ...form, paid_with: e.target.value as PaidWith })}>
          {PAID_WITH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="btn-primary" disabled={busy}>{busy ? '…' : editingId ? 'Save changes' : '+ Add'}</button>
        <input className="input md:col-span-4" placeholder="Description / notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="md:col-span-2">
          <label className="panel-label mb-1 block">Receipt photo</label>
          <input ref={receiptRef} type="file" accept="image/*,.pdf" capture="environment" className="input" />
        </div>
      </form>

      <div className="card divide-y divide-gray-100 p-0">
        {expenses.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium capitalize">{x.category.replace(/_/g, ' ')}{x.vendor && <span className="font-normal text-gray-500"> · {x.vendor}</span>}</p>
              <p className="truncate text-xs text-gray-500">{x.incurred_on}{x.jobs?.title && ` · ${x.jobs.title}`}{x.description && ` · ${x.description}`}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-semibold text-red-700">-${Number(x.amount).toFixed(2)}</span>
              {x.receipt_url && (
                <button className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => viewReceipt(x.receipt_url!)}>Receipt</button>
              )}
              <button className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100" onClick={() => startEdit(x)}>Edit</button>
              <button className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(x.id)}>Delete</button>
            </div>
          </div>
        ))}
        {!expenses.length && <p className="p-4 text-sm text-gray-500">No expenses logged yet.</p>}
      </div>
    </div>
  );
}
