-- 0061 — lock rental RPCs to the server (audit 2026-10-24).
-- rental_create_hold and rental_quote were executable with the public anon key (it ships in the website's JS), so anyone could
-- create holds directly: no per-IP rate limit (lock up every tote) and a client-supplied delivery_minutes (skip the far-zone fee).
-- The app only calls them through the service-role client in /api/public/rentals/{hold,quote}.
-- rental_report (revenue, payback) was executable by every logged-in user, technicians included; the Reports page and the
-- connector now read it with the server key.
revoke execute on function public.rental_create_hold(jsonb) from public, anon, authenticated;
revoke execute on function public.rental_quote(jsonb) from public, anon, authenticated;
revoke execute on function public.rental_report(date, date) from public, anon, authenticated;
grant execute on function public.rental_create_hold(jsonb) to service_role;
grant execute on function public.rental_quote(jsonb) to service_role;
grant execute on function public.rental_report(date, date) to service_role;

-- check: each row should show service_role only
select p.proname, array_agg(distinct r.rolname order by r.rolname) as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public' and p.proname in ('rental_create_hold', 'rental_quote', 'rental_report')
  and r.rolname in ('anon', 'authenticated', 'service_role') and has_function_privilege(r.oid, p.oid, 'execute')
group by p.proname;
