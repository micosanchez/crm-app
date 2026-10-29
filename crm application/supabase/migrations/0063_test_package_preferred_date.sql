-- 0063: owner 2026-10-29.
-- 1. Customers pick a preferred delivery date (a calendar on the booking page). It is a request: Mico still confirms the date
--    and time window by text, so delivery_date stays empty until confirmDate() and nothing is reserved.
-- 2. A hidden $1 "Test booking" package for running a real booking end to end on the owner's card. It never shows on the public
--    package list (the catalog route only returns it for /rent?package=<id>), has no delivery fee, and rentals made with it are
--    is_test: no Meta Purchase (pixel or CAPI) and left out of rental_report, rental_revenue and weekly_scorecard.
-- The report functions are patched in place from the live definitions (repo and prod have drifted before); every patch point must match.
alter table public.rentals add column if not exists preferred_delivery_date date;
alter table public.rentals add column if not exists is_test boolean not null default false;
alter table public.rental_packages add column if not exists is_test boolean not null default false;

insert into public.rental_packages (name, description, tote_count, rental_days_included, price, extra_week_price, deposit_amount, active, sort_order, is_test)
select 'Test booking', 'Owner test: 1 tote, $1, no delivery fee. Hidden from the public list.', 1, 14, 1.00, null, 0, true, 999, true
where not exists (select 1 from public.rental_packages where is_test);

do $$
declare d text; n int;
  patch constant text[][] := array[
    -- function, find, replace
    ['public.rental_quote(jsonb)', '  v_tax := round(v_taxable', '  if pk.is_test then v_del := 0; v_zone_name := ''Test''; end if;   -- 0063: $1 test package, no delivery fee' || chr(10) || '  v_tax := round(v_taxable'],
    ['public.rental_revenue(date,date)', 'from public.rental_charges where status in (''succeeded'',''refunded'') and type <> ''deposit''', 'from public.rental_charges where status in (''succeeded'',''refunded'') and type <> ''deposit'' and rental_id not in (select t.id from public.rentals t where t.is_test)'],
    ['public.rental_report(date,date)', 'from public.rental_charges where status in (''succeeded'',''refunded'') and type <> ''deposit''', 'from public.rental_charges where status in (''succeeded'',''refunded'') and type <> ''deposit'' and rental_id not in (select t.id from public.rentals t where t.is_test)'],
    ['public.rental_report(date,date)', 'and type <> ''deposit'' group by 1, 2', 'and type <> ''deposit'' and rental_id not in (select t.id from public.rentals t where t.is_test) group by 1, 2'],
    ['public.rental_report(date,date)', 'from public.rentals r where ', 'from public.rentals r where not r.is_test and '],
    ['public.rental_report(date,date)', 'from public.rentals where ', 'from public.rentals where not is_test and '],
    ['public.weekly_scorecard(date)', 'from public.rentals r where ', 'from public.rentals r where not r.is_test and '],
    ['public.weekly_scorecard(date)', 'from public.rentals where ', 'from public.rentals where not is_test and ']];
  i int;
begin
  for i in 1 .. array_length(patch, 1) loop
    d := pg_get_functiondef(patch[i][1]::regprocedure);
    if position(patch[i][3] in d) > 0 then continue; end if;   -- already patched (re-run)
    n := (length(d) - length(replace(d, patch[i][2], ''))) / length(patch[i][2]);
    if n = 0 then raise exception '0063: patch point not found in %: %', patch[i][1], patch[i][2]; end if;
    execute replace(d, patch[i][2], patch[i][3]);   -- create or replace keeps the existing grants
    raise notice '0063: % (% place(s))', patch[i][1], n;
  end loop;
end $$;

-- check: the test package id (for the test link), its $1 quote, the new columns, and that the patched reports still run
select (select id::text from public.rental_packages where is_test) || ' || quote total ' ||
       coalesce(public.rental_quote(jsonb_build_object('package_id', (select id from public.rental_packages where is_test), 'delivery_address', '1746 Riverbank St, Lincoln Park, MI 48146'))::text, 'null') ||
       ' || columns ' || (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'rentals' and column_name in ('is_test','preferred_delivery_date')) or (table_name = 'rental_packages' and column_name = 'is_test'))) ||
       ' || report ' || (public.rental_report(null, null) is not null) || ' || scorecard ' || (public.weekly_scorecard(null) is not null) as result;
