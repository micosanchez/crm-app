'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/accounting/types';
import type { ArAging, CashFlow, TrialBalance } from '@/lib/accounting/financials';

type Tab = 'trial' | 'aging' | 'cash';

export default function Reports({
  trialBalance, aging, cashFlow, from, to,
}: {
  trialBalance: TrialBalance; aging: ArAging; cashFlow: CashFlow; from: string; to: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('trial');

  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, ...patch });
    router.push(`/accounting/reports?${p.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-md" style={{ border: '1px solid var(--border-subtle)' }}>
          {([['trial', 'Trial Balance'], ['aging', 'A/R Aging'], ['cash', 'Cash Flow']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 text-xs font-semibold"
              style={{ background: tab === k ? 'var(--brand-primary)' : 'var(--surface-primary)', color: tab === k ? '#fff' : 'var(--text-tertiary)' }}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'cash' && (
          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>From
              <input className="input ml-1 h-8 py-1" type="date" defaultValue={from} onChange={(e) => nav({ from: e.target.value })} />
            </label>
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>To
              <input className="input ml-1 h-8 py-1" type="date" defaultValue={to} onChange={(e) => nav({ to: e.target.value })} />
            </label>
          </div>
        )}
        {tab !== 'cash' && (
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>As of
            <input className="input ml-1 h-8 py-1" type="date" defaultValue={to} onChange={(e) => nav({ to: e.target.value })} />
          </label>
        )}
      </div>

      {tab === 'trial' && (
        <div className="card mx-auto max-w-2xl">
          <div className="mb-3 text-center"><h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Trial Balance</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>As of {to}</p></div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              <th className="py-1 text-left">Account</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th></tr></thead>
            <tbody>
              {trialBalance.lines.map((l) => (
                <tr key={l.number} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-1" style={{ color: 'var(--text-secondary)' }}><span className="metric text-[12px]" style={{ color: 'var(--metal-titanium)' }}>{l.number}</span> {l.name}</td>
                  <td className="py-1 text-right metric">{l.debit ? money(l.debit) : ''}</td>
                  <td className="py-1 text-right metric">{l.credit ? money(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 font-bold" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
              <td className="py-1">Total</td>
              <td className="py-1 text-right metric">{money(trialBalance.totalDebit)}</td>
              <td className="py-1 text-right metric">{money(trialBalance.totalCredit)}</td></tr></tfoot>
          </table>
          <p className="mt-2 text-xs" style={{ color: trialBalance.balanced ? 'var(--status-success)' : 'var(--status-danger)' }}>
            {trialBalance.balanced ? 'In balance ✓' : `Out of balance by ${money(trialBalance.totalDebit - trialBalance.totalCredit)}`}
          </p>
        </div>
      )}

      {tab === 'aging' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg sm:grid-cols-4" style={{ background: 'var(--border-subtle)' }}>
            {aging.buckets.map((b) => (
              <div key={b.label} className="bg-surface px-4 py-3">
                <p className="panel-label">{b.label}</p>
                <p className="metric mt-1 text-[18px] font-bold" style={{ color: b.label.startsWith('90') && b.total > 0 ? 'var(--status-danger)' : 'var(--text-primary)' }}>{money(b.total)}</p>
              </div>
            ))}
          </div>
          <div className="card p-0">
            <div className="flex items-center justify-between px-4 pt-3">
              <p className="panel-label">Outstanding invoices · as of {to}</p>
              <p className="panel-label" style={{ color: 'var(--brand-text)' }}>{money(aging.total)}</p>
            </div>
            <div className="mt-2 divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {aging.invoices.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="min-w-0"><p className="truncate" style={{ color: 'var(--text-primary)' }}>#{i.invoice_number} · {i.customer}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{i.issued} · {i.days} days · {i.bucket}</p></div>
                  <span className="metric" style={{ color: i.days > 90 ? 'var(--status-danger)' : 'var(--text-secondary)' }}>{money(i.outstanding)}</span>
                </div>
              ))}
              {!aging.invoices.length && <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>No outstanding invoices. 🎉</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'cash' && (
        <div className="card mx-auto max-w-2xl">
          <div className="mb-3 text-center"><h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Cash Flow</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{from} to {to}</p></div>
          <div className="flex items-center justify-between border-b py-1.5 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Opening cash</span><span className="metric">{money(cashFlow.openingCash)}</span>
          </div>
          <CashSection title="Cash in" lines={cashFlow.inflows} total={cashFlow.totalIn} tone="var(--status-success)" />
          <CashSection title="Cash out" lines={cashFlow.outflows} total={cashFlow.totalOut} tone="var(--status-danger)" />
          <div className="mt-2 flex items-center justify-between border-t py-1.5 text-sm font-semibold" style={{ borderColor: 'var(--border-standard)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Net change</span>
            <span className="metric" style={{ color: cashFlow.net >= 0 ? 'var(--brand-text)' : 'var(--status-danger)' }}>{money(cashFlow.net)}</span>
          </div>
          <div className="flex items-center justify-between border-t-2 py-2 text-sm font-bold" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
            <span>Closing cash</span><span className="metric">{money(cashFlow.closingCash)}</span>
          </div>
          {!cashFlow.ties && <p className="mt-1 text-xs" style={{ color: 'var(--status-warning)' }}>Note: opening + net ≠ closing — likely a mis-dated entry in range.</p>}
        </div>
      )}
    </div>
  );
}

function CashSection({ title, lines, total, tone }: { title: string; lines: { name: string; amount: number }[]; total: number; tone: string }) {
  return (
    <div className="mt-2">
      <p className="panel-label mb-1">{title}</p>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between py-1 text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>{l.name}</span>
            <span className="metric" style={{ color: 'var(--text-primary)' }}>{money(l.amount)}</span>
          </div>
        ))}
        {!lines.length && <p className="py-1 text-sm" style={{ color: 'var(--text-muted)' }}>None in range.</p>}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-1 text-sm font-semibold" style={{ borderColor: 'var(--border-standard)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total {title.toLowerCase()}</span>
        <span className="metric" style={{ color: tone }}>{money(total)}</span>
      </div>
    </div>
  );
}
