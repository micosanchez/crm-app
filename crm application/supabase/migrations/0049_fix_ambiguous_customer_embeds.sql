-- 0049 — HOTFIX (2026-09-27). 0044 added jobs.referred_by_customer_id and leads.referred_by_customer_id
-- with foreign keys to customers. PostgREST then sees two relationships between jobs and customers
-- and refuses every `customers(...)` embed from jobs (PGRST201: "more than one relationship was
-- found for 'jobs' and 'customers'"). That broke list_jobs, dashboard_summary and the app's job pages.
-- Fix: keep the columns (the referral chain still works through customers.referred_by_customer_id and
-- the value on the job), drop only the FK constraints so each table has exactly one path to customers.
-- No data is touched.
alter table public.jobs  drop constraint if exists jobs_referred_by_customer_id_fkey;
alter table public.leads drop constraint if exists leads_referred_by_customer_id_fkey;

-- Guard: nothing else may hold a second FK to customers from these tables.
do $$
declare r record;
begin
  for r in select c.conrelid::regclass::text as tbl, count(*) as n
           from pg_constraint c
           where c.contype = 'f' and c.confrelid = 'public.customers'::regclass
             and c.conrelid in ('public.jobs'::regclass, 'public.leads'::regclass, 'public.invoices'::regclass,
                                'public.estimates'::regclass, 'public.payments'::regclass, 'public.estimate_requests'::regclass)
           group by 1 having count(*) > 1
  loop
    raise exception 'Table % still has % foreign keys to customers', r.tbl, r.n;
  end loop;
end $$;

select c.conrelid::regclass::text as tbl, c.conname
from pg_constraint c
where c.contype = 'f' and c.confrelid = 'public.customers'::regclass
order by 1;
