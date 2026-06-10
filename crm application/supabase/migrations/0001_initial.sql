-- ============================================================
-- Fieldtrack CRM — initial schema
-- Run in Supabase SQL Editor (or `supabase db push`)
-- ============================================================

-- ---------- ENUMS ----------
create type user_role as enum ('admin', 'dispatcher', 'technician');
create type job_status as enum ('lead', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid');
create type invoice_status as enum ('draft', 'sent', 'paid');
create type customer_tag as enum ('residential', 'commercial', 'repeat', 'high_value');
create type service_type as enum ('junk_removal', 'landscaping', 'other');

-- ---------- USERS (profiles, linked to Supabase auth) ----------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  role user_role not null default 'technician',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- CUSTOMERS ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  city text,
  notes text,
  tags customer_tag[] not null default '{}',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_idx on public.customers using gin (to_tsvector('simple', name));

-- ---------- JOBS ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  title text not null,
  description text,
  service service_type not null default 'junk_removal',
  status job_status not null default 'lead',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  address text,
  estimated_value numeric(10,2),
  photos jsonb not null default '[]'::jsonb, -- [{url, caption, uploaded_by, uploaded_at}]
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_customer_idx on public.jobs(customer_id);
create index jobs_status_idx on public.jobs(status);
create index jobs_sched_idx on public.jobs(scheduled_start);

-- Crew assignment (many-to-many)
create table public.job_assignments (
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

-- ---------- JOB STATUS HISTORY (immutable) ----------
create table public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status job_status,
  to_status job_status not null,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now(),
  note text
);
create index jsh_job_idx on public.job_status_history(job_id);

-- ---------- INVOICES ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number serial,
  job_id uuid not null references public.jobs(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status invoice_status not null default 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  subtotal numeric(10,2) not null default 0,
  tax_rate numeric(5,4) not null default 0,
  total numeric(10,2) not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_job_idx on public.invoices(job_id);
create index invoices_status_idx on public.invoices(status);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  kind text not null check (kind in ('labor','disposal','materials','other')),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(10,2) generated always as (quantity * unit_price) stored
);
create index invoice_items_idx on public.invoice_items(invoice_id);

-- ---------- SCHEDULE EVENTS ----------
create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index sched_time_idx on public.schedule_events(starts_at);
create index sched_user_idx on public.schedule_events(user_id);

-- ---------- NOTES ----------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer','job','invoice')),
  entity_id uuid not null,
  body text not null,
  author_id uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index notes_entity_idx on public.notes(entity_type, entity_id);

-- ---------- MESSAGES (SMS/email hooks — architecture placeholder) ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  channel text not null check (channel in ('sms','email','internal')),
  direction text not null check (direction in ('outbound','inbound')),
  body text not null,
  status text not null default 'pending', -- pending|sent|delivered|failed
  provider_id text,
  sent_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ---------- ACTIVITY LOG (GLOBAL MEMORY LAYER, immutable) ----------
create table public.activity_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  action_type text not null, -- created|updated|status_changed|deleted|assigned|...
  user_id uuid references public.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_entity_idx on public.activity_log(entity_type, entity_id);
create index activity_time_idx on public.activity_log(created_at desc);

-- ---------- IDEMPOTENCY KEYS (offline sync dedupe) ----------
create table public.idempotency_keys (
  key uuid primary key,
  user_id uuid references public.users(id),
  response jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- updated_at maintenance
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

-- Automatic activity logging (memory backbone)
create or replace function public.log_activity() returns trigger as $$
declare
  v_action text;
  v_entity_id uuid;
  v_meta jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'created'; v_entity_id := new.id; v_meta := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'updated'; v_entity_id := new.id;
    v_meta := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    v_action := 'deleted'; v_entity_id := old.id; v_meta := to_jsonb(old);
  end if;

  insert into public.activity_log (entity_type, entity_id, action_type, user_id, metadata)
  values (tg_table_name, v_entity_id, v_action, auth.uid(), v_meta);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger customers_log after insert or update or delete on public.customers
  for each row execute function public.log_activity();
create trigger jobs_log after insert or update or delete on public.jobs
  for each row execute function public.log_activity();
create trigger invoices_log after insert or update or delete on public.invoices
  for each row execute function public.log_activity();
create trigger notes_log after insert on public.notes
  for each row execute function public.log_activity();
create trigger sched_log after insert or update or delete on public.schedule_events
  for each row execute function public.log_activity();

-- Job status changes → immutable status history
create or replace function public.track_job_status() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_status_history (job_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif old.status is distinct from new.status then
    insert into public.job_status_history (job_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger jobs_status_track after insert or update on public.jobs
  for each row execute function public.track_job_status();

-- Invoice totals recompute on item changes
create or replace function public.recompute_invoice_total() returns trigger as $$
declare v_invoice uuid; v_sub numeric;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0) into v_sub from public.invoice_items where invoice_id = v_invoice;
  update public.invoices
    set subtotal = v_sub, total = round(v_sub * (1 + tax_rate), 2)
    where id = v_invoice;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger invoice_items_total after insert or update or delete on public.invoice_items
  for each row execute function public.recompute_invoice_total();

-- New auth user → profile row (default technician; promote via admin)
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.users (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'technician')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_status_history enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.schedule_events enable row level security;
alter table public.notes enable row level security;
alter table public.messages enable row level security;
alter table public.activity_log enable row level security;
alter table public.idempotency_keys enable row level security;

create or replace function public.app_role() returns user_role as $$
  select role from public.users where id = auth.uid();
$$ language sql stable security definer;

-- Users: everyone authenticated can read team; only admin updates roles
create policy users_read on public.users for select to authenticated using (true);
create policy users_self_update on public.users for update to authenticated
  using (id = auth.uid() or public.app_role() = 'admin');

-- Customers / jobs / schedule / notes / messages: all authenticated staff read+write
create policy customers_all on public.customers for all to authenticated using (true) with check (true);
create policy jobs_all on public.jobs for all to authenticated using (true) with check (true);
create policy assignments_all on public.job_assignments for all to authenticated using (true) with check (true);
create policy sched_all on public.schedule_events for all to authenticated using (true) with check (true);
create policy notes_all on public.notes for all to authenticated using (true) with check (true);
create policy messages_all on public.messages for all to authenticated using (true) with check (true);

-- Invoices: technicians read-only; admin/dispatcher full
create policy invoices_read on public.invoices for select to authenticated using (true);
create policy invoices_write on public.invoices for insert to authenticated
  with check (public.app_role() in ('admin','dispatcher'));
create policy invoices_update on public.invoices for update to authenticated
  using (public.app_role() in ('admin','dispatcher'));
create policy invoice_items_read on public.invoice_items for select to authenticated using (true);
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

-- History/log: read-only to staff, written only by triggers (security definer)
create policy jsh_read on public.job_status_history for select to authenticated using (true);
create policy activity_read on public.activity_log for select to authenticated using (true);

-- Idempotency: owner only
create policy idem_own on public.idempotency_keys for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- STORAGE bucket for job photos (run once)
-- ============================================================
insert into storage.buckets (id, name, public) values ('job-photos','job-photos', true)
  on conflict (id) do nothing;
create policy job_photos_rw on storage.objects for all to authenticated
  using (bucket_id = 'job-photos') with check (bucket_id = 'job-photos');
