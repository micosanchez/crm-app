-- 0034 Parity rebuild — core schema: soft delete, void, tips-on-payments,
-- invoice correctability, quote first-class backfill, team-name backfill,
-- audit coverage. Additive and idempotent. RLS rewrite is 0035; clock→labor is 0036.

-- ============ Soft delete columns ============
alter table public.customers      add column if not exists deleted_at timestamptz;
alter table public.jobs           add column if not exists deleted_at timestamptz;
alter table public.invoices       add column if not exists deleted_at timestamptz;
alter table public.estimates      add column if not exists deleted_at timestamptz;
alter table public.expenses       add column if not exists deleted_at timestamptz;
alter table public.labor_entries  add column if not exists deleted_at timestamptz;
alter table public.time_entries   add column if not exists deleted_at timestamptz;
alter table public.workers        add column if not exists deleted_at timestamptz;

-- ============ Invoice void + payment tips ============
alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists void_reason text;
alter table public.payments add column if not exists tip numeric(10,2) not null default 0;

-- ============ Clock→labor linkage columns (used by 0036) ============
alter table public.workers       add column if not exists user_id uuid unique references public.users(id) on delete set null;
alter table public.labor_entries add column if not exists time_entry_id uuid unique references public.time_entries(id) on delete set null;

-- ============ Invoice correctability ============
-- Raising a paid invoice's total above what was collected reopens it as
-- partially paid (balance owing) instead of silently absorbing the change.
-- Lowering it below what was collected keeps it paid; readers surface the
-- overpayment from amount_paid > total rather than hiding it.
create or replace function public.invoice_reopen_on_total_change() returns trigger
language plpgsql as $$
begin
  if new.total is distinct from old.total
     and new.status = 'paid'
     and new.amount_paid < new.total - 0.005 then
    new.status := 'sent';
    new.paid_at := null;  -- cash-basis reports key off paid_at; it comes back when the balance is settled
  end if;
  return new;
end $$;
drop trigger if exists invoices_reopen_on_total on public.invoices;
create trigger invoices_reopen_on_total before update on public.invoices
  for each row execute function public.invoice_reopen_on_total_change();

-- When an invoice leaves 'paid' (reopened for correction), pull its job back
-- to 'invoiced' so the pipeline agrees. Mirrors invoices_paid_sync (0018).
create or replace function public.invoice_unpaid_job_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'paid' and new.status <> 'paid' and new.job_id is not null then
    update public.jobs set status = 'invoiced'
      where id = new.job_id and status = 'paid';
  end if;
  return new;
end $$;
drop trigger if exists invoices_unpaid_sync on public.invoices;
create trigger invoices_unpaid_sync after update on public.invoices
  for each row execute function public.invoice_unpaid_job_sync();

-- ============ Quote guards ============
-- A zero-dollar quote can exist only as a draft mid-composition; it can never
-- be sent, accepted, or signed at $0.
create or replace function public.estimate_block_zero_total() returns trigger
language plpgsql as $$
begin
  if new.status in ('sent','accepted') and coalesce(new.total, 0) <= 0 then
    raise exception 'Quote total must be greater than $0 before it can be %', new.status;
  end if;
  return new;
end $$;
drop trigger if exists estimates_block_zero on public.estimates;
create trigger estimates_block_zero before insert or update on public.estimates
  for each row execute function public.estimate_block_zero_total();

-- ============ Quote first-class backfill (issue #4) ============
-- Connector-written quotes stored "Title || Paragraph" verbatim in a single
-- estimate_item and left line_item/description null (or 0026 backfilled the
-- un-split blob). Split server-side once, so the document AND the edit screen
-- read clean fields with no render-time hacks needed.
update public.estimates e set
  line_item = case when position(' || ' in src.description) > 0
                   then btrim(split_part(src.description, ' || ', 1))
                   else src.description end,
  description = case when position(' || ' in src.description) > 0
                     then btrim(substr(src.description, position(' || ' in src.description) + 4))
                     else e.description end
from (
  select i.estimate_id, i.description,
         row_number() over (partition by i.estimate_id order by i.amount desc nulls last) rn
  from public.estimate_items i
) src
where src.estimate_id = e.id and src.rn = 1
  and (e.line_item is null or position(' || ' in e.line_item) > 0);

-- ============ Team account names (issue #8 backfill) ============
update public.users set full_name = 'Mico Sanchez'     where email = 'sanchezhaulco@gmail.com'     and full_name = email;
update public.users set full_name = 'Sarah Collins'    where email = 'sarahcollins0429@gmail.com'  and full_name = email;
update public.users set full_name = 'Jeremiah Martin'  where email = 'martinjeremiah99@gmail.com'  and full_name = email;
update public.users set full_name = 'Dylan Ibarra'     where email = 'ibarra.dylan@gmail.com'      and full_name = email;

-- ============ Audit coverage ============
-- activity_log (0001) is the audit spine: triggers capture old/new for every
-- change. Extend it to the tables that were missing triggers, so edits to
-- line items, labor, workers, and settings are all in the trail. The
-- connector additionally writes explicit 'connector:<tool>' rows.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'invoice_items_log') then
    create trigger invoice_items_log after insert or update or delete on public.invoice_items
      for each row execute function public.log_activity();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'estimate_items_log') then
    create trigger estimate_items_log after insert or update or delete on public.estimate_items
      for each row execute function public.log_activity();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'labor_entries_log') then
    create trigger labor_entries_log after insert or update or delete on public.labor_entries
      for each row execute function public.log_activity();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'workers_log') then
    create trigger workers_log after insert or update or delete on public.workers
      for each row execute function public.log_activity();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'business_settings_log') then
    create trigger business_settings_log after update on public.business_settings
      for each row execute function public.log_activity();
  end if;
end $$;

-- log_activity() writes entity_id from new.id; business_settings.id is a
-- boolean primary key, which would break the uuid column. Guard it.
create or replace function public.log_activity() returns trigger as $$
declare
  v_action text;
  v_entity_id uuid;
  v_meta jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'created'; v_meta := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_action := 'updated';
    v_meta := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    v_action := 'deleted'; v_meta := to_jsonb(old);
  end if;
  begin
    v_entity_id := (to_jsonb(coalesce(new, old))->>'id')::uuid;
  exception when others then
    v_entity_id := '00000000-0000-0000-0000-000000000000';
  end;
  insert into public.activity_log (entity_type, entity_id, action_type, user_id, metadata)
  values (tg_table_name, v_entity_id, v_action, auth.uid(), v_meta);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;
