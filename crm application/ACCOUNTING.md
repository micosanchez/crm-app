# Accounting module

Double-entry books with bank reconciliation, built into the CRM beside Reports. The **ledger is the source of truth**; bank reconciliation is what keeps it matched to reality (Bluevine), rather than to whatever was typed in.

## Enable it (one time)

1. Run `supabase/migrations/0020_accounting.sql` in the Supabase SQL editor (same method as prior migrations).
2. `NEXT_PUBLIC_FF_ACCOUNTING=1` is already in `.env.local` (and must be set in Netlify env for production — `NEXT_PUBLIC_*` is build-inlined, so a clean rebuild is required).
3. Open **Accounting → First-time setup → “Create chart of accounts + backfill ledger.”** This seeds your real Chart of Accounts and generates double-entry journal entries from existing paid invoices, payments, and expenses. It's idempotent and skips anything already posted.

Staff only (admin / dispatcher) — enforced by RLS on every table, matching the `payments` pattern.

## The six sub-tabs

- **Bank Reconciliation** — import a Bluevine CSV or OFX/QFX export (columns auto-detect; adjust the mapping inline). The matching engine suggests matches to existing journal entries by amount (hard gate) + date proximity + description similarity; confirm, reject, or one-click **create the missing entry** categorized to your COA. A summary shows statement balance vs. book balance, the difference, and what's causing it. You can't close a month until it reconciles — unless you override with a note.
- **Chart of Accounts** — fully editable: add/edit/deactivate/delete/reorder. Number, name, type, normal side. Your real categories are pre-loaded; system accounts can't be deleted (deactivate instead).
- **General Ledger** — every job payment and expense posts as a balanced entry. Manual journal-entry editor for adjustments (owner draws, depreciation, corrections) with a live balance check (debits must equal credits). Void with an audit trail; each entry carries a `reconciled` flag.
- **Income Statement** — any date range (default trailing 6 months), cash/accrual toggle, CSV + Print/PDF export.
- **Balance Sheet** — as of any date. Assets = Liabilities + Equity, with a loud flag if it doesn't tie. Bluevine Cash reflects the reconciled book cash balance; current-period earnings roll into equity.
- **Close Books** — one-click month-end: pre-close checklist, requires reconciliation (or override + note), locks the period, rolls net income into Retained Earnings, snapshots closing balances. Reopen to fix errors.

## Accounting basis

Cash basis by default — equipment purchases (e.g. the trailer) are expensed immediately. The Income Statement cash/accrual toggle is live, and `accounting_settings.basis` / `equipment_treatment` can switch to accrual; `depreciation_schedules` exists for that path but is inert under cash basis. The ledger itself is posted on an accrual spine (A/R recognized at invoice date, cash collected at payment) so the Balance Sheet is always correct.

## Pluggable bank source (Plaid later, without a rewrite)

The import layer is abstracted behind a `BankSource` interface (`src/lib/accounting/bank/`). CSV and OFX implementations exist today; everything downstream — the matching engine, reconciliation UI, and import action — consumes the normalized `NormalizedBankTxn` shape. To add a Plaid feed, implement `BankSource.getTransactions()` and register it in `bank/index.ts`. Nothing else changes.

## Where things live

- `supabase/migrations/0020_accounting.sql` — tables, deferred debits=credits constraint, period-lock triggers, balance views, `seed_chart_of_accounts()`, `backfill_ledger()`, `close_period()`/`reopen_period()`, RLS.
- `src/lib/accounting/` — `types.ts`, `bank/` (source abstraction + CSV/OFX), `matching.ts` (match engine), `financials.ts` (statement builders).
- `src/app/accounting/` — `actions.ts` (all server-side writes) + the six sub-tab routes.

Data model tables: `accounts`, `journal_entries`, `journal_lines`, `bank_transactions`, `bank_import_batches`, `reconciliations`, `periods`, `close_snapshots`, `depreciation_schedules`, `accounting_settings`.
