-- 0056 — Sanchez Tote Rentals business plan (2026-10-13): packages, add-on menu, ZIP zones, rush fee, sales tax on sold
-- goods, 7-day option, launch code FIRST10 with a use cap, move/junk-interest fields, lead score, lead events, consent
-- records, gear inventory, 2-day grace then weekly late billing, report additions.

-- ============ schema ============
alter table public.rental_packages add column if not exists week_price numeric(10,2);
alter table public.rental_packages add column if not exists badge text;
alter table public.rental_packages add column if not exists best_for text;

alter table public.rental_addons add column if not exists kind text not null default 'rent' check (kind in ('rent','sell','bundle'));
alter table public.rental_addons add column if not exists taxable boolean not null default false;
alter table public.rental_addons add column if not exists description text;
alter table public.rental_addons add column if not exists requires jsonb not null default '{}';   -- {asset_type: qty} gear needed per unit
alter table public.rental_addons add column if not exists replacement_fee numeric(10,2);
alter table public.rental_addons add column if not exists featured boolean not null default false;
alter table public.rental_addons drop constraint if exists rental_addons_asset_type_check;
alter table public.rental_addons add constraint rental_addons_asset_type_check check (asset_type in ('tote','dolly','hand_truck','furniture_dolly','blankets','zip_ties','labels','other'));

alter table public.rental_assets drop constraint if exists rental_assets_asset_type_check;
alter table public.rental_assets add constraint rental_assets_asset_type_check check (asset_type in ('tote','dolly','hand_truck','furniture_dolly','blankets','zip_ties','labels','other'));

alter table public.rental_settings add column if not exists zones jsonb not null default '[]';
alter table public.rental_settings add column if not exists rush_fee numeric(10,2);
alter table public.rental_settings add column if not exists rush_hours int not null default 48;
alter table public.rental_settings add column if not exists sales_tax_rate numeric(5,4) not null default 0.06;
alter table public.rental_settings add column if not exists cancel_fee_inside_window numeric(10,2);
alter table public.rental_settings add column if not exists cancel_after_delivery_pct numeric(5,2) not null default 50;
alter table public.rental_settings add column if not exists late_grace_days int not null default 2;
alter table public.rental_settings add column if not exists lid_fee numeric(10,2);
alter table public.rental_settings add column if not exists junk_offer_text text;

alter table public.rentals add column if not exists move_date date;
alter table public.rentals add column if not exists move_reason text;
alter table public.rentals add column if not exists home_size text;
alter table public.rentals add column if not exists junk_interest text check (junk_interest in ('yes','maybe','no'));
alter table public.rentals add column if not exists lead_score int not null default 0;
alter table public.rentals add column if not exists marketing_sms_consent_at timestamptz;
alter table public.rentals add column if not exists marketing_email_consent_at timestamptz;
alter table public.rentals add column if not exists tax_amount numeric(10,2) not null default 0;
alter table public.rentals add column if not exists rush_fee numeric(10,2) not null default 0;
alter table public.rentals add column if not exists zone text;
alter table public.rentals add column if not exists gear jsonb not null default '{}';
alter table public.rentals add column if not exists rental_days int;

alter table public.rental_partners add column if not exists max_uses int;
alter table public.rental_partners add column if not exists uses int not null default 0;
alter table public.rental_partners add column if not exists expires_on date;

create table if not exists public.lead_events (
  id bigserial primary key,
  type text not null,                       -- checkout_yes, checkout_maybe, qr_scan, quote_form, turned_away, sms_reply
  rental_id uuid references public.rentals(id) on delete set null,
  customer_id uuid,
  asset_tag text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_lead_events_type on public.lead_events (type, created_at desc);
create table if not exists public.consent_records (
  id bigserial primary key,
  customer_id uuid,
  rental_id uuid references public.rentals(id) on delete set null,
  channel text not null check (channel in ('sms','email')),
  purpose text not null check (purpose in ('transactional','marketing')),
  source_text text,
  ip text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
do $$ declare t text; begin
  foreach t in array array['lead_events','consent_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_staff on public.%I', t, t);
    execute format('create policy %I_staff on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end $$;

-- ============ seeds: packages, add-ons, gear, launch code, settings ============
delete from public.rental_packages where name like 'TEST PACKAGE%';
insert into public.rental_packages (name, description, best_for, badge, tote_count, rental_days_included, price, week_price, extra_week_price, active, sort_order)
select * from (values
  ('Starter', 'Studios, dorms and 1 bedroom moves.', 'Studio, 1 BR, dorm', null, 20, 14, 109.00, 89.00, 25.00, true, 1),
  ('Home', 'Our most popular. Most 2 bedroom apartments start here.', '2 BR apartment, small house', 'Most Popular', 30, 14, 139.00, 115.00, 30.00, true, 2),
  ('Full House', 'Bigger homes and families. 40 totes, the whole kitchen and then some.', '3 BR and larger moves', null, 40, 14, 169.00, 139.00, 35.00, true, 3)
) v(name, description, best_for, badge, tote_count, rental_days_included, price, week_price, extra_week_price, active, sort_order)
where not exists (select 1 from public.rental_packages p where p.name = v.name);

update public.rental_addons set name = 'Tote dolly', price = 15, max_qty = 3, replacement_fee = 50, kind = 'rent', description = 'Rolls 4 to 5 totes at a time.', requires = '{"dolly":1}', sort_order = 2 where asset_type = 'dolly';
insert into public.rental_addons (name, asset_type, kind, price, per, max_qty, taxable, description, requires, replacement_fee, featured, active, sort_order)
select * from (values
  ('Roll It Kit', 'other', 'bundle', 25.00, 'rental', 1, false, 'A tote dolly and a hand truck. Totes stack 4 high on a dolly. Most people add this.', '{"dolly":1,"hand_truck":1}'::jsonb, null::numeric, true, true, 1),
  ('Hand truck', 'hand_truck', 'rent', 15.00, 'rental', 2, false, 'For the heavy stuff.', '{"hand_truck":1}'::jsonb, 75, false, true, 3),
  ('Furniture dolly', 'furniture_dolly', 'rent', 10.00, 'rental', 2, false, 'Four wheels for dressers and couches.', '{"furniture_dolly":1}'::jsonb, 25, false, true, 4),
  ('Moving blankets, 6 pack', 'blankets', 'rent', 20.00, 'rental', 2, false, 'Wrap furniture so it arrives the way it left.', '{"blankets":1}'::jsonb, 72, false, true, 5),
  ('Furniture Protection Kit', 'other', 'bundle', 45.00, 'rental', 1, false, 'Six moving blankets, a roll of stretch wrap and a mattress bag.', '{"blankets":1}'::jsonb, null, false, true, 6),
  ('Kitchen & Fragile Kit', 'other', 'sell', 35.00, 'rental', 2, true, 'Packing paper and bubble wrap for dishes and glass.', '{}'::jsonb, null, false, true, 7),
  ('Complete Move Kit', 'other', 'bundle', 89.00, 'rental', 1, false, 'Roll It Kit, Furniture Protection Kit and packing paper. Everything for a full house.', '{"dolly":1,"hand_truck":1,"blankets":1}'::jsonb, null, false, true, 8),
  ('Stretch wrap, 20 in roll', 'other', 'sell', 24.00, 'rental', 3, true, null, '{}'::jsonb, null, false, true, 9),
  ('Packing paper, 10 lb', 'other', 'sell', 24.00, 'rental', 3, true, null, '{}'::jsonb, null, false, true, 10),
  ('Mattress bag, queen or king', 'other', 'sell', 10.00, 'rental', 4, true, null, '{}'::jsonb, null, false, true, 11),
  ('Extra markers, 2 pack', 'other', 'sell', 3.00, 'rental', 4, true, null, '{}'::jsonb, null, false, true, 12),
  ('Security zip ties, 25', 'zip_ties', 'sell', 5.00, 'rental', 4, true, null, '{}'::jsonb, null, false, true, 13)
) v(name, asset_type, kind, price, per, max_qty, taxable, description, requires, replacement_fee, featured, active, sort_order)
where not exists (select 1 from public.rental_addons a where a.name = v.name);

insert into public.rental_assets (asset_type, asset_tag) select 'dolly', 'D-03' where not exists (select 1 from public.rental_assets where asset_tag = 'D-03');
insert into public.rental_assets (asset_type, asset_tag) select 'hand_truck', 'H-' || lpad(g::text, 2, '0') from generate_series(1, 4) g on conflict (asset_tag) do nothing;
insert into public.rental_assets (asset_type, asset_tag) select 'furniture_dolly', 'F-' || lpad(g::text, 2, '0') from generate_series(1, 2) g on conflict (asset_tag) do nothing;
insert into public.rental_assets (asset_type, asset_tag) select 'blankets', 'B-' || lpad(g::text, 2, '0') from generate_series(1, 2) g on conflict (asset_tag) do nothing;

insert into public.rental_partners (name, brokerage, referral_code, discount_type, discount_amount, max_uses, active)
select 'Launch offer', 'first 10 bookings', 'FIRST10', 'fixed', 15, 10, true where not exists (select 1 from public.rental_partners where referral_code = 'FIRST10');

update public.rental_settings set
  replacement_fee_per_tote = 20, replacement_fee_per_dolly = 50, damage_fee_per_tote = 15, cleaning_fee_per_tote = 15, failed_trip_fee = 20, lid_fee = 6,
  late_fee_per_day = null, late_grace_days = 2, rush_fee = 25, rush_hours = 48, sales_tax_rate = 0.06, cancel_fee_inside_window = 25, cancel_after_delivery_pct = 50,
  turnaround_days = 2, booking_lead_time_hours = 24, max_service_radius_miles = 16,
  slot_windows = '{"weekday":["6-8pm"],"weekend":["9-11am","11-1pm","1-3pm","3-5pm"]}',
  junk_offer_text = '$25 off any Sanchez Junk & Haul Co. job of $250 or more, booked during your rental or within 7 days of pickup. Code TOTE25.',
  zones = '[
    {"name":"Zone 1","fee":0,"label":"Lincoln Park, Allen Park, Southgate, Wyandotte, Ecorse, Melvindale, Taylor, SW Detroit","zips":["48146","48101","48195","48192","48229","48122","48180","48209","48217","48210","48216","48218"]},
    {"name":"Zone 2","fee":25,"label":"Dearborn, Dearborn Heights, Riverview, Trenton, Grosse Ile, Romulus, downtown Detroit","zips":["48120","48124","48126","48128","48125","48127","48193","48183","48138","48174","48201","48202","48207","48208","48226","48243"]},
    {"name":"Zone 3","fee":50,"label":"Woodhaven, Brownstown, Flat Rock, Rockwood, Westland, Inkster, Garden City, Belleville","zips":["48134","48173","48185","48186","48141","48135","48111","48112"]}
  ]'
where id;

-- ============ gear availability ============
create or replace function public.rental_gear_free(p_type text, p_start date, p_end date) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.rental_assets where asset_type = p_type and status not in ('damaged','lost','retired'))::int
       - coalesce((select sum(coalesce((r.gear->>p_type)::int, 0)) from public.rentals r
                   where (r.status in ('booked','delivered','out','pickup_scheduled') or (r.status = 'pending_payment' and r.created_at > now() - interval '30 minutes'))
                     and r.delivery_date <= p_end and r.pickup_date + (select coalesce(turnaround_days,1) from public.rental_settings where id) >= p_start), 0)::int
$$;
grant execute on function public.rental_gear_free(text, date, date) to anon, authenticated;

-- ============ pricing ============
-- p: {package_id, duration (7|14), extra_weeks, addons:[{addon_id, qty}], delivery_address, pickup_address, delivery_miles, pickup_miles, promo_code, delivery_date}
create or replace function public.rental_quote(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.rental_settings; pk public.rental_packages; a record; v_weeks int := coalesce((p->>'extra_weeks')::int, 0);
        v_sub numeric := 0; v_add numeric := 0; v_del numeric := 0; v_disc numeric := 0; v_tax numeric := 0; v_taxable numeric := 0; v_rush numeric := 0; v_total numeric; v_days int; v_lines jsonb := '[]';
        v_miles numeric; v_pmiles numeric; v_partner public.rental_partners; v_gear jsonb := '{}'; v_dollies int := 0;
        v_zip text; v_pzip text; v_zone jsonb; v_pzone jsonb; v_zone_name text; v_duration int := coalesce((p->>'duration')::int, 14); v_price numeric;
        k text; vv int;
begin
  select * into s from public.rental_settings where id;
  select * into pk from public.rental_packages where id = (p->>'package_id')::uuid and active;
  if pk.id is null then return jsonb_build_object('error', 'Pick a package.'); end if;
  if pk.price is null then return jsonb_build_object('error', 'That package has no price yet.'); end if;
  if v_duration = 7 and pk.week_price is not null then v_price := pk.week_price; v_days := 7; else v_duration := 14; v_price := pk.price; v_days := pk.rental_days_included; end if;
  v_sub := v_price + v_weeks * coalesce(pk.extra_week_price, 0);
  v_days := v_days + v_weeks * 7;
  for a in select (x->>'addon_id')::uuid as addon_id, (x->>'qty')::int as qty from jsonb_array_elements(coalesce(p->'addons','[]')) x loop
    declare ad public.rental_addons; v_line numeric; begin
      select * into ad from public.rental_addons where id = a.addon_id and active;
      if ad.id is null or a.qty is null or a.qty <= 0 then continue; end if;
      if a.qty > ad.max_qty then return jsonb_build_object('error', format('Max %s of %s.', ad.max_qty, ad.name)); end if;
      v_line := ad.price * a.qty * case when ad.per = 'day' then v_days else 1 end;
      v_add := v_add + v_line;
      if ad.taxable then v_taxable := v_taxable + v_line; end if;
      for k, vv in select key, value::int from jsonb_each_text(coalesce(ad.requires, '{}')) loop
        v_gear := jsonb_set(v_gear, array[k], to_jsonb(coalesce((v_gear->>k)::int, 0) + vv * a.qty));
      end loop;
      v_lines := v_lines || jsonb_build_object('addon_id', ad.id, 'name', ad.name, 'qty', a.qty, 'unit_price', ad.price, 'line', v_line, 'kind', ad.kind, 'taxable', ad.taxable);
    end;
  end loop;
  v_dollies := coalesce((v_gear->>'dolly')::int, 0);
  -- delivery zone by ZIP (the farther of the two addresses sets the fee)
  v_zip := (regexp_match(coalesce(p->>'delivery_address',''), '(\d{5})(?:-\d{4})?\s*$'))[1];
  v_pzip := (regexp_match(coalesce(p->>'pickup_address',''), '(\d{5})(?:-\d{4})?\s*$'))[1];
  v_miles := (p->>'delivery_miles')::numeric; v_pmiles := coalesce((p->>'pickup_miles')::numeric, v_miles);
  if coalesce(p->>'delivery_address','') <> '' then
    if v_zip is null then return jsonb_build_object('error', 'zip_required'); end if;
    select z into v_zone from jsonb_array_elements(s.zones) z where z->'zips' ? v_zip limit 1;
    if v_zone is null then return jsonb_build_object('error', 'out_of_area'); end if;
    v_del := (v_zone->>'fee')::numeric; v_zone_name := v_zone->>'name';
    if v_pzip is not null then
      select z into v_pzone from jsonb_array_elements(s.zones) z where z->'zips' ? v_pzip limit 1;
      if v_pzone is null then return jsonb_build_object('error', 'out_of_area'); end if;
      if (v_pzone->>'fee')::numeric > v_del then v_del := (v_pzone->>'fee')::numeric; v_zone_name := v_pzone->>'name'; end if;
    end if;
  end if;
  -- rush: delivery inside rush_hours of now
  if (p->>'delivery_date') is not null and coalesce(s.rush_fee, 0) > 0
     and (p->>'delivery_date')::date < ((now() + make_interval(hours => s.rush_hours)) at time zone 'America/Detroit')::date then v_rush := s.rush_fee; end if;
  if nullif(p->>'promo_code','') is not null then
    select * into v_partner from public.rental_partners where upper(referral_code) = upper(p->>'promo_code') and active;
    if v_partner.id is null then return jsonb_build_object('error', 'That code is not valid.'); end if;
    if v_partner.max_uses is not null and v_partner.uses >= v_partner.max_uses then return jsonb_build_object('error', 'That code has already been used up.'); end if;
    if v_partner.expires_on is not null and v_partner.expires_on < current_date then return jsonb_build_object('error', 'That code has expired.'); end if;
    v_disc := case when v_partner.discount_type = 'percent' then round((v_sub + v_add) * v_partner.discount_amount / 100, 2) else v_partner.discount_amount end;
    v_disc := least(v_disc, v_sub + v_add);
  end if;
  v_tax := round(v_taxable * coalesce(s.sales_tax_rate, 0), 2);
  v_total := round(v_sub + v_add + v_del + v_rush + v_tax - v_disc, 2);
  return jsonb_build_object('package', jsonb_build_object('id', pk.id, 'name', pk.name, 'tote_count', pk.tote_count, 'days', v_days, 'price', v_price),
    'duration', v_duration, 'extra_weeks', v_weeks, 'subtotal', round(v_sub,2), 'addons', v_lines, 'addons_total', round(v_add,2), 'delivery_fee', round(v_del,2), 'zone', v_zone_name,
    'rush_fee', round(v_rush,2), 'tax', v_tax, 'delivery_miles', v_miles, 'pickup_miles', v_pmiles,
    'discount', round(v_disc,2), 'partner_id', v_partner.id, 'total', v_total, 'deposit', 0, 'balance', v_total, 'tote_count', pk.tote_count, 'dolly_count', v_dollies, 'gear', v_gear,
    'balance_charge_mode', s.balance_charge_mode, 'rental_days', v_days);
end $$;
grant execute on function public.rental_quote(jsonb) to anon, authenticated;

-- ============ hold ============
create or replace function public.rental_create_hold(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; s public.rental_settings; v_cust uuid; v_id uuid; v_phone text := public.to_e164(p->>'phone'); v_email text := lower(nullif(btrim(p->>'email'),''));
        v_start date := (p->>'delivery_date')::date; v_end date; v_day int; v_slot int; l record; k text; vv int; v_free int;
begin
  perform pg_advisory_xact_lock(hashtext('rental_hold'));
  select * into s from public.rental_settings where id;
  q := public.rental_quote(p);
  if q ? 'error' then return q; end if;
  if v_start is null or v_start < (now() at time zone 'America/Detroit')::date then return jsonb_build_object('error', 'Pick a delivery date.'); end if;
  if v_start < ((now() + make_interval(hours => s.booking_lead_time_hours)) at time zone 'America/Detroit')::date then return jsonb_build_object('error', format('We need %s hours notice.', s.booking_lead_time_hours)); end if;
  v_day := extract(dow from v_start)::int;
  if not (v_day = any(s.service_days)) then return jsonb_build_object('error', 'We do not deliver on that day.'); end if;
  if s.blackout_dates ? v_start::text then return jsonb_build_object('error', 'That date is not available.'); end if;
  v_end := v_start + (q->>'rental_days')::int;
  if not public.rental_can_fit(v_start, v_end + s.turnaround_days, (q->>'tote_count')::int, 0) then
    insert into public.lead_events (type, detail) values ('turned_away', jsonb_build_object('delivery_date', v_start, 'totes', q->>'tote_count'));
    return jsonb_build_object('error', 'sold_out');
  end if;
  for k, vv in select key, value::int from jsonb_each_text(coalesce(q->'gear','{}')) loop
    v_free := public.rental_gear_free(k, v_start, v_end);
    if v_free < vv then return jsonb_build_object('error', 'gear_sold_out', 'gear', k, 'free', greatest(v_free, 0)); end if;
  end loop;
  select count(*) into v_slot from public.rentals where status in ('booked','delivered','out','pickup_scheduled','pending_payment') and delivery_date = v_start and delivery_window = p->>'delivery_window' and (status <> 'pending_payment' or created_at > now() - interval '30 minutes');
  if v_slot >= s.max_bookings_per_slot then return jsonb_build_object('error', 'slot_full'); end if;
  if coalesce(btrim(p->>'name'),'') = '' or v_phone is null then return jsonb_build_object('error', 'Name and phone are required.'); end if;
  select id into v_cust from public.customers where deleted_at is null and (phone_e164 = v_phone or (v_email is not null and lower(email) = v_email)) order by created_at limit 1;
  if v_cust is null then
    insert into public.customers (name, phone, email, address, lead_source, segment, notes)
    values (btrim(p->>'name'), v_phone, v_email, p->>'delivery_address', case when public.is_lead_source(p->>'lead_source') then (p->>'lead_source')::public.lead_source else 'website_direct' end, 'residential', 'Created by the tote rental booking page')
    returning id into v_cust;
  end if;
  insert into public.rentals (customer_id, package_id, status, delivery_address, pickup_address, delivery_miles, pickup_miles, delivery_date, delivery_window, pickup_date, pickup_window,
    tote_count, dolly_count, extra_weeks, subtotal, delivery_fee, addons_total, discount_amount, total, deposit_amount, balance_due, lead_source, partner_id, promo_code, payer_name, payer_email,
    sms_consent_at, marketing_sms_consent_at, marketing_email_consent_at, notes_customer, move_date, move_reason, home_size, junk_interest, tax_amount, rush_fee, zone, gear, rental_days)
  values (v_cust, (q->'package'->>'id')::uuid, 'pending_payment', p->>'delivery_address', nullif(btrim(coalesce(p->>'pickup_address','')),''), (q->>'delivery_miles')::numeric, (q->>'pickup_miles')::numeric,
    v_start, p->>'delivery_window', v_end, nullif(p->>'pickup_window',''),
    (q->>'tote_count')::int, (q->>'dolly_count')::int, (q->>'extra_weeks')::int, (q->>'subtotal')::numeric, (q->>'delivery_fee')::numeric, (q->>'addons_total')::numeric, (q->>'discount')::numeric,
    (q->>'total')::numeric, 0, (q->>'total')::numeric, nullif(p->>'lead_source',''), (q->>'partner_id')::uuid, nullif(upper(p->>'promo_code'),''),
    nullif(p->>'payer_name',''), nullif(lower(p->>'payer_email'),''),
    now(),   -- transactional texts: the number was given for this booking
    case when (p->>'marketing_sms')::boolean then now() end, case when (p->>'marketing_email')::boolean then now() end,
    nullif(p->>'notes_customer',''), (p->>'move_date')::date, nullif(p->>'move_reason',''), nullif(p->>'home_size',''), nullif(p->>'junk_interest',''),
    (q->>'tax')::numeric, (q->>'rush_fee')::numeric, q->>'zone', coalesce(q->'gear','{}'), (q->>'rental_days')::int)
  returning id into v_id;
  for l in select * from jsonb_array_elements(q->'addons') x loop
    insert into public.rental_addon_lines (rental_id, addon_id, qty, unit_price) values (v_id, (l.value->>'addon_id')::uuid, (l.value->>'qty')::int, (l.value->>'unit_price')::numeric);
  end loop;
  insert into public.consent_records (customer_id, rental_id, channel, purpose, source_text, ip) values (v_cust, v_id, 'sms', 'transactional', 'Phone given at tote checkout for booking, delivery and pickup texts.', p->>'ip');
  if (p->>'marketing_sms')::boolean then insert into public.consent_records (customer_id, rental_id, channel, purpose, source_text, ip) values (v_cust, v_id, 'sms', 'marketing', p->>'marketing_sms_text', p->>'ip'); end if;
  if (p->>'marketing_email')::boolean then insert into public.consent_records (customer_id, rental_id, channel, purpose, source_text, ip) values (v_cust, v_id, 'email', 'marketing', p->>'marketing_email_text', p->>'ip'); end if;
  if p->>'junk_interest' in ('yes','maybe') then insert into public.lead_events (type, rental_id, customer_id, detail) values ('checkout_' || (p->>'junk_interest'), v_id, v_cust, jsonb_build_object('notes', p->>'notes_customer')); end if;
  return jsonb_build_object('rental_id', v_id, 'public_token', (select public_token from public.rentals where id = v_id), 'rental_number', (select rental_number from public.rentals where id = v_id), 'customer_id', v_cust, 'quote', q);
end $$;
grant execute on function public.rental_create_hold(jsonb) to anon, authenticated;

-- ============ lead score (0 to 10) ============
create or replace function public.rental_lead_score(r public.rentals) returns int language sql stable as $$
  select least(10,
    (case when r.junk_interest = 'yes' or r.junk_request_id is not null then 5 when r.junk_interest = 'maybe' then 2 else 0 end)
    + (case when r.move_reason in ('downsizing','estate') then 2 else 0 end)
    + (case when coalesce(r.notes_customer,'') ~* '(furniture|couch|sofa|mattress|appliance|fridge|washer|dryer|dresser)' then 2 else 0 end)
    + (case when r.move_date is not null and r.move_date - (r.created_at at time zone 'America/Detroit')::date <= 7 then 1 else 0 end)
    + (case when r.tote_count >= 40 then 1 else 0 end))
$$;
create or replace function public.rentals_score() returns trigger language plpgsql as $$
begin new.lead_score := public.rental_lead_score(new); return new; end $$;
drop trigger if exists rentals_score on public.rentals;
create trigger rentals_score before insert or update of junk_interest, junk_request_id, move_reason, notes_customer, move_date, tote_count on public.rentals for each row execute function public.rentals_score();

-- ============ catalog ============
create or replace function public.rental_public_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packages', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'best_for', best_for, 'badge', badge, 'tote_count', tote_count, 'rental_days_included', rental_days_included, 'price', price, 'week_price', week_price, 'extra_week_price', extra_week_price) order by sort_order, name), '[]') from public.rental_packages where active and price is not null),
    'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'asset_type', a.asset_type, 'kind', a.kind, 'price', a.price, 'per', a.per, 'max_qty', a.max_qty, 'taxable', a.taxable, 'description', a.description, 'requires', a.requires, 'featured', a.featured,
        'stock', (select coalesce(min(c), 99) from (select (select count(*) from public.rental_assets x where x.asset_type = e.key and x.status not in ('damaged','lost','retired')) / greatest(e.value::int, 1) as c from jsonb_each_text(a.requires) e) m)) order by a.sort_order, a.name), '[]') from public.rental_addons a where a.active and a.price is not null),
    'settings', (select jsonb_build_object('max_service_radius_miles', max_service_radius_miles, 'zones', (select coalesce(jsonb_agg(jsonb_build_object('name', z->>'name', 'fee', (z->>'fee')::numeric, 'label', z->>'label')), '[]') from jsonb_array_elements(zones) z),
      'rush_fee', rush_fee, 'rush_hours', rush_hours, 'sales_tax_rate', sales_tax_rate, 'cancel_full_refund_hours', cancel_full_refund_hours, 'cancel_fee_inside_window', cancel_fee_inside_window, 'cancel_after_delivery_pct', cancel_after_delivery_pct,
      'booking_lead_time_hours', booking_lead_time_hours, 'max_bookings_per_slot', max_bookings_per_slot,
      'service_days', to_jsonb(service_days), 'slot_windows', slot_windows, 'blackout_dates', blackout_dates, 'turnaround_days', turnaround_days, 'late_grace_days', late_grace_days,
      'replacement_fee_per_tote', replacement_fee_per_tote, 'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'failed_trip_fee', failed_trip_fee, 'lid_fee', lid_fee,
      'junk_offer_text', junk_offer_text, 'terms_version', terms_version) from public.rental_settings where id),
    'slot_counts', (select coalesce(jsonb_object_agg(k, n), '{}') from (
        select delivery_date::text || '|' || delivery_window as k, count(*) as n from public.rentals where status in ('booked','delivered','out','pickup_scheduled') and delivery_date >= current_date group by 1
        union all
        select pickup_date::text || '|' || coalesce(pickup_window,'') as k, count(*) as n from public.rentals where status in ('booked','delivered','out','pickup_scheduled') and pickup_date >= current_date group by 1) s)
  )
$$;
grant execute on function public.rental_public_catalog() to anon, authenticated;

-- ============ customer view ============
create or replace function public.rental_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'rental_number', r.rental_number, 'status', r.status, 'delivery_address', r.delivery_address, 'pickup_address', coalesce(r.pickup_address, r.delivery_address),
    'delivery_date', r.delivery_date, 'delivery_window', r.delivery_window, 'pickup_date', r.pickup_date, 'pickup_window', r.pickup_window,
    'tote_count', r.tote_count, 'dolly_count', r.dolly_count, 'extra_weeks', r.extra_weeks, 'subtotal', r.subtotal, 'delivery_fee', r.delivery_fee, 'addons_total', r.addons_total, 'discount_amount', r.discount_amount,
    'tax_amount', r.tax_amount, 'rush_fee', r.rush_fee, 'zone', r.zone, 'gear', r.gear, 'rental_days', r.rental_days,
    'total', r.total, 'deposit_amount', r.deposit_amount, 'deposit_status', r.deposit_status, 'balance_due', r.balance_due, 'card_brand', r.card_brand, 'card_last4', r.card_last4, 'card_exp', r.card_exp,
    'notes_customer', r.notes_customer, 'sms_consent', r.sms_consent_at is not null, 'marketing_sms', r.marketing_sms_consent_at is not null, 'marketing_email', r.marketing_email_consent_at is not null, 'created_at', r.created_at,
    'move_date', r.move_date, 'move_reason', r.move_reason, 'home_size', r.home_size, 'junk_interest', r.junk_interest,
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email),
    'package', (select jsonb_build_object('name', name, 'tote_count', tote_count, 'extra_week_price', extra_week_price, 'rental_days_included', rental_days_included) from public.rental_packages where id = r.package_id),
    'addons', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'qty', l.qty, 'unit_price', l.unit_price)), '[]') from public.rental_addon_lines l join public.rental_addons a on a.id = l.addon_id where l.rental_id = r.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('tag', a.asset_tag, 'type', a.asset_type, 'condition', i.return_condition)), '[]') from public.rental_items i join public.rental_assets a on a.id = i.asset_id where i.rental_id = r.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'amount', amount, 'description', description, 'status', status, 'created_at', created_at, 'photo_urls', photo_urls, 'payment_link_url', payment_link_url) order by created_at), '[]') from public.rental_charges where rental_id = r.id and status <> 'void'),
    'agreement', (select jsonb_build_object('signed_at', signed_at, 'signer_name', signer_name, 'terms_version', terms_version, 'pdf_url', pdf_url) from public.rental_agreements where rental_id = r.id order by signed_at desc limit 1),
    'settings', (select jsonb_build_object('cancel_full_refund_hours', cancel_full_refund_hours, 'cancel_fee_inside_window', cancel_fee_inside_window, 'cancel_after_delivery_pct', cancel_after_delivery_pct, 'late_grace_days', late_grace_days, 'terms_text', terms_text, 'terms_version', terms_version, 'replacement_fee_per_tote', replacement_fee_per_tote,
       'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'turnaround_days', turnaround_days, 'junk_offer_text', junk_offer_text) from public.rental_settings where id),
    'junk_request_id', r.junk_request_id)
  from public.rentals r join public.customers c on c.id = r.customer_id where r.public_token = p_token
$$;
grant execute on function public.rental_by_token(uuid) to anon, authenticated;

-- ============ late returns: grace, then the next week billed at the package extra-week rate ============
create or replace function public.rental_accrue_late_fees() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_today date := (now() at time zone 'America/Detroit')::date; v_grace int; v_weeks int; w int; v_rate numeric; v_label text;
begin
  select coalesce(late_grace_days, 2) into v_grace from public.rental_settings where id;
  for r in select x.id, x.pickup_date, coalesce(p.extra_week_price, (select late_fee_per_day * 7 from public.rental_settings where id)) as rate
           from public.rentals x left join public.rental_packages p on p.id = x.package_id
           where x.status in ('delivered','out','pickup_scheduled') and x.pickup_date + v_grace < v_today loop
    if coalesce(r.rate, 0) <= 0 then continue; end if;
    v_weeks := ceil((v_today - r.pickup_date - v_grace)::numeric / 7)::int;
    for w in 1..v_weeks loop
      v_label := 'Late week ' || w || ' (through ' || (r.pickup_date + v_grace + 7 * w)::text || ')';
      insert into public.rental_charges (rental_id, type, amount, description, status)
      select r.id, 'late_fee', r.rate, v_label, 'pending'
      where not exists (select 1 from public.rental_charges c where c.rental_id = r.id and c.type = 'late_fee' and c.description = v_label);
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
  net as (select m, sum(amt) as net from money group by m),
  booked as (select * from public.rentals where status not in ('cancelled','pending_payment') and (created_at at time zone 'America/Detroit')::date between v_from and v_to)
  select jsonb_build_object('from', v_from, 'to', v_to, 'tote_pool', v_pool,
    'utilization', jsonb_build_object(
      'avg_pct_out', (select public.pct(avg(totes_out), v_pool) from util),
      'by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'pct_out', public.pct(avg_out, v_pool)) order by wk), '[]') from (select date_trunc('week', day)::date wk, avg(totes_out) avg_out from util group by 1) w),
      'avg_rental_days', (select public.r2(avg(pickup_date - delivery_date)) from public.rentals where status not in ('cancelled','pending_payment') and delivery_date between v_from and v_to),
      'idle_totes_today', v_pool - coalesce((select sum(tote_count) from public.rentals where status in ('delivered','out','pickup_scheduled') and current_date between delivery_date and pickup_date), 0)),
    'bookings', (select count(*) from booked),
    'aov', (select public.r2(avg(total)) from booked),
    'addon_attach_pct', (select public.pct(count(*) filter (where addons_total > 0), count(*)) from booked),
    'zone_fees', (select public.r2(sum(delivery_fee)) from booked),
    'turned_away', (select count(*) from public.lead_events where type = 'turned_away' and created_at::date between v_from and v_to) + (select count(*) from public.rental_waitlist where created_at::date between v_from and v_to),
    'revenue_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(n.m, 'YYYY-MM'), 'net', public.r2(n.net), 'by_type', (select jsonb_object_agg(type, public.r2(amt)) from money mm where mm.m = n.m)) order by n.m), '[]') from net n),
    'net_total', (select public.r2(sum(net)) from net),
    'deposits_held', (select public.r2(sum(deposit_amount)) from public.rentals where deposit_status = 'held'),
    'balances_due', (select public.r2(sum(balance_due)) from public.rentals where status not in ('cancelled','closed','pending_payment')),
    'failed_charges_open', (select count(*) from public.rental_charges where status in ('failed','requires_action')),
    'losses', (select jsonb_build_object('lost_assets', count(*) filter (where status='lost'), 'damaged_assets', count(*) filter (where status='damaged'),
       'cost', public.r2(sum(purchase_cost) filter (where status in ('lost','damaged'))),
       'fees_recovered', (select public.r2(sum(amount)) from public.rental_charges where status = 'succeeded' and type in ('missing_item','damage'))) from public.rental_assets),
    'payback', jsonb_build_object('asset_spend', (select public.r2(sum(purchase_cost)) from public.rental_assets), 'net_revenue_to_date', (select public.r2(sum(amount)) from public.rental_charges where status in ('succeeded','refunded') and type <> 'deposit')),
    'lead_sources', (select coalesce(jsonb_object_agg(coalesce(lead_source,'unknown'), n), '{}') from (select lead_source, count(*) n from booked group by 1) x),
    'conversion', jsonb_build_object('page_views', (select coalesce(sum(views),0) from public.rental_page_views where day between v_from and v_to), 'paid_bookings', (select count(*) from booked)),
    'leads', jsonb_build_object(
       'checkout_yes', (select count(*) from booked where junk_interest = 'yes'), 'checkout_maybe', (select count(*) from booked where junk_interest = 'maybe'),
       'qr_scans', (select count(*) from public.lead_events where type = 'qr_scan' and created_at::date between v_from and v_to),
       'quote_forms', (select count(*) from public.lead_events where type = 'quote_form' and created_at::date between v_from and v_to),
       'hot_leads', (select count(*) from booked where lead_score >= 7)),
    'goal', (select jsonb_build_object('low', monthly_goal_low, 'high', monthly_goal_high) from public.rental_settings where id),
    'crosssell', jsonb_build_object('requests', (select count(*) from public.estimate_requests where rental_id is not null and created_at::date between v_from and v_to),
       'quotes_won', (select count(*) from public.estimate_requests er join public.estimates e on e.id = er.quote_id where er.rental_id is not null and e.status = 'accepted'),
       'junk_revenue', (select public.r2(sum(i.total)) from public.estimate_requests er join public.estimates e on e.id = er.quote_id join public.invoices i on i.job_id = e.job_id where er.rental_id is not null and i.status = 'paid'))
  ) into v_out;
  return v_out;
end $$;
grant execute on function public.rental_report(date, date) to authenticated;

create or replace function public.weekly_scorecard(p_week date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start date := date_trunc('week', coalesce(p_week, public.detroit_today()))::date; v_end date; v_out jsonb; v_pool int;
begin
  v_end := v_start + 6;
  select count(*) into v_pool from public.rental_assets where asset_type = 'tote' and status not in ('retired');
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
                                  'revenue', public.r2(public.rental_revenue(v_start, v_end)),
                                  'utilization_pct', (select public.pct(avg(o), v_pool) from (select coalesce((select sum(tote_count) from public.rentals r where r.status in ('delivered','out','pickup_scheduled','returned') and d between r.delivery_date and r.pickup_date), 0) as o from generate_series(v_start, v_end, interval '1 day') d) u),
                                  'totes_out_now', coalesce((select sum(tote_count) from public.rentals where status in ('delivered','out','pickup_scheduled') and current_date between delivery_date and pickup_date), 0),
                                  'totes_available_now', v_pool - coalesce((select sum(tote_count) from public.rentals where status in ('delivered','out','pickup_scheduled') and current_date between delivery_date and pickup_date), 0),
                                  'junk_quotes_from_renters', (select count(*) from public.estimate_requests where rental_id is not null and (created_at at time zone 'America/Detroit')::date between v_start and v_end))
  ) into v_out;
  return v_out;
end $$;

select (select count(*) from public.rental_packages where active) as packages, (select count(*) from public.rental_addons where active) as addons,
       (select count(*) from public.rental_assets) as assets, (select jsonb_array_length(zones) from public.rental_settings) as zones, (select referral_code from public.rental_partners where referral_code='FIRST10') as launch_code;

-- promo use counter (called by the confirm route once the booking is paid)
create or replace function public.rental_partner_use(p_partner uuid) returns void language sql security definer set search_path = public as $$
  update public.rental_partners set uses = uses + 1 where id = p_partner
$$;
