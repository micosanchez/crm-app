'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, type Account, type AccountingSettings, type DepreciationSchedule } from '@/lib/accounting/types';
import { updateSettings, runBackfill, setOpeningBalances, createDepreciationSchedule, postDepreciation } from '../actions';

type Acct = Pick<Account, 'id' | 'number' | 'name' | 'type' | 'normal_side' | 'system_key'>;
const monthNow = () => new Date().toISOString().slice(0, 7);
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function SetupClient({
  settings, accounts, schedules,
}: {
  settings: AccountingSettings | null; accounts: Acct[]; schedules: DepreciationSchedule[];
}) {
  return (
    <div className="space-y-5">
      <BasisCard settings={settings} />
      <OpeningBalancesCard accounts={accounts} />
      <DepreciationCard accounts={accounts} schedules={schedules} />
      <BackfillCard />
    </div>
  );
}

/* ---------------- basis ---------------- */
function BasisCard({ settings }: { settings: AccountingSettings | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const basis = settings?.basis ?? 'cash';
  const treat = settings?.equipment_treatment ?? 'expense';

  async function set(patch: { basis?: 'cash' | 'accrual'; equipment_treatment?: 'expense' | 'capitalize' | 'ask' }) {
    setBusy(true);
    const res = await updateSettings(patch);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <p className="panel-label">Accounting basis</p>
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>Default statement basis</p>
          <div className="flex overflow-hidden rounded-md" style={{ border: '1px solid var(--border-subtle)' }}>
            {(['cash', 'accrual'] as const).map((b) => (
              <button key={b} disabled={busy} onClick={() => set({ basis: b })} className="px-3 py-1.5 text-xs font-semibold capitalize"
                style={{ background: basis === b ? 'var(--brand-primary)' : 'var(--surface-primary)', color: basis === b ? '#fff' : 'var(--text-tertiary)' }}>{b}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs" style={{ color: 'var(--text-muted)' }}>Equipment treatment</p>
          <div className="flex overflow-hidden rounded-md" style={{ border: '1px solid var(--border-subtle)' }}>
            {(['expense', 'capitalize'] as const).map((t) => (
              <button key={t} disabled={busy} onClick={() => set({ equipment_treatment: t })} className="px-3 py-1.5 text-xs font-semibold capitalize"
                style={{ background: treat === t ? 'var(--brand-primary)' : 'var(--surface-primary)', color: treat === t ? '#fff' : 'var(--text-tertiary)' }}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Cash basis expenses equipment immediately. Capitalize lets you depreciate big items below.
      </p>
    </div>
  );
}

/* ---------------- opening balances ---------------- */
function OpeningBalancesCard({ accounts }: { accounts: Acct[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(todayIso());
  const [vals, setVals] = useState<Record<string, string>>({});

  // Things you'd enter opening balances for; AR/retained/OBE are derived, so hide them.
  const rows = accounts.filter((a) =>
    ['asset', 'liability', 'equity'].includes(a.type) &&
    !['ar', 'retained_earnings', 'opening_balance_equity'].includes(a.system_key ?? ''));

  const plug = useMemo(() => {
    let dr = 0, cr = 0;
    for (const a of rows) {
      const b = Number(vals[a.id] || 0);
      if (!b) continue;
      const debitNormal = a.type === 'asset';
      if (debitNormal) { if (b > 0) dr += b; else cr += -b; }
      else { if (b > 0) cr += b; else dr += -b; }
    }
    return Math.round((dr - cr) * 100) / 100; // remainder plugged to Opening Balance Equity
  }, [vals, rows]);

  async function save() {
    const lines = rows.map((a) => ({ account_id: a.id, balance: Number(vals[a.id] || 0) })).filter((l) => l.balance !== 0);
    if (!lines.length) { alert('Enter at least one opening balance.'); return; }
    if (!confirm('Save opening balances? This replaces any previous opening entry.')) return;
    setBusy(true);
    const res = await setOpeningBalances({ asOf, lines });
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    setVals({});
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div><p className="panel-label">Opening balances</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Enter what backfill can’t know: loan balances, credit-card balance, equipment cost, starting cash, owner capital.</p></div>
        <input className="input h-8 w-40 py-1" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
        {(['asset', 'liability', 'equity'] as const).map((type) => {
          const list = rows.filter((a) => a.type === type);
          if (!list.length) return null;
          return (
            <div key={type}>
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>{type}</p>
              {list.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="metric w-12 shrink-0 text-[12px]" style={{ color: 'var(--metal-titanium)' }}>{a.number}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{a.name}</span>
                  <input className="input h-8 w-32 py-1 text-right" type="number" step="0.01" placeholder="0.00"
                    value={vals[a.id] ?? ''} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {plug === 0 ? 'Balances net to zero.' : `${money(Math.abs(plug))} will plug to Owner’s / Opening Balance Equity.`}
        </span>
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save opening balances'}</button>
      </div>
    </div>
  );
}

/* ---------------- depreciation ---------------- */
function DepreciationCard({ accounts, schedules }: { accounts: Acct[]; schedules: DepreciationSchedule[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const byKey = (k: string) => accounts.find((a) => a.system_key === k)?.id ?? '';
  const [form, setForm] = useState({
    asset_name: '', cost: '', salvage: '', useful_life_months: '36', start_date: todayIso(),
    asset_account_id: byKey('equipment'), accum_account_id: byKey('accum_depr'), expense_account_id: byKey('exp_depreciation'),
  });
  const [months, setMonths] = useState<Record<string, string>>({});

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.asset_name || !Number(form.cost)) { alert('Asset name and cost are required.'); return; }
    setBusy(true);
    const res = await createDepreciationSchedule({
      asset_name: form.asset_name, asset_account_id: form.asset_account_id,
      accum_account_id: form.accum_account_id, expense_account_id: form.expense_account_id,
      cost: Number(form.cost), salvage: Number(form.salvage || 0),
      useful_life_months: Number(form.useful_life_months), start_date: form.start_date,
    });
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    setForm({ ...form, asset_name: '', cost: '', salvage: '' });
    router.refresh();
  }

  async function post(id: string) {
    const m = (months[id] || monthNow()) + '-01';
    setBusy(true);
    const res = await postDepreciation(id, m);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <div><p className="panel-label">Depreciation schedules</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Straight-line. Post one month at a time (Dr Depreciation Expense / Cr Accumulated Depreciation).</p></div>

      {schedules.length > 0 && (
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p style={{ color: 'var(--text-primary)' }}>{s.asset_name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{money(Number(s.monthly_amount))}/mo · {s.months_posted}/{s.useful_life_months} posted · cost {money(Number(s.cost))}</p>
              </div>
              <input className="input h-8 w-32 py-1" type="month" value={months[s.id] ?? monthNow()} onChange={(e) => setMonths({ ...months, [s.id]: e.target.value })} />
              <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy || s.months_posted >= s.useful_life_months} onClick={() => post(s.id)}>
                {s.months_posted >= s.useful_life_months ? 'Complete' : 'Post month'}
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={create} className="grid gap-2 md:grid-cols-6">
        <input className="input md:col-span-2" placeholder="Asset (e.g. Trailer)" value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} />
        <input className="input" type="number" step="0.01" placeholder="Cost $" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <input className="input" type="number" step="0.01" placeholder="Salvage $" value={form.salvage} onChange={(e) => setForm({ ...form, salvage: e.target.value })} />
        <input className="input" type="number" placeholder="Life (months)" value={form.useful_life_months} onChange={(e) => setForm({ ...form, useful_life_months: e.target.value })} />
        <button className="btn-primary" disabled={busy}>{busy ? '…' : '+ Add schedule'}</button>
      </form>
    </div>
  );
}

/* ---------------- backfill ---------------- */
function BackfillCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const res = await runBackfill();
    setBusy(false);
    if (!res.ok) { setMsg(res.error); return; }
    setMsg(`Backfill complete — ${res.data?.created ?? 0} new journal entries posted.`);
    router.refresh();
  }
  return (
    <div className="card space-y-2">
      <p className="panel-label">Re-run backfill</p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Posts journal entries for any invoices, payments, or expenses not yet in the ledger (e.g. after adding new records or marking expenses paid by credit card). Idempotent — skips anything already posted.
      </p>
      <div className="flex items-center gap-3">
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run backfill'}</button>
        {msg && <span className="text-sm" style={{ color: 'var(--brand-text)' }}>{msg}</span>}
      </div>
    </div>
  );
}
