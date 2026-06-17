-- ============================================================
-- Recurring jobs / maintenance plans (audit gap: recurring revenue).
-- STAGED: run at batch release. Flagged via NEXT_PUBLIC_FF_RECURRING / FF_RECURRING.
-- A daily scheduled task calls generate_due_recurring_jobs().
-- ============================================================

create table if not exists public.job_recurrence (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  title text not null,
  service service_type not null default 'landscaping',
  estimated_value numeric(10,2),
  address text,
  interval_days integer not null check (interval_days > 0),  -- 7 weekly, 14 biweekly, 30 monthly
  next_run date not null,
  active boolean not null default true,
  lead_source text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists job_recurrence_next_idx on public.job_recurrence(next_run) where active;

alter table public.job_recurrence enable row level security;
create policy job_recurrence_all on public.job_recurrence for all to authenticated
  using (true) with check (true);

-- Materialize jobs whose next_run is due and advance the schedule. Idempotent per day.
create or replace function public.generate_due_recurring_jobs() returns integer
language plpgsql security definer as $$
declare r record; n integer := 0;
begin
  for r in select * from public.job_recurrence where active and next_run <= current_date loop
    insert into public.jobs (customer_id, title, service, status, estimated_value, address, scheduled_start, lead_source, created_at)
    values (r.customer_id, r.title, r.service, 'scheduled', r.estimated_value, r.address,
            (r.next_run::timestamptz + time '09:00'), r.lead_source, now());
    update public.job_recurrence
      set next_run = r.next_run + (r.interval_days || ' days')::interval
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end; $$;

-- Schedule daily (run once at release):
--   select cron.schedule('recurring-jobs','0 6 * * *', $$ select public.generate_due_recurring_jobs(); $$);
