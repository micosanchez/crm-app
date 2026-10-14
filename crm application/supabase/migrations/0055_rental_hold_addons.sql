-- 0055 — fix: rental_create_hold read l.x from jsonb_array_elements (the column is `value`); every order with an add-on failed. Applied 2026-10-13.
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

select 'ok' as rental_create_hold;
