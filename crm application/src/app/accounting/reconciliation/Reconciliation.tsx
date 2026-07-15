'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, type Account, type AccountBalance, type BankTransaction, type Reconciliation } from '@/lib/accounting/types';
import { suggestMatches, type CashLineCandidate, type Suggestion } from '@/lib/accounting/matching';
import {
  parseCsv, detectMapping, applyMapping, isOfx, OfxBankSource,
  type ColumnMapping, type NormalizedBankTxn,
} from '@/lib/accounting/bank';
import {
  importBankTransactions, confirmMatch, unmatch, setTransactionIgnored, createEntryFromBankTxn, saveReconciliation, matchDepositBatch,
} from '../actions';

type Acct = Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side' | 'system_key'>;
const monthEndOf = (m: string) => { const d = new Date(m + 'T00:00:00'); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); };

export default function ReconciliationWorkspace({
  cashAccountId, cashAccount, accounts, reconcilable, bankTxns, candidates, reconciliations, currentMonth,
}: {
  cashAccountId: string; cashAccount: AccountBalance | null; accounts: Acct[]; reconcilable: Acct[];
  bankTxns: BankTransaction[]; candidates: CashLineCandidate[]; reconciliations: Reconciliation[]; currentMonth: string;
}) {
  const router = useRouter();
  const unmatched = bankTxns.filter((t) => t.status === 'unmatched');
  const matched = bankTxns.filter((t) => t.status === 'matched');
  const ignored = bankTxns.filter((t) => t.status === 'ignored');
  const bookBalance = Number(cashAccount?.balance ?? 0);

  return (
    <div className="space-y-5">
      {reconcilable.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="panel-label">Reconciling</span>
          <select className="input h-8 w-64 py-1" value={cashAccountId}
            onChange={(e) => router.push(`/accounting/reconciliation?account=${e.target.value}`)}>
            {reconcilable.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
          </select>
        </div>
      )}
      <ImportPanel cashAccountId={cashAccountId} />
      <ReconSummary
        cashAccountId={cashAccountId} bookBalance={bookBalance} unmatched={unmatched}
        reconciliations={reconciliations} currentMonth={currentMonth}
      />
      <MatchWorkspace unmatched={unmatched} candidates={candidates} accounts={accounts} />
      {matched.length > 0 && <MatchedList matched={matched} />}
      {ignored.length > 0 && <IgnoredList ignored={ignored} />}
    </div>
  );
}

/* --------------------------------------------------------------- Import */
function ImportPanel({ cashAccountId }: { cashAccountId: string }) {
  const router = useRouter();
  const [filename, setFilename] = useState('');
  const [sourceId, setSourceId] = useState('bluevine_csv');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [ofxTxns, setOfxTxns] = useState<NormalizedBankTxn[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setFilename(file.name); setMsg(null); setOfxTxns(null); setHeaders([]); setRows([]); setMapping(null);
    if (isOfx(file.name, text)) {
      setSourceId('bluevine_ofx');
      setOfxTxns(await new OfxBankSource(text).getTransactions());
    } else {
      setSourceId('bluevine_csv');
      const parsed = parseCsv(text);
      setHeaders(parsed.headers); setRows(parsed.rows); setMapping(detectMapping(parsed.headers));
    }
  }

  const txns: NormalizedBankTxn[] = useMemo(() => {
    if (ofxTxns) return ofxTxns;
    if (mapping) return rows.map((r) => applyMapping(r, mapping)).filter((t): t is NormalizedBankTxn => t !== null);
    return [];
  }, [ofxTxns, rows, mapping]);

  async function doImport() {
    setBusy(true); setMsg(null);
    const res = await importBankTransactions({ accountId: cashAccountId, source: sourceId, filename, txns });
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setMsg(`Imported ${res.data?.inserted ?? 0} transaction(s)${res.data?.duplicates ? `, skipped ${res.data.duplicates} duplicate(s)` : ''}.`);
    setFilename(''); setRows([]); setHeaders([]); setMapping(null); setOfxTxns(null);
    router.refresh();
  }

  const mapField = (k: keyof ColumnMapping, label: string) => (
    <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}
      <select className="input ml-1 h-7 py-0.5 text-xs" value={(mapping?.[k] as string) ?? ''} onChange={(e) => setMapping({ ...mapping!, [k]: e.target.value || undefined })}>
        <option value="">—</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="panel-label">Import bank activity</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bluevine CSV or OFX/QFX export. Columns auto-detect; adjust below if needed.</p>
        </div>
        <input type="file" accept=".csv,.ofx,.qfx,text/csv" className="input max-w-xs text-sm" onChange={onFile} />
      </div>

      {mapping && headers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg p-2" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-subtle)' }}>
          {mapField('date', 'Date')}
          {mapField('description', 'Description')}
          {mapField('amount', 'Amount')}
          {mapField('credit', 'Money in')}
          {mapField('debit', 'Money out')}
          {mapField('externalId', 'ID')}
          <label className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Sign
            <select className="input ml-1 h-7 py-0.5 text-xs" value={mapping.amountSign ?? 'standard'} onChange={(e) => setMapping({ ...mapping, amountSign: e.target.value as 'standard' | 'inverted' })}>
              <option value="standard">− = out</option>
              <option value="inverted">− = in</option>
            </select>
          </label>
        </div>
      )}

      {txns.length > 0 && (
        <div>
          <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
            <table className="w-full text-sm">
              <thead><tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} className="text-[11px] uppercase tracking-wide">
                <th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-left">Description</th><th className="px-3 py-1.5 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {txns.slice(0, 6).map((t, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="px-3 py-1" style={{ color: 'var(--text-secondary)' }}>{t.postedDate}</td>
                    <td className="px-3 py-1" style={{ color: 'var(--text-primary)' }}>{t.description}</td>
                    <td className="px-3 py-1 text-right metric" style={{ color: t.direction === 'credit' ? 'var(--status-success)' : 'var(--status-danger)' }}>
                      {t.direction === 'credit' ? '+' : '−'}{money(t.amount).replace('-', '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{txns.length} transaction(s) parsed{txns.length > 6 ? ' (showing 6)' : ''}</span>
            <button className="btn-primary px-4 py-1.5 text-sm" onClick={doImport} disabled={busy}>{busy ? 'Importing…' : `Import ${txns.length}`}</button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm" style={{ color: 'var(--brand-text)' }}>{msg}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- Summary */
function ReconSummary({
  cashAccountId, bookBalance, unmatched, reconciliations, currentMonth,
}: {
  cashAccountId: string; bookBalance: number; unmatched: BankTransaction[]; reconciliations: Reconciliation[]; currentMonth: string;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth.slice(0, 7));
  const [statementEnd, setStatementEnd] = useState(monthEndOf(currentMonth));
  const [statementBal, setStatementBal] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = reconciliations.find((r) => r.period_month.slice(0, 7) === month);
  const enteredBal = statementBal === '' ? null : Number(statementBal);
  const diff = enteredBal == null ? null : Math.round((enteredBal - bookBalance) * 100) / 100;
  const unmatchedSum = unmatched.reduce((s, t) => s + (t.direction === 'credit' ? Number(t.amount) : -Number(t.amount)), 0);

  async function save() {
    if (enteredBal == null) { alert('Enter the statement ending balance from Bluevine.'); return; }
    setBusy(true);
    const res = await saveReconciliation({
      accountId: cashAccountId, periodMonth: month + '-01', statementEnd,
      statementEndingBalance: enteredBal, note, override: diff !== 0 && !!note.trim(),
    });
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="panel-label">Reconciliation summary</p>
        <div className="flex items-center gap-2">
          <input className="input h-8 w-36 py-1" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setStatementEnd(monthEndOf(e.target.value + '-01')); }} />
          <input className="input h-8 w-40 py-1" type="date" value={statementEnd} onChange={(e) => setStatementEnd(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg sm:grid-cols-4" style={{ background: 'var(--border-subtle)' }}>
        <Cell label="Book cash balance" value={money(bookBalance)} />
        <div className="bg-surface px-4 py-3">
          <p className="panel-label">Statement balance</p>
          <input className="input mt-1 h-8 py-1 text-right metric" type="number" step="0.01" placeholder="0.00" value={statementBal} onChange={(e) => setStatementBal(e.target.value)} />
        </div>
        <Cell label="Difference" value={diff == null ? '—' : money(diff)} tone={diff === 0 ? 'var(--status-success)' : diff == null ? undefined : 'var(--status-danger)'} />
        <Cell label="Uncleared items" value={`${unmatched.length}`} sub={money(unmatchedSum)} />
      </div>

      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {diff === 0
          ? 'Books match the bank — you can reconcile and close the month.'
          : diff == null
            ? 'Enter your Bluevine statement ending balance to see the difference.'
            : `Off by ${money(diff)}. Likely causes: ${unmatched.length} uncleared bank item(s) totaling ${money(unmatchedSum)}, or missing journal entries. Match them below, or reconcile with an override note.`}
      </div>

      {diff !== 0 && diff != null && (
        <input className="input" placeholder="Override note (needed to reconcile with a difference)" value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="flex items-center justify-between">
        {existing && (
          <span className="text-xs" style={{ color: existing.status === 'reconciled' ? 'var(--status-success)' : 'var(--text-muted)' }}>
            {existing.status === 'reconciled' ? `Reconciled${existing.override ? ' (override)' : ''} · diff ${money(existing.difference)}` : 'In progress'}
          </span>
        )}
        <button className="btn-primary ml-auto px-4 py-1.5 text-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save reconciliation'}</button>
      </div>
    </div>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="panel-label">{label}</p>
      <p className="metric mt-1 text-[18px] font-bold leading-none" style={{ color: tone ?? 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- Matching */
function MatchWorkspace({ unmatched, candidates, accounts }: { unmatched: BankTransaction[]; candidates: CashLineCandidate[]; accounts: Acct[] }) {
  return (
    <div>
      <p className="panel-label mb-2">Unmatched bank transactions · {unmatched.length}</p>
      {!unmatched.length ? (
        <div className="card text-sm" style={{ color: 'var(--text-muted)' }}>Nothing to match. Import a Bluevine export to begin, or every transaction is already matched.</div>
      ) : (
        <div className="space-y-2">
          {unmatched.map((t) => <MatchRow key={t.id} txn={t} candidates={candidates} accounts={accounts} />)}
        </div>
      )}
    </div>
  );
}

function MatchRow({ txn, candidates, accounts }: { txn: BankTransaction; candidates: CashLineCandidate[]; accounts: Acct[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [offset, setOffset] = useState('');
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [feeAcct, setFeeAcct] = useState(accounts.find((a) => a.system_key === 'exp_processing_fees')?.id ?? '');
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const eligible = candidates.filter((c) => (txn.direction === 'credit' ? c.debit > 0 : c.credit > 0));
  const selectedIds = eligible.filter((c) => selected[c.lineId]).map((c) => c.lineId);
  const selectedSum = round2(eligible.filter((c) => selected[c.lineId]).reduce((s, c) => s + (txn.direction === 'credit' ? c.debit : c.credit), 0));
  const fee = round2(selectedSum - Number(txn.amount));
  const suggestions: Suggestion[] = useMemo(
    () => suggestMatches({ postedDate: txn.posted_date, amount: Number(txn.amount), direction: txn.direction, description: txn.description }, candidates),
    [txn, candidates],
  );

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  // Sensible default offset account: revenue for money in, an expense for money out.
  const defaultOffset = txn.direction === 'credit'
    ? accounts.find((a) => a.type === 'revenue')?.id
    : accounts.find((a) => a.type === 'expense')?.id;

  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="w-24 shrink-0 text-sm" style={{ color: 'var(--text-secondary)' }}>{txn.posted_date}</span>
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--text-primary)' }}>{txn.description}</span>
        <span className="metric shrink-0 text-sm" style={{ color: txn.direction === 'credit' ? 'var(--status-success)' : 'var(--status-danger)' }}>
          {txn.direction === 'credit' ? '+' : '−'}{money(Number(txn.amount)).replace('-', '')}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button className="rounded-md px-2 py-1 text-xs" style={{ border: '1px solid var(--border-standard)', color: 'var(--brand-text)' }}
            onClick={() => setBatch((b) => !b)}>Deposit / split</button>
          <button className="rounded-md px-2 py-1 text-xs" style={{ border: '1px solid var(--border-standard)', color: 'var(--brand-text)' }}
            onClick={() => { setCreating((c) => !c); if (!offset && defaultOffset) setOffset(defaultOffset); }}>Create entry</button>
          <button className="rounded-md px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }} onClick={() => act(() => setTransactionIgnored(txn.id, true))} disabled={busy}>Ignore</button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="panel-label mb-1">Suggested matches</p>
          <div className="space-y-1">
            {suggestions.slice(0, 3).map((s) => (
              <div key={s.lineId} className="flex items-center gap-2 text-sm">
                <span className="w-8 shrink-0 text-[11px] font-semibold" style={{ color: s.auto ? 'var(--status-success)' : 'var(--text-muted)' }}>{s.score}</span>
                <span className="w-20 shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>{s.entryDate}</span>
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{s.memo} · {s.reasons.join(', ')}</span>
                <button className="btn-primary shrink-0 px-2.5 py-1 text-xs" onClick={() => act(() => confirmMatch(txn.id, s.lineId))} disabled={busy}>{s.auto ? 'Confirm ✓' : 'Match'}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {creating && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="panel-label mb-1">Post a new journal entry for this transaction</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{txn.direction === 'credit' ? 'Debit Cash / Credit' : 'Debit'}</span>
            <select className="input h-8 flex-1 py-1" value={offset} onChange={(e) => setOffset(e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
            </select>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{txn.direction === 'credit' ? '' : '/ Credit Cash'}</span>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={!offset || busy}
              onClick={() => act(() => createEntryFromBankTxn({ bankTxnId: txn.id, offsetAccountId: offset }))}>Post &amp; match</button>
          </div>
        </div>
      )}

      {batch && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="panel-label mb-1">Match a deposit to several entries (Stripe / Venmo payouts, net of fees)</p>
          <div className="max-h-48 overflow-auto rounded" style={{ border: '1px solid var(--border-subtle)' }}>
            {eligible.map((c) => (
              <label key={c.lineId} className="flex items-center gap-2 px-2 py-0.5 text-sm">
                <input type="checkbox" checked={!!selected[c.lineId]} onChange={(e) => setSelected({ ...selected, [c.lineId]: e.target.checked })} />
                <span className="w-20 shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>{c.entryDate}</span>
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{c.memo}</span>
                <span className="metric shrink-0 text-xs">{money(txn.direction === 'credit' ? c.debit : c.credit)}</span>
              </label>
            ))}
            {!eligible.length && <p className="px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }}>No unreconciled entries on this side yet.</p>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>Selected {money(selectedSum)} vs bank {money(Number(txn.amount))}</span>
            {fee > 0.005 && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>fee {money(fee)} →</span>
                <select className="input h-7 py-0.5 text-xs" value={feeAcct} onChange={(e) => setFeeAcct(e.target.value)}>
                  <option value="">Fee account…</option>
                  {accounts.filter((a) => a.type === 'expense').map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
                </select>
              </>
            )}
            <button className="btn-primary px-3 py-1 text-xs"
              disabled={busy || !selectedIds.length || fee < -0.005 || (fee > 0.005 && !feeAcct)}
              onClick={() => act(() => matchDepositBatch({ bankTxnId: txn.id, lineIds: selectedIds, feeAccountId: fee > 0.005 ? feeAcct : undefined, feeAmount: fee > 0.005 ? fee : 0 }))}>
              Match {selectedIds.length} {selectedIds.length === 1 ? 'entry' : 'entries'}
            </button>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Fee = selected book total − bank amount, booked to the fee account so book cash nets to the actual deposit. Select more entries if the bank amount is larger.
          </p>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Cleared / Ignored */
function MatchedList({ matched }: { matched: BankTransaction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button className="panel-label mb-1" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Cleared · {matched.length}</button>
      {open && (
        <div className="card divide-y p-0" style={{ borderColor: 'var(--border-subtle)' }}>
          {matched.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>{t.posted_date}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
              <span className="metric" style={{ color: 'var(--text-secondary)' }}>{t.direction === 'credit' ? '+' : '−'}{money(Number(t.amount)).replace('-', '')}</span>
              <button className="text-xs underline" style={{ color: 'var(--text-muted)' }} disabled={busy}
                onClick={async () => { setBusy(true); await unmatch(t.id); setBusy(false); router.refresh(); }}>unmatch</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IgnoredList({ ignored }: { ignored: BankTransaction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="panel-label mb-1" onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'} Ignored · {ignored.length}</button>
      {open && (
        <div className="card divide-y p-0" style={{ borderColor: 'var(--border-subtle)' }}>
          {ignored.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>{t.posted_date}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{t.description}</span>
              <button className="text-xs underline" style={{ color: 'var(--text-muted)' }}
                onClick={async () => { await setTransactionIgnored(t.id, false); router.refresh(); }}>restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
