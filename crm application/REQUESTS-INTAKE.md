# Estimate requests — public intake form + Requests queue

Built 2026-09-15 against the "SJHC Command Center: Estimate Request Form + Quo Connector" plan.
Everything here is **additive**: one new migration, one new private bucket, new routes,
new endpoints. No existing table, column, RPC, trigger or policy was changed, and the
signing flow was not touched.

Ships dark behind `NEXT_PUBLIC_FF_REQUESTS`.

---

## 1. What's in this drop

### New

| File | What it is |
|---|---|
| `supabase/migrations/0038_estimate_requests.sql` | `estimate_requests` table, `sms_opt_outs` table, private `request-photos` bucket, RLS, audit trigger |
| `src/lib/requests.ts` | Phone E.164 + display + as-you-type formatting, field validation, `?ref=` → `lead_source` enum mapping, Turnstile check, client IP |
| `src/lib/quo.ts` | Quo transport, guardrails, outbox logging, message templates |
| `src/app/api/public/estimate-request/route.ts` | Public submit. Validates, honeypot, Turnstile, per-IP cap, inserts, returns signed upload URLs |
| `src/app/api/public/estimate-request/[id]/photos-done/route.ts` | Public. Lists the bucket, records what actually landed, emails Mico |
| `src/app/api/public/estimate-request/[id]/photo-urls/route.ts` | Public. Fresh upload slots for a retry after a failed upload |
| `src/app/api/text/route.ts` | Staff-only send over the business line |
| `src/app/request/page.tsx` + `RequestForm.tsx` | The public form, Direction A (paperwork) |
| `src/app/estimates/RequestsTabs.tsx` | Estimates \| Requests tabs with the new-count badge |
| `src/app/estimates/requests/*` | List, detail, accept/decline/spam actions, the shareable link card |
| `src/components/TextButton.tsx` | One-button text, used on the quote screen |

### Changed

`middleware.ts`, `SwRegister.tsx`, `Nav.tsx`, `BackButton.tsx` — `/request` is public and gets
no app chrome, same treatment as `/sign/`.
`flags.ts` — added `requests`.
`notify.ts` — `entityKind` widened to include `estimate_request`. No behavior change.
`EstimateDocument.tsx` — **the fallback letterhead phone moved from 313-348-3325 to (734) 537-8061.**
`estimates/page.tsx`, `estimates/new/page.tsx`, `QuoteComposer.tsx`, `estimates/[id]/*`,
`customers/page.tsx` — tabs, prefill-from-request, quote link-back, Text quote, the link card.

---

## 2. Decisions I made

The plan left 6 open. Here's what I did and why, so you can overrule any of them cheaply.

1. **Path is `/request`.** `?ref=` is optional and free text.
2. **Pre-built `ref` links:** facebook, instagram, google, nextdoor, text, yard_sign, website.
   `customers.lead_source` is a Postgres **enum**, and nextdoor isn't a member — so the raw ref is
   stored verbatim on the request (full attribution kept) and mapped to a legal enum value only when
   a customer is created. That avoids an `ALTER TYPE`, which would have had to run alone in its own
   migration.
3. **Success screen says "within a few hours."** Change the string in `RequestForm.tsx` if that's
   a promise you don't want to make.
4. **Accepting auto-opens the composer** with the customer attached, their words in the description,
   the first sentence suggested as the job title, and their photos in a strip beside the price field.
5. **`send_quote(method: sms)` uses Twilio today.** The Worker has the Twilio path wired but the
   three Twilio secrets were never set, so SMS has been failing gracefully since August. Nothing was
   ever actually sent. Quo replaces that pipe — see section 5. Twilio is out.
6. **Turnstile, optional.** If `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set,
   the widget renders and a missing or bad token is rejected. If they're absent, the widget isn't
   rendered and the honeypot plus the per-IP cap carry it. So you can ship today and add Turnstile
   whenever.

Two deviations from the plan worth knowing about:

- **STOP handling lives in a new `sms_opt_outs` table, not a `customers.do_not_text` column.**
  The plan's first non-negotiable was no changes to the `customers` schema. An opt-out keyed by
  E.164 also survives a customer being merged, renamed or deleted. Inbound STOP still needs the Quo
  webhook, which the plan defers; the table and the check in front of every automated send are
  already in place.
- **Quo sending lives in the Next app (`src/lib/quo.ts` + `/api/text`), not only in the Worker.**
  The plan said the app's Text buttons should call the Worker. That would need the Worker URL plus a
  shared token in the app. Both services can just hold `QUO_API_KEY` and write to the same outbox
  table, which is simpler and has one less thing to leak. The Worker still needs its own copy for the
  MCP tools — section 5.

---

## 3. Deploy order

1. **Run `0038_estimate_requests.sql`** in the Supabase SQL editor. It's additive and idempotent
   (verified by running it twice against a clean Postgres 16).
2. **Push the code.** Nothing is reachable until the flag is on, so this is safe on main.
3. **Set env vars in Netlify** (see below), then a clean rebuild — `NEXT_PUBLIC_*` vars are inlined
   at build time, so a cached rebuild won't pick them up.
4. **Test with the flag on but the link unpublished** (section 6).
5. **Then share the link.**

### Env vars

| Var | Where | Needed for |
|---|---|---|
| `NEXT_PUBLIC_FF_REQUESTS=1` | Netlify | Turns on `/estimates/requests` and the tabs. `/request` itself is always live once deployed |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify | Already set. The public endpoints need it — without it the form returns a 503 telling people to call |
| `NOTIFY_EMAIL` | Netlify | Already set. Where the "new request" email goes |
| `QUO_API_KEY` | Netlify **and** the Worker | Texting. Until it's set, every send is logged as skipped and nothing is sent |
| `QUO_FROM` | optional | Defaults to `+17345378061` |
| `NEXT_PUBLIC_FF_SMS=1` | Netlify | Shows the Text quote button |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Netlify | Optional bot check |

---

## 4. How the submit path works

The whole design turns on one rule: **the customer's typing is never lost.**

1. Browser posts the text fields only. No files.
2. Server validates, checks the honeypot, verifies Turnstile if configured, counts that IP's last
   hour (cap 5, counted across every status so marking something spam doesn't hand the sender a
   fresh allowance), normalises the phone to E.164, and inserts the row.
3. Server returns the request id plus one signed upload URL per photo the browser said it has,
   capped at 8.
4. Browser uploads directly to the private bucket. Each thumbnail shows its own state, and a
   progress bar counts the batch.
5. Browser calls `photos-done`. The server **lists the bucket** and records only objects that
   actually exist — the client's reported list is used for pixel dimensions and nothing else. Then
   it emails Mico.

If step 4 partly fails, the lead is already in and the success screen says so, with a
**Try those photos again** button. The retry asks the server for fresh slots; the server picks
indexes that aren't taken, so a retry can never overwrite a photo that did make it.

HEIC: iPhones handing over a `.heic` get `heic2any` lazily pulled from cdnjs, converted to JPEG,
then resized to 1600px at quality 0.8 like everything else. An iPhone original at 3 to 5 MB lands
around 300 KB. If the decoder can't be reached, the customer gets a plain sentence telling them to
pick the photo from the Photos app instead — not a silent failure.

---

## 5. Still to do — the Worker

I could not do the connector half. The `sjhc-connector` source isn't in this session (the local
folder is an iCloud placeholder, and there's no public repo), and I have no Cloudflare token this
time. Everything below is specified rather than written.

### Tools to add

| Tool | Input | Behavior |
|---|---|---|
| `list_estimate_requests` | `status?` (default `new`), `limit?` (default 25) | Select from `estimate_requests` ordered by `created_at desc`. Return name, city, description, photo count, status, age |
| `get_estimate_request` | `id` | Full row **plus** signed photo URLs — `storage.from('request-photos').createSignedUrls(paths, 1800)` |
| `accept_estimate_request` | `id`, `customer_id?`, `create_new?` | Same dedupe as `src/app/estimates/requests/actions.ts`: last-10-digits phone match, lowercased email match, normalised street substring. With matches and no `customer_id`/`create_new`, **return the candidates and stop** — don't guess. Otherwise create the customer (`lead_source` through `refToLeadSource`), set status `accepted` + `accepted_at` + `customer_id` |
| `decline_estimate_request` | `id`, `reason` | status `declined`, `declined_at`, `decline_reason` |
| `get_intake_link` | `ref?` | `https://crmsjh.netlify.app/request?ref=<ref>` |
| `send_text` | `to`, `content` | Port `sendText()` from `src/lib/quo.ts` verbatim. It's plain `fetch`, no deps |
| `send_intake_link` | `to`, `ref?`, `message?` | `send_text` with the `intake_link` template |

The Worker writes with the service role, so RLS isn't in the way. Log every write to `activity_log`
as `connector:<tool>` to match the existing 53 tools.

### Swapping `send_quote(method: sms)`

Replace the Twilio call with `sendText()`. Same tool, same outbox, new pipe. Keep the existing
outbox row shape; `src/lib/quo.ts` already writes `status`, `error` and `sent_at` the same way
`sendNotification` does.

Quo specifics, all handled in `src/lib/quo.ts` and **verified against quo.com/docs 2026-09-15**
(Quo is the former OpenPhone; the docs confirm every field below):

- `POST https://api.quo.com/v1/messages`
- `Authorization: <raw key>` — **no** `Bearer` prefix
- `{ content, from: "+17345378061", to: ["+1..."] }`, content ≤ 1600 chars, text only
- 202 with `data.id`, `data.conversationId`, `data.status`
- 400 A2P not approved · 401 bad key · 402 subscription · 403 daily cap · 404 not found — each gets
  a sentence a person can act on
- `setInboxStatus: "done"` on automated sends so they don't sit open in the Operations inbox

### Automation guardrails (already built, app side)

Every **automated** send checks, in order: quiet hours (nothing before 8am or after 8pm Eastern,
computed in `America/Detroit` regardless of the server clock), the `sms_opt_outs` table, a 48-hour
per-number cooldown, and a 50/day cap. A person pressing a button skips all four. The reason for any
skip comes back in plain language rather than a silent no-op.

The expired-quote follow-up is **not** built. Per the plan it should draft into the outbox for
approval rather than send, so it needs an approval screen first.

### Message templates

Defaults live in `TEMPLATES` in `src/lib/quo.ts`: `intake_link`, `request_received`, `quote_link`,
`quote_followup`, `on_my_way`, `job_complete`. The plan wants these editable under
Settings → Delivery. That needs somewhere to store them, and `business_settings` is off-limits under
the non-negotiables, so it's a small new table plus a form — not in this drop.

---

## 6. Test checklist

Verified here:

- [x] Migration runs clean, twice, on Postgres 16. Status check fires on a bad value, NOT NULL fires
      on a missing description, bucket is private, RLS on, 8 indexes, audit row written on insert.
- [x] `(734) 555-1234` → `+17345551234`. 23 helper cases pass, including the NANP rules that reject
      `134-555-1234` and `734-155-1234`.
- [x] Every required field blank → 8 named errors, nothing posted.
- [x] `next build` clean with the flags on. No new lint or type errors.
- [x] `/request` renders at 390px and 360px with no horizontal page scroll.

Needs a real device and a real key:

- [ ] 8 HEIC photos from an iPhone over cellular.
- [ ] Kill the connection mid-upload → fields preserved, **Try those photos again** works.
- [ ] Bot submit without a Turnstile token → rejected, no row (needs the keys set).
- [ ] 6 submits from one IP in an hour → the 6th is rejected.
- [ ] Accept a request whose phone matches an existing customer → the dedupe prompt appears and
      "use existing" links without creating a duplicate.
- [ ] Browser back from detail → the same filtered list. Back from the composer → the request.
- [ ] Quo send with a bad key → 401 surfaced on screen, outbox row `failed`, nothing silently dropped.
- [ ] Quo send to a test number → 202, arrives from (734) 537-8061 in the Operations inbox.

---

## 7. Accounting

Dead, and already absent. `grep -ri accounting src/` on `main` returns nothing — no pages, no lib,
no nav entry. The only traces are `supabase/migrations/0020_accounting.sql` and
`0021_accounting_enhancements.sql`, which **already ran in production**. Deleting those files
wouldn't drop the tables, it would just lose the record of what created them, so they stay.

If you want the tables gone from Supabase, that's a `drop table` script and a separate decision —
say the word. Otherwise they're inert.
