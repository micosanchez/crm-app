'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seedChartOfAccounts, runBackfill } from './actions';

export default function SetupPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function setup() {
    setBusy(true); setMsg(null);
    const seed = await seedChartOfAccounts();
    if (!seed.ok) { setBusy(false); setMsg(`Seed failed: ${seed.error}`); return; }
    const back = await runBackfill();
    setBusy(false);
    if (!back.ok) { setMsg(`Chart created. Backfill failed: ${back.error}`); router.refresh(); return; }
    setMsg(`Chart of accounts created and ${back.data?.created ?? 0} journal entries backfilled from your history.`);
    router.refresh();
  }

  return (
    <div className="card space-y-4">
      <div>
        <p className="panel-label">First-time setup</p>
        <h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Build your books</h2>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        This loads your real Chart of Accounts (Bluevine Cash, A/R, Equipment/Trailer, hauling income, and every
        expense category you already use), then backfills the general ledger with double-entry journal entries
        generated from your existing paid invoices, payments, and expenses — so the books reflect your actual history.
        The ledger becomes the source of truth; bank reconciliation keeps it matched to Bluevine.
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Basis: cash (equipment expensed immediately). You can switch to accrual later in the Income Statement.
        Safe to run once — it skips anything already posted.
      </p>
      <button className="btn-primary" onClick={setup} disabled={busy}>
        {busy ? 'Setting up…' : 'Create chart of accounts + backfill ledger'}
      </button>
      {msg && <p className="text-sm" style={{ color: 'var(--brand-text)' }}>{msg}</p>}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Not seeing this work? Make sure migration <code>0020_accounting.sql</code> has been run in Supabase.
      </p>
    </div>
  );
}
