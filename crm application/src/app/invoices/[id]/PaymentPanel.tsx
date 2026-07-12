'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { flags } from '@/lib/flags';
import type { Invoice, PaymentMethod } from '@/lib/types';

const METHODS: PaymentMethod[] = ['cash', 'venmo', 'card', 'check', 'other'];

/**
 * Record deposits / partial payments and show balance due. Flagged behind
 * NEXT_PUBLIC_FF_PAYMENTS — returns null (zero production impact) until enabled
 * AND migration 0010 has run.
 */
export default function PaymentPanel({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('venmo');
  const [kind, setKind] = useState<'deposit' | 'payment'>('payment');

  if (!flags.payments) return null;

  const paid = Number(invoice.amount_paid ?? 0);
  const balance = Math.max(0, Number(invoice.total) - paid);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) { setError('Enter an amount.'); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from('payments').insert({
      invoice_id: invoice.id, amount: value, method, kind,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setAmount('');
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="panel-label">Balance due</p>
          <p className="metric text-2xl font-bold text-gray-900">${balance.toFixed(2)}</p>
        </div>
        <div className="text-right">
          <p className="panel-label">Paid</p>
          <p className="metric text-sm" style={{ color: 'var(--metal-titanium)' }}>${paid.toFixed(2)} of ${Number(invoice.total).toFixed(2)}</p>
        </div>
      </div>

      {balance > 0 && (
        <form onSubmit={record} className="flex flex-wrap items-end gap-2">
          <input className="input w-28" type="number" step="0.01" min="0" placeholder="Amount $" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'payment')}>
            <option value="payment">Payment</option>
            <option value="deposit">Deposit</option>
          </select>
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record'}</button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">Records cash, Venmo, or check. Fully paying the balance marks the invoice paid automatically.</p>
    </div>
  );
}
