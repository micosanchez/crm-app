'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Customer } from '@/lib/types';

export default function NewEstimateForm({ customers }: { customers: Pick<Customer, 'id' | 'name'>[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [notes, setNotes] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('estimates')
      .insert({ customer_id: customerId || null, notes: notes || null })
      .select()
      .single();
    setBusy(false);
    setOpen(false);
    if (data) router.push(`/estimates/${data.id}`);
    router.refresh();
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>+ New estimate</button>;

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-center gap-3">
      <select className="input max-w-xs" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">Select customer *</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input className="input max-w-sm" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button className="btn-primary" disabled={busy}>{busy ? '…' : 'Create'}</button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
