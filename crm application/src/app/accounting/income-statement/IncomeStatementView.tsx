'use client';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/accounting/types';
import { incomeStatementCsv, type IncomeStatement } from '@/lib/accounting/financials';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function IncomeStatementView({
  statement, from, to, basis,
}: {
  statement: IncomeStatement; from: string; to: string; basis: 'cash' | 'accrual';
}) {
  const router = useRouter();
  const nav = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, basis, ...patch });
    router.push(`/accounting/income-statement?${p.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>From
            <input className="input ml-1 h-8 py-1" type="date" defaultValue={from} onChange={(e) => nav({ from: e.target.value })} />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>To
            <input className="input ml-1 h-8 py-1" type="date" defaultValue={to} onChange={(e) => nav({ to: e.target.value })} />
          </label>
          <div className="flex overflow-hidden rounded-md" style={{ border: '1px solid var(--border-subtle)' }}>
            {(['cash', 'accrual'] as const).map((b) => (
              <button key={b} onClick={() => nav({ basis: b })} className="px-3 py-1.5 text-xs font-semibold capitalize"
                style={{ background: basis === b ? 'var(--brand-primary)' : 'var(--surface-primary)', color: basis === b ? '#fff' : 'var(--text-tertiary)' }}>
                {b}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => download(`income-statement-${from}_${to}.csv`, incomeStatementCsv(statement))}>Export CSV</button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className="card mx-auto max-w-2xl">
        <div className="mb-4 text-center">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Income Statement</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{from} to {to} · {basis} basis</p>
        </div>

        <Section title="Revenue" lines={statement.revenue.lines} total={statement.revenue.total} />
        <Section title="Expenses" lines={statement.expenses.lines} total={statement.expenses.total} />

        <div className="mt-3 flex items-center justify-between border-t-2 pt-3" style={{ borderColor: 'var(--border-strong)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Net Income</span>
          <span className="metric text-lg font-bold" style={{ color: statement.netIncome >= 0 ? 'var(--brand-text)' : 'var(--status-danger)' }}>
            {money(statement.netIncome)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, lines, total }: { title: string; lines: { label: string; amount: number }[]; total: number }) {
  return (
    <div className="mb-3">
      <p className="panel-label mb-1">{title}</p>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between py-1 text-sm">
            <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>{l.label}</span>
            <span className="metric" style={{ color: 'var(--text-primary)' }}>{money(l.amount)}</span>
          </div>
        ))}
        {!lines.length && <p className="py-1 text-sm" style={{ color: 'var(--text-muted)' }}>None in range.</p>}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-1 text-sm font-semibold" style={{ borderColor: 'var(--border-standard)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total {title}</span>
        <span className="metric" style={{ color: 'var(--text-primary)' }}>{money(total)}</span>
      </div>
    </div>
  );
}
