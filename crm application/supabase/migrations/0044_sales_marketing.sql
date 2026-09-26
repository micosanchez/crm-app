-- 0044 — Phase 3: sales & marketing tracking. Requires 0041–0043.

-- ============ 3.3 campaigns & spend ============
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel public.lead_source not null default 'meta_ads',
  start_date date, end_date date,
  daily_budget numeric(8,2),
  status text not null default 'active' check (status in ('active','paused','ended')),
  platform text,                 -- 'meta' | 'google' ...
  platform_campaign_id text,
  notes text,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_campaign_platform on public.marketing_campaigns (platform, platform_campaign_id) where platform_campaign_id is not null;
create table if not exists public.marketing_daily_spend (
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  spend_date date not null,
  spend numeric(10,2) not null default 0,
  impressions int, clicks int, leads int,
  external_source text,
  synced_at timestamptz not null default now(),
  primary key (campaign_id, spend_date)
);
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_daily_spend enable row level security;
drop policy if exists campaigns_staff on public.marketing_campaigns;
create policy campaigns_staff on public.marketing_campaigns for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists daily_spend_staff on public.marketing_daily_spend;
create policy daily_spend_staff on public.marketing_daily_spend for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into public.marketing_campaigns (name, channel, platform, notes)
select 'Meta — unassigned', 'meta_ads', 'meta', 'Catch-all for FACEBK bank charges not matched to a specific campaign'
where not exists (select 1 from public.marketing_campaigns where name = 'Meta — unassigned');

alter table public.expenses drop constraint if exists expenses_campaign_fk;
alter table public.expenses add constraint expenses_campaign_fk foreign key (campaign_id) references public.marketing_campaigns(id) on delete set null;

-- Unmatched Meta charges land on the default campaign so channel_roi never loses spend.
create or replace function public.expenses_default_campaign() returns trigger language plpgsql as $$
begin
  if new.category = 'marketing' and new.campaign_id is null
     and (coalesce(new.vendor,'') || ' ' || coalesce(new.description,'') || ' ' || coalesce(new.bank_txn_ref,'')) ~* '(facebk|facebook|meta ads|meta platforms|instagram)' then
    select id into new.campaign_id from public.marketing_campaigns where name = 'Meta — unassigned';
  end if;
  return new;
end $$;
drop trigger if exists expenses_default_campaign on public.expenses;
create trigger expenses_default_campaign before insert or update of category, vendor, description on public.expenses
  for each row execute function public.expenses_default_campaign();
update public.expenses e set campaign_id = (select id from public.marketing_campaigns where name = 'Meta — unassigned')
  where category = 'marketing' and campaign_id is null and deleted_at is null
    and (coalesce(vendor,'') || ' ' || coalesce(description,'')) ~* '(facebk|facebook|meta ads|meta platforms|instagram)';

-- ============ 3.2 lead source attribution ============
alter table public.customers add column if not exists referred_by_customer_id uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists lead_source_detail text;
alter table public.customers add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;
alter table public.jobs add column if not exists referred_by_customer_id uuid references public.customers(id) on delete set null;
alter table public.jobs add column if not exists lead_source_detail text;
alter table public.jobs add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;
-- jobs.lead_source is text (0007). Normalise the one stray value, then hold it to the enum's labels.
update public.jobs set lead_source = 'meta_ads' where lead_source in ('facebook_ad','facebook_ads','meta');
update public.jobs set lead_source = lower(regexp_replace(lead_source, '\s+', '_', 'g')) where lead_source is not null;
alter table public.jobs drop constraint if exists jobs_lead_source_valid;
create or replace function public.is_lead_source(p text) returns boolean language sql immutable as $$
  select p is null or p in ('google','google_ads','facebook','instagram','referral','yard_sign','website','repeat_customer','other',
    'google_business_profile','google_search_organic','website_direct','facebook_organic_page','facebook_group_post','meta_ads',
    'facebook_marketplace','nextdoor','commercial_account','truck_trailer_signage','yard_sign_flyer','unknown')
$$;
update public.jobs set lead_source = 'other' where not public.is_lead_source(lead_source);
alter table public.jobs add constraint jobs_lead_source_valid check (public.is_lead_source(lead_source));

-- Web intake: attribution capture
alter table public.estimate_requests add column if not exists utm_source text;
alter table public.estimate_requests add column if not exists utm_medium text;
alter table public.estimate_requests add column if not exists utm_campaign text;
alter table public.estimate_requests add column if not exists heard_about_us text;
alter table public.estimate_requests add column if not exists lead_id uuid;

-- ============ 3.1 leads (extend the existing table) ============
alter table public.leads add column if not exists channel_in public.lead_channel;
alter table public.leads add column if not exists first_response_at timestamptz;
alter table public.leads add column if not exists quote_id uuid references public.estimates(id) on delete set null;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists not_a_fit_reason public.not_a_fit_reason;
alter table public.leads add column if not exists lead_source_detail text;
alter table public.leads add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;
alter table public.leads add column if not exists referred_by_customer_id uuid references public.customers(id) on delete set null;
alter table public.leads add column if not exists utm_source text;
alter table public.leads add column if not exists utm_medium text;
alter table public.leads add column if not exists utm_campaign text;
alter table public.leads add column if not exists estimate_request_id uuid references public.estimate_requests(id) on delete set null;
alter table public.leads add column if not exists external_source text;
alter table public.leads add column if not exists external_id text;
alter table public.leads add column if not exists inbound_count int not null default 1;
alter table public.leads add column if not exists outbound_count int not null default 0;
alter table public.leads add column if not exists last_contact_at timestamptz;
alter table public.leads add column if not exists is_test boolean not null default false;
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads alter column source set default 'unknown';
alter table public.leads alter column service set default 'junk_removal';
create unique index if not exists idx_leads_external on public.leads (external_source, external_id) where external_id is not null;
create index if not exists idx_leads_status on public.leads (status) where deleted_at is null;
create index if not exists idx_leads_phone on public.leads (phone);
alter table public.estimate_requests drop constraint if exists estimate_requests_lead_fk;
alter table public.estimate_requests add constraint estimate_requests_lead_fk foreign key (lead_id) references public.leads(id) on delete set null;

-- Every intake request is a lead too (so speed-to-lead and leaking-leads cover the form).
create or replace function public.estimate_request_to_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_src public.lead_source;
begin
  if new.lead_id is null then
    v_src := case lower(coalesce(new.utm_source, new.lead_source, ''))
      when 'facebook' then 'meta_ads' when 'meta' then 'meta_ads' when 'fb' then 'meta_ads' when 'instagram' then 'instagram'
      when 'google' then 'google_search_organic' when 'gbp' then 'google_business_profile' when 'nextdoor' then 'nextdoor'
      when 'text' then 'other' when 'yard_sign' then 'yard_sign_flyer' when 'website' then 'website_direct'
      else case when new.lead_source is not null and public.is_lead_source(new.lead_source) then new.lead_source::public.lead_source else 'website_direct' end end;
    insert into public.leads (name, phone, email, address, source, status, channel_in, notes, customer_id,
                              lead_source_detail, utm_source, utm_medium, utm_campaign, estimate_request_id, created_by)
    values (btrim(new.first_name || ' ' || new.last_name), new.phone, new.email, new.address, v_src, 'new', 'web_form',
            new.description, new.customer_id, coalesce(new.heard_about_us, new.lead_source), new.utm_source, new.utm_medium, new.utm_campaign, new.id, null)
    returning id into v_lead;
    new.lead_id := v_lead;
  end if;
  return new;
end $$;
drop trigger if exists estimate_requests_to_lead on public.estimate_requests;
create trigger estimate_requests_to_lead before insert on public.estimate_requests
  for each row execute function public.estimate_request_to_lead();

-- Keep the lead's status in step with the request it came from
create or replace function public.estimate_request_status_to_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and (new.status is distinct from old.status or new.quote_id is distinct from old.quote_id or new.customer_id is distinct from old.customer_id) then
    update public.leads set
      status = case new.status when 'accepted' then case when new.quote_id is not null then 'quoted' else 'contacted' end
                               when 'declined' then 'not_a_fit' when 'spam' then 'spam' else status end,
      quote_id = coalesce(new.quote_id, quote_id),
      customer_id = coalesce(new.customer_id, customer_id),
      first_response_at = coalesce(first_response_at, case when new.status <> 'new' then now() end),
      not_a_fit_reason = case when new.status = 'declined' then coalesce(not_a_fit_reason, 'other') else not_a_fit_reason end,
      lost_reason = case when new.status = 'declined' then coalesce(new.decline_reason, lost_reason) else lost_reason end
    where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists estimate_requests_status_to_lead on public.estimate_requests;
create trigger estimate_requests_status_to_lead after update on public.estimate_requests
  for each row execute function public.estimate_request_status_to_lead();

-- Backfill leads for existing requests
insert into public.leads (name, phone, email, address, source, status, channel_in, notes, customer_id, quote_id, estimate_request_id, created_at, first_response_at)
select btrim(r.first_name || ' ' || r.last_name), r.phone, r.email, r.address,
       case when public.is_lead_source(r.lead_source) then coalesce(r.lead_source, 'website_direct')::public.lead_source else 'website_direct' end,
       case r.status when 'accepted' then case when r.quote_id is not null then 'quoted' else 'contacted' end when 'declined' then 'not_a_fit' when 'spam' then 'spam' else 'new' end,
       'web_form', r.description, r.customer_id, r.quote_id, r.id, r.created_at, coalesce(r.accepted_at, r.declined_at)
from public.estimate_requests r
where r.lead_id is null;
update public.estimate_requests r set lead_id = l.id from public.leads l where l.estimate_request_id = r.id and r.lead_id is null;

-- ============ 3.4 quote outcomes ============
alter table public.estimates add column if not exists sent_at timestamptz;
alter table public.estimates add column if not exists decided_at timestamptz;
alter table public.estimates add column if not exists loss_reason public.quote_loss_reason;
alter table public.estimates add column if not exists competitor_name text;
alter table public.estimates add column if not exists competitor_price numeric(10,2);
alter table public.estimates add column if not exists follow_up_count int not null default 0;
alter table public.estimates add column if not exists last_follow_up_at timestamptz;
alter table public.estimates add column if not exists next_follow_up_at timestamptz;
alter table public.estimates add column if not exists options jsonb;            -- [{label:'A', scope, price}, ...]
alter table public.estimates add column if not exists accepted_option text;
alter table public.estimates add column if not exists deposit_required boolean not null default false;
alter table public.estimates add column if not exists deposit_amount numeric(10,2);
alter table public.estimates add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.estimates add column if not exists quote_size_bucket text generated always as (
  case when total < 250 then '<250' when total < 500 then '250-499' when total < 1000 then '500-999' when total < 2500 then '1000-2499' else '2500+' end
) stored;
create index if not exists idx_estimates_status_decided on public.estimates (status, decided_at);
-- backfill timestamps from what we know
update public.estimates set sent_at = coalesce(sent_at, viewed_at, created_at) where status <> 'draft' and sent_at is null;
update public.estimates set decided_at = coalesce(decided_at, accepted_at, declined_at, signed_at) where status in ('accepted','declined','expired','cancelled') and decided_at is null;
update public.estimates set deposit_required = true, deposit_amount = coalesce(deposit_amount, (regexp_match(description, '\$([0-9,]+) deposit', 'i'))[1]::numeric)
  where description ~* 'deposit' and not deposit_required;

-- A quote can't be declined or expired without a reason (no_response_ghosted is a valid one).
create or replace function public.estimates_outcome_rules() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
    if new.status in ('accepted','declined','expired','cancelled') then new.decided_at := coalesce(new.decided_at, now()); end if;
    if new.status in ('declined','expired') and new.loss_reason is null then
      raise exception 'loss_reason is required when a quote is declined or expired (price_too_high, went_with_competitor, did_it_themselves, city_bulk_pickup, timing_scheduling, scope_changed, no_response_ghosted, hazmat_or_out_of_scope, deposit_required, other).'
        using errcode = 'not_null_violation';
    end if;
    if new.status = 'sent' then new.loss_reason := null; new.decided_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists estimates_outcome_rules on public.estimates;
create trigger estimates_outcome_rules before update of status on public.estimates
  for each row execute function public.estimates_outcome_rules();

-- Quote linked to a lead → the lead moves to quoted / booked
create or replace function public.estimate_status_to_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null then
    update public.leads set quote_id = new.id, customer_id = coalesce(customer_id, new.customer_id),
      status = case when new.status = 'accepted' then 'booked' when new.status in ('declined','expired') then 'lost' when status in ('new','contacted','quoted') then 'quoted' else status end,
      lost_reason = case when new.status in ('declined','expired') then new.loss_reason::text else lost_reason end,
      job_id = coalesce(new.job_id, job_id),
      first_response_at = coalesce(first_response_at, now())
    where id = new.lead_id;
  end if;
  return new;
end $$;
drop trigger if exists estimates_status_to_lead on public.estimates;
create trigger estimates_status_to_lead after insert or update of status, job_id, lead_id on public.estimates
  for each row execute function public.estimate_status_to_lead();

-- ============ 3.5 reviews & referrals ============
alter table public.jobs add column if not exists review_requested_at timestamptz;
alter table public.jobs add column if not exists review_received boolean not null default false;
alter table public.jobs add column if not exists review_platform public.review_platform;
alter table public.jobs add column if not exists review_rating int check (review_rating is null or review_rating between 1 and 5);
alter table public.jobs add column if not exists review_url text;
alter table public.customers add column if not exists referral_code text unique;
alter table public.customers add column if not exists referral_credit_balance numeric(8,2) not null default 0;
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_customer_id uuid not null references public.customers(id) on delete cascade,
  referred_customer_id uuid references public.customers(id) on delete set null,
  referred_job_id uuid references public.jobs(id) on delete set null,
  reward_amount numeric(8,2) not null default 0,
  reward_paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.review_snapshots (
  snapshot_date date not null,
  platform public.review_platform not null,
  total_count int not null,
  avg_rating numeric(3,2),
  source text,
  primary key (snapshot_date, platform)
);
alter table public.referrals enable row level security;
alter table public.review_snapshots enable row level security;
drop policy if exists referrals_staff on public.referrals;
create policy referrals_staff on public.referrals for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists review_snapshots_staff on public.review_snapshots;
create policy review_snapshots_staff on public.review_snapshots for all to authenticated using (public.is_staff()) with check (public.is_staff());
