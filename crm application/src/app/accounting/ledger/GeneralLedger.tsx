'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, type Account, type JournalEntry } from '@/lib/accounting/types';
import { createJournalEntry, voidJournalEntry, repostJournalEntry } from '../actions';

type Acct = Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side'>;
type Line = { account_id: string; debit: string; credit: string; memo: string };

const blankLine = (): Line => ({ account_id: '', debit: '', credit: '', memo: '' });
const today = () => new Date().toISOString().slice(0, 10);

export default function GeneralLedger({ entries, accounts }: { entries: JournalEntry[]; accounts: Acct[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100 };
  }, [lines]);
  const balanced = totals.dr === totals.cr && totals.dr > 0;

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function startEdit(e: JournalEntry) {
    setEditingId(e.id);
    setDate(e.entry_date);
    setMemo(e.memo ?? '');
    setLines((e.journal_lines ?? []).sort((a, b) => a.line_no - b.line_no).map((l) => ({
      account_id: l.account_id, debit: Number(l.debit) ? String(l.debit) : '', credit: Number(l.credit) ? String(l.credit) : '', memo: l.memo ?? '',
    })));
    setOpen(true);
    setExpanded(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setOpen(false); setEditingId(null); setMemo(''); setLines([blankLine(), blankLine()]); setDate(today());
  }

  async function submit() {
    if (!balanced) return;
    setBusy(true);
    const payload = {
      entry_date: date, memo,
      lines: lines.filter((l) => l.account_id && (Number(l.debit) || Number(l.credit)))
        .map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null })),
    };
    const res = editingId
      ? await repostJournalEntry(editingId, payload)
      : await createJournalEntry({ ...payload, source: 'adjustment' });
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    resetForm();
    router.refresh();
  }

  async function doVoid(id: string) {
    const reason = prompt('Reason for voiding this entry? (kept in the audit trail)');
    if (reason == null) return;
    setBusy(true);
    const res = await voidJournalEntry(id, reason);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-label">General ledger · double-entry journal</p>
        <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => (open ? resetForm() : setOpen(true))}>
          {open ? 'Close' : '+ New journal entry'}
        </button>
      </div>

      {open && (
        <div className="card space-y-3">
          {editingId && <p className="text-xs font-semibold" style={{ color: 'var(--brand-text)' }}>Editing entry — saving voids the original and posts a corrected copy (audit trail kept).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <input className="input h-9 w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="input h-9 flex-1" placeholder="Memo (e.g. owner draw, depreciation, correction)" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
              <span className="col-span-5">Account</span><span className="col-span-3">Memo</span>
              <span className="col-span-2 text-right">Debit</span><span className="col-span-2 text-right">Credit</span>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 px-3 py-1.5">
                <select className="input col-span-5 h-8 py-1" value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
                </select>
                <input className="input col-span-3 h-8 py-1" placeholder="—" value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} />
                <input className="input col-span-2 h-8 py-1 text-right" type="number" step="0.01" min="0" placeholder="0.00" value={l.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                <input className="input col-span-2 h-8 py-1 text-right" type="number" step="0.01" min="0" placeholder="0.00" value={l.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-sm">
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add line</button>
            <div className="flex items-center gap-4">
              <span className="metric" style={{ color: 'var(--text-secondary)' }}>Dr {money(totals.dr)} · Cr {money(totals.cr)}</span>
              <span className="text-xs font-semibold" style={{ color: balanced ? 'var(--status-success)' : 'var(--status-danger)' }}>
                {balanced ? 'Balanced' : `Out of balance ${money(totals.dr - totals.cr)}`}
              </span>
              <button className="btn-primary px-4 py-1.5 text-sm" disabled={!balanced || busy} onClick={submit}>{busy ? '…' : 'Post entry'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {entries.map((e) => {
          const dr = (e.journal_lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
          const isExpanded = expanded === e.id;
          const voided = e.status === 'void';
          return (
            <div key={e.id} className="card p-0">
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => setExpanded(isExpanded ? null : e.id)}>
                <span className="metric w-10 shrink-0 text-[11px]" style={{ color: 'var(--metal-titanium)' }}>#{e.entry_no}</span>
                <span className="w-24 shrink-0 text-sm" style={{ color: 'var(--text-secondary)' }}>{e.entry_date}</span>
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--text-primary)', textDecoration: voided ? 'line-through' : undefined }}>{e.memo}</span>
                <span className="badge" style={{ color: 'var(--text-muted)' }}>{e.source}</span>
                {e.reconciled && <span className="badge" style={{ color: 'var(--status-success)' }}>reconciled</span>}
                {voided && <span className="badge" style={{ color: 'var(--status-danger)' }}>void</span>}
                <span className="metric shrink-0 text-[13px]" style={{ color: 'var(--text-primary)' }}>{money(dr)}</span>
              </button>
              {isExpanded && (
                <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <table className="w-full text-sm">
                    <tbody>
                      {(e.journal_lines ?? []).sort((a, b) => a.line_no - b.line_no).map((l) => (
                        <tr key={l.id}>
                          <td className="py-1" style={{ color: 'var(--text-secondary)' }}>{l.accounts?.number} · {l.accounts?.name}</td>
                          <td className="py-1 text-xs" style={{ color: 'var(--text-muted)' }}>{l.memo}</td>
                          <td className="py-1 text-right metric">{Number(l.debit) ? money(Number(l.debit)) : ''}</td>
                          <td className="py-1 text-right metric">{Number(l.credit) ? money(Number(l.credit)) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!voided && !e.is_closing && (
                    <div className="mt-2 flex justify-end gap-2">
                      {(e.source === 'manual' || e.source === 'adjustment') && !e.reconciled && (
                        <button className="rounded-md px-2 py-1 text-xs" style={{ border: '1px solid var(--border-standard)', color: 'var(--brand-text)' }} onClick={() => startEdit(e)} disabled={busy}>Edit</button>
                      )}
                      <button className="rounded-md px-2 py-1 text-xs hover:bg-red-50 hover:text-red-600" style={{ color: 'var(--text-muted)' }} onClick={() => doVoid(e.id)} disabled={busy}>Void entry</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!entries.length && <p className="card text-sm" style={{ color: 'var(--text-muted)' }}>No journal entries yet. Run setup to backfill from your history, or post a manual entry.</p>}
      </div>
    </div>
  );
}
