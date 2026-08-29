-- 0035 Role-based visibility: technicians must not see company money (P0 #11)
-- + soft-deleted rows disappear from every app read.
--
-- Enforced in the DATABASE: financial tables become admin/dispatcher-only at
-- RLS (0014 was written for this in July but never ran in production — the
-- live policies were still `using (true)`); jobs money columns are protected
-- by removing technicians' direct SELECT on jobs entirely and giving them
-- SECURITY DEFINER RPCs that return only the redacted field list. A
-- technician hitting PostgREST directly gets zero rows from jobs, invoices,
-- invoice_items, estimates, estimate_items, payments, expenses,
-- labor_entries, and workers.
--
-- Technicians keep: their assigned jobs (via RPCs, no dollar fields), job
-- updates on assigned jobs (status/photos from the Field screen), customers
-- (name/phone/address — needed to do the work), notes, schedule events, their
-- own time entries, and their own users row.

-- ---------- helper ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select public.app_role() in ('admin','dispatcher') $$;

-- ---------- customers: all roles read (not deleted); staff write ----------
drop policy if exists customers_all    on public.customers;
drop policy if exists customers_read   on public.customers;
create policy customers_read on public.customers for select to authenticated
  using (deleted_at is null);

-- ---------- jobs: staff-only direct reads; techs use the RPCs ----------
drop policy if exists jobs_all    on public.jobs;
drop policy if exists jobs_read   on public.jobs;
create policy jobs_read on public.jobs for select to authenticated
  using (public.is_staff() and deleted_at is null);
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update to authenticated
  using (deleted_at is null and (public.is_staff() or exists (
    select 1 from public.job_assignments a where a.job_id = jobs.id and a.user_id = auth.uid())))
  with check (public.is_staff() or exists (
    select 1 from public.job_assignments a where a.job_id = jobs.id and a.user_id = auth.uid()));
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert to authenticated
  with check (public.is_staff());

-- ---------- financial tables: staff only (0014, finally applied) ----------
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (public.is_staff() and deleted_at is null);
drop policy if exists invoice_items_read on public.invoice_items;
create policy invoice_items_read on public.invoice_items for select to authenticated
  using (public.is_staff());
drop policy if exists estimates_read on public.estimates;
create policy estimates_read on public.estimates for select to authenticated
  using (public.is_staff() and deleted_at is null);
drop policy if exists estimate_items_read on public.estimate_items;
create policy estimate_items_read on public.estimate_items for select to authenticated
  using (public.is_staff());

-- The old *_write policies were FOR ALL, which also grants SELECT and would
-- OR around the deleted_at filter above. Split them into explicit commands.
drop policy if exists estimates_write on public.estimates;
drop policy if exists estimates_insert on public.estimates;
create policy estimates_insert on public.estimates for insert to authenticated
  with check (public.is_staff());
drop policy if exists estimates_update on public.estimates;
create policy estimates_update on public.estimates for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists estimates_delete on public.estimates;
create policy estimates_delete on public.estimates for delete to authenticated
  using (public.is_staff());
drop policy if exists estimate_items_write on public.estimate_items;
drop policy if exists estimate_items_insert on public.estimate_items;
create policy estimate_items_insert on public.estimate_items for insert to authenticated
  with check (public.is_staff());
drop policy if exists estimate_items_update on public.estimate_items;
create policy estimate_items_update on public.estimate_items for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists estimate_items_delete on public.estimate_items;
create policy estimate_items_delete on public.estimate_items for delete to authenticated
  using (public.is_staff());
drop policy if exists expenses_admin on public.expenses;
create policy expenses_admin on public.expenses for all to authenticated
  using (public.is_staff() and deleted_at is null)
  with check (public.is_staff());
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.is_staff());
drop policy if exists labor_entries_staff on public.labor_entries;
create policy labor_entries_staff on public.labor_entries for all to authenticated
  using (public.is_staff() and deleted_at is null)
  with check (public.is_staff());
drop policy if exists workers_staff on public.workers;
create policy workers_staff on public.workers for all to authenticated
  using (public.is_staff() and deleted_at is null)
  with check (public.is_staff());

-- ---------- users: own row, or staff (hides teammates' contact info) ----------
drop policy if exists users_read on public.users;
create policy users_read on public.users for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- ---------- time entries: own, or staff; hide soft-deleted ----------
drop policy if exists time_entries_rw    on public.time_entries;
drop policy if exists time_entries_read  on public.time_entries;
drop policy if exists time_entries_write on public.time_entries;
create policy time_entries_read on public.time_entries for select to authenticated
  using (deleted_at is null and (user_id = auth.uid() or public.is_staff()));
drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = auth.uid() or public.is_staff());
drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = auth.uid() or public.is_staff())
  with check (user_id = auth.uid() or public.is_staff());
drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (public.is_staff());

-- ---------- technician job access: redacted, assigned-only RPCs ----------
-- No dollar columns in the return type, so no request shape can leak money.
drop function if exists public.tech_my_jobs(timestamptz, timestamptz);
create function public.tech_my_jobs(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  id uuid, title text, description text, status public.job_status,
  service public.service_type, scheduled_start timestamptz, scheduled_end timestamptz,
  address text, photos jsonb, customer_id uuid, customer_name text, customer_phone text
) language sql stable security definer set search_path = public as $$
  select j.id, j.title, j.description, j.status, j.service,
         j.scheduled_start, j.scheduled_end, j.address, j.photos,
         c.id, c.name, c.phone
  from public.jobs j
  left join public.customers c on c.id = j.customer_id
  where j.deleted_at is null
    and j.status <> 'cancelled'
    and exists (select 1 from public.job_assignments a
                where a.job_id = j.id and a.user_id = auth.uid())
    and (p_from is null or j.scheduled_start >= p_from)
    and (p_to   is null or j.scheduled_start <  p_to)
  order by j.scheduled_start nulls last;
$$;
grant execute on function public.tech_my_jobs(timestamptz, timestamptz) to authenticated;

drop function if exists public.tech_job(uuid);
create function public.tech_job(p_id uuid)
returns table (
  id uuid, title text, description text, status public.job_status,
  service public.service_type, scheduled_start timestamptz, scheduled_end timestamptz,
  address text, photos jsonb, customer_id uuid, customer_name text, customer_phone text
) language sql stable security definer set search_path = public as $$
  select j.id, j.title, j.description, j.status, j.service,
         j.scheduled_start, j.scheduled_end, j.address, j.photos,
         c.id, c.name, c.phone
  from public.jobs j
  left join public.customers c on c.id = j.customer_id
  where j.id = p_id
    and j.deleted_at is null
    and exists (select 1 from public.job_assignments a
                where a.job_id = j.id and a.user_id = auth.uid());
$$;
grant execute on function public.tech_job(uuid) to authenticated;
