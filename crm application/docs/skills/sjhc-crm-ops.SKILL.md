---
name: sjhc-crm-ops
description: Operate the SJHC Command Center CRM for Sanchez Junk & Haul: log jobs, payments, expenses and crew hours, write quotes, pull reports. Use when Mico records business activity or asks how it went.
---

# SJHC CRM operations

The `sjhc-connector` tools reach Mico's CRM. This skill decides **what** to write,
in what order, and when to stop and ask.

## Pricing belongs to another skill

`sanchez-job-pricing` owns every number — the $90 minimum, margin targets, dump
tiers, fuel, drive time, load estimation. Never recompute, adjust, or second-guess
a price here. This skill picks up once a price exists and gets it into the system.

## Phrasing → tool

| Mico says | Tool |
|---|---|
| "quote", "estimate", "bid", "send them a price" | `create_quote` |
| "they took it", "passed on it", "that one expired" | `update_quote_status` — declined/expired **need `loss_reason`**; "never heard back" = `no_response_ghosted` |
| "what's still out there", "old quotes" | `list_quotes`, `stale_quotes` |
| "booked", "on the schedule Tuesday" | `create_job` — **needs `service_type`** (what kind of job); ask if he didn't say |
| "did", "finished", "wrapped", "knocked out" | `complete_job` — with `owner_hours`, `load_fraction`, `helper_labor`, `dump_ticket` |
| "paid", "got paid", "Venmo'd me" — **at close-out** | `complete_job` (paid + method) |
| "paid", "that one finally came in" — **after close-out** | `record_payment` |
| "spent", "dump fee", "gas", "bought" | `create_expense` |
| a pasted bank export | `categorize_expense` → `bulk_import_expenses` |
| helper's name + hours | `log_hours` (or `helper_labor` inside `complete_job`) — this IS the record of helper pay |
| "I paid myself", "took $300 out" | `create_expense(category owner_draw)` — stays in the ledger, out of profit |
| "I spent 3 hours quoting today", "drove to the dump" | `log_owner_time(hours, activity, job_id?)` |
| "dump ticket $48 Riverview, covered two jobs" | `log_dump_ticket(cost, site, job_ids)` |
| "new commercial account", "property manager wants monthly" | `create_account`, `update_account`, `list_accounts` |
| "someone called about a couch" (no form, no text) | `create_lead` → later `update_lead` |
| "left us a review" | `log_review` |
| "what do I owe Jeremiah" | `unpaid_labor` → `mark_hours_paid` |
| "new helper", "he's $30 now" | `create_worker`, `update_worker_rate` |
| "how'd July go", "am I making money", "what's my hourly" | `pnl_report`, `unit_economics`, `owner_hourly` (cash basis, tips separate, owner draws excluded) |
| "why am I losing quotes", "which channel works" | `quote_win_rate`, `channel_roi`, `service_line_profitability` |
| "what's outstanding", "did I make money on that one" | `outstanding_balances`, `job_profitability`, `customer_metrics` |
| "what's in the pipe", "anything leaking" | `pipeline_report` |
| "how was the week", "close out August", "am I ready to go full time" | `weekly_scorecard`, `monthly_close`, `full_time_readiness` |
| "what's wrong with my data", weekly hygiene | `data_health_check` — fix what it lists, in the order listed |
| "what's today look like", "who owes me", "how's it going" | `get_schedule`, `list_invoices`, `dashboard_summary` |

Any customer reference starts with `find_customer`.

## Echo the record, not a success message

After every write, one line containing the identifying facts — id, customer,
place, amount:

> Job `532eede6` — Autumn Aguilar, 6841 Bailey, $120, paid.

A wrong match has to be visible in the same breath as the write. "Done" and
"Saved" hide it.

## Closing out a job, always ask two things

When Mico says a job is done, ask — in one question, not a form:

**Has it been paid, and how?** (cash, Venmo, card, check)

Don't assume it's unpaid, and don't assume Venmo just because that's his usual.
If it isn't paid, close the job without payment; it shows up in
`outstanding_balances` until the money lands, then use `record_payment`.

Then the 60-second close-out, in one question, defaults offered:
**what kind of job** (`service_type`, if the job doesn't have one), **how many
loads** (`load_fraction`: 0.5, 1, 2), **who helped and for how long**
(`helper_labor` — this creates the hours; `paid: true` if he already paid them),
**his own hours** (`owner_hours`), and **the dump ticket** (`dump_ticket`: cost +
site). `complete_job` answers with `still_missing`; read it back and offer to fill
the gaps, once. Never invent a value to make it empty.

Helper pay lives in hours, not expenses: `complete_job(helper_labor)` / `log_hours`
→ `mark_hours_paid` generates the payroll expense. Do not also `create_expense`
for payroll — the database rejects it on a job with logged hours unless an
`override_reason` is given, and that should be rare.

## Owner pay, personal spend, capital

- Mico paying himself → `create_expense` with `category: owner_draw`. Recorded, never profit.
- Something personal on the business card → `category: personal`. Same.
- A tool or trailer over ~$250 → `expense_class: capital` (the category can stay
  `equipment_purchase`); it is tracked as an asset, not a monthly cost. Under that,
  `job_supplies`.
- Crew food → `crew_meals`. A rented dumpster → `dumpster_rental`. Card fees →
  `payment_processing` (automatic when `record_payment` gets `processing_fee`).

## Leads and quotes carry their own reasons

Every job needs a `lead_source` (inherits from the customer if omitted; `unknown`
is allowed and reported). Every declined or expired quote needs a `loss_reason`.
Every cancelled job needs a `cancel_reason`. When he doesn't say, ask — one
question with the likely answer as the default.

## More than one match means stop

Customers, workers, jobs alike: list the candidates and ask which one. Never take
the top hit, never "assuming you meant."

## Quotes

A quote is exactly **one** line item — never itemized. It has two customer-facing
parts that match the "THE JOB" box: a short **title** and a **description**
paragraph under it. The connector's `create_quote` has a single `description`
field, so write both into it separated by ` || ` (space-pipe-pipe-space):

    create_quote(description: "<short title> || <one-paragraph description>", total: <price>, service_type: <kind>, load_fraction: <loads>)

`service_type` and `load_fraction` come from the pricing conversation and ride
along to the job when the quote is accepted — set them on every quote.

- **Title** (before ` || `) — the job in a few words; this is the bold line under
  "THE JOB". e.g. `Furniture & Mattress Removal`, `Garage Cleanout`, `Hot Tub Removal`.
- **Paragraph** (after ` || `) — a sentence or two of plain-language description the
  customer reads under the title. e.g. `Main level and basement haul-away and disposal
  of two mattress sets, a platform bed, and a reclining loveseat. Includes all loading,
  labor, and disposal.`
- Title only is fine — omit ` || ` and the paragraph, and it renders as just the title.

The signing document splits ` || ` into the title + the description box automatically,
and **prefills Payment and Additional Terms from the business defaults** — never set
or restate terms in the quote.

The internal breakdown — dump fee, fuel, helper hours, margin — never reaches the
customer-facing quote. Not in the title, not in the paragraph, not in `notes`. Cost
reminders, if any, go in `notes` (internal-only) and never as a breakdown.

## Rates are stamped, not retroactive

`update_worker_rate` changes future hours only; already-logged hours keep the rate
they were logged at. So log hours at the rate actually worked, and never "fix" an
old rate by raising the default — that won't touch history, which is the point.

## Weekly catch-up sessions

Mico records in batches, roughly once a week. When he signals a catch-up, work in
this order:

1. Jobs completed
2. Payments received
3. Expenses
4. Labor hours
5. Owner hours for the week (`log_owner_time` per activity)
6. Reporting — last; end with `data_health_check` and fix what it lists

Confirm each group before starting the next, and hold every report until the
writes have landed so the numbers cover the whole week. Carry context forward:
don't make him restate a customer, date, or job he already gave you earlier in
the session.

## Gap logging

While operating, note friction — a field that doesn't exist, something you can't
query, an input that's awkward to give. Collect it and surface it at the **end**
of the response, never mid-task.

One occurrence is an anecdote. Only propose building something once a gap has
recurred.

## Scope

This skill covers operating the CRM through conversation. It does not cover
unattended automation. Anything that should fire on a schedule with nobody
present is a Supabase cron job — say so plainly rather than implying it can be
handled here.
