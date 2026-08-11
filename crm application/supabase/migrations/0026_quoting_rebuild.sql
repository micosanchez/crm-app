-- 0026 Quoting rebuild: first-class quote fields, business_settings, customer lead-scoring.
-- Additive + idempotent + NON-BREAKING. Legacy columns are retained and backfilled FROM,
-- so the live app + connector keep working unchanged. The eventual DROP of estimates.notes
-- is deferred until both the app and the connector write internal_notes instead.

-- =====================================================================
-- estimates (quotes): first-class fields, split out of the concatenated blob
-- =====================================================================
alter table public.estimates add column if not exists line_item        text;  -- short title
alter table public.estimates add column if not exists description       text;  -- the paragraph, sentence case
alter table public.estimates add column if not exists payment_terms     text;
alter table public.estimates add column if not exists additional_terms  text;
alter table public.estimates add column if not exists internal_notes    text;  -- NEVER customer-facing

-- Backfill from the existing structure so old quotes gain the new fields:
--   payment_instructions -> payment_terms, comments -> additional_terms,
--   notes -> internal_notes, and the largest estimate_item -> the single line item.
update public.estimates e set
  internal_notes   = coalesce(e.internal_notes, e.notes),
  payment_terms    = coalesce(e.payment_terms, e.payment_instructions),
  additional_terms = coalesce(e.additional_terms, e.comments),
  line_item        = coalesce(e.line_item,
                       (select i.description from public.estimate_items i
                        where i.estimate_id = e.id order by i.amount desc nulls last limit 1)),
  description       = coalesce(e.description,
                       (select i.details from public.estimate_items i
                        where i.estimate_id = e.id order by i.amount desc nulls last limit 1))
where true;

-- =====================================================================
-- business_settings: single-row table backing the Settings screen + doc defaults
-- =====================================================================
create table if not exists public.business_settings (
  id                        boolean primary key default true,
  business_name             text default 'Sanchez Junk & Haul Co.',
  tagline                   text default 'Remove · Refresh · Reclaim',
  phone                     text default '313-348-3325',
  email                     text default 'sanchezhaulco@gmail.com',
  website                   text default 'sanchezhaulco.com',
  service_area              text default 'Lincoln Park · Taylor · Allen Park & surrounding Downriver MI',
  mailing_address           text,
  logo_url                  text,
  ein                       text,
  licensed_insured          boolean default true,
  default_valid_days        integer default 14,
  estimate_prefix           text default 'EST',
  default_line_item         text,
  default_payment_terms     text default 'Check preferred. Cash also accepted at no charge. Venmo and card accepted with a 2% processing fee.',
  default_additional_terms  text default 'Additional items may be negotiated at pickup. Payment is due upon completion.',
  updated_at                timestamptz default now(),
  constraint business_settings_singleton check (id)
);
insert into public.business_settings (id) values (true) on conflict (id) do nothing;

alter table public.business_settings enable row level security;
drop policy if exists business_settings_read on public.business_settings;
create policy business_settings_read on public.business_settings
  for select to authenticated using (true);
drop policy if exists business_settings_write on public.business_settings;
create policy business_settings_write on public.business_settings
  for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

-- =====================================================================
-- customers: lead scoring + internal notes (all internal-only)
-- =====================================================================
alter table public.customers add column if not exists is_high_value  boolean default false;
alter table public.customers add column if not exists customer_type   text;
alter table public.customers add column if not exists internal_notes  text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'customers_customer_type_chk') then
    alter table public.customers add constraint customers_customer_type_chk
      check (customer_type is null or customer_type in
        ('residential','realtor','property_manager','contractor','commercial'));
  end if;
end $$;

-- Flag Chris Bujaki (per the brief): high-value realtor, strong referral source.
update public.customers set is_high_value = true, customer_type = 'realtor'
where id = '1f5ce91b-ed6d-415a-8600-c3d3f87c7e99';
