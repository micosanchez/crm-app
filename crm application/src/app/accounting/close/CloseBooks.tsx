'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, type Period, type Reconciliation } from '@/lib/accounting/types';
import { closePeriod, reopenPeriod } from '../actions';

const monthLabel = (m: string) => new Date(m + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

export default function CloseBooks({
  month, monthEnd, periods, reconciliation, unmatchedCount, netIncome, revenue, expense,
}: {
  month: string; monthEnd: string; periods: Period[]; reconciliation: Reconciliation | null;
  unmatchedCount: number; netIncome: number; revenue: number; expense: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const closed = periods.find((p) => p.period_month.slice(0, 7) === month.slice(0, 7))?.status === 'closed';
  const reconciled = reconciliation?.status === 'reconciled';
  const canCloseClean = reconciled && unmatchedCount === 0;

  const check = (ok: boolean, label: string, detail: string) => (
    <div className="flex items-start gap-2 py-1.5">
      <span style={{ color: ok ? 'var(--status-success)' : 'var(--status-warning)' }}>{ok ? '✓' : '⚠'}</span>
      <div>
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</p>
      </div>
    </div>
  );

  async function doClose() {
    if (!canCloseClean && !note.trim()) { alert('This month is not fully reconciled. Add an override note to close anyway.'); return; }
    if (!confirm(`Close ${monthLabel(month)}? Entries in this month will be locked and net income rolled into Retained Earnings.`)) return;
    setBusy(true);
    const res = await closePeriod(month, !canCloseClean, note);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  async function doReopen(m: string) {
    if (!confirm(`Reopen ${monthLabel(m)}? The closing entry will be reversed so you can edit the period.`)) return;
    setBusy(true);
    const res = await reopenPeriod(m);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <p className="panel-label">Close month</p>
          <input className="input h-8 w-40 py-1" type="month" defaultValue={month.slice(0, 7)}
            onChange={(e) => router.push(`/accounting/close?month=${e.target.value}-01`)} />
        </div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{monthLabel(month)}</h2>

        <div className="rounded-lg p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-subtle)' }}>
          <p className="panel-label mb-1">Pre-close checklist</p>
          {check(reconciled, 'Bank reconciliation complete', reconciliation ? `Statement diff ${money(reconciliation.difference)}${reconciliation.override ? ' (overridden)' : ''}` : 'No reconciliation saved for this month')}
          {check(unmatchedCount === 0, 'No uncleared bank items', `${unmatchedCount} unmatched bank transaction(s) in ${monthLabel(month)}`)}
          {check(true, 'Entries balanced', 'Double-entry integrity enforced at the database')}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'var(--text-secondary)' }}>Revenue {money(revenue)} − Expenses {money(expense)}</span>
          <span className="metric font-semibold" style={{ color: netIncome >= 0 ? 'var(--brand-text)' : 'var(--status-danger)' }}>Net {money(netIncome)}</span>
        </div>

        {closed ? (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            This month is <b>closed</b>. Net income was rolled into Retained Earnings and entries are locked.
            <button className="mt-2 block rounded-md px-3 py-1.5 text-xs font-semibold" style={{ border: '1px solid var(--border-standard)', color: 'var(--brand-text)' }} onClick={() => doReopen(month)} disabled={busy}>Reopen to fix errors</button>
          </div>
        ) : (
          <>
            {!canCloseClean && (
              <input className="input" placeholder="Override note (required to close unreconciled)" value={note} onChange={(e) => setNote(e.target.value)} />
            )}
            <button className="btn-primary w-full" onClick={doClose} disabled={busy}>{busy ? 'Closing…' : `Close ${monthLabel(month)}`}</button>
          </>
        )}
      </div>

      <div className="card p-0">
        <p className="panel-label px-4 pt-3">Period history</p>
        <div className="mt-2 divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {periods.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>{monthLabel(p.period_month)}</span>
              <div className="flex items-center gap-2">
                <span className="badge" style={{ color: p.status === 'closed' ? 'var(--status-success)' : 'var(--text-muted)' }}>{p.status}</span>
                {p.status === 'closed' && <button className="text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => doReopen(p.period_month)} disabled={busy}>reopen</button>}
              </div>
            </div>
          ))}
          {!periods.length && <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>No periods yet.</p>}
        </div>
      </div>
    </div>
  );
}
