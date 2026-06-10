-- ============================================================
-- SJHC Command Center — Phase 1: Leads, Estimates, Expenses, Job Costing
-- Run in Supabase SQL Editor after 0001
-- ============================================================

create type lead_status as enum ('new','contacted','estimate_sent','accepted','scheduled','won','lost');
create type lead_source as enum ('google','facebook','referral','yard_sign','website','repeat_customer','other');
create type estimate_status as enum ('draft','sent','accepted','declined','expired');
create type expense_category as enum ('dump_fees','fuel','payroll','equipment_purchase','equipment_repair','vehicle_repair','insurance','marketing','office','software','utilities','permits','misc');

alter table public.customers add column if not exists lead_source lead_source;

-- ---------- LEADS ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  source lead_source not null default 'other',
  status lead_status not null default 'new',
  service service_type not null default 'junk_removal',
  est_value numeric(10,2),
  notes text,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on public.leads(status);
create index leads_source_idx on public.leads(source);

-- ---------- ESTIMATES ----------
create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  estimate_number serial,
  customer_id uuid references public.customers(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  status estimate_status not null default 'draft',
  notes text,
  subtotal numeric(10,2) not null default 0,
  tax_rate numeric(5,4) not null default 0,
  total numeric(10,2) not null default 0,
  valid_until date,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index estimates_status_idx on public.estimates(status);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(10,2) generated always as (quantity * unit_price) stored
);
create index estimate_items_idx on public.estimate_items(estimate_id);

-- ---------- EXPENSES ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category expense_category not null,
  amount numeric(10,2) not null,
  incurred_on date not null default current_date,
  vendor text,
  description text,
  job_id uuid references public.jobs(id) on delete set null,
  receipt_url text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses(incurred_on desc);
create index expenses_job_idx on public.expenses(job_id);
create index expenses_cat_idx on public.expenses(category);

-- ---------- JOB PROFITABILITY (costing engine v1) ----------
create or replace view public.job_profitability with (security_invoker = true) as
select
  j.id as job_id,
  j.title,
  j.service,
  j.customer_id,
  j.status,
  coalesce(rev.revenue, 0) as revenue,
  coalesce(cost.costs, 0) as costs,
  coalesce(rev.revenue, 0) - coalesce(cost.costs, 0) as profit
from public.jobs j
left join lateral (
  select sum(total) as revenue from public.invoices
  where job_id = j.id and status = 'paid'
) rev on true
left join lateral (
  select sum(amount) as costs from public.expenses where job_id = j.id
) cost on true;

-- ---------- TRIGGERS ----------
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();
create trigger estimates_touch before update on public.estimates
  for each row execute function public.touch_updated_at();
create trigger expenses_touch before update on public.expenses
  for each row execute function public.touch_updated_at();

create trigger leads_log after insert or update or delete on public.leads
  for each row execute function public.log_activity();
create trigger estimates_log after insert or update or delete on public.estimates
  for each row execute function public.log_activity();
create trigger expenses_log after insert or update or delete on public.expenses
  for each row execute function public.log_activity();

create or replace function public.recompute_estimate_total() returns trigger as $$
declare v_estimate uuid; v_sub numeric;
begin
  v_estimate := coalesce(new.estimate_id, old.estimate_id);
  select coalesce(sum(amount),0) into v_sub from public.estimate_items where estimate_id = v_estimate;
  update public.estimates
    set subtotal = v_sub, total = round(v_sub * (1 + tax_rate), 2)
    where id = v_estimate;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger estimate_items_total after insert or update or delete on public.estimate_items
  for each row execute function public.recompute_estimate_total();

-- ---------- RLS ----------
alter table public.leads enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_items enable row level security;
alter table public.expenses enable row level security;

-- Leads & estimates: all staff read; admin/dispatcher write
create policy leads_read on public.leads for select to authenticated using (true);
create policy leads_write on public.leads for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

create policy estimates_read on public.estimates for select to authenticated using (true);
create policy estimates_write on public.estimates for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));
create policy estimate_items_read on public.estimate_items for select to authenticated using (true);
create policy estimate_items_write on public.estimate_items for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

-- Expenses: financials — admin/dispatcher only (technicians get nothing)
create policy expenses_admin on public.expenses for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));
