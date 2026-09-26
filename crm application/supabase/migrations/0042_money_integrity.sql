-- 0042 — Phase 1: money integrity. Requires 0041 (enums) committed first.
-- Additive + idempotent. Validation lives here (triggers/constraints) so the app,
-- the MCP connector and SQL all hit the same rules.

-- ============ settings (key/value; thresholds + config live here) ============
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_staff on public.app_settings;
create policy app_settings_staff on public.app_settings for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
insert into public.app_settings (key, value, note) values
  ('vehicle_cost_mode',      '"mileage_rate"',  'mileage_rate | actual (lease+insurance allocated monthly)'),
  ('mileage_rate_per_mile',  '0.70',            'Standard mileage rate. Check the current IRS rate each January.'),
  ('vehicle_actual_monthly', '0',               'Used when vehicle_cost_mode = actual: lease + insurance per month'),
  ('trailer_capacity_cy',    '10.6',            '6.4x12 trailer, cubic yards per full load'),
  ('owner_target_hourly',    '100',             'Target owner earnings per owner hour'),
  ('home_base_address',      '"1746 Riverbank St, Lincoln Park, MI"', null),
  ('day_job_hours',          '{"days":[1,2,3,4,5],"start":"08:00","end":"17:30"}', 'Owner unavailable window, Detroit time'),
  ('capital_threshold',      '250',             'equipment_purchase at/above this is capital'),
  ('cash_reserve',           '0',               'Manual input for full_time_readiness'),
  ('reserve_target',         '10000',           'Cash reserve target'),
  ('required_owner_income',  '5000',            'Monthly income the owner needs to go full time'),
  ('ft_thresholds', '{"profit_multiple":1.3,"concentration_max_share":0.30,"concentration_months_of_6":4,"volume_jobs_per_month":12,"volume_consecutive_months":3,"seasonality_winter_ratio":0.60,"leads_per_month":25,"free_channel_share":0.40,"recurring_revenue_share":0.25,"paid_cost_per_job_max_share":0.15,"owner_hourly_min":75,"owner_hours_logged_share":0.90}', 'full_time_readiness thresholds')
on conflict (key) do nothing;

create or replace function public.setting_num(p_key text, p_default numeric default 0) returns numeric
language sql stable as $$
  select coalesce((select (value#>>'{}')::numeric from public.app_settings where key = p_key), p_default)
$$;

-- ============ 1.4 test / internal / backfilled flags ============
alter table public.jobs      add column if not exists is_test boolean not null default false;
alter table public.estimates add column if not exists is_test boolean not null default false;
alter table public.customers add column if not exists is_test boolean not null default false;
alter table public.payments  add column if not exists is_test boolean not null default false;
alter table public.invoices  add column if not exists is_test boolean not null default false;
alter table public.jobs      add column if not exists job_kind public.job_kind not null default 'customer';
alter table public.jobs      add column if not exists date_precision public.date_precision not null default 'exact';
alter table public.estimates add column if not exists date_precision public.date_precision not null default 'exact';
alter table public.invoices  add column if not exists date_precision public.date_precision not null default 'exact';
alter table public.jobs      add column if not exists internal_notes text;
alter table public.invoices  add column if not exists internal_notes text;

-- ============ 1.2 assets ============
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'tool' check (category in ('trailer','tool','vehicle','other')),
  purchased_on date,
  cost numeric(10,2) not null default 0,
  vendor text,
  useful_life_years numeric(4,1),
  disposed_on date,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.assets enable row level security;
drop policy if exists assets_staff on public.assets;
create policy assets_staff on public.assets for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ============ 1.1 expense classification ============
alter table public.expenses add column if not exists expense_class public.expense_class;
alter table public.expenses add column if not exists is_tax_deductible boolean not null default true;
alter table public.expenses add column if not exists asset_id uuid references public.assets(id) on delete set null;
alter table public.expenses add column if not exists campaign_id uuid;   -- fk added in 0044 (marketing_campaigns)
alter table public.expenses add column if not exists bank_txn_ref text;
alter table public.expenses add column if not exists is_pending boolean not null default false;
alter table public.expenses add column if not exists labor_entry_id uuid references public.labor_entries(id) on delete set null;
alter table public.expenses add column if not exists override_reason text; -- set to bypass the payroll/labor duplicate guard
create index if not exists idx_expenses_bank_txn_ref on public.expenses (bank_txn_ref) where bank_txn_ref is not null;
create index if not exists idx_expenses_class on public.expenses (expense_class);

create or replace function public.default_expense_class(p_category public.expense_category, p_amount numeric)
returns public.expense_class language sql immutable as $$
  select case p_category::text
    when 'owner_draw' then 'owner_draw'::public.expense_class
    when 'personal'   then 'personal'
    when 'equipment_purchase' then case when p_amount >= 250 then 'capital' else 'overhead' end
    when 'dump_fees' then 'direct_job_cost' when 'dumpster_rental' then 'direct_job_cost'
    when 'fuel' then 'direct_job_cost' when 'payroll' then 'direct_job_cost'
    when 'job_supplies' then 'direct_job_cost' when 'crew_meals' then 'direct_job_cost'
    when 'payment_processing' then 'direct_job_cost' when 'vehicle_mileage' then 'direct_job_cost'
    else 'overhead' end
$$;

-- Fill the class from the category when the writer didn't say; keep the ledger honest on deductibility.
create or replace function public.expenses_classify() returns trigger language plpgsql as $$
begin
  if new.expense_class is null then
    new.expense_class := public.default_expense_class(new.category, new.amount);
  end if;
  if new.expense_class in ('owner_draw','personal') then new.is_tax_deductible := false; end if;
  -- owner draws / personal never belong to a job's P&L
  if new.expense_class in ('owner_draw','personal') then new.job_id := null; end if;
  return new;
end $$;
drop trigger if exists expenses_classify on public.expenses;
create trigger expenses_classify before insert or update of category, expense_class, amount on public.expenses
  for each row execute function public.expenses_classify();

-- Backfill every existing row (the classify trigger only fires on writes)
update public.expenses set expense_class = public.default_expense_class(category, amount) where expense_class is null;
update public.expenses set is_tax_deductible = false where expense_class in ('owner_draw','personal') and is_tax_deductible;

-- ============ 1.5 owner vs helper labor ============
alter table public.workers add column if not exists is_owner boolean not null default false;
alter table public.workers add column if not exists target_hourly_value numeric(8,2);
alter table public.labor_entries add column if not exists activity public.labor_activity not null default 'on_job';
alter table public.time_entries  add column if not exists activity public.labor_activity not null default 'on_job';
-- job required for on-the-truck activities
alter table public.labor_entries drop constraint if exists labor_entries_job_required;
alter table public.labor_entries add constraint labor_entries_job_required
  check (activity not in ('on_job','drive','dump_run') or job_id is not null) not valid;
alter table public.labor_entries validate constraint labor_entries_job_required;

-- Owner worker record (Mico). $0 rate: draws aren't wages; hours still count.
insert into public.workers (name, default_rate, active, is_owner, target_hourly_value, user_id, notes)
select 'Mico Sanchez', 0, true, true, 100, 'e33ead09-404d-4043-b37c-ae2d1c22f90a', 'Owner. Hours logged at $0; owner_hourly report divides operating profit by these hours.'
where not exists (select 1 from public.workers where is_owner);

-- One source of truth for helper pay: a paid labor entry GENERATES its payroll expense.
create or replace function public.labor_paid_to_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; v_amt numeric;
begin
  if new.paid_at is not null and (old.paid_at is null or old.paid_at is distinct from new.paid_at)
     and new.deleted_at is null then
    select * into w from public.workers where id = new.worker_id;
    if w.is_owner then return new; end if;                          -- owner time is never payroll
    v_amt := coalesce(new.amount, new.hours * new.rate);
    if v_amt <= 0 then return new; end if;
    if not exists (select 1 from public.expenses where labor_entry_id = new.id and deleted_at is null) then
      insert into public.expenses (category, amount, incurred_on, vendor, description, job_id, paid_with,
                                   labor_entry_id, expense_class, created_by)
      values ('payroll', round(v_amt, 2), (new.paid_at at time zone 'America/Detroit')::date, w.name,
              format('Helper pay — %s, %s hr @ $%s', w.name, new.hours, new.rate), new.job_id, 'other',
              new.id, 'direct_job_cost', new.created_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists labor_entries_paid_expense on public.labor_entries;
create trigger labor_entries_paid_expense after update of paid_at on public.labor_entries
  for each row execute function public.labor_paid_to_expense();

-- Block a MANUAL payroll expense that duplicates a labor entry on the same job, unless overridden.
create or replace function public.expenses_block_double_payroll() returns trigger language plpgsql as $$
begin
  if new.category = 'payroll' and new.labor_entry_id is null and new.job_id is not null
     and new.override_reason is null
     and exists (select 1 from public.labor_entries l join public.workers w on w.id = l.worker_id
                 where l.job_id = new.job_id and l.deleted_at is null and not w.is_owner) then
    raise exception 'This job already has helper hours in labor_entries. Pay them with mark_hours_paid (the payroll expense is generated), or set override_reason to record a separate payout on purpose.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists expenses_block_double_payroll on public.expenses;
create trigger expenses_block_double_payroll before insert on public.expenses
  for each row execute function public.expenses_block_double_payroll();

-- ============ 1.3 payments integrity ============
alter table public.payments add column if not exists processing_fee numeric(10,2) not null default 0;
alter table public.payments add column if not exists external_source text;
alter table public.payments add column if not exists external_id text;
create unique index if not exists idx_payments_external on public.payments (external_source, external_id)
  where external_id is not null;
-- method is already NOT NULL text. Constrain it. 'card' stays valid (existing rows/tools);
-- 'unknown_legacy' is for the Feb–Jun backfill only.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in
  ('cash','check','venmo','cash_app','zelle','stripe_card','stripe_ach','bank_transfer','card','other','unknown_legacy')) not valid;
alter table public.payments validate constraint payments_method_check;
alter table public.payments drop constraint if exists payments_method_not_blank;
alter table public.payments add constraint payments_method_not_blank check (length(trim(method)) > 0);

-- Stripe fee → payment_processing expense on the invoice's job (once per payment)
create or replace function public.payment_fee_to_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if new.processing_fee > 0 and (tg_op = 'INSERT' or old.processing_fee is distinct from new.processing_fee) then
    select job_id into v_job from public.invoices where id = new.invoice_id;
    if not exists (select 1 from public.expenses where description like 'Processing fee — payment ' || new.id::text || '%' and deleted_at is null) then
      insert into public.expenses (category, amount, incurred_on, vendor, description, job_id, paid_with, expense_class, created_by)
      values ('payment_processing', new.processing_fee, (new.paid_at at time zone 'America/Detroit')::date,
              case when new.method like 'stripe%' then 'Stripe' else null end,
              'Processing fee — payment ' || new.id::text, v_job, 'other', 'direct_job_cost', new.created_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists payments_fee_expense on public.payments;
create trigger payments_fee_expense after insert or update of processing_fee on public.payments
  for each row execute function public.payment_fee_to_expense();

-- invoices.amount_paid is DERIVED from payments. A hand edit is silently replaced by the real sum
-- (the payments trigger recompute_invoice_paid runs at depth > 1 and is left alone).
create or replace function public.invoices_amount_paid_derived() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() <= 1 and new.amount_paid is distinct from old.amount_paid then
    select coalesce(sum(amount), 0) into new.amount_paid from public.payments where invoice_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists invoices_amount_paid_derived on public.invoices;
create trigger invoices_amount_paid_derived before update of amount_paid on public.invoices
  for each row execute function public.invoices_amount_paid_derived();

-- Every completed job gets an invoice: when a job reaches 'completed' with no live invoice, draft one.
create or replace function public.job_completed_auto_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_price numeric; v_due int;
begin
  if new.status = 'completed' and old.status is distinct from new.status and new.job_kind = 'customer' and not new.is_test
     and not exists (select 1 from public.invoices where job_id = new.id and deleted_at is null and voided_at is null) then
    v_price := coalesce(new.final_price, new.estimated_value);
    select coalesce(default_invoice_due_days, 14) into v_due from public.business_settings where id;
    insert into public.invoices (job_id, customer_id, status, tax_rate, due_at, created_by, date_precision, is_test)
    values (new.id, new.customer_id, 'draft', 0, now() + make_interval(days => coalesce(v_due, 14)), new.created_by, new.date_precision, new.is_test)
    returning id into v_inv;
    if v_price is not null and v_price > 0 then
      insert into public.invoice_items (invoice_id, kind, description, quantity, unit_price)
      values (v_inv, 'labor', new.title, 1, v_price);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_completed_auto_invoice on public.jobs;
create trigger jobs_completed_auto_invoice after update of status on public.jobs
  for each row execute function public.job_completed_auto_invoice();

-- A job can only be 'paid' when its invoice is covered by payments (or when the
-- invoice→job sync trigger itself is the caller, which is depth > 1).
create or replace function public.jobs_block_paid_without_money() returns trigger language plpgsql as $$
declare inv record;
begin
  if new.status = 'paid' and old.status is distinct from new.status and pg_trigger_depth() <= 1 and not new.is_test then
    select total, amount_paid into inv from public.invoices
      where job_id = new.id and deleted_at is null and voided_at is null order by created_at desc limit 1;
    if inv is null then
      raise exception 'Job cannot be marked paid: it has no invoice. Complete the job (an invoice is drafted), then record the payment on the invoice.' using errcode = 'check_violation';
    end if;
    if coalesce(inv.amount_paid, 0) + 0.005 < coalesce(inv.total, 0) then
      raise exception 'Job cannot be marked paid: invoice total $% but only $% in payments. Record the payment first.', inv.total, inv.amount_paid using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_block_paid_without_money on public.jobs;
create trigger jobs_block_paid_without_money before update of status on public.jobs
  for each row execute function public.jobs_block_paid_without_money();

-- Job reopened from paid → invoice back to 'sent' (mirror of invoices_unpaid_sync)
create or replace function public.job_reopened_invoice_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'paid' and new.status in ('in_progress','completed','scheduled') and pg_trigger_depth() <= 1 then
    update public.invoices set status = 'sent', paid_at = null
      where job_id = new.id and status = 'paid' and deleted_at is null and voided_at is null
        and amount_paid + 0.005 < total;  -- only if the money really isn't there
  end if;
  return new;
end $$;
drop trigger if exists jobs_reopened_invoice_sync on public.jobs;
create trigger jobs_reopened_invoice_sync after update of status on public.jobs
  for each row execute function public.job_reopened_invoice_sync();

-- ============ 1.6 mileage ============
create table if not exists public.mileage_log (
  id uuid primary key default gen_random_uuid(),
  logged_on date not null default (now() at time zone 'America/Detroit')::date,
  job_id uuid references public.jobs(id) on delete set null,
  miles numeric(8,1) not null check (miles >= 0),
  purpose text,
  start_odometer integer,
  end_odometer integer,
  rate_per_mile numeric(6,3) not null default public.setting_num('mileage_rate_per_mile', 0.70),
  amount numeric(10,2) generated always as (round(miles * rate_per_mile, 2)) stored,
  external_source text, external_id text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_mileage_job on public.mileage_log (job_id);
create unique index if not exists idx_mileage_external on public.mileage_log (external_source, external_id) where external_id is not null;
alter table public.mileage_log enable row level security;
drop policy if exists mileage_staff on public.mileage_log;
create policy mileage_staff on public.mileage_log for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
