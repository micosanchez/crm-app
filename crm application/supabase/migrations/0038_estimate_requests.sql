-- ============================================================
-- 0038 — Estimate requests (public intake form)
--
-- ADDITIVE ONLY. Creates one new table, one new private storage
-- bucket, and their policies. Touches NO existing table, column,
-- RPC, trigger or policy. Nothing here can affect the signing
-- flow, quotes, jobs or invoices.
--
-- The public form never talks to Postgres directly: the browser
-- posts to a Next.js route that uses the service-role client, so
-- there is deliberately NO anon insert policy below. Staff read
-- and update through their normal authenticated session.
-- ============================================================

-- ============ Table ============
create table if not exists public.estimate_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  status        text not null default 'new'
                  check (status in ('new','accepted','declined','spam')),

  -- Customer-typed fields
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  phone         text not null,              -- stored E.164, e.g. +17345551234
  address       text,                       -- street line
  city          text,
  state         text default 'MI',
  postal_code   text,
  description   text not null,

  -- Storage paths, never URLs: [{path,bytes,width,height}]
  photos        jsonb not null default '[]'::jsonb,

  -- Attribution + abuse review
  lead_source        text,                  -- from ?ref= on the link
  ip                 inet,
  user_agent         text,
  turnstile_verified boolean not null default false,

  -- Set when the request is worked
  customer_id   uuid references public.customers(id) on delete set null,
  quote_id      uuid references public.estimates(id) on delete set null,
  accepted_at   timestamptz,
  declined_at   timestamptz,
  decline_reason text,
  internal_notes text                       -- never customer-facing
);

comment on table public.estimate_requests is
  'Public estimate-request intake. Rows are written server-side by the service role only.';

create index if not exists estimate_requests_status_idx  on public.estimate_requests (status);
create index if not exists estimate_requests_created_idx on public.estimate_requests (created_at desc);
create index if not exists estimate_requests_phone_idx   on public.estimate_requests (phone);
create index if not exists estimate_requests_email_idx   on public.estimate_requests (email);
create index if not exists estimate_requests_ip_idx      on public.estimate_requests (ip, created_at desc);
create index if not exists estimate_requests_customer_idx on public.estimate_requests (customer_id);
create index if not exists estimate_requests_quote_idx    on public.estimate_requests (quote_id);

-- ============ RLS ============
alter table public.estimate_requests enable row level security;

-- Staff (admin/dispatcher) read and work the queue. Technicians see nothing.
-- No insert policy: the intake endpoint uses the service role, which bypasses
-- RLS; that keeps every public write behind server-side validation.
drop policy if exists estimate_requests_staff_read on public.estimate_requests;
create policy estimate_requests_staff_read on public.estimate_requests
  for select to authenticated using (public.is_staff());

drop policy if exists estimate_requests_staff_update on public.estimate_requests;
create policy estimate_requests_staff_update on public.estimate_requests
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============ Activity log coverage ============
-- log_activity() is the repo-wide audit trigger (0001, hardened in 0034).
-- Attach it so accept/decline decisions land in the same history as everything
-- else. Guarded: if the function is absent for any reason, skip rather than fail.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'log_activity' and pronamespace = 'public'::regnamespace) then
    execute 'drop trigger if exists estimate_requests_audit on public.estimate_requests';
    execute 'create trigger estimate_requests_audit after insert or update or delete
             on public.estimate_requests for each row execute function public.log_activity()';
  end if;
end $$;

-- ============ SMS opt-outs ============
-- A customer who replies STOP must never get another automated text. Keeping
-- this in its own table (rather than a flag on customers) means the public
-- intake work adds nothing to the customers schema, and an opt-out survives a
-- customer being merged, renamed or deleted. Keyed by E.164 phone.
create table if not exists public.sms_opt_outs (
  phone      text primary key,
  reason     text,
  created_at timestamptz not null default now()
);

comment on table public.sms_opt_outs is
  'E.164 numbers that must not receive automated texts. Checked before every automated send.';

alter table public.sms_opt_outs enable row level security;

drop policy if exists sms_opt_outs_staff_read on public.sms_opt_outs;
create policy sms_opt_outs_staff_read on public.sms_opt_outs
  for select to authenticated using (public.is_staff());

drop policy if exists sms_opt_outs_staff_write on public.sms_opt_outs;
create policy sms_opt_outs_staff_write on public.sms_opt_outs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============ Storage: private request-photos bucket ============
insert into storage.buckets (id, name, public)
values ('request-photos', 'request-photos', false)
on conflict (id) do nothing;

-- Staff read photos through their session (the CRM detail view); uploads happen
-- via short-lived signed URLs minted by the service role, so anon needs nothing.
drop policy if exists request_photos_staff on storage.objects;
create policy request_photos_staff on storage.objects for all to authenticated
  using (bucket_id = 'request-photos' and public.is_staff())
  with check (bucket_id = 'request-photos' and public.is_staff());
