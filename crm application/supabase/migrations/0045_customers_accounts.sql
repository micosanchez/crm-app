-- 0045 — Phase 4: customers, repeat, commercial accounts. Requires 0041–0044.

create table if not exists public.accounts_crm (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.account_kind not null default 'other',
  primary_contact_customer_id uuid references public.customers(id) on delete set null,
  address text,
  units_managed int,
  stage public.account_stage not null default 'prospect',
  rate_card jsonb,
  billing_terms text,
  recurring_cadence public.recurring_cadence not null default 'none',
  next_expected_job_at date,
  notes text,
  internal_notes text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.accounts_crm is 'Commercial / PM / recurring accounts. Named accounts_crm because public.accounts is the retired ledger chart of accounts.';
alter table public.accounts_crm enable row level security;
drop policy if exists accounts_crm_staff on public.accounts_crm;
create policy accounts_crm_staff on public.accounts_crm for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop trigger if exists accounts_crm_touch on public.accounts_crm;
create trigger accounts_crm_touch before update on public.accounts_crm for each row execute function public.touch_updated_at();

alter table public.customers add column if not exists segment public.customer_segment not null default 'residential';
alter table public.customers add column if not exists account_id uuid references public.accounts_crm(id) on delete set null;
alter table public.customers add column if not exists do_not_contact boolean not null default false;
alter table public.customers add column if not exists phone_e164 text;
alter table public.jobs      add column if not exists account_id uuid references public.accounts_crm(id) on delete set null;
alter table public.estimates add column if not exists account_id uuid references public.accounts_crm(id) on delete set null;
alter table public.leads     add column if not exists account_id uuid references public.accounts_crm(id) on delete set null;

-- now the estimate→job inheritance trigger (needs account_id on both)
drop trigger if exists estimates_linked_to_job on public.estimates;
create trigger estimates_linked_to_job after update of job_id on public.estimates
  for each row execute function public.estimate_linked_to_job();

-- Phone / email normalisation
create or replace function public.to_e164(p text) returns text language sql immutable as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) = 10 then '+1' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(p, '\D', '', 'g')) = 11 and left(regexp_replace(p, '\D', '', 'g'), 1) = '1' then '+' || regexp_replace(p, '\D', '', 'g')
    else null end
$$;
create or replace function public.customers_normalize() returns trigger language plpgsql as $$
begin
  new.phone_e164 := public.to_e164(new.phone);
  if new.email is not null then new.email := lower(btrim(new.email)); end if;
  if new.email = '' then new.email := null; end if;
  if new.referral_code is null then new.referral_code := upper(substr(md5(new.id::text), 1, 6)); end if;
  return new;
end $$;
drop trigger if exists customers_normalize on public.customers;
create trigger customers_normalize before insert or update of phone, email on public.customers
  for each row execute function public.customers_normalize();
update public.customers set phone_e164 = public.to_e164(phone), email = nullif(lower(btrim(email)), ''),
  referral_code = coalesce(referral_code, upper(substr(md5(id::text), 1, 6)));

-- Unique phone/email among live, non-test customers — only if the data is already clean;
-- otherwise leave it to data_health_check (possible_duplicate_customers) and re-run later.
do $$ begin
  if not exists (select 1 from public.customers where deleted_at is null and not is_test and phone_e164 is not null group by phone_e164 having count(*) > 1) then
    create unique index if not exists idx_customers_phone_unique on public.customers (phone_e164) where deleted_at is null and not is_test and phone_e164 is not null;
  else raise notice 'customers.phone_e164 has duplicates; unique index skipped'; end if;
  if not exists (select 1 from public.customers where deleted_at is null and not is_test and email is not null group by email having count(*) > 1) then
    create unique index if not exists idx_customers_email_unique on public.customers (email) where deleted_at is null and not is_test and email is not null;
  else raise notice 'customers.email has duplicates; unique index skipped'; end if;
end $$;

-- Customer lifetime view (repeat / reactivation)
create or replace view public.customer_stats with (security_invoker = true) as
select c.id as customer_id, c.name, c.segment, c.account_id, c.lead_source, c.is_test,
  count(j.id) filter (where j.job_kind = 'customer' and not j.is_test and j.status <> 'cancelled') as job_count,
  coalesce(sum(p.revenue), 0) as lifetime_revenue,
  min(j.completed_on) as first_job_at, max(j.completed_on) as last_job_at,
  (count(j.id) filter (where j.job_kind = 'customer' and not j.is_test and j.status <> 'cancelled')) >= 2 as is_repeat,
  max(j.completed_on) + case when c.segment in ('landlord','property_manager','realtor') then interval '30 days' else interval '6 months' end as reactivation_due_at
from public.customers c
left join public.jobs j on j.customer_id = c.id and j.deleted_at is null
left join public.job_profitability p on p.job_id = j.id
where c.deleted_at is null
group by c.id;
