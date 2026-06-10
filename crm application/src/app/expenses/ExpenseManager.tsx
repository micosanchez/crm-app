'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type Job } from '@/lib/types';

export default function ExpenseManager({ expenses, jobs }: { expenses: Expense[]; jobs: Pick<Job, 'id' | 'title'>[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    category: 'dump_fees' as ExpenseCategory, amount: '', incurred_on: new Date().toISOString().slice(0, 10),
    vendor: '', description: '', job_id: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.from('expenses').insert({
      category: form.category,
      amount: Number(form.amount),
      incurred_on: form.incurred_on,
      vendor: form.vendor || null,
      description: form.description || null,
      job_id: form.job_id || null,
    });
    setBusy(false);
    setForm({ ...form, amount: '', vendor: '', description: '', job_id: '' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card grid gap-3 md:grid-cols-6">
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
        <button className="btn-primary" disabled={busy}>{busy ? '…' : '+ Add'}</button>
        <input className="input md:col-span-6" placeholder="Description / notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </form>

      <div className="card divide-y divide-gray-100 p-0">
        {expenses.map((x) => (
          <div key={x.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <div>
              <p className="font-medium capitalize">{x.category.replace(/_/g, ' ')}{x.vendor && <span className="font-normal text-gray-500"> · {x.vendor}</span>}</p>
              <p className="text-xs text-gray-500">{x.incurred_on}{x.jobs?.title && ` · ${x.jobs.title}`}{x.description && ` · ${x.description}`}</p>
            </div>
            <span className="font-semibold text-red-700">-${Number(x.amount).toFixed(2)}</span>
          </div>
        ))}
        {!expenses.length && <p className="p-4 text-sm text-gray-500">No expenses logged yet.</p>}
      </div>
    </div>
  );
}
