-- ============================================================
-- Technician time tracking (clock in / clock out) — labor per job.
-- STAGED: run at batch release.
-- ============================================================

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists time_entries_user_idx on public.time_entries(user_id, started_at desc);
create index if not exists time_entries_job_idx on public.time_entries(job_id);

alter table public.time_entries enable row level security;
-- A worker manages their own entries; admin/dispatcher see the whole crew.
create policy time_entries_rw on public.time_entries for all to authenticated
  using (user_id = auth.uid() or public.app_role() in ('admin','dispatcher'))
  with check (user_id = auth.uid() or public.app_role() in ('admin','dispatcher'));

create trigger time_entries_log after insert or update or delete on public.time_entries
  for each row execute function public.log_activity();
