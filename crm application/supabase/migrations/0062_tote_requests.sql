-- 0062 — tote booking redesign (spec 2026-10-27): no availability calendar, $0 at booking, billed at pickup.
-- A checkout is now a REQUEST: it has no delivery date, reserves no totes, and becomes 'awaiting_confirmation' once the card is saved.
-- Mico texts delivery windows, then sets the date in the CRM (status 'booked', totes reserved). Unanswered requests become 'expired'.
do $$ declare c text; begin   -- drop the old status check whatever it is named
  for c in select conname from pg_constraint where conrelid = 'public.rentals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%pending_payment%' loop
    execute format('alter table public.rentals drop constraint %I', c);
  end loop;
end $$;
alter table public.rentals add constraint rentals_status_check check (status in ('pending_payment','awaiting_confirmation','booked','delivered','out','pickup_scheduled','returned','inspected','closed','cancelled','expired'));
alter table public.rentals alter column delivery_date drop not null;
alter table public.rentals alter column delivery_window drop not null;
alter table public.rentals alter column pickup_date drop not null;
-- nothing is charged until the pickup check-in
update public.rental_settings set balance_charge_mode = 'pickup' where id;
-- the agreement text changed (card saved, charged at pickup; second delivery trip at the zone rate): new terms version on new signatures
update public.rental_settings set terms_version = terms_version + 1 where id;

create or replace function public.rental_create_hold(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q jsonb; s public.rental_settings; v_cust uuid; v_id uuid; v_phone text := public.to_e164(p->>'phone'); v_email text := lower(nullif(btrim(p->>'email'),''));
        v_start date := (p->>'delivery_date')::date; v_end date; v_day int; v_slot int; l record; k text; vv int; v_free int; v_partner public.rental_partners;
begin
  perform pg_advisory_xact_lock(hashtext('rental_hold'));
  select * into s from public.rental_settings where id;
  q := public.rental_quote(p);
  if q ? 'error' then return q; end if;
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
            and (status not in ('cancelled','pending_payment','expired') or (status = 'pending_payment' and created_at > now() - interval '30 minutes'))) >= v_partner.max_uses then
        return jsonb_build_object('error', 'That code has already been used up.');
      end if;
      if exists (select 1 from public.rentals where partner_id = v_partner.id and customer_id = v_cust and status not in ('cancelled','pending_payment','expired')) then
        return jsonb_build_object('error', 'That code can only be used once per customer.');
      end if;
    end if;
  end if;
  insert into public.rentals (customer_id, package_id, status, delivery_address, pickup_address, delivery_miles, pickup_miles, delivery_date, delivery_window, pickup_date, pickup_window,
    tote_count, dolly_count, extra_weeks, subtotal, delivery_fee, addons_total, discount_amount, total, deposit_amount, balance_due, lead_source, partner_id, promo_code, payer_name, payer_email,
    sms_consent_at, marketing_sms_consent_at, marketing_email_consent_at, notes_customer, move_date, move_reason, home_size, junk_interest, tax_amount, rush_fee, zone, gear, rental_days)
  values (v_cust, (q->'package'->>'id')::uuid, 'pending_payment', p->>'delivery_address', nullif(btrim(coalesce(p->>'pickup_address','')),''), (q->>'delivery_miles')::numeric, (q->>'pickup_miles')::numeric,
    null, null, null, null,   -- dates are set when Mico confirms a delivery window (rental_confirm_date in the app)
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
revoke execute on function public.rental_create_hold(jsonb) from public, anon, authenticated;   -- service role only (0061)
grant execute on function public.rental_create_hold(jsonb) to service_role;

-- check
select (select balance_charge_mode from public.rental_settings) as mode,
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'rentals_status_check') as status_check,
       (select string_agg(column_name || '=' || is_nullable, ', ') from information_schema.columns where table_schema = 'public' and table_name = 'rentals' and column_name in ('delivery_date','delivery_window','pickup_date')) as nullable;
