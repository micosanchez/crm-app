# Moving tote rentals (built 2026-10-12)

One division inside the CRM: public booking, Stripe deposits with the card kept on file, e-signed agreement, dispatch, check-in with fees, automated texts, reports, connector tools, and a landing page on sanchezhaulco.com.

## Go-live checklist (in order)

1. **Migration** `supabase/migrations/0051_rentals.sql` in the Supabase SQL editor (one paste, one transaction). Last statement prints row counts: 40 totes, 2 dollies, 1 settings row, 1 add-on.
2. **Netlify env** (crmsjh.netlify.app → Site configuration → Environment variables):
   `STRIPE_SECRET_KEY` (sk_test_… until step 6 passes), `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…), `CRON_SECRET` (any long random string), plus the ones already there (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `QUO_API_KEY`).
3. **Stripe webhook** → `https://crmsjh.netlify.app/api/stripe/webhook`, events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`, `setup_intent.succeeded`, `charge.refunded`, `charge.dispute.created`, `payment_method.detached`, `customer.updated` (keep the invoice events already selected).
4. **Merge the branch** → Netlify builds. The scheduled function `rental-cron` runs every 15 minutes with `CRON_SECRET`.
5. **Fill in prices** at `/rentals/packages` and fees at `/rentals/settings`. A package without a price does not show on the booking page. Paste or edit the terms once; the version bumps itself.
6. **Test in Stripe test mode** (see below), then swap to live keys and delete the test rentals.
7. **Website**: Netlify Drop the zip `~/Downloads/SJHC Command Center_files/sanchezhaulco-DEPLOY-2026-10-12.zip` onto the hilarious-rolypoly-6357d4 site. `/totes` goes live with the live packages pulled from the CRM.

## Stage 11 test script (Stripe test mode)

Card numbers are shown on the rental detail page while the secret key is a test key.

1. Open `/rent` (or `/totes` on the site). Book 20 totes + 1 dolly for a date two days out. Sign, pay the deposit with `4242 4242 4242 4242`. Expect: rental turns **booked**, confirmation text + email, owner email, `booking_confirmed` event, deposit charge `succeeded`.
2. `/rentals/today?day=<delivery date>` → Check out totes → scan or tap tags → Mark delivered. Expect: items out, `delivered` text, balance charged if settings say "delivery".
3. Customer page (link in the text) → Extend one week. Expect extension charge succeeded, pickup moved.
4. `/rentals/<id>` → Check in: mark one tote **damaged** with a photo, one **missing**. Expect pending fee lines for damage and replacement.
5. Charges review → Settle. Expect deposit applied first, leftover refunded or balance charged, receipt text, status **closed**.
6. Found item → the missing tote comes back: replacement fee refunded.
7. Failure paths: book another rental with `4000 0000 0000 0341` (attaches, then fails) → settle fails → text with payment link → owner email after retries. `4000 0027 6000 3184` forces 3‑D Secure → `requires_action` → payment link text.
8. Dispute: in the Stripe test dashboard, create a dispute on the deposit charge → rental flagged DISPUTE on the board, owner email, evidence packet at `/rentals/<id>/evidence`.
9. Cancel a booked rental more than 48 h before delivery → full refund; inside 48 h → partial per settings.
10. Waitlist: book every tote for a date, try to book again → waitlist card → cancel the first rental → cron texts the first person on the waitlist.

## Screens

| Route | What it is |
|---|---|
| `/rent` (public) | Booking flow. `?package=&date=&code=&embed=1&resume=<token>` |
| `/rental/<token>` (public) | Customer page: status, receipts, agreement PDF, extend, move pickup, update card, cancel |
| `/rental/<token>/card` | Update the card on file (SetupIntent) |
| `/rentals` | Board by status with OVERDUE / PAYMENT FAILED / CARD EXPIRING / DISPUTE flags |
| `/rentals/<id>` | Detail: schedule, payments, check-out, check-in, charges review, agreement, texts, notes, events |
| `/rentals/<id>/evidence` | Printable dispute packet |
| `/rentals/calendar` | Week / day, merged with junk jobs (same-address trips flagged) |
| `/rentals/today` | Route with navigate / call / text / On my way |
| `/rentals/inventory` | Assets, bulk add, mark damaged / lost / retired |
| `/rentals/packages` | Packages and add-ons with a preview card |
| `/rentals/settings` | Fees, deposits, scheduling, delivery, goals, terms, message templates (admin) |
| `/rentals/reports` | rental_report: revenue, utilization, losses, payback, conversion, cross-sell |
| `/rentals/labels` | QR labels, 2×1 in. `/rentals/scan/<tag>` is what the QR opens |
| `/rentals/partners` | Realtor partners, promo codes, monthly statement |
| `/rentals/waitlist` | Who is waiting and who was texted |
| `/request?source=tote_rental&rental=<id>` | Junk cross-sell: prefilled, saved as `tote_rental_crosssell` and linked to the rental |

## APIs

- Public (CORS open): `/api/public/rentals/{catalog,quote,hold,sign,payment-intent,confirm,me,waitlist}`
- Staff / connector: `POST /api/rentals` `{action, rental_id, ...}` with the session cookie or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; actions in `src/lib/rentals/actions.ts`
- Cron: `POST /api/cron/rentals` with `x-cron-secret`
- Webhook: `/api/stripe/webhook` (rental events routed by `metadata.rental_id`)

## Connector (v2.2.0, deployed)

`list_rentals`, `get_rental`, `check_tote_availability`, `rental_schedule`, `create_rental` (books by phone and texts the sign-and-pay link), `update_rental`, `cancel_rental`, `extend_rental`, `record_delivery`, `record_pickup`, `charge_rental`, `settle_rental`, `refund_rental_charge`, `send_rental_payment_link`, `send_rental_text`, `list_rental_assets`, `update_rental_asset`, `rental_report`. `revenue_summary` now returns `rental_revenue`. Money-moving tools need `confirm: true`. Source: `connector/rental_tools.js` + `connector/patch_rentals.py`.

## Money model

`rental_charges` is the ledger. `deposit` is held, never revenue. `rental_payment` / `balance` / fee rows with a Stripe intent are collected money. `deposit_applied` on the rental is how much of the deposit covered fees. `balance_due` is recomputed by trigger. `rental_revenue(from,to)` = succeeded + refunded non-deposit charges, and it is its own line in `pnl_report`, `weekly_scorecard` and `monthly_close`.

## Texts

Queue table `rental_messages`, drained by the cron inside 8am–8pm Detroit, only to customers who ticked SMS consent, and never to `sms_opt_outs`. Templates (no prices) are editable in Settings; variables are listed there.

## Shortcuts taken

- Website booking is the CRM flow in an iframe (`/rent?embed=1`); the parent page fires `ToteBooking` + `Purchase` to the Meta pixel from a postMessage.
- Geocoding is Nominatim with a 1.3× road factor; an address it cannot find returns `address_not_found` and the customer is told to call.
- QR scanning uses `BarcodeDetector` (Android Chrome); on iPhone tap the tag chips.
- Calendar moves are date inputs on the rental, not drag and drop.
- The cross-sell link goes to the CRM `/request` page rather than the website form so the lead is tagged without a webhook change.
