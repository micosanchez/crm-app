# SJHC Command Center — Data Integrity & Business-Metrics Upgrade (2026-09-26)

Everything here is **staged, not live**. Nothing runs against production until the
owner runs the migrations (§5). The app and connector changes are safe to deploy only
*after* 0041–0047 have run, because they write to the new columns.

---

## 1. Inspection: exists / partial / missing

| Spec item | State before | Where |
|---|---|---|
| Time clock + labor entries (clock → labor trigger) | **exists** | `time_entries`, `labor_entries`, 0036 |
| Payroll expense when labor is paid | **missing** (payroll typed by hand → double count) | fixed by 0042 `labor_paid_to_expense` |
| Owner time at $0 | **missing** | 0042 owner worker row + `log_owner_time` |
| Expense categories (13) | **partial** | 0041 adds 8 |
| Expense class (direct / overhead / capital / owner draw / personal) | **missing** | 0042 `expense_class` + auto-classify trigger |
| Assets register | **missing** | 0042 `assets` |
| Payment methods | **partial** (cash, venmo, card, check, other) | 0042 CHECK: + cash_app, zelle, stripe_card, stripe_ach, bank_transfer, unknown_legacy |
| Processing fees | **missing** | 0042 `payments.processing_fee` → expense trigger; Stripe webhook reads the fee |
| Tips separate from revenue | **partial** (column existed, mixed in some views) | 0043 `job_profitability` excludes tips; reports treat tips as their own line |
| Invoice `amount_paid` derived | **exists** (trigger) | hardened in 0042 (recompute + paid guard) |
| Job ↔ invoice paid sync | **exists** | 0042 adds "paid needs money" guard + auto draft invoice on completed |
| is_test / job_kind internal | **missing** | 0042 |
| Date precision for legacy backfill | **missing** | 0042 `date_precision` |
| Service taxonomy (what kind of job) | **missing** (`service` was junk/landscaping/other) | 0043 `service_type` enum, required on new jobs |
| Load / crew / access / weight / mattress counts | **missing** | 0043 |
| Dump tickets + multi-job allocation | **missing** (dump fee was a flat expense) | 0043 `dump_tickets`, `allocate_dump_ticket`, `job_dump_cost` |
| Mileage / vehicle cost | **missing** | 0042 `mileage_log`, `vehicle_cost()` (mode in `app_settings`) |
| Lead sources | **partial** (9 values) | 0041 adds 12; jobs normalized; `is_lead_source()` CHECK |
| Leads pipeline | **exists but abandoned** (`leads` table unused) | 0044 extends; estimate_requests → leads trigger; texts → leads via auto-reply |
| Speed-to-lead | **missing** | 0044 `first_response_at`; `mark_lead_responded()` on every outbound text |
| Campaigns / daily spend | **missing** | 0044 `marketing_campaigns`, `marketing_daily_spend`, Meta-unassigned default |
| UTM capture on the request form | **missing** | 0044 columns; RequestForm + route + Netlify webhook |
| "How did you hear about us?" | **missing** | RequestForm + `heard_about_us` |
| Quote outcomes (loss reason, competitor, follow-ups, options) | **missing** | 0044; DB refuses decline without a reason |
| Reviews / referrals | **missing** | 0044 `referrals`, `review_snapshots`, review fields on jobs |
| Accounts (commercial) | **missing** (`public.accounts` is a retired ledger) | 0045 `accounts_crm` |
| Customer segment / do-not-contact / E.164 | **missing** | 0045 |
| Reports: P&L, unit economics, owner $/hr, win rate, channel ROI, service line, customer metrics, pipeline, health check, weekly, monthly close, full-time readiness | **missing** (only revenue/expense/job_profitability) | 0046 |
| Internal notes never on customer docs | **partial** (`payload.notes` rendered on the signature page) | fixed in app |
| Integrations log, external ids, bank matching | **missing** | 0047 |
| MCP tool names / params | **kept** — every existing tool keeps its name and required params; only optional params were added | connector v2.1.0 |

---

## 2. Changelog by phase

### Phase 1 — Money integrity (0041, 0042)
- Enums widened (must run 0041 alone first — Postgres commits `ADD VALUE` before use).
- `app_settings` with `setting_num()`; owner targets, mileage rate, trailer capacity, capital threshold, cash reserve.
- `expenses.expense_class` auto-derived from category; owner_draw/personal never deductible, never in profit.
- Paid labor → payroll expense (one source of helper pay). Manual payroll on a job with logged hours is blocked unless `override_reason`.
- Payments: method CHECK, `processing_fee` → `payment_processing` expense, `external_source/external_id`.
- Invoice `amount_paid` recomputed from payments; a job cannot go `paid` with $0 collected; completed jobs get a draft invoice.
- `assets`, `mileage_log`, owner worker row (rate 0), `labor_entries.activity`.

### Phase 2 — Job economics (0043)
- `service_type` (required on insert, `sjhc.auto_job` bypass for triggers), hauling unit, load fraction, cubic yards, weight, counts, access flags, crew size, minutes, quoted price, pickup/disposal timestamps, cancel reason.
- Estimates carry the same scope fields; `sign_estimate` copies them to the job.
- `disposal_sites` (seeded), `dump_tickets`, allocation by cubic-yard share, `job_dump_cost` view.
- `job_profitability` rebuilt: revenue (no tips), direct expenses, helper labor, owner hours, allocated dump cost, miles, vehicle cost, profit and profit after vehicle.

### Phase 3 — Sales & marketing (0044)
- Campaigns + daily spend; Meta spend defaults to a "Meta — unassigned" campaign.
- Referral chain (`referred_by_customer_id`), `lead_source_detail`, `campaign_id` on customers and jobs.
- Request form UTMs + heard_about_us; estimate_requests → leads with status sync.
- Quote outcome fields; `estimates_outcome_rules` requires `loss_reason` on declined/expired.
- Reviews on jobs, `referrals`, `review_snapshots`.

### Phase 4 — Customers & accounts (0045)
- `accounts_crm`, `customers.segment/account_id/do_not_contact/phone_e164`, `to_e164()` normalizer, duplicate-phone detection, `customer_stats` view.

### Phase 5 — Reports (0046)
- `pnl_report`, `unit_economics`, `owner_hourly`, `quote_win_rate`, `channel_roi`, `service_line_profitability`, `customer_metrics`, `pipeline_report`, `data_health_check`, `weekly_scorecard`, `monthly_close` (snapshots), `full_time_readiness`.
- Writers: `log_owner_time`, `log_dump_ticket`, `job_close_out` (returns `still_missing`).
- All cash basis by `paid_at`, Detroit time, `real_jobs` view (no test, no internal).

### Phase 6 — Cleanup (0048)
- PART A dry-run `SELECT` lists every row and the before/after. PART B applies in one transaction. Items needing the owner's word are commented at the bottom (see §6).

### Phase 7 — Integrations (0047 + stubs)
- `integration_runs`, external ids on expenses/jobs, `bank_transactions` match columns, `job_photos`, `upsert_lead_from_message`, `mark_lead_responded`.
- Auto-reply Worker: every inbound text creates/extends a lead; every outbound text stamps first response.
- Stripe webhook: `stripe_card`, fee from the balance transaction, external ids.
- Meta Ads, Google Business Profile, Maps mileage, Calendar, bank CSV: **not built** — pricing and credentials listed in §7 for a decision first.

### App (Netlify) changes
- Types widened; `PAYMENT_METHODS`, `SERVICE_TYPES`, `LEAD_SOURCES`, `EXPENSE_CATEGORIES`, `EXPENSE_CLASSES`.
- New job / edit job / book-again require **what kind of job**; lead source blank inherits the customer's.
- Quote decline asks **why** (matches the DB rule); accepted quotes pass service type, quoted price, test flag to the job.
- Cancel job asks for a reason. Internal notes field on the job editor. Signature page no longer renders internal `notes`.
- Expense form: class picker (auto by default), class badge in the list.
- Field view (staff): **60-second close-out** on Complete — kind of job, hauling unit, loads, crew, your hours, dump ticket $, site, mattresses → `job_close_out`; shows `still_missing`.
- Reports: P&L, owner economics, win rate, pipeline, full-time readiness, data health at the top of `/reports` (fail-soft until migrations run).
- Request form: "How did you hear about us?" + UTM/fbclid/gclid/referrer captured into columns; Netlify webhook maps `utm_*`, source names use the new enum.

### Connector (Cloudflare Worker `sjhc-connector` v2.1.0)
- Constants widened (categories, classes, paid_with, payment methods, lead sources).
- `create_expense` / `update_expense` / `bulk_import_expenses`: `expense_class`, `bank_txn_ref`, `is_pending`, `campaign_id`, `asset_id`, `override_reason`; bulk import returns `possible_duplicate` (same bank ref, or ±$0.50 within ±2 days with a similar vendor) instead of writing.
- `record_payment`: full method list, `processing_fee`.
- `complete_job`: `service_type`, `hauling_unit`, `load_fraction`, `crew_size`, `mattress_count`, `access_flags`, `owner_hours`, `owner_drive_hours`, `helper_labor[]` (creates labor entries; `paid` settles them), `dump_ticket`, `allocate_ticket_ids`, `disposed_at`, `review_requested`; returns `still_missing`. `crew_cost` still works but is stamped with an override reason.
- `create_job`: `service_type` **required**, `lead_source` enum, `account_id`, `job_kind`. `update_job`: cancel_reason (required to cancel), service_type, job_kind, is_test, account_id, internal_notes, hauling, crew, referred_by.
- `update_quote_status`: `loss_reason` **required** for declined/expired, competitor fields; the job it creates carries service type / quoted price / test flag.
- `create_quote`: service_type, hauling, loads, weight, crew, deposit, options (A/B), lead_id, account_id, `sent_at`.
- `create_customer`: lead_source **required** (`unknown` allowed), segment, referred_by, account. `update_customer`: segment, account, referred_by, do_not_contact, is_test.
- `log_hours`: `activity`. `mark_hours_paid` tells the caller the payroll expense is generated.
- Intake `ref` map → new enum names. Every outbound text calls `mark_lead_responded`.
- New tools: `pnl_report`, `unit_economics`, `owner_hourly`, `quote_win_rate`, `channel_roi`, `service_line_profitability`, `customer_metrics`, `pipeline_report`, `data_health_check`, `weekly_scorecard`, `monthly_close`, `full_time_readiness`, `log_owner_time`, `log_dump_ticket`, `create_lead`, `update_lead`, `log_review`, `create_account`, `update_account`, `list_accounts`, `record_referral`, `log_mileage`, `close_out_job_details`, `get_settings`, `update_setting`, `sync_status`, `review_unmatched_transactions`, `match_transaction`.

---

## 3. How to log a job now (the 60-second habit)

1. **Inquiry comes in** — text/call/form. Texts and web forms become leads on their own. For a call: `create_lead` (name, phone, channel `phone_call`, source).
2. **Quote it** — `create_quote` with `service_type`, `load_fraction`, `crew_size`, price. Send it. If they pass: `update_quote_status(declined, loss_reason)`. Ghosted after a week: `expired` with `no_response_ghosted`.
3. **They accept** — the job is created from the quote (service type and quoted price carry over). Booked without a quote: `create_job` with `service_type`; lead source inherits from the customer.
4. **Do the job** — at the curb, Field view → Complete → fill the close-out: kind of job, unit, loads, crew, **your hours**, dump ticket $ and site. Or say it: "Finished Aguilar, $220 Venmo, one load, Jeremiah 3 hours, dump $48 at Riverview, I was there 2.5 hours." → `complete_job` with `helper_labor`, `owner_hours`, `dump_ticket`.
5. **Paid later** — `record_payment` with the real method (cash_app, zelle, stripe_card…). Fees go on `processing_fee`.
6. **Pay helpers** — `unpaid_labor` → `mark_hours_paid`. Never add a payroll expense by hand.
7. **Owner pay** — `create_expense(category owner_draw)`. It stays in the ledger and out of profit.
8. **Weekly** — `weekly_scorecard`, `data_health_check`; fix what it lists. **Monthly** — `monthly_close(month)`.

Rules the database enforces now: a job cannot be `paid` with $0 collected; a quote cannot be declined without a reason; a job cannot be cancelled without a reason; a new job needs a kind; a payroll expense on a job with logged hours needs an override reason.

---

## 4. Files in this change

- `supabase/migrations/0041_audit_enums.sql` … `0047_integrations.sql`, `0048_phase6_cleanup.sql`
- `connector/metrics_tools.js` (new module), `connector/patch_bundle.py` (the exact edits applied to the deployed bundle), `connector/README.md`
- `src/lib/types.ts`, `src/lib/requests.ts`, `src/lib/websiteLead.ts`
- `src/app/jobs/NewJobForm.tsx`, `src/app/jobs/[id]/JobEditForm.tsx`, `src/app/jobs/[id]/JobActions.tsx`, `src/app/customers/[id]/BookAgainButton.tsx`
- `src/app/estimates/[id]/EstimateEditor.tsx`, `src/app/invoices/[id]/PaymentPanel.tsx`, `src/app/invoices/[id]/InvoiceEditor.tsx`
- `src/app/expenses/ExpenseManager.tsx`, `src/app/field/page.tsx`, `src/app/field/FieldJobList.tsx`
- `src/app/reports/page.tsx`, `src/app/reports/Metrics.tsx`, `src/app/signatures/[id]/page.tsx`
- `src/app/request/RequestForm.tsx`, `src/app/api/public/estimate-request/route.ts`, `src/app/api/webhooks/netlify-form/route.ts`, `src/app/api/stripe/webhook/route.ts`
- `docs/skills/sjhc-crm-ops.SKILL.md`, `docs/skills/sjhc-expense-import.SKILL.md` (paste over the live skills)
- Outside the repo: `~/Downloads/sjhc-auto-reply/src/index.js` (lead upsert + response stamp)

Verified: `tsc --noEmit` clean, `next build` clean, connector bundle `node --check` clean (90 tools registered).

---

## 5. Go-live order (owner runs)

1. Supabase SQL editor → run **0041 alone**. Wait for success.
2. Run 0042, 0043, 0044, 0045, 0046, 0047 in order (each is one transaction-safe file; all additive/nullable).
3. `select public.data_health_check();` — expect the known legacy issues (§6), nothing else.
4. Run **0048 PART A** (the SELECT). Read the diff. Then PART B.
5. Merge the PR → Netlify deploys the app.
6. Deploy the connector bundle (`index.patched.js`, see `connector/README.md`) — keeps every secret binding; bumps to v2.1.0.
7. `cd ~/Downloads/sjhc-auto-reply && ./deploy.sh` (needs `NPM_CONFIG_CACHE` pointed away from the root-owned `~/.npm`).
8. Paste `docs/skills/*.SKILL.md` over the live skills.
9. Add `STRIPE_SECRET_KEY` to Netlify env if fee capture is wanted (optional; the webhook works without it).

Rollback: every migration is additive. `supabase/migrations/ROLLBACK_0042_0047_metrics_upgrade.sql` drops what 0042–0047 created; 0041 enum values cannot be dropped in Postgres and are harmless.

---

## 6. Owner confirmations still needed (Phase 6)

| # | Record | Question |
|---|---|---|
| 1 | Michael Little job `08896d67`, Lynn Steffensky job `dae0faeb` | Marked paid with $0 collected. Did they pay (cash, how much) or not? |
| 2 | Cervelli dump ticket expense `7bde0f0a` $60 "NOT YET PAID" | Paid since? |
| 3 | Justin Mayes job `1bd613e1`: labor entry $15 vs payroll expense $40 | Which is right? |
| 4 | Capital One $350 on 7/16; Goldobin $361.98 + $12.70 | Not found by id — need the vendor text as it appears on the statement |
| 5 | 29 jobs with no lead source, 14 legacy jobs with no title | `data_health_check` lists them after 0046; `suggest_service_type()` fills a guess from the title — confirm in a batch |
| 6 | Tip job → invoice #35 | 0048 moves the $112.50 tip onto Nolan O'Connor's payment and voids #36 — confirm that is the right invoice |

---

## 7. Phase 7 integrations — decide before building

| Integration | What it gives | Cost | Needs |
|---|---|---|---|
| Meta Marketing API | daily spend per campaign → `marketing_daily_spend` (true CPL/CPA) | free API; needs a Meta developer app + system-user token | Business Manager admin; 1 hr setup |
| Google Business Profile API | reviews count/rating → `review_snapshots`; calls/direction requests | free; app approval by Google can take days | GBP owner account; OAuth consent |
| Google Maps Distance Matrix | miles per job → `mileage_log` | $5 / 1,000 requests after $200/mo free credit — effectively free at this volume | Cloud project + API key in Worker secrets |
| Google Calendar | jobs ↔ events (`calendar_event_id`) | free | OAuth or service account on the business calendar |
| Bank CSV import (Bluevine / Capital One) | `bank_transactions` → suggested matches, duplicate detection | free (manual monthly upload) — recommended first | nothing |
| Plaid (live bank feed) | same, automatic | ~$0.30 per connected account/month on Pay-as-you-go plus fixed minimums; overkill today | not recommended yet |
| Stripe fee capture | already wired; only needs the secret | free | `STRIPE_SECRET_KEY` in Netlify |

Recommendation: bank CSV import + Stripe secret now (free, no approvals); Meta spend next; GBP when the review push starts.
