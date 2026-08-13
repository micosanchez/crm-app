-- 0030 App/DB-side fixes for the connector-created-quote gaps (issues 1, 3, 6 data).
-- Connector (Cloudflare Worker) changes for update_quote / update_customer / the
-- create_* input schemas are OUT OF SCOPE here — this is only what the DB + app own.
--
--   Issue 3: customers had no state / postal_code. Add them (state defaults 'MI').
--   Issue 6: estimates had no scheduled_start. Add it so a quote can carry an
--            arrival time that the accept->job flow (0031) turns into a booked job.
--   Issue 1: #67 already renders split correctly; only its wording needs the two
--            words that were dropped ("countertop", "transport").
--   Backfills: Rogelio's ZIP/state, #67's schedule, and existing customers' state
--            (Sanchez Junk & Haul is a Downriver-Michigan-only business, so 'MI').

-- ---------- Issue 3: customer state + postal_code ----------
alter table public.customers add column if not exists state       text default 'MI';
alter table public.customers add column if not exists postal_code text;

-- Existing customers are all Downriver MI; give them the default so the address
-- block renders a state. (Per-customer corrections happen in the app / connector.)
update public.customers set state = 'MI' where state is null;

-- ---------- Issue 6: estimate can carry an arrival time ----------
alter table public.estimates add column if not exists scheduled_start timestamptz;

-- ---------- Backfill: Rogelio Herrera (quote #67 customer) ----------
update public.customers
  set state = 'MI', postal_code = '48195'
  where id = 'd52900cf-fd3b-433d-9a13-c4b206d78f7a';

-- ---------- Backfill: quote #67 exact wording + arrival time ----------
update public.estimates
  set line_item = 'Kitchen Cabinet Removal & Hauling',
      description = 'Removal and haul-away of kitchen cabinets, cabinet doors, countertop and wood debris staged in the garage and alongside the house. Includes hand-loading onto the trailer, all labor, transport, disposal at a licensed facility, disposal fees, and travel.',
      scheduled_start = '2026-08-15 10:00:00 America/Detroit'::timestamptz
  where estimate_number = 67;

-- Keep the legacy estimate_items row (what the connector's list_quotes echoes)
-- consistent with the corrected wording, preserving the "title || paragraph" form.
update public.estimate_items
  set description = 'Kitchen Cabinet Removal & Hauling || Removal and haul-away of kitchen cabinets, cabinet doors, countertop and wood debris staged in the garage and alongside the house. Includes hand-loading onto the trailer, all labor, transport, disposal at a licensed facility, disposal fees, and travel.'
  where estimate_id = (select id from public.estimates where estimate_number = 67);
