'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACCOUNT_TYPES, DEFAULT_NORMAL_SIDE, money,
  type AccountBalance, type AccountType,
} from '@/lib/accounting/types';
import { createAccount, updateAccount, deleteAccount, reorderAccounts } from '../actions';

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses',
};

const EMPTY = { number: '', name: '', type: 'expense' as AccountType, normal_side: 'debit' as 'debit' | 'credit', description: '' };

export default function ChartOfAccounts({ accounts }: { accounts: AccountBalance[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ number: '', name: '', description: '' });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await createAccount(form);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    setForm(EMPTY); router.refresh();
  }

  async function saveEdit(id: string) {
    setBusy(true);
    const res = await updateAccount(id, edit);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    setEditingId(null); router.refresh();
  }

  async function toggleActive(a: AccountBalance) {
    setBusy(true);
    await updateAccount(a.id, { is_active: !a.is_active });
    setBusy(false); router.refresh();
  }

  async function remove(a: AccountBalance) {
    if (!confirm(`Delete ${a.number} ${a.name}?`)) return;
    setBusy(true);
    const res = await deleteAccount(a.id);
    setBusy(false);
    if (!res.ok) { alert(res.error); return; }
    router.refresh();
  }

  async function move(a: AccountBalance, dir: -1 | 1) {
    const sameType = accounts.filter((x) => x.type === a.type);
    const idx = sameType.findIndex((x) => x.id === a.id);
    const swap = sameType[idx + dir];
    if (!swap) return;
    setBusy(true);
    await reorderAccounts([{ id: a.id, sort_order: swap.sort_order }, { id: swap.id, sort_order: a.sort_order }]);
    setBusy(false); router.refresh();
  }

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="card grid gap-2 md:grid-cols-12">
        <input className="input md:col-span-2" placeholder="Number *" required value={form.number}
          onChange={(e) => setForm({ ...form, number: e.target.value })} />
        <input className="input md:col-span-4" placeholder="Account name *" required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className="input md:col-span-2" value={form.type}
          onChange={(e) => { const t = e.target.value as AccountType; setForm({ ...form, type: t, normal_side: DEFAULT_NORMAL_SIDE[t] }); }}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select className="input md:col-span-2" value={form.normal_side}
          onChange={(e) => setForm({ ...form, normal_side: e.target.value as 'debit' | 'credit' })}>
          <option value="debit">Debit-normal</option>
          <option value="credit">Credit-normal</option>
        </select>
        <button className="btn-primary md:col-span-2" disabled={busy}>{busy ? '…' : '+ Add account'}</button>
      </form>

      {ACCOUNT_TYPES.map((type) => {
        const rows = accounts.filter((a) => a.type === type);
        if (!rows.length) return null;
        return (
          <section key={type}>
            <div className="mb-2 flex items-baseline justify-between">
              <p className="panel-label">{TYPE_LABEL[type]}</p>
              <p className="panel-label" style={{ color: 'var(--text-muted)' }}>
                {money(rows.reduce((s, r) => s + Number(r.balance), 0))}
              </p>
            </div>
            <div className="card divide-y p-0" style={{ borderColor: 'var(--border-subtle)' }}>
              {rows.map((a, i) => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="metric w-14 shrink-0 text-[12px]" style={{ color: 'var(--metal-titanium)' }}>{a.number}</span>
                  {editingId === a.id ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <input className="input h-8 w-24 py-1" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} />
                      <input className="input h-8 flex-1 py-1" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                      <button className="btn-primary h-8 px-3 py-1 text-xs" onClick={() => saveEdit(a.id)} disabled={busy}>Save</button>
                      <button className="btn-ghost h-8 px-3 py-1 text-xs" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" style={{ color: a.is_active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {a.name}{!a.is_active && <span className="ml-1 text-xs">(inactive)</span>}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{a.normal_side}-normal{a.system_key ? ' · system' : ''}</p>
                      </div>
                      <span className="metric shrink-0 text-[13px]" style={{ color: 'var(--text-secondary)' }}>{money(Number(a.balance))}</span>
                      <div className="flex shrink-0 items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
                        <button title="Up" className="rounded px-1.5 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-30" disabled={i === 0 || busy} onClick={() => move(a, -1)}>↑</button>
                        <button title="Down" className="rounded px-1.5 py-1 text-xs hover:bg-[var(--bg-tertiary)] disabled:opacity-30" disabled={i === rows.length - 1 || busy} onClick={() => move(a, 1)}>↓</button>
                        <button className="rounded px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)]" onClick={() => { setEditingId(a.id); setEdit({ number: a.number, name: a.name, description: a.description ?? '' }); }}>Edit</button>
                        <button className="rounded px-2 py-1 text-xs hover:bg-[var(--bg-tertiary)]" onClick={() => toggleActive(a)}>{a.is_active ? 'Off' : 'On'}</button>
                        {!a.system_key && <button className="rounded px-2 py-1 text-xs hover:bg-red-50 hover:text-red-600" onClick={() => remove(a)}>Del</button>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
