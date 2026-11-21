-- 0064: owner 2026-11-21. Tote rentals: editable pickup address with a pickup-location-change fee, editable/removable
-- pending charges, and connector writes that no longer put the string 'connector' into uuid columns.
-- 1. rentals.pickup_address (exists since 0051; kept idempotent).
-- 2. rental_charges.status gains 'voided' (a removed charge is kept, never hard-deleted). 'void' stays for older rows.
-- 3. rental_charges.source: who wrote the row ('staff' | 'connector' | 'customer' | null for system). created_by stays a uuid or null.
-- 4. app_settings.pickup_location_change_fee = 25 (the fee on a customer-requested pickup address change).
-- 5. rental_recompute_balance counts reschedule_fee and expedited_pickup like the other fee types (0058 added the types,
--    but the balance never included them), so a pending $25 location fee raises balance_due.
-- 6. rental_by_token hides voided charges from the customer page as it already hides void ones.
alter table public.rentals add column if not exists pickup_address text;
alter table public.rental_charges add column if not exists source text;

do $$ declare c text; begin   -- drop the status check whatever it is named
  for c in select conname from pg_constraint where conrelid = 'public.rental_charges'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%requires_action%' loop
    execute format('alter table public.rental_charges drop constraint %I', c);
  end loop;
end $$;
alter table public.rental_charges add constraint rental_charges_status_check check (status in ('pending','succeeded','failed','requires_action','refunded','void','voided'));

insert into public.app_settings (key, value, note) values
  ('pickup_location_change_fee', '25', 'Fee for a customer-requested change of the tote pickup address (pending, collected at settle).')
on conflict (key) do nothing;

create or replace function public.rental_recompute_balance(p_rental uuid) returns numeric language plpgsql as $$
declare v_total numeric; v_owed numeric; v_paid numeric; v_applied numeric; v_bal numeric;
  fees constant text[] := array['late_fee','missing_item','damage','cleaning','adjustment','failed_trip','extension','reschedule_fee','expedited_pickup'];
begin
  select total, deposit_applied into v_total, v_applied from public.rentals where id = p_rental;
  select coalesce(sum(amount),0) into v_owed from public.rental_charges where rental_id = p_rental and type = any(fees) and status in ('pending','failed','requires_action','succeeded');
  select coalesce(sum(amount),0) into v_paid from public.rental_charges where rental_id = p_rental and status = 'succeeded'
    and (type in ('rental_payment','balance') or (type = any(fees) and stripe_payment_intent_id is not null));
  v_bal := round(greatest(v_total + v_owed - v_paid - coalesce(v_applied, 0), 0), 2);
  update public.rentals set balance_due = v_bal where id = p_rental and balance_due is distinct from v_bal;
  return v_bal;
end $$;

-- patched in place from the live definition (repo and prod have drifted before)
do $$ declare d text; begin
  d := pg_get_functiondef('public.rental_by_token(uuid)'::regprocedure);
  if position('status not in (''void'',''voided'')' in d) = 0 then
    if position('status <> ''void''' in d) = 0 then raise exception '0064: patch point not found in rental_by_token'; end if;
    execute replace(d, 'status <> ''void''', 'status not in (''void'',''voided'')');
  end if;
end $$;

-- recompute every open rental once so balances pick up any pending reschedule/expedited fees already on file
select public.rental_recompute_balance(id) from public.rentals where status not in ('closed','cancelled','expired');

-- check
select (select value::text from public.app_settings where key = 'pickup_location_change_fee') || ' || status check ' ||
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'rental_charges_status_check') || ' || source col ' ||
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rental_charges' and column_name = 'source') as result;
