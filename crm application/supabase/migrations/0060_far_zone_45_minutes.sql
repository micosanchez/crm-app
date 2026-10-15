-- 0060 — owner 2026-10-14: $60 delivery and pickup for addresses 45+ minutes' drive from Lincoln Park ("Zone 3").
-- Drive minutes come from the app (OSRM, no traffic) as delivery_minutes / pickup_minutes; the farther address decides.
-- Also expose the far tier in the public catalog. Existing rentals keep their booked fee.
alter table public.rental_settings add column if not exists far_zone_fee numeric(10,2) default 60;
alter table public.rental_settings add column if not exists far_zone_minutes int default 45;
update public.rental_settings set far_zone_fee = 60, far_zone_minutes = 45 where id;

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
  -- far tier: 45+ minutes' drive from the shop (either address) costs the far fee instead of the zone fee
  if coalesce(p->>'delivery_address','') <> '' and coalesce(s.far_zone_fee, 0) > v_del
     and greatest(coalesce((p->>'delivery_minutes')::numeric, 0), coalesce((p->>'pickup_minutes')::numeric, 0)) >= coalesce(s.far_zone_minutes, 45) then
    v_del := s.far_zone_fee; v_zone_name := 'Zone 3';
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
    'rush_fee', round(v_rush,2), 'tax', v_tax, 'drive_minutes', greatest((p->>'delivery_minutes')::numeric, (p->>'pickup_minutes')::numeric), 'delivery_miles', v_miles, 'pickup_miles', v_pmiles,
    'discount', round(v_disc,2), 'partner_id', v_partner.id, 'total', v_total, 'deposit', 0, 'balance', v_total, 'tote_count', pk.tote_count, 'dolly_count', v_dollies, 'gear', v_gear,
    'balance_charge_mode', s.balance_charge_mode, 'rental_days', v_days);
end $$;
grant execute on function public.rental_quote(jsonb) to anon, authenticated;

create or replace function public.rental_public_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'packages', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'best_for', best_for, 'badge', badge, 'tote_count', tote_count, 'rental_days_included', rental_days_included, 'price', price, 'week_price', week_price, 'extra_week_price', extra_week_price) order by sort_order, name), '[]') from public.rental_packages where active and price is not null),
    'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'asset_type', a.asset_type, 'kind', a.kind, 'price', a.price, 'per', a.per, 'max_qty', a.max_qty, 'taxable', a.taxable, 'description', a.description, 'requires', a.requires, 'featured', a.featured,
        'stock', (select coalesce(min(c), 99) from (select (select count(*) from public.rental_assets x where x.asset_type = e.key and x.status not in ('damaged','lost','retired')) / greatest(e.value::int, 1) as c from jsonb_each_text(a.requires) e) m)) order by a.sort_order, a.name), '[]') from public.rental_addons a where a.active and a.price is not null),
    'settings', (select jsonb_build_object('max_service_radius_miles', max_service_radius_miles, 'zones', (select coalesce(jsonb_agg(jsonb_build_object('name', z->>'name', 'fee', (z->>'fee')::numeric, 'label', z->>'label')), '[]') from jsonb_array_elements(zones) z),
      'far_zone_fee', far_zone_fee, 'far_zone_minutes', far_zone_minutes, 'rush_fee', rush_fee, 'rush_hours', rush_hours, 'sales_tax_rate', sales_tax_rate, 'cancel_full_refund_hours', cancel_full_refund_hours, 'cancel_fee_inside_window', cancel_fee_inside_window, 'cancel_after_delivery_pct', cancel_after_delivery_pct,
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

select public.rental_quote(jsonb_build_object('package_id', (select id from public.rental_packages where name = 'Home' and active), 'delivery_address', '100 Main St, Romeo, MI 48065', 'delivery_minutes', 67))->>'delivery_fee' as romeo_67min,
       public.rental_quote(jsonb_build_object('package_id', (select id from public.rental_packages where name = 'Home' and active), 'delivery_address', '100 Big Beaver Rd, Troy, MI 48084', 'delivery_minutes', 44))->>'delivery_fee' as troy_44min,
       public.rental_quote(jsonb_build_object('package_id', (select id from public.rental_packages where name = 'Home' and active), 'delivery_address', '1746 Riverbank St, Lincoln Park, MI 48146', 'delivery_minutes', 3))->>'delivery_fee' as lincoln_park;
