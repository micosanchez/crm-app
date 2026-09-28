---
name: sjhc-expense-import
description: Turn a bank or card statement into logged business expenses for Sanchez Junk & Haul WITHOUT typing each one. Trigger when Mico uploads a statement (PDF, CSV, or screenshot) or says "log my expenses", "import my statement", "do my bank statement", "here's my Bluevine/credit card statement", "categorize my spending". Reads the file, auto-categorizes through the connector, asks only about the unclear ones, then bulk-imports.
---

# SJHC expense import

Mico uploads a statement; you turn it into recorded expenses using the
`sjhc-connector` tools. The whole point: he answers a few quick questions instead
of typing rows. Pricing, quotes, jobs, and payments are other skills — this one
only ingests spending from a statement.

## The engine you're driving

`bulk_import_expenses` is built for exactly this. It takes up to 200 rows (a raw
`line` per row is enough), guesses a category and pulls the amount/date for each,
and returns any it isn't sure about as **needs_review WITHOUT writing them**. Set
`dry_run: true` to classify the whole batch and write nothing. `categorize_expense`
does the same for a single line. Never file a low-confidence line silently.

## The flow

1. **Read the file.** Statements arrive as PDF (most banks), CSV (exports), or a
   screenshot. Pull every transaction: date, description, amount, and which
   account it's on — that sets `default_paid_with` (`bluevine`, `credit_card`,
   `cash_app`, `venmo`, `zelle`, `cash`, `other`).

2. **Keep money OUT only.** Drop deposits, customer payments coming in, transfers
   between his own accounts, credit-card payments, and refunds — none are
   expenses. If a line could be a charge or a refund, ask.

3. **Don't double-import.** Run `list_expenses` for the statement's date range
   first. If dates + amounts already match what's on file, the statement was
   likely imported before — say so and ask before importing again.

4. **Pre-classify in one pass.** Send the money-out lines to
   `bulk_import_expenses` with `dry_run: true`. Nothing is written; you get a
   category guess per row and the needs_review flags.

5. **Ask only about what's unclear — batched, never line by line.** Group the
   dry-run result and put the likely answer as the default so he can just say
   "yep":
   - **Clear business** (fuel at a gas station, dump/landfill, a known vendor):
     list them compactly, one confirmation for the whole group.
   - **needs_review / low confidence**: one short question, all together —
     e.g. "Three I'm unsure on: $48 SHELL (fuel?), $210 REPUBLIC SVCS (dump
     fees?), $63 HOME DEPOT (equipment or a repair?)."
   - **Looks personal** (groceries, restaurants, streaming, ATM withdrawals):
     propose skipping, list them, let him pull any back in. Never file personal
     spending as a business expense.

6. **Link to a job only when it's obvious.** A dump fee or fuel charge on a day
   with a single job can take that `job_id`; otherwise leave it unlinked. Don't
   go hunting for links — that's not worth his time here.

7. **Import the confirmed batch.** Call `bulk_import_expenses` again with
   `dry_run` off, `default_paid_with` set to the account, and an explicit
   `category` on every row you reviewed (explicit category skips re-guessing).
   Leave off the personal ones he skipped.

8. **Report the numbers, not "done".** How many imported, the total dollars, the
   per-category breakdown, and anything skipped or still unresolved. Then offer
   `expense_summary` for the period so he sees where the money went.

## The 21 categories — map every expense to one, there are no others

`dump_fees` · `dumpster_rental` · `fuel` · `payroll` · `job_supplies` ·
`crew_meals` · `equipment_purchase` · `equipment_repair` · `vehicle_repair` ·
`vehicle_mileage` · `insurance` · `marketing` · `office` · `software` ·
`utilities` · `permits` · `payment_processing` · `bank_fees` · `owner_draw` ·
`personal` · `misc`

- **owner_draw** — Mico paying himself (transfers to his personal account, Capital One
  payments from the business account). Import it; it is tracked and kept out of profit.
- **personal** — personal spend on the business card (streaming, Apple, restaurants
  that weren't crew food). Import it as `personal` rather than skipping — the
  ledger should match the statement — unless he says to leave it out.
- **crew_meals** — food on a job day for the crew. **job_supplies** — small Home Depot
  runs, ice, bags, straps (under ~$250). **equipment_purchase** over ~$250 is
  capital: pass `expense_class: capital`.
- **payroll** — only if there is no matching helper hours entry; the connector
  generates payroll expenses from paid hours, and a duplicate is a double count.
  If a Cash App / Venmo / Zelle to a helper shows up, check `unpaid_labor` first and
  prefer `mark_hours_paid`.
- **payment_processing** / **bank_fees** — Stripe/Square fees, ATM and wire fees.

When two genuinely fit (Home Depot could be equipment_purchase or
equipment_repair; a mechanic could be vehicle_repair or equipment_repair), ask
rather than guess.

## Duplicates

Pass the bank's descriptor as `bank_txn_ref` on every row. `bulk_import_expenses`
returns rows that match an existing expense (same reference, or same amount
±$0.50 within ±2 days with a similar vendor) as **possible_duplicate**, unwritten.
Show them as their own group; import only the ones he confirms are separate charges.
Pending charges: `is_pending: true`; re-importing once posted matches the reference.

## Fixing a mistake

`update_expense` changes category, class, amount, vendor, job link or date;
`delete_expense` removes a row (soft delete, stays in the audit log). Reclassing
a Meta charge to a campaign: `update_expense(campaign_id)`.

## Keep it fast

He came here to stop typing. Batch every question into one turn, default to the
likely category, and never ask about a line the guess already nailed. Ten
transactions should be two or three questions and then it's filed.
