-- 0025 — Phase 1 audit fixes: close the self-promote-to-admin hole + add the
-- foreign-key / filter indexes the connected-drill-down pages now rely on.
-- Additive and idempotent. Safe to run on production.

-- ---------------------------------------------------------------------------
-- SECURITY: prevent a non-admin from changing their OWN role.
-- The 0001 users_self_update policy lets a user update their own row but has
-- no column restriction, so a signed-in user could set role='admin'. RLS can't
-- easily gate a single column, so we guard it with a trigger: any role change
-- attempted by a non-admin is silently reverted to the existing value. Admins
-- (Team page) can still change roles.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and public.app_role() <> 'admin' then
    new.role := old.role;  -- non-admins cannot change any role, including their own
  end if;
  return new;
end;
$$;

drop trigger if exists users_no_self_promote on public.users;
create trigger users_no_self_promote
  before update on public.users
  for each row execute function public.prevent_self_role_change();

-- ---------------------------------------------------------------------------
-- PERFORMANCE: index the foreign keys and filters the new pages hit
-- (Customer 360, Job P&L, Reports, global search). All IF NOT EXISTS.
-- ---------------------------------------------------------------------------
create index if not exists idx_expenses_job_id          on public.expenses (job_id);
create index if not exists idx_invoices_customer_id      on public.invoices (customer_id);
create index if not exists idx_invoices_job_id           on public.invoices (job_id);
create index if not exists idx_invoices_status_paid_at   on public.invoices (status, paid_at);
create index if not exists idx_estimates_customer_id     on public.estimates (customer_id);
create index if not exists idx_estimates_job_id          on public.estimates (job_id);
create index if not exists idx_jobs_customer_id          on public.jobs (customer_id);

-- ---------------------------------------------------------------------------
-- DEFERRED (not in this migration): adding connector labor_entries to the
-- job_profitability view. labor_entries is owned by the connector (migration
-- 0023) and currently holds 0 rows; crew pay logged as a job-linked payroll
-- expense is already counted by the view. Revisit once the connector's labor
-- system is in active use, to avoid coupling this view to a table whose schema
-- lives outside this repo.
-- ---------------------------------------------------------------------------
