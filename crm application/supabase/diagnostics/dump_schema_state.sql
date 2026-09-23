-- READ-ONLY. Paste into the Supabase SQL editor and save each result as CSV.
-- Purpose: the repo's migration folder does not match production (0015–0019 were
-- never committed, 0016 was "review first", 0029_fix and 0032 both redefine
-- sign_estimate, and 0035 leaves customers/jobs/invoices with no DELETE policy
-- on paper). This dump lets the next engineering pass reconcile the two
-- without guessing. Nothing here modifies anything.

-- 1) Every RLS policy, by table
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- 2) Tables with RLS on/off
select relname as table_name, relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and relkind = 'r' order by relname;

-- 3) Every trigger
select event_object_table as table_name, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers where trigger_schema = 'public' order by 1, 2;

-- 4) Every function body (compare sign_estimate, estimate_by_token, invoice_by_token, log_activity)
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.proname;

-- 5) Enum values (job_status should include 'cancelled'; lead_source should include instagram, google_ads)
select t.typname, e.enumlabel, e.enumsortorder
from pg_type t join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' order by 1, 3;

-- 6) Indexes
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2;

-- 7) Storage buckets (job-photos should probably be private — owner decision)
select id, name, public from storage.buckets;

-- 8) pg_cron jobs (recurring-jobs generator)
select jobid, jobname, schedule, command, active from cron.job;

-- 9) Data sanity: signed estimates without an archive snapshot (should be 0 after 0039)
select count(*) as signed_estimates_missing_snapshot
from public.estimates e where e.signed_at is not null
  and not exists (select 1 from public.document_snapshots s where s.kind = 'estimate' and s.source_id = e.id);

-- 10) Data sanity: "paid" jobs whose invoice is not paid, and paid invoices with no payments row
select j.id, j.title, i.invoice_number, i.status as invoice_status
from public.jobs j join public.invoices i on i.job_id = j.id
where j.status = 'paid' and i.status <> 'paid' and i.voided_at is null;

select i.invoice_number, i.total, i.amount_paid, i.paid_at
from public.invoices i
where i.status = 'paid' and i.voided_at is null
  and not exists (select 1 from public.payments p where p.invoice_id = i.id);

-- 11) Data sanity: expenses not linked to a job (the margin-inflation problem)
select count(*) filter (where job_id is null) as unlinked, count(*) as total, sum(amount) filter (where job_id is null) as unlinked_amount
from public.expenses where deleted_at is null;
