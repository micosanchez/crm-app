# SJHC Command Center — Engineering audit log (2026-09-22)

Source of truth audited: GitHub `micosanchez/crm-app` @ `main` (tarball 2026-09-22 17:22), base dir `crm application`.
The `~/Documents/Claude/Projects/crm application` copy is a stale Sept-16 snapshot (missing the requests
queue, webhook, text routes) — it was used only to recover migrations 0015–0019 that were never committed.

Environment note: this Mac has no git/Xcode CLT and the disk was 100% full (51 MB free) when the audit
started; dependencies were reused from an earlier session's install. Type-check and production build ran
locally against the modified tree. No production data was written. No migration was run.

## DISCOVERED

Architecture: Next.js 14 App Router + Supabase (Postgres/RLS/Storage) + Tailwind, deployed on Netlify from
`main`. ~11.4k lines TS/TSX across 29 routes, 13 API routes, 38 migrations (3.1k lines SQL). Writes go
through an IndexedDB offline queue → `/api/sync` (idempotent) or the browser Supabase client directly.
An external MCP connector (Cloudflare Worker, not in this repo) also writes to the same DB with the
service role (its migrations 0020–0024 are not in the repo either).

Entities: customers → estimates(quotes) → jobs → invoices → payments; expenses(job_id nullable);
time_entries → labor_entries (trigger 0036); estimate_requests (public intake); document_snapshots
(signed archive); notifications (outbox); leads (abandoned, unlinked from nav); schedule_events, messages
(dead tables).

Money definitions in use (cash basis): collected = paid invoices by paid_at, not voided; outstanding =
sent invoices' total − amount_paid; job profit = paid invoices − job-linked expenses (labor NOT included).

### Findings by severity
P0/P1
- SEC: `activity_log` readable by every login and it stores full before/after row images of invoices,
  payments, expenses → the 0035 technician lockdown was bypassable in one PostgREST call. (0039 A)
- INTEGRITY: `sign_estimate()` lost its `snapshot_estimate()` call when 0029_fix/0032 rewrote it from an
  older copy → no signed ESTIMATE has been archived to Signatures since ~Aug 25. (0039 C, with backfill)
- CUSTOMER-FACING: token RPCs lost `signature_data` (both) and `amount_paid` (invoice) in 0027–0031
  rewrites → drawn signature not shown; Pay button shows full total on partially paid invoices. (0039 D)
- REPO: migrations 0015–0019 never committed; 0016 is "review first"; repo ≠ production. Cannot rebuild
  the DB or audit RLS from the repo. Read-only diagnostics script written to reconcile.
- AUTH: `middleware.ts` sat at the repo root while the app is in `src/` → Next never ran it; server-side
  auth redirect + cookie refresh were dead code (only the client-side redirect in SwRegister ran). Also
  `/sign/…` was missing from its public list, so enabling it as-is would have broken customer sign links.
- MONEY: job-page "Mark paid" and Kanban "→ Paid" set the JOB paid without touching the invoice's
  balance (DB trigger 0018 only flips the invoice status) → Dashboard shows outstanding A/R on "paid" jobs
  and PaymentPanel shows a balance on paid invoices; "Mark paid" on the invoice never wrote a `payments`
  row (Stripe and the connector do) → two ledgers; "Revert to sent" promised the balance reopens but left
  amount_paid = total.
- MONEY: Invoices page "Outstanding" included DRAFTS and ignored partial payments — disagreed with
  Dashboard/Money. `job_profitability` counted voided paid invoices.
- MONEY: `cancelled` quotes rendered as "Draft", counted as pending value and against acceptance rate,
  though the UI promises they never count. Dashboard conversion had the same flaw.
- DATA-SAFETY: `DeleteRecordButton` and `/api/sync` update/delete treated "0 rows affected" (RLS filtered
  it out) as success → user redirected/told "saved" while nothing changed. (0035 leaves no DELETE policy on
  jobs/customers/invoices in the repo — deletes may already be silently no-ops in production.)
- TZ: "today"/"this month" computed from the server clock (Netlify = UTC unless TZ is set) and server-
  rendered times printed in server-local zone → evening jobs land on the next day; month boundaries
  off by 4–5 hours. Only the cron route handled Detroit explicitly.
- MOBILE: QuoteComposer's sticky "Save quote" bar and the Settings save bar used `bottom:0` → hidden
  behind the fixed phone tab bar. Invoice detail's 5-column table overflowed (body has overflow-x hidden).
- SYNC: conflict check had zero clock-skew tolerance → a phone a few seconds slow gets a spurious
  "changed by someone else" on every second consecutive edit.
P2
- In-app "Accept → create job" made a different job than the signing path (generic title, no address).
- `/api/invoices` refused to generate an invoice for a job whose only invoice is voided.
- Duplicate business identity (old phone 313-348-3325) hard-coded in signatures page and Settings defaults.
- App's lead-source list missing `instagram`/`google_ads` (added to the enum in 0033); two divergent lists.
- Price book / recurring plans writable by any login (using(true)). (0039 B)
- No index on job_assignments(user_id) though every technician RPC filters on it. (0039 F)
- No pagination anywhere; /jobs loads every job with photos JSON; search loads 200 estimates+invoices to
  filter client-side. Fine at current volume (<100s of rows); revisit at ~10×.
- `leads` module: page exists, not in nav, 1 row, cron still emails follow-ups from it.
- Dead code: `src/lib/permissions.ts` (never imported), `estimate-A2-commercial.html` inside a route
  folder, `serverFlags.twilio`. Repo root holds stray copies of app files + `crm application 3/6` folders.
- 37 `alert()` calls for errors; acceptable for an internal tool, not great.
P3
- `any` in search/money pages (money fixed). `next lint` not runnable (eslint not installed).

## CHANGED (code — 42 files, see audit.diff)
- `src/middleware.ts` (moved from root; `/sign/` public). `src/lib/permissions.ts`, stray HTML removed.
- NEW `src/lib/dates.ts` (Detroit day/month ranges, DST-safe, display helpers) and `src/lib/money.ts`
  (balanceDue, collectedOn, sumCollected, sumOutstanding, classifyQuote, quoteConversion). NEW
  `scripts/check-money.mjs` (24 assertions) + `npm run check`.
- Dashboard, Money, Reports, Invoices, Customer detail, Job detail, Expenses, Field, Schedule, Documents,
  Signatures, Estimates list: use the shared definitions and Detroit boundaries/formatting.
- InvoiceEditor: "Mark paid" records a `payments` row for the balance (trigger flips status, job follows);
  "Revert to sent" deletes that invoice's payments (audit log keeps them) and reopens the balance. Both
  online-only. `toDateInput` uses Detroit dates.
- JobActions + KanbanBoard: "→ Invoiced" generates the invoice (was Kanban-only gap); "→ Paid" with an
  invoice opens the invoice instead of marking the job paid behind the ledger's back.
- EstimateEditor accept: job title = quote line item, address = customer address (matches sign path).
- DeleteRecordButton / api/sync: `.select('id')` after update/delete; zero rows → clear error, rejected
  (not retried). 60 s clock-skew tolerance on conflicts.
- api/invoices: dupe check ignores voided. stripe/checkout reuses APP_URL. types.ts lead sources = enum;
  requests.ts derives from it. Sticky bars `bottom-20 md:bottom-0`. Invoice table scrolls horizontally.
- requireStaff() added to estimates/[id], invoices/[id], documents (RLS already agreed).

## CHANGED (database — NOT RUN, for the owner to apply)
- `0039_audit_2026_09_22_integrity.sql`: activity_log staff-only; price book/recurring staff-only writes;
  sign_estimate restored (snapshot + cast + backfill); snapshot_estimate handles composer quotes; token
  RPCs return signature_data/amount_paid again; job_profitability excludes voided invoices; 3 indexes.
- `0040_OWNER_DECISION_labor_in_job_profit.sql`: labor_entries into job profit — decision required.
- `supabase/diagnostics/dump_schema_state.sql`: read-only reconciliation dump.

## VERIFIED
- `tsc --noEmit`: clean before and after. `next build`: see report. `npm run check`: 24 + 21 assertions pass
  (money/date logic incl. DST boundaries; website webhook mapping).
- Read-only inspection of the live app (see report §9).
- NOT verified at runtime: authenticated flows against production (no credentials on this machine; no
  staging DB). Every behavioural change is guarded by existing DB triggers/RLS reviewed in migrations.

## DEFERRED (deliberately not changed)
- Public `job-photos` bucket (customers' home photos world-readable by URL) — needs private bucket +
  signed URLs + path storage; owner decision + migration.
- Notes on jobs readable by technicians (cost breakdowns are typed into notes).
- Pagination; global search server-side filtering; `alert()` → toasts; ClockWidget/PhotoSection offline.
- Leads module removal; repo-root junk deletion (needs GitHub UI); moving to soft-delete everywhere.
- Multi-tenancy, connector RPC centralization (accept_estimate etc.).

## OWNER DECISIONS
See report §12.
