-- 0051 — Rentals branch (Sanchez moving-tote rental division), 2026-10-12.
-- Shares the Supabase project, the customers table and the Stripe account. Touches NO junk-removal table
-- except: customers.stripe_customer_id (new nullable column) and estimate_requests.rental_id (cross-sell link).
-- Everything the public booking page needs goes through SECURITY DEFINER functions granted to anon;
-- anon has no direct access to any rental table. Staff (admin/dispatcher) have full access via RLS.
-- Card data: only Stripe ids, brand, last4 and expiry are ever stored.

alter type public.lead_source add value if not exists 'tote_rental_crosssell';

alter table public.customers add column if not exists stripe_customer_id text;
alter table public.estimate_requests add column if not exists rental_id uuid;

-- ============ assets ============
create table if not exists public.rental_assets (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null check (asset_type in ('tote','dolly','zip_ties','labels','other')),
  asset_tag text not null unique,
  status text not null default 'available' check (status in ('available','reserved','out','returned_dirty','damaged','lost','retired')),
  condition_notes text,
  purchase_cost numeric(10,2),
  purchase_date date,
  created_at timestamptz not null default now()
);

-- ============ packages / add-ons ============
create table if not exists public.rental_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  tote_count int not null default 0 check (tote_count >= 0),
  rental_days_included int not null default 14 check (rental_days_included > 0),
  price numeric(10,2),
  extra_week_price numeric(10,2),
  deposit_amount numeric(10,2),
  active boolean not null default true,
  sort_order int not null default 0
);
create table if not exists public.rental_addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_type text not null check (asset_type in ('tote','dolly','zip_ties','labels','other')),
  price numeric(10,2),
  per text not null default 'rental' check (per in ('rental','day')),
  max_qty int not null default 2 check (max_qty >= 0),
  active boolean not null default true,
  sort_order int not null default 0
);

-- ============ settings (one row) ============
create table if not exists public.rental_settings (
  id boolean primary key default true check (id),
  late_fee_per_day numeric(10,2),
  replacement_fee_per_tote numeric(10,2),
  replacement_fee_per_dolly numeric(10,2),
  cleaning_fee_per_tote numeric(10,2),
  damage_fee_per_tote numeric(10,2),
  delivery_fee_base numeric(10,2),
  free_delivery_radius_miles numeric(6,1),
  per_mile_fee numeric(10,2),
  max_service_radius_miles numeric(6,1) not null default 25,
  deposit_mode text not null default 'fixed' check (deposit_mode in ('fixed','percent')),
  deposit_percent numeric(5,2),
  cancel_full_refund_hours int not null default 48,
  booking_lead_time_hours int not null default 24,
  max_bookings_per_slot int not null default 3,
  service_days int[] not null default '{0,1,2,3,4,5,6}',   -- 0 = Sunday
  slot_windows jsonb not null default '{"weekday":["5-7pm","7-9pm"],"weekend":["9-11am","11-1pm","1-3pm","3-5pm"]}',
  blackout_dates jsonb not null default '[]',
  turnaround_days int not null default 1,
  failed_trip_fee numeric(10,2),
  balance_charge_mode text not null default 'delivery' check (balance_charge_mode in ('booking','delivery','pickup')),
  monthly_goal_low numeric(10,2) not null default 300,
  monthly_goal_high numeric(10,2) not null default 500,
  terms_version int not null default 1,
  terms_text text,
  templates jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.rental_settings (id) values (true) on conflict (id) do nothing;

-- Terms edits bump the version automatically.
create or replace function public.rental_settings_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.terms_text is distinct from old.terms_text then new.terms_version := old.terms_version + 1; end if;
  return new;
end $$;
drop trigger if exists rental_settings_touch on public.rental_settings;
create trigger rental_settings_touch before update on public.rental_settings for each row execute function public.rental_settings_touch();

-- ============ partners / promo codes (Stage 13) ============
create table if not exists public.rental_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brokerage text,
  phone text,
  email text,
  referral_code text not null unique,
  discount_type text not null default 'fixed' check (discount_type in ('fixed','percent')),
  discount_amount numeric(10,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ rentals ============
create sequence if not exists public.rental_number_seq start 1001;
create table if not exists public.rentals (
  id uuid primary key default gen_random_uuid(),
  rental_number text not null unique default ('R-' || nextval('public.rental_number_seq')),
  public_token uuid not null unique default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  package_id uuid references public.rental_packages(id),
  status text not null default 'pending_payment' check (status in ('pending_payment','booked','delivered','out','pickup_scheduled','returned','inspected','closed','cancelled')),
  delivery_address text not null,
  pickup_address text,                                   -- null = same as delivery
  delivery_miles numeric(6,1),
  pickup_miles numeric(6,1),
  delivery_date date not null,
  delivery_window text not null,
  pickup_date date not null,
  pickup_window text,
  actual_delivered_at timestamptz,
  actual_picked_up_at timestamptz,
  tote_count int not null default 0,
  dolly_count int not null default 0,
  extra_weeks int not null default 0,
  subtotal numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  addons_total numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  deposit_amount numeric(10,2) not null default 0,
  deposit_status text not null default 'none' check (deposit_status in ('none','held','captured','applied','refunded')),
  deposit_applied numeric(10,2) not null default 0,
  balance_due numeric(10,2) not null default 0,
  stripe_customer_id text,
  stripe_payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp text,                                          -- MM/YY
  lead_source text,
  partner_id uuid references public.rental_partners(id),
  promo_code text,
  payer_name text,                                        -- "someone else is paying"
  payer_email text,
  sms_consent_at timestamptz,
  abandoned_text_sent_at timestamptz,
  junk_request_id uuid,                                   -- cross-sell: the estimate request this rental produced
  disputed_at timestamptz,
  notes_internal text,
  notes_customer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rentals_dates on public.rentals (delivery_date, pickup_date) where status not in ('cancelled','closed');
create index if not exists idx_rentals_customer on public.rentals (customer_id);

create table if not exists public.rental_items (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  asset_id uuid not null references public.rental_assets(id),
  checked_out_at timestamptz,
  checked_in_at timestamptz,
  return_condition text check (return_condition in ('good','dirty','damaged','missing')),
  photo_urls jsonb not null default '[]',
  unique (rental_id, asset_id)
);
create table if not exists public.rental_addon_lines (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  addon_id uuid not null references public.rental_addons(id),
  qty int not null check (qty > 0),
  unit_price numeric(10,2) not null default 0
);
create table if not exists public.rental_charges (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  type text not null check (type in ('deposit','rental_payment','balance','late_fee','missing_item','damage','cleaning','extension','adjustment','refund','failed_trip')),
  amount numeric(10,2) not null,                          -- refunds are negative
  description text,
  stripe_payment_intent_id text,
  stripe_refund_id text,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','requires_action','refunded','void')),
  failure_reason text,
  photo_urls jsonb not null default '[]',
  retry_count int not null default 0,
  next_retry_at timestamptz,
  payment_link_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rental_charges_rental on public.rental_charges (rental_id);
create unique index if not exists idx_rental_charges_pi on public.rental_charges (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create table if not exists public.rental_agreements (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  terms_version int not null,
  terms_snapshot text not null,
  signer_name text not null,
  signature_image_url text,
  pdf_url text,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);
create table if not exists public.rental_events (
  id bigserial primary key,
  rental_id uuid references public.rentals(id) on delete cascade,
  event text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_events_rental on public.rental_events (rental_id, created_at desc);

-- Outgoing customer messages queue (texts + emails). The cron drains it inside quiet hours.
create table if not exists public.rental_messages (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid references public.rentals(id) on delete cascade,
  template text not null,
  channel text not null default 'sms' check (channel in ('sms','email')),
  to_phone text,
  to_email text,
  body text not null,
  subject text,
  scheduled_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sent','skipped','failed','cancelled')),
  dedupe_key text unique,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rental_messages_due on public.rental_messages (scheduled_at) where status = 'queued';

create table if not exists public.rental_waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  start_date date not null,
  end_date date not null,
  tote_count int not null default 0,
  notified_at timestamptz,
  booked_rental_id uuid references public.rentals(id),
  created_at timestamptz not null default now()
);

create table if not exists public.rental_page_views (
  day date primary key,
  views int not null default 0
);

-- ============ RLS: staff only on every table; anon only via functions ============
do $$ declare t text; begin
  foreach t in array array['rental_assets','rental_packages','rental_addons','rental_settings','rental_partners','rentals','rental_items','rental_addon_lines','rental_charges','rental_agreements','rental_events','rental_messages','rental_waitlist','rental_page_views'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_staff on public.%I', t, t);
    execute format('create policy %I_staff on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end $$;

-- ============ audit: every status change is an event ============
create or replace function public.rentals_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create or replace function public.rentals_audit() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.rental_events (rental_id, event, detail) values (new.id, 'created', jsonb_build_object('status', new.status, 'total', new.total));
  elsif new.status is distinct from old.status then
    insert into public.rental_events (rental_id, event, detail) values (new.id, 'status:' || new.status, jsonb_build_object('from', old.status));
  end if;
  return null;
end $$;
drop trigger if exists rentals_touch on public.rentals;
drop trigger if exists rentals_audit on public.rentals;
create trigger rentals_touch before insert or update on public.rentals for each row execute function public.rentals_touch();
create trigger rentals_audit after insert or update on public.rentals for each row execute function public.rentals_audit();   -- AFTER: the row must exist before the event row's FK

create or replace function public.rental_charges_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists rental_charges_touch on public.rental_charges;
create trigger rental_charges_touch before update on public.rental_charges for each row execute function public.rental_charges_touch();

-- balance_due is derived. Money model:
--   fee rows (late_fee, missing_item, damage, cleaning, adjustment, failed_trip, extension) add to what is owed while
--   pending/failed/requires_action/succeeded; void/refunded rows are ignored.
--   payment rows (rental_payment, balance) and fee rows charged on their OWN payment intent count as paid when succeeded.
--   A settlement charge is one 'balance' row covering several fee rows (those are marked succeeded without a PI).
--   deposit_applied is the part of the held deposit used against the balance. 'refund' and 'deposit' rows are audit only.
create or replace function public.rental_recompute_balance(p_rental uuid) returns numeric language plpgsql as $$
declare v_total numeric; v_owed numeric; v_paid numeric; v_applied numeric; v_bal numeric;
begin
  select total, deposit_applied into v_total, v_applied from public.rentals where id = p_rental;
  select coalesce(sum(amount),0) into v_owed from public.rental_charges where rental_id = p_rental and type in ('late_fee','missing_item','damage','cleaning','adjustment','failed_trip','extension') and status in ('pending','failed','requires_action','succeeded');
  select coalesce(sum(amount),0) into v_paid from public.rental_charges where rental_id = p_rental and status = 'succeeded'
    and (type in ('rental_payment','balance') or (type in ('late_fee','missing_item','damage','cleaning','adjustment','failed_trip','extension') and stripe_payment_intent_id is not null));
  v_bal := round(greatest(v_total + v_owed - v_paid - coalesce(v_applied, 0), 0), 2);
  update public.rentals set balance_due = v_bal where id = p_rental and balance_due is distinct from v_bal;
  return v_bal;
end $$;
create or replace function public.rental_charges_recompute() returns trigger language plpgsql as $$
begin perform public.rental_recompute_balance(coalesce(new.rental_id, old.rental_id)); return null; end $$;
drop trigger if exists rental_charges_recompute on public.rental_charges;
create trigger rental_charges_recompute after insert or update or delete on public.rental_charges for each row execute function public.rental_charges_recompute();

-- ============ availability ============
-- Totes and dollies free for every day in the range. A rental occupies its counts from delivery_date through
-- pickup_date + turnaround_days while it is booked/delivered/out/pickup_scheduled, or a pending_payment hold
-- younger than 30 minutes. Assets that are damaged/lost/retired are not in the pool.
create or replace function public.get_tote_availability(start_date date, end_date date)
returns table(day date, totes_free int, dollies_free int)
language sql stable security definer set search_path = public as $$
  with pool as (
    select count(*) filter (where asset_type = 'tote') as totes, count(*) filter (where asset_type = 'dolly') as dollies
    from public.rental_assets where status not in ('damaged','lost','retired')),
  buf as (select coalesce(turnaround_days, 1) as d from public.rental_settings where id),
  days as (select generate_series(start_date, end_date, interval '1 day')::date as day),
  busy as (
    select d.day, coalesce(sum(r.tote_count),0) as totes, coalesce(sum(r.dolly_count),0) as dollies
    from days d left join public.rentals r
      on (r.status in ('booked','delivered','out','pickup_scheduled') or (r.status = 'pending_payment' and r.created_at > now() - interval '30 minutes'))
     and d.day between r.delivery_date and r.pickup_date + (select d from buf)
    group by d.day)
  select b.day, (p.totes - b.totes)::int, (p.dollies - b.dollies)::int from busy b, pool p order by b.day
$$;
grant execute on function public.get_tote_availability(date, date) to anon, authenticated;

-- Can this order fit on every day of [start, end]? (start..end inclusive; buffer handled by callers via end+turnaround)
create or replace function public.rental_can_fit(p_start date, p_end date, p_totes int, p_dollies int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(totes_free >= p_totes and dollies_free >= p_dollies), true) from public.get_tote_availability(p_start, p_end)
$$;
grant execute on function public.rental_can_fit(date, date, int, int) to anon, authenticated;

-- ============ public catalog ============
create or replace function public.rental_public_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packages', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'tote_count', tote_count, 'rental_days_included', rental_days_included, 'price', price, 'extra_week_price', extra_week_price, 'deposit_amount', deposit_amount) order by sort_order, name), '[]') from public.rental_packages where active and price is not null),
    'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'asset_type', asset_type, 'price', price, 'per', per, 'max_qty', max_qty) order by sort_order, name), '[]') from public.rental_addons where active and price is not null),
    'settings', (select jsonb_build_object('delivery_fee_base', delivery_fee_base, 'free_delivery_radius_miles', free_delivery_radius_miles, 'per_mile_fee', per_mile_fee, 'max_service_radius_miles', max_service_radius_miles,
      'deposit_mode', deposit_mode, 'deposit_percent', deposit_percent, 'cancel_full_refund_hours', cancel_full_refund_hours, 'booking_lead_time_hours', booking_lead_time_hours, 'max_bookings_per_slot', max_bookings_per_slot,
      'service_days', to_jsonb(service_days), 'slot_windows', slot_windows, 'blackout_dates', blackout_dates, 'turnaround_days', turnaround_days, 'late_fee_per_day', late_fee_per_day,
      'replacement_fee_per_tote', replacement_fee_per_tote, 'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'failed_trip_fee', failed_trip_fee,
      'terms_version', terms_version, 'terms_text', terms_text) from public.rental_settings where id),
    'slot_counts', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select delivery_date::text || '|' || delivery_window as k, count(*) as n from public.rentals where status in ('booked','delivered','out','pickup_scheduled') and delivery_date >= current_date group by 1
        union all
        select pickup_date::text || '|' || coalesce(pickup_window,'') as k, count(*) as n from public.rentals where status in ('booked','delivered','out','pickup_scheduled') and pickup_date >= current_date group by 1) s)
  )
$$;
grant execute on function public.rental_public_catalog() to anon, authenticated;

create or replace function public.rental_track_view() returns void language sql security definer set search_path = public as $$
  insert into public.rental_page_views (day, views) values ((now() at time zone 'America/Detroit')::date, 1) on conflict (day) do update set views = public.rental_page_views.views + 1
$$;
grant execute on function public.rental_track_view() to anon, authenticated;

-- ============ pricing ============
-- p: {package_id, extra_weeks, addons:[{addon_id, qty}], delivery_miles, pickup_miles, promo_code}
create or replace function public.rental_quote(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.rental_settings; pk public.rental_packages; a record; v_weeks int := coalesce((p->>'extra_weeks')::int, 0);
        v_sub numeric := 0; v_add numeric := 0; v_del numeric := 0; v_disc numeric := 0; v_dep numeric := 0; v_total numeric; v_days int; v_lines jsonb := '[]';
        v_miles numeric; v_pmiles numeric; v_partner public.rental_partners; v_dollies int := 0;
begin
  select * into s from public.rental_settings where id;
  select * into pk from public.rental_packages where id = (p->>'package_id')::uuid and active;
  if pk.id is null then return jsonb_build_object('error', 'Pick a package.'); end if;
  if pk.price is null then return jsonb_build_object('error', 'That package has no price yet.'); end if;
  v_sub := pk.price + v_weeks * coalesce(pk.extra_week_price, 0);
  v_days := pk.rental_days_included + v_weeks * 7;
  for a in select (x->>'addon_id')::uuid as addon_id, (x->>'qty')::int as qty from jsonb_array_elements(coalesce(p->'addons','[]')) x loop
    declare ad public.rental_addons; begin
      select * into ad from public.rental_addons where id = a.addon_id and active;
      if ad.id is null or a.qty is null or a.qty <= 0 then continue; end if;
      if a.qty > ad.max_qty then return jsonb_build_object('error', format('Max %s of %s.', ad.max_qty, ad.name)); end if;
      v_add := v_add + ad.price * a.qty * case when ad.per = 'day' then v_days else 1 end;
      if ad.asset_type = 'dolly' then v_dollies := v_dollies + a.qty; end if;
      v_lines := v_lines || jsonb_build_object('addon_id', ad.id, 'name', ad.name, 'qty', a.qty, 'unit_price', ad.price, 'line', ad.price * a.qty * case when ad.per = 'day' then v_days else 1 end);
    end;
  end loop;
  v_miles := (p->>'delivery_miles')::numeric; v_pmiles := coalesce((p->>'pickup_miles')::numeric, v_miles);
  if v_miles is not null then
    if v_miles > s.max_service_radius_miles or v_pmiles > s.max_service_radius_miles then return jsonb_build_object('error', 'out_of_area'); end if;
    v_del := coalesce(s.delivery_fee_base, 0) + greatest(v_miles - coalesce(s.free_delivery_radius_miles, 0), 0) * coalesce(s.per_mile_fee, 0)
           + greatest(v_pmiles - coalesce(s.free_delivery_radius_miles, 0), 0) * coalesce(s.per_mile_fee, 0);
  end if;
  if nullif(p->>'promo_code','') is not null then
    select * into v_partner from public.rental_partners where upper(referral_code) = upper(p->>'promo_code') and active;
    if v_partner.id is null then return jsonb_build_object('error', 'That code is not valid.'); end if;
    v_disc := case when v_partner.discount_type = 'percent' then round((v_sub + v_add) * v_partner.discount_amount / 100, 2) else v_partner.discount_amount end;
    v_disc := least(v_disc, v_sub + v_add);
  end if;
  v_total := round(v_sub + v_add + v_del - v_disc, 2);
  v_dep := case when s.deposit_mode = 'percent' then round(v_total * coalesce(s.deposit_percent, 0) / 100, 2) else coalesce(pk.deposit_amount, 0) end;
  return jsonb_build_object('package', jsonb_build_object('id', pk.id, 'name', pk.name, 'tote_count', pk.tote_count, 'days', v_days, 'price', pk.price),
    'extra_weeks', v_weeks, 'subtotal', round(v_sub,2), 'addons', v_lines, 'addons_total', round(v_add,2), 'delivery_fee', round(v_del,2), 'delivery_miles', v_miles, 'pickup_miles', v_pmiles,
    'discount', round(v_disc,2), 'partner_id', v_partner.id, 'total', v_total, 'deposit', v_dep, 'balance', round(v_total - v_dep, 2), 'tote_count', pk.tote_count, 'dolly_count', v_dollies,
    'balance_charge_mode', s.balance_charge_mode, 'rental_days', v_days);
end $$;
grant execute on function public.rental_quote(jsonb) to anon, authenticated;

-- ============ hold (atomic availability re-check + create pending_payment) ============
-- p: quote inputs + {delivery_date, delivery_window, pickup_window, delivery_address, pickup_address, name, phone, email,
--     lead_source, notes_customer, sms_consent, payer_name, payer_email}
create or replace function public.rental_create_hold(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; s public.rental_settings; v_cust uuid; v_id uuid; v_phone text := public.to_e164(p->>'phone'); v_email text := lower(nullif(btrim(p->>'email'),''));
        v_start date := (p->>'delivery_date')::date; v_end date; v_day int; v_slot int; l record;
begin
  perform pg_advisory_xact_lock(hashtext('rental_hold'));   -- two browsers, one winner
  select * into s from public.rental_settings where id;
  q := public.rental_quote(p);
  if q ? 'error' then return q; end if;
  if v_start is null or v_start < (now() at time zone 'America/Detroit')::date then return jsonb_build_object('error', 'Pick a delivery date.'); end if;
  if v_start < ((now() + make_interval(hours => s.booking_lead_time_hours)) at time zone 'America/Detroit')::date then return jsonb_build_object('error', format('We need %s hours notice.', s.booking_lead_time_hours)); end if;
  v_day := extract(dow from v_start)::int;
  if not (v_day = any(s.service_days)) then return jsonb_build_object('error', 'We do not deliver on that day.'); end if;
  if s.blackout_dates ? v_start::text then return jsonb_build_object('error', 'That date is not available.'); end if;
  v_end := v_start + (q->>'rental_days')::int;
  if not public.rental_can_fit(v_start, v_end + s.turnaround_days, (q->>'tote_count')::int, (q->>'dolly_count')::int) then return jsonb_build_object('error', 'sold_out'); end if;
  select count(*) into v_slot from public.rentals where status in ('booked','delivered','out','pickup_scheduled','pending_payment') and delivery_date = v_start and delivery_window = p->>'delivery_window' and (status <> 'pending_payment' or created_at > now() - interval '30 minutes');
  if v_slot >= s.max_bookings_per_slot then return jsonb_build_object('error', 'slot_full'); end if;
  if coalesce(btrim(p->>'name'),'') = '' or v_phone is null then return jsonb_build_object('error', 'Name and phone are required.'); end if;

  -- reuse the customer by phone or email
  select id into v_cust from public.customers where deleted_at is null and (phone_e164 = v_phone or (v_email is not null and lower(email) = v_email)) order by created_at limit 1;
  if v_cust is null then
    insert into public.customers (name, phone, email, address, lead_source, segment, notes)
    values (btrim(p->>'name'), v_phone, v_email, p->>'delivery_address', case when public.is_lead_source(p->>'lead_source') then (p->>'lead_source')::public.lead_source else 'website_direct' end, 'residential', 'Created by the tote rental booking page')
    returning id into v_cust;
  end if;

  insert into public.rentals (customer_id, package_id, status, delivery_address, pickup_address, delivery_miles, pickup_miles, delivery_date, delivery_window, pickup_date, pickup_window,
    tote_count, dolly_count, extra_weeks, subtotal, delivery_fee, addons_total, discount_amount, total, deposit_amount, balance_due, lead_source, partner_id, promo_code, payer_name, payer_email, sms_consent_at, notes_customer)
  values (v_cust, (q->'package'->>'id')::uuid, 'pending_payment', p->>'delivery_address', nullif(btrim(coalesce(p->>'pickup_address','')),''), (q->>'delivery_miles')::numeric, (q->>'pickup_miles')::numeric,
    v_start, p->>'delivery_window', v_end, nullif(p->>'pickup_window',''),
    (q->>'tote_count')::int, (q->>'dolly_count')::int, (q->>'extra_weeks')::int, (q->>'subtotal')::numeric, (q->>'delivery_fee')::numeric, (q->>'addons_total')::numeric, (q->>'discount')::numeric,
    (q->>'total')::numeric, (q->>'deposit')::numeric, (q->>'balance')::numeric, nullif(p->>'lead_source',''), (q->>'partner_id')::uuid, nullif(upper(p->>'promo_code'),''),
    nullif(p->>'payer_name',''), nullif(lower(p->>'payer_email'),''), case when (p->>'sms_consent')::boolean then now() end, nullif(p->>'notes_customer',''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(q->'addons') x loop
    insert into public.rental_addon_lines (rental_id, addon_id, qty, unit_price) values (v_id, (l.value->>'addon_id')::uuid, (l.value->>'qty')::int, (l.value->>'unit_price')::numeric);
  end loop;
  return jsonb_build_object('rental_id', v_id, 'public_token', (select public_token from public.rentals where id = v_id), 'rental_number', (select rental_number from public.rentals where id = v_id), 'customer_id', v_cust, 'quote', q);
end $$;
grant execute on function public.rental_create_hold(jsonb) to anon, authenticated;

-- Pending holds older than 30 minutes are cancelled and release their slot. Returns the ones eligible for the one abandoned-booking text.
create or replace function public.rental_expire_holds() returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with x as (update public.rentals set status = 'cancelled', notes_internal = concat_ws(E'\n', notes_internal, 'Hold expired (no payment within 30 minutes)')
             where status = 'pending_payment' and created_at < now() - interval '30 minutes' returning id, public_token, customer_id, sms_consent_at, abandoned_text_sent_at)
  select coalesce(jsonb_agg(jsonb_build_object('rental_id', x.id, 'public_token', x.public_token, 'phone', c.phone, 'name', c.name, 'opted_in', x.sms_consent_at is not null and x.abandoned_text_sent_at is null)), '[]') into v
  from x join public.customers c on c.id = x.customer_id;
  return v;
end $$;

-- ============ customer-facing read by token ============
create or replace function public.rental_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'rental_number', r.rental_number, 'status', r.status, 'delivery_address', r.delivery_address, 'pickup_address', coalesce(r.pickup_address, r.delivery_address),
    'delivery_date', r.delivery_date, 'delivery_window', r.delivery_window, 'pickup_date', r.pickup_date, 'pickup_window', r.pickup_window,
    'tote_count', r.tote_count, 'dolly_count', r.dolly_count, 'extra_weeks', r.extra_weeks, 'subtotal', r.subtotal, 'delivery_fee', r.delivery_fee, 'addons_total', r.addons_total, 'discount_amount', r.discount_amount,
    'total', r.total, 'deposit_amount', r.deposit_amount, 'deposit_status', r.deposit_status, 'balance_due', r.balance_due, 'card_brand', r.card_brand, 'card_last4', r.card_last4, 'card_exp', r.card_exp,
    'notes_customer', r.notes_customer, 'sms_consent', r.sms_consent_at is not null, 'created_at', r.created_at,
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email),
    'package', (select jsonb_build_object('name', name, 'tote_count', tote_count, 'extra_week_price', extra_week_price, 'rental_days_included', rental_days_included) from public.rental_packages where id = r.package_id),
    'addons', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'qty', l.qty, 'unit_price', l.unit_price)), '[]') from public.rental_addon_lines l join public.rental_addons a on a.id = l.addon_id where l.rental_id = r.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('tag', a.asset_tag, 'type', a.asset_type, 'condition', i.return_condition)), '[]') from public.rental_items i join public.rental_assets a on a.id = i.asset_id where i.rental_id = r.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'amount', amount, 'description', description, 'status', status, 'created_at', created_at, 'photo_urls', photo_urls, 'payment_link_url', payment_link_url) order by created_at), '[]') from public.rental_charges where rental_id = r.id and status <> 'void'),
    'agreement', (select jsonb_build_object('signed_at', signed_at, 'signer_name', signer_name, 'terms_version', terms_version, 'pdf_url', pdf_url) from public.rental_agreements where rental_id = r.id order by signed_at desc limit 1),
    'settings', (select jsonb_build_object('cancel_full_refund_hours', cancel_full_refund_hours, 'late_fee_per_day', late_fee_per_day, 'terms_text', terms_text, 'terms_version', terms_version, 'replacement_fee_per_tote', replacement_fee_per_tote,
       'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'turnaround_days', turnaround_days) from public.rental_settings where id),
    'junk_request_id', r.junk_request_id)
  from public.rentals r join public.customers c on c.id = r.customer_id where r.public_token = p_token
$$;
grant execute on function public.rental_by_token(uuid) to anon, authenticated;

-- ============ overdue + late fees (daily) ============
-- Accrues one pending late_fee line per overdue day; nothing is charged here.
create or replace function public.rental_accrue_late_fees() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_fee numeric; v_today date := (now() at time zone 'America/Detroit')::date;
begin
  select late_fee_per_day into v_fee from public.rental_settings where id;
  if coalesce(v_fee, 0) <= 0 then return 0; end if;
  for r in select id, pickup_date from public.rentals where status in ('delivered','out','pickup_scheduled') and pickup_date < v_today loop
    for i in 1..(v_today - r.pickup_date) loop
      insert into public.rental_charges (rental_id, type, amount, description, status, created_by)
      select r.id, 'late_fee', v_fee, 'Late fee for ' || (r.pickup_date + i)::text, 'pending', null
      where not exists (select 1 from public.rental_charges c where c.rental_id = r.id and c.type = 'late_fee' and c.description = 'Late fee for ' || (r.pickup_date + i)::text);
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

-- ============ reports ============
create or replace function public.rental_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, date_trunc('month', (now() at time zone 'America/Detroit'))::date); v_to date := coalesce(p_to, (now() at time zone 'America/Detroit')::date);
        v_pool int; v_out jsonb;
begin
  select count(*) into v_pool from public.rental_assets where asset_type = 'tote' and status not in ('retired');
  with days as (select generate_series(v_from, v_to, interval '1 day')::date as day),
  util as (select d.day, coalesce((select sum(tote_count) from public.rentals r where r.status in ('delivered','out','pickup_scheduled','returned') and d.day between r.delivery_date and r.pickup_date), 0) as totes_out from days d),
  money as (select date_trunc('month', created_at at time zone 'America/Detroit')::date as m, type, sum(amount) as amt from public.rental_charges
            where status in ('succeeded','refunded') and (created_at at time zone 'America/Detroit')::date between v_from and v_to and type <> 'deposit' group by 1, 2),
  net as (select m, sum(amt) as net from money group by m)
  select jsonb_build_object('from', v_from, 'to', v_to, 'tote_pool', v_pool,
    'utilization', jsonb_build_object(
      'avg_pct_out', (select public.pct(avg(totes_out), v_pool) from util),
      'by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'pct_out', public.pct(avg_out, v_pool)) order by wk), '[]') from (select date_trunc('week', day)::date wk, avg(totes_out) avg_out from util group by 1) w),
      'avg_rental_days', (select public.r2(avg(pickup_date - delivery_date)) from public.rentals where status not in ('cancelled','pending_payment') and delivery_date between v_from and v_to),
      'idle_totes_today', v_pool - coalesce((select sum(tote_count) from public.rentals where status in ('delivered','out','pickup_scheduled') and current_date between delivery_date and pickup_date), 0)),
    'revenue_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(n.m, 'YYYY-MM'), 'net', public.r2(n.net), 'by_type', (select jsonb_object_agg(type, public.r2(amt)) from money mm where mm.m = n.m)) order by n.m), '[]') from net n),
    'net_total', (select public.r2(sum(net)) from net),
    'deposits_held', (select public.r2(sum(deposit_amount)) from public.rentals where deposit_status = 'held'),
    'balances_due', (select public.r2(sum(balance_due)) from public.rentals where status not in ('cancelled','closed','pending_payment')),
    'failed_charges_open', (select count(*) from public.rental_charges where status in ('failed','requires_action')),
    'losses', (select jsonb_build_object('lost_assets', count(*) filter (where status='lost'), 'damaged_assets', count(*) filter (where status='damaged'),
       'cost', public.r2(sum(purchase_cost) filter (where status in ('lost','damaged'))),
       'fees_recovered', (select public.r2(sum(amount)) from public.rental_charges where status = 'succeeded' and type in ('missing_item','damage'))) from public.rental_assets),
    'payback', jsonb_build_object('asset_spend', (select public.r2(sum(purchase_cost)) from public.rental_assets), 'net_revenue_to_date', (select public.r2(sum(amount)) from public.rental_charges where status in ('succeeded','refunded') and type <> 'deposit')),
    'lead_sources', (select coalesce(jsonb_object_agg(coalesce(lead_source,'unknown'), n), '{}') from (select lead_source, count(*) n from public.rentals where status not in ('cancelled','pending_payment') and created_at::date between v_from and v_to group by 1) x),
    'conversion', jsonb_build_object('page_views', (select coalesce(sum(views),0) from public.rental_page_views where day between v_from and v_to),
       'paid_bookings', (select count(*) from public.rentals where status not in ('cancelled','pending_payment') and created_at::date between v_from and v_to)),
    'goal', (select jsonb_build_object('low', monthly_goal_low, 'high', monthly_goal_high) from public.rental_settings where id),
    'crosssell', jsonb_build_object('requests', (select count(*) from public.estimate_requests where rental_id is not null and created_at::date between v_from and v_to),
       'quotes_won', (select count(*) from public.estimate_requests er join public.estimates e on e.id = er.quote_id where er.rental_id is not null and e.status = 'accepted'),
       'junk_revenue', (select public.r2(sum(i.total)) from public.estimate_requests er join public.estimates e on e.id = er.quote_id join public.invoices i on i.job_id = e.job_id where er.rental_id is not null and i.status = 'paid'))
  ) into v_out;
  return v_out;
end $$;
grant execute on function public.rental_report(date, date) to authenticated;

-- Rental revenue as its own division line in the P&L (cash basis, by charge date).
create or replace function public.rental_revenue(p_from date, p_to date) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.rental_charges where status in ('succeeded','refunded') and type <> 'deposit' and (created_at at time zone 'America/Detroit')::date between p_from and p_to
$$;

-- pnl_report: rental revenue is its own division line, included in profit
-- ============ pnl_report ============
create or replace function public.pnl_report(p_from date default null, p_to date default null, p_group_by text default 'month')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, date_trunc('month', public.detroit_today())::date);
        v_to date := coalesce(p_to, public.detroit_today());
        v_out jsonb;
begin
  with periods as (
    select case when p_group_by = 'all' then v_from else greatest(d::date, v_from) end as pstart,
           case when p_group_by = 'all' then v_to else least((d + interval '1 month' - interval '1 day')::date, v_to) end as pend
    from generate_series(date_trunc('month', v_from), date_trunc('month', v_to), interval '1 month') d
    where p_group_by <> 'all' or d = date_trunc('month', v_from)
  ),
  rev as (
    select p.pstart, sum(i.total - coalesce(i.tip,0)) as job_revenue, sum(coalesce(i.tip,0)) as tips, count(*) as paid_invoices
    from periods p join public.invoices i on (i.paid_at at time zone 'America/Detroit')::date between p.pstart and p.pend
    join public.jobs j on j.id = i.job_id
    where i.status = 'paid' and i.voided_at is null and i.deleted_at is null and not i.is_test and j.job_kind = 'customer' and not j.is_test
    group by p.pstart),
  exp as (
    select p.pstart, e.expense_class, e.category::text as category, sum(e.amount) as amt
    from periods p join public.expenses e on e.incurred_on between p.pstart and p.pend
    where e.deleted_at is null and e.labor_entry_id is null
    group by p.pstart, e.expense_class, e.category),
  labor as (
    select p.pstart, sum(coalesce(l.amount, l.hours*l.rate)) as helper_pay
    from periods p join public.labor_entries l on l.worked_on between p.pstart and p.pend
    join public.workers w on w.id = l.worker_id where not w.is_owner and l.deleted_at is null group by p.pstart),
  veh as (select p.pstart, public.vehicle_cost(p.pstart, p.pend) as vehicle_cost from periods p),
  rows as (
    select p.pstart, p.pend,
      coalesce(r.job_revenue,0) as job_revenue, coalesce(r.tips,0) as tips, coalesce(r.paid_invoices,0) as paid_invoices,
      coalesce((select jsonb_object_agg(category, public.r2(amt)) from exp e where e.pstart = p.pstart and e.expense_class = 'direct_job_cost'), '{}') as direct_by_category,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'direct_job_cost'), 0) + coalesce(l.helper_pay, 0) as direct_costs,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'overhead'), 0) as overhead,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'capital'), 0) as capex,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'owner_draw'), 0) as owner_draws,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'personal'), 0) as personal,
      coalesce(v.vehicle_cost, 0) as vehicle_cost,
      public.owner_hours(p.pstart, p.pend) as owner_hours,
      public.rental_revenue(p.pstart, p.pend) as rental_revenue
    from periods p left join rev r on r.pstart = p.pstart left join labor l on l.pstart = p.pstart left join veh v on v.pstart = p.pstart)
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'basis', 'cash', 'group_by', p_group_by,
    'periods', jsonb_agg(jsonb_build_object(
      'period', to_char(pstart, 'YYYY-MM'), 'start', pstart, 'end', pend,
      'partial', pend >= public.detroit_today() and pstart <= public.detroit_today(),
      'job_revenue', public.r2(job_revenue), 'rental_revenue', public.r2(rental_revenue), 'tips', public.r2(tips), 'paid_invoices', paid_invoices,
      'direct_costs', public.r2(direct_costs), 'direct_by_category', direct_by_category,
      'gross_profit', public.r2(job_revenue + rental_revenue - direct_costs), 'gross_margin_pct', public.pct(job_revenue + rental_revenue - direct_costs, job_revenue + rental_revenue),
      'overhead', public.r2(overhead),
      'operating_profit', public.r2(job_revenue + rental_revenue - direct_costs - overhead), 'operating_margin_pct', public.pct(job_revenue + rental_revenue - direct_costs - overhead, job_revenue + rental_revenue),
      'capex', public.r2(capex), 'cash_profit_after_capex', public.r2(job_revenue + rental_revenue - direct_costs - overhead - capex),
      'owner_draws', public.r2(owner_draws), 'personal_memo', public.r2(personal),
      'vehicle_cost', public.r2(vehicle_cost), 'profit_after_vehicle', public.r2(job_revenue + rental_revenue - direct_costs - overhead - vehicle_cost),
      'owner_hours', public.r2(owner_hours),
      'pace_projection', case when pend >= public.detroit_today() and pstart <= public.detroit_today() and (public.detroit_today() - pstart + 1) > 0
        then public.r2((job_revenue + rental_revenue - direct_costs - overhead) * ((pend - pstart + 1)::numeric / (public.detroit_today() - pstart + 1))) end
    ) order by pstart),
    'totals', jsonb_build_object(
      'job_revenue', public.r2(sum(job_revenue)), 'rental_revenue', public.r2(sum(rental_revenue)), 'tips', public.r2(sum(tips)),
      'direct_costs', public.r2(sum(direct_costs)), 'gross_profit', public.r2(sum(job_revenue + rental_revenue - direct_costs)),
      'overhead', public.r2(sum(overhead)), 'operating_profit', public.r2(sum(job_revenue + rental_revenue - direct_costs - overhead)),
      'operating_margin_pct', public.pct(sum(job_revenue + rental_revenue - direct_costs - overhead), sum(job_revenue + rental_revenue)),
      'capex', public.r2(sum(capex)), 'owner_draws', public.r2(sum(owner_draws)), 'personal_memo', public.r2(sum(personal)),
      'vehicle_cost', public.r2(sum(vehicle_cost)), 'profit_after_vehicle', public.r2(sum(job_revenue + rental_revenue - direct_costs - overhead - vehicle_cost)),
      'all_outflows', public.r2(sum(direct_costs + overhead + capex + owner_draws + personal)),
      'owner_hours', public.r2(sum(owner_hours)),
      'owner_earnings_per_hour', case when sum(owner_hours) > 0 then public.r2(sum(job_revenue + rental_revenue - direct_costs - overhead - vehicle_cost) / sum(owner_hours)) end
    ))
  into v_out from rows;
  return v_out;
end $$;


-- weekly scorecard gets a rentals block
create or replace function public.weekly_scorecard(p_week date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start date := date_trunc('week', coalesce(p_week, public.detroit_today()))::date; v_end date; v_out jsonb;
begin
  v_end := v_start + 6;
  select jsonb_build_object('week_start', v_start, 'week_end', v_end,
    'quotes_sent', (select count(*) from public.estimates where deleted_at is null and not is_test and (sent_at at time zone 'America/Detroit')::date between v_start and v_end),
    'quotes_won', (select jsonb_build_object('count', count(*), 'value', public.r2(sum(total)), 'by_bucket', coalesce((select jsonb_object_agg(b, n) from (select quote_size_bucket b, count(*) n from public.estimates where status='accepted' and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end group by 1) x), '{}'))
                    from public.estimates where status='accepted' and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end),
    'quotes_lost', (select jsonb_build_object('count', count(*), 'value', public.r2(sum(total))) from public.estimates where status in ('declined','expired') and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end),
    'jobs_completed', (select count(*) from public.real_jobs where completed_on between v_start and v_end and status in ('completed','invoiced','paid')),
    'revenue_collected', (select public.r2(sum(i.total - coalesce(i.tip,0))) from public.invoices i join public.real_jobs j on j.id=i.job_id where i.status='paid' and i.voided_at is null and i.deleted_at is null and (i.paid_at at time zone 'America/Detroit')::date between v_start and v_end),
    'owner_hours', public.owner_hours(v_start, v_end),
    'speed_to_lead_median_min', (select round(percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at)/60)) from public.leads where first_response_at is not null and (created_at at time zone 'America/Detroit')::date between v_start and v_end),
    'leads_in', (select count(*) from public.leads where deleted_at is null and not is_test and (created_at at time zone 'America/Detroit')::date between v_start and v_end),
    'open_pipeline_value', (select public.r2(sum(total)) from public.estimates where status='sent' and deleted_at is null and not is_test),
    'ad_spend', (select public.r2(sum(amount)) from public.expenses where category='marketing' and deleted_at is null and incurred_on between v_start and v_end),
    'rentals', jsonb_build_object('booked', (select count(*) from public.rentals where status not in ('cancelled','pending_payment') and (created_at at time zone 'America/Detroit')::date between v_start and v_end),
                                  'deliveries', (select count(*) from public.rentals where status not in ('cancelled','pending_payment') and delivery_date between v_start and v_end),
                                  'revenue', public.r2(public.rental_revenue(v_start, v_end)))
  ) into v_out;
  return v_out;
end $$;

-- monthly close snapshots the rental report too
alter table public.monthly_snapshots add column if not exists rental_report jsonb;
create or replace function public.monthly_close(p_month date, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_start date := date_trunc('month', p_month)::date; v_end date; v_health jsonb;
begin
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from public.monthly_snapshots where month = v_start) then
    return jsonb_build_object('ok', false, 'error', format('%s is already closed and locked.', to_char(v_start, 'YYYY-MM')));
  end if;
  v_health := public.data_health_check();
  if (v_health->>'critical')::int > 0 and not p_override then
    return jsonb_build_object('ok', false, 'error', 'data_health_check has critical issues; fix them or pass override', 'health', v_health);
  end if;
  insert into public.monthly_snapshots (month, overridden, health, pnl, unit_economics, owner_hourly, quote_win_rate, channel_roi, customer_metrics, rental_report)
  values (v_start, p_override, v_health, public.pnl_report(v_start, v_end, 'month'), public.unit_economics(v_start, v_end), public.owner_hourly(v_start, v_end),
          public.quote_win_rate(v_start, v_end, 'size_bucket'), public.channel_roi(v_start, v_end), public.customer_metrics(v_start, v_end), public.rental_report(v_start, v_end));
  return jsonb_build_object('ok', true, 'month', to_char(v_start, 'YYYY-MM'), 'pnl', public.pnl_report(v_start, v_end, 'month')->'totals', 'rentals', public.rental_report(v_start, v_end)->'net_total');
end $$;

-- ============ seed assets ============
insert into public.rental_assets (asset_type, asset_tag)
select 'tote', 'T-' || lpad(g::text, 3, '0') from generate_series(1, 40) g on conflict (asset_tag) do nothing;
insert into public.rental_assets (asset_type, asset_tag)
select 'dolly', 'D-' || lpad(g::text, 2, '0') from generate_series(1, 2) g on conflict (asset_tag) do nothing;

-- Dolly is an add-on, never in a package (price left blank on purpose).
insert into public.rental_addons (name, asset_type, per, max_qty, sort_order)
select 'Dolly', 'dolly', 'rental', 2, 1 where not exists (select 1 from public.rental_addons where asset_type = 'dolly');

-- Row counts
select 'rental_assets' as t, count(*) from public.rental_assets
union all select 'rental_packages', count(*) from public.rental_packages
union all select 'rental_addons', count(*) from public.rental_addons
union all select 'rental_settings', count(*) from public.rental_settings
union all select 'rentals', count(*) from public.rentals
union all select 'rental_items', count(*) from public.rental_items
union all select 'rental_addon_lines', count(*) from public.rental_addon_lines
union all select 'rental_charges', count(*) from public.rental_charges
union all select 'rental_agreements', count(*) from public.rental_agreements
union all select 'rental_events', count(*) from public.rental_events
union all select 'rental_partners', count(*) from public.rental_partners
union all select 'rental_waitlist', count(*) from public.rental_waitlist
union all select 'rental_messages', count(*) from public.rental_messages;
