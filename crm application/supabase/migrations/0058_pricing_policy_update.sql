-- 0058 — tote rental pricing and policy update (owner spec, 2026-10-14)
-- Two delivery zones ($10 local, $35 extended by city), three-item equipment catalog (standard hand truck $20, convertible
-- hand truck $30, furniture dolly $10), no late grace period, $10 damage / $10 cleaning, $25 expedited early pickup and
-- $25 inside-48h date change, FIRST10 cap enforced under the hold lock, junk-removal discount tracked per rental.
-- Existing rentals keep the zone, fee and prices they were booked with (nothing here rewrites rentals rows).

-- ============ schema ============
alter table public.rental_settings add column if not exists expedited_pickup_fee numeric(10,2) default 25;
alter table public.rental_settings add column if not exists reschedule_fee_inside_window numeric(10,2) default 25;
alter table public.rental_settings add column if not exists tote_unit_cost numeric(10,2) default 8.79;
alter table public.rentals add column if not exists junk_discount_estimate_id uuid references public.estimates(id) on delete set null;
create unique index if not exists rentals_junk_discount_estimate_uidx on public.rentals (junk_discount_estimate_id) where junk_discount_estimate_id is not null;

alter table public.rental_addons drop constraint if exists rental_addons_asset_type_check;
alter table public.rental_addons add constraint rental_addons_asset_type_check check (asset_type in ('tote','dolly','hand_truck','convertible_hand_truck','furniture_dolly','blankets','zip_ties','labels','other'));
alter table public.rental_assets drop constraint if exists rental_assets_asset_type_check;
alter table public.rental_assets add constraint rental_assets_asset_type_check check (asset_type in ('tote','dolly','hand_truck','convertible_hand_truck','furniture_dolly','blankets','zip_ties','labels','other'));
alter table public.rental_charges drop constraint if exists rental_charges_type_check;
alter table public.rental_charges add constraint rental_charges_type_check check (type in ('deposit','rental_payment','balance','late_fee','missing_item','damage','cleaning','extension','adjustment','refund','failed_trip','reschedule_fee','expedited_pickup'));

-- ============ settings ============
update public.rental_settings set
  late_grace_days = 0, damage_fee_per_tote = 10, cleaning_fee_per_tote = 10,
  expedited_pickup_fee = 25, reschedule_fee_inside_window = 25, cancel_fee_inside_window = 25, cancel_full_refund_hours = 48, tote_unit_cost = 8.79,
  junk_offer_text = '$25 off a Sanchez Junk & Haul Co. junk removal job of $250 or more, booked during your rental or within 7 days after pickup. No code needed, we match it to your rental.',
  zones = '[{"name": "Zone 1", "fee": 10, "label": "Lincoln Park, Allen Park, Southgate, Wyandotte, Ecorse, River Rouge, Melvindale, Taylor, Dearborn, Dearborn Heights, Riverview, Trenton, Grosse Ile, Romulus, Southwest and downtown Detroit", "zips": ["48146", "48101", "48195", "48192", "48229", "48122", "48180", "48209", "48217", "48210", "48216", "48218", "48120", "48124", "48126", "48128", "48125", "48127", "48193", "48183", "48138", "48174", "48201", "48202", "48207", "48208", "48226", "48243"]}, {"name": "Zone 2", "fee": 35, "label": "Farmington Hills, Bloomfield Township, Redford, Ferndale, and the Grosse Pointes (Grosse Pointe, Park, Farms, Woods, Shores)", "zips": ["48331", "48334", "48335", "48336", "48301", "48302", "48304", "48239", "48240", "48220", "48230", "48236"], "cities": ["Farmington Hills", "Bloomfield", "Redford", "Ferndale", "Grosse Pointe"]}]'::jsonb
where id;

-- ============ equipment catalog: exactly three rentable items ============
update public.rental_addons set active = false, featured = false where name in ('Roll It Kit', 'Tote dolly', 'Moving blankets, 6 pack', 'Furniture Protection Kit', 'Complete Move Kit');
update public.rental_addons set name = 'Standard Hand Truck', price = 20, kind = 'rent', per = 'rental', featured = true, sort_order = 1, active = true,
  description = 'Move stacked boxes, moving totes, and heavy household items more easily with our heavy-duty standard hand truck.'
where asset_type = 'hand_truck' and kind = 'rent';
insert into public.rental_addons (name, asset_type, kind, price, per, max_qty, taxable, description, requires, replacement_fee, featured, active, sort_order)
select 'Convertible Hand Truck', 'convertible_hand_truck', 'rent', 30, 'rental', 1, false,
  'A versatile convertible hand truck that switches between upright and platform configurations for boxes, totes, and larger loads.',
  '{"convertible_hand_truck":1}'::jsonb, null, true, true, 2
where not exists (select 1 from public.rental_addons where asset_type = 'convertible_hand_truck');
update public.rental_addons set name = 'Furniture Dolly', price = 10, kind = 'rent', per = 'rental', featured = true, sort_order = 3, active = true,
  description = 'Move furniture and bulky household items across suitable flat surfaces with a sturdy four-wheel furniture dolly.'
where asset_type = 'furniture_dolly' and kind = 'rent';
update public.rental_addons set sort_order = sort_order + 10 where active and asset_type not in ('hand_truck','convertible_hand_truck','furniture_dolly') and sort_order < 10;

-- gear records: keep every row; retire the categories that left the catalog, add the convertible, record known unit costs
update public.rental_assets set status = 'retired', condition_notes = trim(coalesce(condition_notes, '') || ' Retired 2026-10-14: category removed from the rental catalog.')
where asset_type in ('dolly', 'blankets') and status = 'available';
insert into public.rental_assets (asset_type, asset_tag, purchase_cost) select 'convertible_hand_truck', 'C-01', 126.57 where not exists (select 1 from public.rental_assets where asset_tag = 'C-01');
update public.rental_assets set purchase_cost = 79 where asset_type = 'hand_truck' and purchase_cost is null;
update public.rental_assets set purchase_cost = 8.79 where asset_type = 'tote' and purchase_cost is null;

-- ============ zone match: a zone with a city list needs the address (or the geocoder's place name) to name one ============
create or replace function public.rental_zone_city_ok(z jsonb, place text) returns boolean language sql immutable as $$
  select coalesce(jsonb_array_length(z->'cities'), 0) = 0
      or exists (select 1 from jsonb_array_elements_text(z->'cities') c where coalesce(place, '') ilike '%' || c || '%')
$$;

-- ============ pricing ============
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
    select z into v_zone from jsonb_array_elements(s.zones) z where z->'zips' ? v_zip and public.rental_zone_city_ok(z, coalesce(p->>'delivery_address','') || ' ' || coalesce(p->>'delivery_place','')) limit 1;
    if v_zone is null then return jsonb_build_object('error', 'out_of_area'); end if;
    v_del := (v_zone->>'fee')::numeric; v_zone_name := v_zone->>'name';
    if v_pzip is not null then
      select z into v_pzone from jsonb_array_elements(s.zones) z where z->'zips' ? v_pzip and public.rental_zone_city_ok(z, coalesce(p->>'pickup_address','') || ' ' || coalesce(p->>'pickup_place','')) limit 1;
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
        v_start date := (p->>'delivery_date')::date; v_end date; v_day int; v_slot int; l record; k text; vv int; v_free int; v_partner public.rental_partners;
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
  if (q->>'partner_id') is not null then
    select * into v_partner from public.rental_partners where id = (q->>'partner_id')::uuid;
    if v_partner.max_uses is not null then
      if (select count(*) from public.rentals where partner_id = v_partner.id
            and (status not in ('cancelled','pending_payment') or (status = 'pending_payment' and created_at > now() - interval '30 minutes'))) >= v_partner.max_uses then
        return jsonb_build_object('error', 'That code has already been used up.');
      end if;
      if exists (select 1 from public.rentals where partner_id = v_partner.id and customer_id = v_cust and status not in ('cancelled','pending_payment')) then
        return jsonb_build_object('error', 'That code can only be used once per customer.');
      end if;
    end if;
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
      'replacement_fee_per_tote', replacement_fee_per_tote, 'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'failed_trip_fee', failed_trip_fee, 'lid_fee', lid_fee, 'expedited_pickup_fee', expedited_pickup_fee, 'reschedule_fee_inside_window', reschedule_fee_inside_window,
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
       'replacement_fee_per_dolly', replacement_fee_per_dolly, 'cleaning_fee_per_tote', cleaning_fee_per_tote, 'damage_fee_per_tote', damage_fee_per_tote, 'turnaround_days', turnaround_days, 'junk_offer_text', junk_offer_text, 'lid_fee', lid_fee, 'failed_trip_fee', failed_trip_fee, 'expedited_pickup_fee', expedited_pickup_fee, 'reschedule_fee_inside_window', reschedule_fee_inside_window) from public.rental_settings where id),
    'junk_request_id', r.junk_request_id)
  from public.rentals r join public.customers c on c.id = r.customer_id where r.public_token = p_token
$$;
grant execute on function public.rental_by_token(uuid) to anon, authenticated;

-- ============ junk removal discount: no code, matched to the rental ============
create or replace function public.tote_junk_discount(p_customer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rental_id', r.id, 'rental_number', r.rental_number, 'status', r.status,
    'eligible_until', coalesce((r.actual_picked_up_at at time zone 'America/Detroit')::date, r.pickup_date) + 7,
    'redeemed_estimate_id', r.junk_discount_estimate_id,
    'redeemed_estimate_number', (select e.estimate_number from public.estimates e where e.id = r.junk_discount_estimate_id))
  from public.rentals r
  where r.customer_id = p_customer and r.status in ('delivered','out','pickup_scheduled','returned','inspected','closed')
    and (r.status in ('delivered','out','pickup_scheduled') or coalesce((r.actual_picked_up_at at time zone 'America/Detroit')::date, r.pickup_date) + 7 >= public.detroit_today())
  order by r.delivery_date desc limit 1
$$;
grant execute on function public.tote_junk_discount(uuid) to authenticated;

select (select jsonb_agg(name order by sort_order) from public.rental_addons where active and kind = 'rent') as equipment,
       (select jsonb_agg(z->>'name' || ' $' || (z->>'fee')) from public.rental_settings s, jsonb_array_elements(s.zones) z) as zones,
       (select late_grace_days from public.rental_settings) as grace,
       (select jsonb_object_agg(asset_type || ':' || status, n) from (select asset_type, status, count(*) n from public.rental_assets group by 1, 2) x) as assets;
