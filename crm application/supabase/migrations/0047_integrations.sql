-- 0047 — Phase 7 plumbing: integration log + external ids. Requires 0041–0046.
-- (0046's data_health_check references integration_runs; run this right after 0046 — the
--  reference is inside a function body so it resolves at call time.)
create table if not exists public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                 -- quo | stripe | meta | gbp | maps | bank_csv | calendar
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error')),
  rows_in int not null default 0, rows_matched int not null default 0,
  errors jsonb not null default '[]',
  notes text
);
create index if not exists idx_integration_runs_source on public.integration_runs (source, started_at desc);
alter table public.integration_runs enable row level security;
drop policy if exists integration_runs_staff on public.integration_runs;
create policy integration_runs_staff on public.integration_runs for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.expenses add column if not exists external_source text;
alter table public.expenses add column if not exists external_id text;
create unique index if not exists idx_expenses_external on public.expenses (external_source, external_id) where external_id is not null;
alter table public.jobs add column if not exists calendar_event_id text;

-- Bank feed staging (CSV path first; Plaid later writes the same rows)
alter table public.bank_transactions add column if not exists matched_expense_id uuid references public.expenses(id) on delete set null;
alter table public.bank_transactions add column if not exists matched_payment_id uuid references public.payments(id) on delete set null;
create index if not exists idx_bank_txn_status on public.bank_transactions (status, posted_date desc);

-- Job photos for the content pipeline (Tier 2, table only)
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null default 'before' check (kind in ('before','after','during')),
  url text not null,
  approved_for_marketing boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.job_photos enable row level security;
drop policy if exists job_photos_staff on public.job_photos;
create policy job_photos_staff on public.job_photos for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Lead intake from Quo (auto-reply Worker) — match customer by phone, dedupe by external id.
create or replace function public.upsert_lead_from_message(p_phone text, p_body text, p_external_source text, p_external_id text, p_channel public.lead_channel default 'text', p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := public.to_e164(p_phone); v_cust uuid; v_lead uuid; v_existing uuid;
begin
  select id into v_cust from public.customers where phone_e164 = v_phone and deleted_at is null limit 1;
  -- an open lead for the same number within 14 days is the same conversation
  select id into v_existing from public.leads where phone is not null and public.to_e164(phone) = v_phone and status in ('new','contacted','quoted') and created_at > now() - interval '14 days' and deleted_at is null order by created_at desc limit 1;
  if v_existing is not null then
    update public.leads set inbound_count = inbound_count + 1, last_contact_at = now(), notes = left(coalesce(notes,'') || E'\n' || coalesce(p_body,''), 4000) where id = v_existing;
    return jsonb_build_object('lead_id', v_existing, 'created', false, 'customer_id', v_cust);
  end if;
  insert into public.leads (name, phone, source, status, channel_in, notes, customer_id, external_source, external_id, last_contact_at)
  values (coalesce(p_name, (select name from public.customers where id = v_cust), 'Unknown (' || coalesce(v_phone, p_phone) || ')'), coalesce(v_phone, p_phone),
          case when v_cust is not null then 'repeat_customer' else 'unknown' end, 'new', p_channel, left(p_body, 4000), v_cust, p_external_source, p_external_id, now())
  on conflict (external_source, external_id) where external_id is not null do update set inbound_count = public.leads.inbound_count
  returning id into v_lead;
  return jsonb_build_object('lead_id', v_lead, 'created', true, 'customer_id', v_cust);
end $$;

-- Outbound reply to a lead's number stamps speed-to-lead.
create or replace function public.mark_lead_responded(p_phone text, p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.leads set first_response_at = coalesce(first_response_at, p_at), outbound_count = outbound_count + 1, last_contact_at = p_at,
    status = case when status = 'new' then 'contacted' else status end
  where public.to_e164(phone) = public.to_e164(p_phone) and status in ('new','contacted','quoted') and deleted_at is null and created_at > now() - interval '30 days';
  get diagnostics n = row_count; return n;
end $$;
