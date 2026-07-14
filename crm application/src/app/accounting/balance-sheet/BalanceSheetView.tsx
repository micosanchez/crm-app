'use client';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/accounting/types';
import { balanceSheetCsv, type BalanceSheet, type StatementGroup } from '@/lib/accounting/financials';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function BalanceSheetView({ sheet, asOf }: { sheet: BalanceSheet; asOf: string }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>As of
          <input className="input ml-1 h-8 py-1" type="date" defaultValue={asOf} onChange={(e) => router.push(`/accounting/balance-sheet?asOf=${e.target.value}`)} />
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => download(`balance-sheet-${asOf}.csv`, balanceSheetCsv(sheet))}>Export CSV</button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      {!sheet.balanced && (
        <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: '#fdecee', border: '1px solid var(--status-danger)', color: 'var(--status-danger)' }}>
          ⚠ Balance sheet does not tie out. Assets − (Liabilities + Equity) = {money(sheet.difference)}. Check for an
          unbalanced or mis-dated journal entry.
        </div>
      )}

      <div className="card mx-auto max-w-2xl">
        <div className="mb-4 text-center">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Balance Sheet</h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>As of {asOf}</p>
        </div>

        <Group group={sheet.assets} strong />
        <Group group={sheet.liabilities} />
        <Group group={sheet.equity} />

        <div className="mt-3 flex items-center justify-between border-t-2 pt-3" style={{ borderColor: 'var(--border-strong)' }}>
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Total Liabilities + Equity</span>
          <span className="metric text-base font-bold" style={{ color: 'var(--text-primary)' }}>{money(sheet.totalLiabilitiesEquity)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs" style={{ color: sheet.balanced ? 'var(--status-success)' : 'var(--status-danger)' }}>
          <span>Assets = Liabilities + Equity</span>
          <span className="font-semibold">{sheet.balanced ? 'In balance ✓' : `Off by ${money(sheet.difference)}`}</span>
        </div>
      </div>
    </div>
  );
}

function Group({ group, strong }: { group: StatementGroup; strong?: boolean }) {
  return (
    <div className="mb-3">
      <p className="panel-label mb-1">{group.label}</p>
      <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
        {group.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between py-1 text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>{l.label}</span>
            <span className="metric" style={{ color: 'var(--text-primary)' }}>{money(l.amount)}</span>
          </div>
        ))}
        {!group.lines.length && <p className="py-1 text-sm" style={{ color: 'var(--text-muted)' }}>None.</p>}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-1 text-sm font-semibold" style={{ borderColor: strong ? 'var(--border-strong)' : 'var(--border-standard)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Total {group.label}</span>
        <span className="metric" style={{ color: 'var(--text-primary)' }}>{money(group.total)}</span>
      </div>
    </div>
  );
}
