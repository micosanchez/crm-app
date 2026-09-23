-- ============================================================
-- 0040 — OWNER DECISION: count crew labor as a job cost
--
-- NOT applied by the audit. Read, decide, then run (or don't).
--
-- Today job_profitability = paid invoices − job-linked expenses. Crew pay only
-- counts when it is ALSO typed in as a `payroll` expense linked to the job.
-- Since 0036, clocking in/out on a job auto-creates a labor_entries row
-- (hours × the worker's stamped rate), and the connector's log_hours does the
-- same — but that cost never reaches the profit number, so margins read high
-- (the Aug-10 audit measured ~78% shown vs ~60% real on fully-costed jobs).
--
-- This adds labor_entries (hours × rate, not soft-deleted) to costs.
-- RISK OF DOUBLE COUNTING: if you have been logging crew pay as a job-linked
-- `payroll` expense AND those same hours are in labor_entries, both would
-- count. Check with:
--   select j.title, e.amount as payroll_expense, l.hours*l.rate as labor
--   from public.expenses e join public.jobs j on j.id = e.job_id
--   join public.labor_entries l on l.job_id = j.id
--   where e.category = 'payroll' and e.deleted_at is null and l.deleted_at is null;
-- and pick ONE way to record crew pay before running this.
-- ============================================================
create or replace view public.job_profitability with (security_invoker = true) as
select
  j.id as job_id,
  j.title,
  j.service,
  j.customer_id,
  j.status,
  coalesce(rev.revenue, 0) as revenue,
  coalesce(cost.costs, 0) + coalesce(lab.labor, 0) as costs,
  coalesce(rev.revenue, 0) - coalesce(cost.costs, 0) - coalesce(lab.labor, 0) as profit
from public.jobs j
left join lateral (
  select sum(total) as revenue from public.invoices
  where job_id = j.id and status = 'paid' and voided_at is null and deleted_at is null
) rev on true
left join lateral (
  select sum(amount) as costs from public.expenses where job_id = j.id and deleted_at is null
) cost on true
left join lateral (
  select sum(hours * rate) as labor from public.labor_entries where job_id = j.id and deleted_at is null
) lab on true
where j.deleted_at is null;
