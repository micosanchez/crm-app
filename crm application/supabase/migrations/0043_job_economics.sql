-- 0043 — Phase 2: job economics. Requires 0041, 0042.

-- ============ 2.1 / 2.2 taxonomy, load, difficulty ============
alter table public.jobs add column if not exists service_type public.job_service_type;
alter table public.jobs add column if not exists secondary_service_types public.job_service_type[];
alter table public.jobs add column if not exists hauling_unit public.hauling_unit;
alter table public.jobs add column if not exists load_fraction numeric(5,2) check (load_fraction is null or load_fraction >= 0);
alter table public.jobs add column if not exists est_cubic_yards numeric(7,1);
alter table public.jobs add column if not exists est_weight_lbs numeric(9,1);
alter table public.jobs add column if not exists mattress_count int not null default 0;
alter table public.jobs add column if not exists box_spring_count int not null default 0;
alter table public.jobs add column if not exists heavy_item_count int not null default 0;
alter table public.jobs add column if not exists access_flags public.access_flag[] not null default '{}';
alter table public.jobs add column if not exists crew_size int;
alter table public.jobs add column if not exists on_site_minutes int;
alter table public.jobs add column if not exists quoted_price numeric(10,2);
alter table public.jobs add column if not exists picked_up_at timestamptz;
alter table public.jobs add column if not exists disposed_at timestamptz;
alter table public.jobs add column if not exists staged boolean not null default false;
alter table public.jobs add column if not exists cancel_reason public.cancel_reason;
alter table public.jobs add column if not exists cancelled_at timestamptz;
-- quotes carry the same estimate fields
alter table public.estimates add column if not exists service_type public.job_service_type;
alter table public.estimates add column if not exists hauling_unit public.hauling_unit;
alter table public.estimates add column if not exists load_fraction numeric(5,2);
alter table public.estimates add column if not exists est_cubic_yards numeric(7,1);
alter table public.estimates add column if not exists est_weight_lbs numeric(9,1);
alter table public.estimates add column if not exists mattress_count int not null default 0;
alter table public.estimates add column if not exists heavy_item_count int not null default 0;
alter table public.estimates add column if not exists access_flags public.access_flag[] not null default '{}';
alter table public.estimates add column if not exists crew_size int;

create index if not exists idx_jobs_service_type on public.jobs (service_type);
create index if not exists idx_jobs_kind_test on public.jobs (job_kind, is_test);

-- Guess the service line from a title (used for the legacy backfill review CSV and as a hint)
create or replace function public.suggest_service_type(p_title text) returns public.job_service_type
language sql immutable as $$
  select case
    when p_title ~* 'hot ?tub' then 'hot_tub'
    when p_title ~* 'mattress' then 'mattress'
    when p_title ~* '(fridge|freezer|washer|dryer|appliance|stove)' then 'appliance'
    when p_title ~* '(estate)' then 'estate_cleanout'
    when p_title ~* '(whole|full) home|whole house|full house' then 'whole_home_cleanout'
    when p_title ~* 'garage' then 'garage_cleanout'
    when p_title ~* 'basement' then 'basement_cleanout'
    when p_title ~* '(brush|tree|yard|storm|debris removal & haul|compost|leaves)' then 'yard_waste'
    when p_title ~* '(demo|demolition|deck)' then 'demo'
    when p_title ~* '(construction|cabinet|flooring|drywall|carpet)' then 'construction_debris'
    when p_title ~* '(office|building|commercial|apartment|unit)' then 'commercial_cleanout'
    when p_title ~* '(turnover|tenant)' then 'property_turnover'
    when p_title ~* '(couch|sofa|sectional|furniture|dresser|recliner|table)' then 'furniture'
    when p_title ~* '(grill|smoker|single|one item|tv|bike)' then 'single_item'
    else null end
$$;

-- ============ Required-on-new-jobs rules ============
-- service_type: required, except for jobs the system creates from an accepted quote / recurrence
-- (those callers set the session flag and the quote's service_type is copied over afterwards).
-- lead_source: inherited from the customer; 'unknown' is allowed and reported prominently.
create or replace function public.jobs_require_fields() returns trigger language plpgsql as $$
declare v_src text;
begin
  if new.job_kind = 'internal' and new.service_type is null then new.service_type := 'other'; end if;
  if new.service_type is null then
    if coalesce(current_setting('sjhc.auto_job', true), '') = '1' then
      new.service_type := 'other';
    else
      raise exception 'service_type is required on a new job (single_item, furniture, appliance, mattress, hot_tub, garage_cleanout, basement_cleanout, estate_cleanout, whole_home_cleanout, yard_waste, construction_debris, demo, commercial_cleanout, property_turnover, other).'
        using errcode = 'not_null_violation';
    end if;
  end if;
  if new.lead_source is null or btrim(new.lead_source) = '' then
    select lead_source::text into v_src from public.customers where id = new.customer_id;
    new.lead_source := coalesce(v_src, 'unknown');
  end if;
  if new.est_cubic_yards is null and new.load_fraction is not null then
    new.est_cubic_yards := round(new.load_fraction * public.setting_num('trailer_capacity_cy', 10.6), 1);
  end if;
  return new;
end $$;
drop trigger if exists jobs_require_fields on public.jobs;
create trigger jobs_require_fields before insert on public.jobs
  for each row execute function public.jobs_require_fields();

-- Same derived cubic yards on update
create or replace function public.jobs_derive_cy() returns trigger language plpgsql as $$
begin
  if new.load_fraction is not null and (new.est_cubic_yards is null or new.load_fraction is distinct from old.load_fraction) then
    new.est_cubic_yards := round(new.load_fraction * public.setting_num('trailer_capacity_cy', 10.6), 1);
  end if;
  return new;
end $$;
drop trigger if exists jobs_derive_cy on public.jobs;
create trigger jobs_derive_cy before update of load_fraction on public.jobs
  for each row execute function public.jobs_derive_cy();

-- When a quote gets linked to a job (accept / sign), the job inherits the quote's
-- scope fields and remembers the quoted price for scope-creep reporting.
create or replace function public.estimate_linked_to_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.job_id is not null and new.job_id is distinct from old.job_id then
    update public.jobs j set
      quoted_price   = coalesce(j.quoted_price, new.total),
      service_type   = case when j.service_type is null or j.service_type = 'other' then coalesce(new.service_type, j.service_type) else j.service_type end,
      hauling_unit   = coalesce(j.hauling_unit, new.hauling_unit),
      load_fraction  = coalesce(j.load_fraction, new.load_fraction),
      est_weight_lbs = coalesce(j.est_weight_lbs, new.est_weight_lbs),
      mattress_count = case when j.mattress_count = 0 then new.mattress_count else j.mattress_count end,
      heavy_item_count = case when j.heavy_item_count = 0 then new.heavy_item_count else j.heavy_item_count end,
      access_flags   = case when cardinality(j.access_flags) = 0 then new.access_flags else j.access_flags end,
      crew_size      = coalesce(j.crew_size, new.crew_size),
      account_id     = coalesce(j.account_id, new.account_id)
    where j.id = new.job_id;
  end if;
  return new;
end $$;
-- (trigger created in 0045 after jobs.account_id / estimates.account_id exist)

-- sign_estimate: set the auto-job flag so the service_type rule doesn't block a customer signing.
create or replace function public.sign_estimate(p_token uuid, p_name text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  v_est public.estimates%rowtype;
  v_job_id uuid;
  v_title text;
begin
  select * into v_est from public.estimates
    where public_token = p_token and signed_at is null and deleted_at is null;
  if not found then
    return false;
  end if;

  update public.estimates
    set signed_name = p_name, signature_data = p_signature, signed_at = now(),
        status = 'accepted', accepted_at = coalesce(accepted_at, now()), decided_at = coalesce(decided_at, now())
    where id = v_est.id;

  perform public.snapshot_estimate(v_est.id);

  if v_est.job_id is null and v_est.customer_id is not null then
    v_title := coalesce(
      nullif(btrim(v_est.line_item), ''),
      (select i.description from public.estimate_items i
        where i.estimate_id = v_est.id order by i.amount desc nulls last limit 1),
      'Estimate #' || v_est.estimate_number || ' job'
    );
    perform set_config('sjhc.auto_job', '1', true);
    insert into public.jobs (customer_id, title, status, estimated_value, address, scheduled_start, service_type, quoted_price, is_test, date_precision)
    select v_est.customer_id, v_title,
           (case when v_est.scheduled_start is not null then 'scheduled' else 'lead' end)::public.job_status,
           v_est.total, c.address, v_est.scheduled_start, coalesce(v_est.service_type, 'other'), v_est.total, v_est.is_test, v_est.date_precision
    from public.customers c where c.id = v_est.customer_id
    returning id into v_job_id;
    perform set_config('sjhc.auto_job', '', true);

    update public.estimates set job_id = v_job_id where id = v_est.id;
  end if;

  return true;
end;
$fn$;

-- ============ 2.4 cancellations ============
create or replace function public.jobs_cancel_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    -- Kimberly #51: an accepted quote whose job died must stop counting as a win.
    update public.estimates set status = 'cancelled', decided_at = coalesce(decided_at, now())
      where job_id = new.id and status = 'accepted' and deleted_at is null;
  end if;
  return new;
end $$;
drop trigger if exists jobs_cancel_cascade on public.jobs;
create trigger jobs_cancel_cascade before update of status on public.jobs
  for each row execute function public.jobs_cancel_cascade();

-- ============ 2.3 dump tickets + allocation ============
create table if not exists public.disposal_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  aliases text[] not null default '{}',
  active boolean not null default true
);
insert into public.disposal_sites (name, address, aliases) values
  ('Taylor Hills / City of Taylor Compost', '16300 Racho Rd, Taylor, MI', '{taylor hills,taylor hills compost,taylor hills compost facility,city of taylor compost,taylor compost,taylor}'),
  ('Carleton Farms', 'New Boston, MI', '{carleton}'),
  ('Woodland Meadows', 'Van Buren Twp, MI', '{woodland}'),
  ('WM 275 & Ecorse', 'Romulus, MI', '{wm,waste management}'),
  ('JFON''s', null, '{jfon,jfons}'),
  ('Hamtramck Recycling', 'Hamtramck, MI', '{hamtramck}'),
  ('Other', null, '{}')
on conflict (name) do nothing;
alter table public.disposal_sites enable row level security;
drop policy if exists disposal_sites_read on public.disposal_sites;
create policy disposal_sites_read on public.disposal_sites for select to authenticated using (true);
drop policy if exists disposal_sites_write on public.disposal_sites;
create policy disposal_sites_write on public.disposal_sites for all to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.dump_tickets (
  id uuid primary key default gen_random_uuid(),
  dumped_on date not null default (now() at time zone 'America/Detroit')::date,
  site_id uuid references public.disposal_sites(id),
  site_name text,                                 -- free text when the site isn't in the list
  cost numeric(10,2) not null check (cost >= 0),
  weight_tons numeric(8,3),
  material public.dump_material not null default 'mixed_junk',
  paid boolean not null default true,
  paid_with text,
  expense_id uuid references public.expenses(id) on delete set null,
  receipt_url text,
  notes text,
  external_source text, external_id text,
  created_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists idx_dump_tickets_external on public.dump_tickets (external_source, external_id) where external_id is not null;
create table if not exists public.dump_ticket_allocations (
  dump_ticket_id uuid not null references public.dump_tickets(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  share numeric(6,4) not null check (share > 0 and share <= 1),   -- fraction of the ticket cost
  primary key (dump_ticket_id, job_id)
);
create index if not exists idx_dump_alloc_job on public.dump_ticket_allocations (job_id);
alter table public.dump_tickets enable row level security;
alter table public.dump_ticket_allocations enable row level security;
drop policy if exists dump_tickets_staff on public.dump_tickets;
create policy dump_tickets_staff on public.dump_tickets for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists dump_alloc_staff on public.dump_ticket_allocations;
create policy dump_alloc_staff on public.dump_ticket_allocations for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Paid ticket → one dump_fees expense (NOT job-linked; allocations split it across jobs).
create or replace function public.dump_ticket_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_site text; v_exp uuid;
begin
  select coalesce(new.site_name, s.name) into v_site from (select 1) x left join public.disposal_sites s on s.id = new.site_id;
  if new.paid and new.expense_id is null then
    insert into public.expenses (category, amount, incurred_on, vendor, description, paid_with, expense_class, receipt_url, created_by)
    values ('dump_fees', new.cost, new.dumped_on, v_site, format('Dump ticket %s — %s%s', new.id::text, new.material, case when new.weight_tons is not null then format(', %s t', new.weight_tons) else '' end),
            coalesce(new.paid_with, 'bluevine'), 'direct_job_cost', new.receipt_url, new.created_by)
    returning id into v_exp;
    new.expense_id := v_exp;
  elsif new.expense_id is not null and tg_op = 'UPDATE' and (new.cost is distinct from old.cost or new.dumped_on is distinct from old.dumped_on) then
    update public.expenses set amount = new.cost, incurred_on = new.dumped_on where id = new.expense_id;
  end if;
  return new;
end $$;
drop trigger if exists dump_tickets_expense on public.dump_tickets;
create trigger dump_tickets_expense before insert or update of paid, cost, dumped_on on public.dump_tickets
  for each row execute function public.dump_ticket_expense();

-- Allocate a ticket across jobs: by load_fraction when every job has one, otherwise evenly.
create or replace function public.allocate_dump_ticket(p_ticket uuid, p_job_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_n int;
begin
  v_n := cardinality(p_job_ids);
  if v_n = 0 then raise exception 'Give at least one job_id'; end if;
  delete from public.dump_ticket_allocations where dump_ticket_id = p_ticket;
  select sum(load_fraction) into v_total from public.jobs where id = any(p_job_ids);
  if v_total is not null and v_total > 0 and (select count(*) from public.jobs where id = any(p_job_ids) and load_fraction is null) = 0 then
    insert into public.dump_ticket_allocations (dump_ticket_id, job_id, share)
      select p_ticket, id, round(load_fraction / v_total, 4) from public.jobs where id = any(p_job_ids);
  else
    insert into public.dump_ticket_allocations (dump_ticket_id, job_id, share)
      select p_ticket, unnest(p_job_ids), round(1.0 / v_n, 4);
  end if;
  -- the ticket's date is the disposal moment for every job on it
  update public.jobs set disposed_at = coalesce(disposed_at, (select dumped_on from public.dump_tickets where id = p_ticket)::timestamptz + interval '12 hours')
    where id = any(p_job_ids);
  return (select jsonb_agg(jsonb_build_object('job_id', job_id, 'share', share)) from public.dump_ticket_allocations where dump_ticket_id = p_ticket);
end $$;
grant execute on function public.allocate_dump_ticket(uuid, uuid[]) to authenticated;

-- Allocated disposal cost per job
create or replace view public.job_dump_cost with (security_invoker = true) as
select a.job_id, round(sum(t.cost * a.share), 2) as allocated_dump_cost, sum(t.weight_tons * a.share) as allocated_tons, count(*) as tickets
from public.dump_ticket_allocations a join public.dump_tickets t on t.id = a.dump_ticket_id
group by a.job_id;

-- ============ Job profitability: real costs ============
-- revenue = paid invoices (tips excluded, voided excluded); costs = job-linked direct expenses
-- (payroll rows generated from labor entries are skipped — the labor entry is the cost)
-- + helper labor entries + allocated dump tickets + mileage. Owner labor is $0 by design.
drop view if exists public.job_profitability;  -- column set changes; the app reads it by name
create view public.job_profitability with (security_invoker = true) as
select
  j.id as job_id, j.title, j.service, j.service_type, j.customer_id, j.status, j.job_kind, j.is_test, j.completed_on,
  coalesce(rev.revenue, 0)            as revenue,
  coalesce(rev.tips, 0)               as tips,
  coalesce(exp.direct, 0)             as direct_expenses,
  coalesce(lab.helper_cost, 0)        as helper_labor,
  coalesce(lab.helper_hours, 0)       as helper_hours,
  coalesce(lab.owner_hours, 0)        as owner_hours,
  coalesce(dc.allocated_dump_cost, 0) as allocated_dump_cost,
  coalesce(mi.miles, 0)               as miles,
  coalesce(mi.amount, 0)              as vehicle_cost,
  coalesce(exp.direct, 0) + coalesce(lab.helper_cost, 0) + coalesce(dc.allocated_dump_cost, 0) as costs,
  coalesce(rev.revenue, 0) - coalesce(exp.direct, 0) - coalesce(lab.helper_cost, 0) - coalesce(dc.allocated_dump_cost, 0) as profit,
  coalesce(rev.revenue, 0) - coalesce(exp.direct, 0) - coalesce(lab.helper_cost, 0) - coalesce(dc.allocated_dump_cost, 0) - coalesce(mi.amount, 0) as profit_after_vehicle
from public.jobs j
left join lateral (
  select sum(total - coalesce(tip, 0)) as revenue, sum(coalesce(tip, 0)) as tips from public.invoices
  where job_id = j.id and status = 'paid' and voided_at is null and deleted_at is null and not is_test
) rev on true
left join lateral (
  select sum(amount) as direct from public.expenses
  where job_id = j.id and deleted_at is null and labor_entry_id is null
    and coalesce(expense_class, 'direct_job_cost') = 'direct_job_cost'
) exp on true
left join lateral (
  select sum(case when w.is_owner then 0 else coalesce(l.amount, l.hours * l.rate) end) as helper_cost,
         sum(case when w.is_owner then 0 else l.hours end) as helper_hours,
         sum(case when w.is_owner then l.hours else 0 end) as owner_hours
  from public.labor_entries l join public.workers w on w.id = l.worker_id
  where l.job_id = j.id and l.deleted_at is null
) lab on true
left join public.job_dump_cost dc on dc.job_id = j.id
left join lateral (select sum(miles) as miles, sum(amount) as amount from public.mileage_log where job_id = j.id) mi on true
where j.deleted_at is null;
