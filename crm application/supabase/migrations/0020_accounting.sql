-- ============================================================
-- Fieldtrack CRM — Accounting module (double-entry general ledger)
-- Bank reconciliation, chart of accounts, journal, income statement,
-- balance sheet, month-end close.
--
-- Design decisions (confirmed with owner):
--   * Ledger is the SOURCE OF TRUTH. Bank reconciliation makes it match reality.
--   * Cash basis by default: equipment purchases are expensed immediately.
--     (accounting_settings.basis / equipment_treatment can flip to accrual;
--      depreciation_schedules is provided but inert under cash basis.)
--   * Backfill: journal entries are generated from existing paid invoices,
--     payments and expenses so the GL reflects real history.
--   * The ledger is posted on an ACCRUAL spine (AR recognized at invoice date,
--     cash collected on payment) so the Balance Sheet is correct; the Income
--     Statement offers a cash/accrual toggle.
--
-- Staff-only (admin / dispatcher). Feature-flagged: NEXT_PUBLIC_FF_ACCOUNTING.
-- Row-level integrity: a deferred constraint trigger guarantees debits = credits.
-- ============================================================

-- ---------- ENUMS ----------
do $$ begin
  create type account_type as enum ('asset','liability','equity','revenue','expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type normal_side as enum ('debit','credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type je_source as enum ('manual','invoice','payment','expense','depreciation','close','opening','adjustment');
exception when duplicate_object then null; end $$;
do $$ begin
  create type je_status as enum ('posted','void');
exception when duplicate_object then null; end $$;
do $$ begin
  -- 'debit' = money OUT of the bank, 'credit' = money IN (bank statement convention)
  create type bank_txn_direction as enum ('debit','credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type bank_txn_status as enum ('unmatched','matched','ignored');
exception when duplicate_object then null; end $$;
do $$ begin
  create type period_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

-- ---------- CHART OF ACCOUNTS ----------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  name text not null,
  type account_type not null,
  normal_side normal_side not null,
  parent_id uuid references public.accounts(id) on delete set null,
  system_key text unique,          -- stable handle for backfill/reporting ('bluevine_cash','ar',...)
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accounts_type_idx on public.accounts(type, sort_order);

-- ---------- PERIODS (monthly open/closed) ----------
create table if not exists public.periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,      -- always first day of the month
  status period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.users(id),
  reopened_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- JOURNAL ENTRIES (header) ----------
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no serial,
  entry_date date not null,
  memo text,
  source je_source not null default 'manual',
  source_table text,
  source_id uuid,
  status je_status not null default 'posted',
  reconciled boolean not null default false,   -- set when the entry's cash line is matched to a bank txn
  is_closing boolean not null default false,   -- period-close entries bypass the period lock
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.users(id),
  void_reason text
);
create index if not exists je_date_idx on public.journal_entries(entry_date);
create index if not exists je_source_idx on public.journal_entries(source, source_table, source_id);

-- ---------- JOURNAL LINES (double-entry) ----------
create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  debit numeric(12,2) not null default 0 check (debit >= 0),
  credit numeric(12,2) not null default 0 check (credit >= 0),
  memo text,
  reconciled boolean not null default false,
  bank_transaction_id uuid,        -- FK added after bank_transactions exists
  line_no int not null default 0,
  -- exactly one side of the entry carries a value
  constraint jl_one_side check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index if not exists jl_entry_idx on public.journal_lines(entry_id);
create index if not exists jl_account_idx on public.journal_lines(account_id);

-- ---------- BANK TRANSACTIONS (imported statement rows) ----------
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,  -- the bank/cash GL account
  source text not null default 'bluevine_csv',   -- pluggable source id ('bluevine_csv','bluevine_ofx','plaid',...)
  external_id text,                              -- OFX FITID or a stable content hash, for dedupe
  posted_date date not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),   -- magnitude
  direction bank_txn_direction not null,
  status bank_txn_status not null default 'unmatched',
  matched_entry_id uuid references public.journal_entries(id) on delete set null,
  matched_line_id uuid references public.journal_lines(id) on delete set null,
  reconciliation_id uuid,                       -- FK added after reconciliations exists
  import_batch_id uuid,
  raw jsonb not null default '{}'::jsonb,        -- original parsed row for audit
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (account_id, source, external_id)
);
create index if not exists bt_status_idx on public.bank_transactions(status, posted_date);
create index if not exists bt_date_idx on public.bank_transactions(posted_date);

alter table public.journal_lines
  drop constraint if exists jl_bank_txn_fk;
alter table public.journal_lines
  add constraint jl_bank_txn_fk foreign key (bank_transaction_id)
  references public.bank_transactions(id) on delete set null;

-- ---------- IMPORT BATCHES ----------
create table if not exists public.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  source text not null,
  filename text,
  row_count int not null default 0,
  inserted_count int not null default 0,
  duplicate_count int not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ---------- RECONCILIATIONS ----------
create table if not exists public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  period_month date not null,
  statement_start date,
  statement_end date not null,
  statement_ending_balance numeric(12,2) not null,
  book_balance numeric(12,2) not null default 0,
  cleared_balance numeric(12,2) not null default 0,
  difference numeric(12,2) not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','reconciled')),
  override boolean not null default false,
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists recon_month_idx on public.reconciliations(account_id, period_month);

alter table public.bank_transactions
  drop constraint if exists bt_recon_fk;
alter table public.bank_transactions
  add constraint bt_recon_fk foreign key (reconciliation_id)
  references public.reconciliations(id) on delete set null;

-- ---------- CLOSE SNAPSHOTS ----------
create table if not exists public.close_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  account_number text not null,
  account_name text not null,
  account_type account_type not null,
  closing_balance numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists cs_period_idx on public.close_snapshots(period_id);

-- ---------- DEPRECIATION SCHEDULES (accrual; inert under cash basis) ----------
create table if not exists public.depreciation_schedules (
  id uuid primary key default gen_random_uuid(),
  asset_name text not null,
  asset_account_id uuid not null references public.accounts(id),
  accum_account_id uuid references public.accounts(id),
  expense_account_id uuid references public.accounts(id),
  cost numeric(12,2) not null,
  salvage numeric(12,2) not null default 0,
  useful_life_months int not null check (useful_life_months > 0),
  method text not null default 'straight_line',
  start_date date not null,
  monthly_amount numeric(12,2) generated always as
    (round((cost - salvage) / nullif(useful_life_months, 0), 2)) stored,
  months_posted int not null default 0,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ---------- SETTINGS (singleton) ----------
create table if not exists public.accounting_settings (
  id boolean primary key default true check (id),
  basis text not null default 'cash' check (basis in ('cash','accrual')),
  equipment_treatment text not null default 'expense'
    check (equipment_treatment in ('expense','capitalize','ask')),
  cash_account_id uuid references public.accounts(id),
  ar_account_id uuid references public.accounts(id),
  books_start_date date,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- INTEGRITY TRIGGERS
-- ============================================================

-- reuse touch_updated_at() from 0001
drop trigger if exists accounts_touch on public.accounts;
create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();

-- first day of the month for a date
create or replace function public.period_first(d date) returns date as $$
  select date_trunc('month', d)::date;
$$ language sql immutable;

-- Deferred: debits must equal credits for every entry, checked at commit
-- so multi-line inserts validate once (not row-by-row).
create or replace function public.assert_entry_balanced() returns trigger as $$
declare v_entry uuid; v_deb numeric; v_cred numeric; v_count int;
begin
  v_entry := coalesce(new.entry_id, old.entry_id);
  if not exists (select 1 from public.journal_entries where id = v_entry) then
    return null;  -- entry deleted (cascade) — nothing to balance
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
    into v_deb, v_cred, v_count
    from public.journal_lines where entry_id = v_entry;
  if v_count > 0 and v_deb <> v_cred then
    raise exception 'Journal entry % is out of balance: debits %, credits %', v_entry, v_deb, v_cred;
  end if;
  return null;
end; $$ language plpgsql;

drop trigger if exists journal_lines_balanced on public.journal_lines;
create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.assert_entry_balanced();

-- Auto-create the (open) period for any entry date before the lock check runs.
create or replace function public.ensure_period() returns trigger as $$
begin
  insert into public.periods (period_month) values (public.period_first(new.entry_date))
    on conflict (period_month) do nothing;
  return new;
end; $$ language plpgsql;

drop trigger if exists je_ensure_period on public.journal_entries;
create trigger je_ensure_period before insert on public.journal_entries
  for each row execute function public.ensure_period();

-- Period lock: block edits to entries whose month is closed (closing entries exempt).
create or replace function public.assert_period_open_entry() returns trigger as $$
declare v_status period_status;
begin
  if coalesce(new.is_closing, old.is_closing, false) then
    return coalesce(new, old);
  end if;
  select status into v_status from public.periods
    where period_month = public.period_first(coalesce(new.entry_date, old.entry_date));
  if v_status = 'closed' then
    raise exception 'Period % is closed. Reopen it before editing entries in that month.',
      to_char(public.period_first(coalesce(new.entry_date, old.entry_date)), 'YYYY-MM');
  end if;
  return coalesce(new, old);
end; $$ language plpgsql;

drop trigger if exists je_period_lock on public.journal_entries;
create trigger je_period_lock before insert or update or delete on public.journal_entries
  for each row execute function public.assert_period_open_entry();

create or replace function public.assert_period_open_line() returns trigger as $$
declare v_date date; v_status period_status; v_closing boolean;
begin
  select entry_date, is_closing into v_date, v_closing
    from public.journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if v_date is null or coalesce(v_closing, false) then
    return coalesce(new, old);
  end if;
  select status into v_status from public.periods where period_month = public.period_first(v_date);
  if v_status = 'closed' then
    raise exception 'Period % is closed.', to_char(public.period_first(v_date), 'YYYY-MM');
  end if;
  return coalesce(new, old);
end; $$ language plpgsql;

drop trigger if exists jl_period_lock on public.journal_lines;
create trigger jl_period_lock before insert or update or delete on public.journal_lines
  for each row execute function public.assert_period_open_line();

-- Activity log hooks (memory backbone, reuse log_activity from 0001)
drop trigger if exists accounts_log on public.accounts;
create trigger accounts_log after insert or update or delete on public.accounts
  for each row execute function public.log_activity();
drop trigger if exists je_log on public.journal_entries;
create trigger je_log after insert or update or delete on public.journal_entries
  for each row execute function public.log_activity();

-- ============================================================
-- REPORTING VIEWS + FUNCTIONS
-- ============================================================

-- Line-level ledger (posted only), account metadata joined in.
create or replace view public.account_ledger with (security_invoker = true) as
select
  a.id as account_id, a.number, a.name, a.type, a.normal_side, a.system_key,
  je.id as entry_id, je.entry_no, je.entry_date, je.memo, je.source, je.status,
  jl.id as line_id, jl.debit, jl.credit, jl.reconciled, jl.bank_transaction_id
from public.journal_lines jl
join public.journal_entries je on je.id = jl.entry_id and je.status = 'posted'
join public.accounts a on a.id = jl.account_id;

-- Lifetime balance per account (posted entries).
create or replace view public.account_balances with (security_invoker = true) as
select
  a.id, a.id as account_id, a.number, a.name, a.type, a.normal_side, a.system_key,
  a.description, a.parent_id, a.sort_order, a.is_active,
  coalesce(sum(jl.debit), 0)  as total_debit,
  coalesce(sum(jl.credit), 0) as total_credit,
  case when a.normal_side = 'debit'
       then coalesce(sum(jl.debit), 0)  - coalesce(sum(jl.credit), 0)
       else coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0) end as balance
from public.accounts a
left join public.journal_lines jl on jl.account_id = a.id
left join public.journal_entries je on je.id = jl.entry_id and je.status = 'posted'
group by a.id;

-- Date-ranged balances (drives Income Statement + Balance Sheet).
-- p_from NULL = since inception (Balance Sheet as-of uses from=NULL, to=as_of).
create or replace function public.ledger_balances(p_from date, p_to date)
returns table(
  account_id uuid, number text, name text, type account_type,
  normal_side normal_side, system_key text,
  debit numeric, credit numeric, balance numeric
) language sql stable security invoker as $$
  with lines as (
    select jl.account_id, jl.debit, jl.credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.entry_id
    where je.status = 'posted'
      and (p_from is null or je.entry_date >= p_from)
      and (p_to   is null or je.entry_date <= p_to)
  )
  select a.id, a.number, a.name, a.type, a.normal_side, a.system_key,
    coalesce(sum(l.debit), 0)  as debit,
    coalesce(sum(l.credit), 0) as credit,
    case when a.normal_side = 'debit'
         then coalesce(sum(l.debit), 0)  - coalesce(sum(l.credit), 0)
         else coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) end as balance
  from public.accounts a
  left join lines l on l.account_id = a.id
  group by a.id;
$$;

-- ============================================================
-- SEED CHART OF ACCOUNTS  (idempotent — safe to re-run)
-- ============================================================
create or replace function public.seed_chart_of_accounts() returns void
language plpgsql security definer set search_path = public as $$
declare v_cash uuid; v_ar uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  insert into public.accounts (number, name, type, normal_side, system_key, sort_order) values
    -- Assets
    ('1000','Bluevine Cash',           'asset','debit','bluevine_cash',    10),
    ('1100','Accounts Receivable',     'asset','debit','ar',               20),
    ('1500','Equipment / Trailer',     'asset','debit','equipment',        30),
    ('1510','Accumulated Depreciation','asset','credit','accum_depr',      31),  -- contra-asset
    -- Liabilities
    ('2000','Credit Card',             'liability','credit','credit_card',       50),
    ('2100','Truck Loan',              'liability','credit','truck_loan',        60),
    ('2200','Sales Tax Payable',       'liability','credit','sales_tax_payable', 70),
    -- Equity
    ('3000','Owner''s Capital',        'equity','credit','owner_capital',   80),
    ('3100','Owner Draws',             'equity','debit','owner_draws',      81),  -- contra-equity
    ('3900','Retained Earnings',       'equity','credit','retained_earnings',90),
    -- Revenue
    ('4000','Hauling Income',          'revenue','credit','hauling_income', 100),
    -- Expenses (system_key = 'exp_<expense_category>' so backfill maps 1:1)
    ('5000','Dump Fees',               'expense','debit','exp_dump_fees',         110),
    ('5100','Fuel',                    'expense','debit','exp_fuel',              111),
    ('5200','Payroll',                 'expense','debit','exp_payroll',           112),
    ('5300','Equipment Purchase',      'expense','debit','exp_equipment_purchase',113),
    ('5310','Equipment Repair',        'expense','debit','exp_equipment_repair',  114),
    ('5320','Vehicle Repair',          'expense','debit','exp_vehicle_repair',    115),
    ('5400','Insurance',               'expense','debit','exp_insurance',         116),
    ('5500','Marketing',               'expense','debit','exp_marketing',         117),
    ('5600','Office',                  'expense','debit','exp_office',            118),
    ('5700','Software',                'expense','debit','exp_software',          119),
    ('5800','Utilities',               'expense','debit','exp_utilities',         120),
    ('5900','Permits',                 'expense','debit','exp_permits',           121),
    ('5990','Misc',                    'expense','debit','exp_misc',              122)
  on conflict (system_key) do nothing;

  select id into v_cash from public.accounts where system_key = 'bluevine_cash';
  select id into v_ar   from public.accounts where system_key = 'ar';

  insert into public.accounting_settings (id, cash_account_id, ar_account_id)
    values (true, v_cash, v_ar)
  on conflict (id) do update set cash_account_id = excluded.cash_account_id,
                                 ar_account_id = excluded.ar_account_id,
                                 updated_at = now();
end; $$;

-- ============================================================
-- POST ENTRY helper — insert a balanced entry from JSON lines.
-- p_lines: [{ "account_id": uuid, "debit": n, "credit": n, "memo": text }]
-- Returns the new entry id. Deferred trigger enforces balance at commit.
-- ============================================================
create or replace function public.post_entry(
  p_date date, p_memo text, p_source je_source,
  p_source_table text, p_source_id uuid, p_lines jsonb,
  p_is_closing boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_line jsonb; v_i int := 0;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  insert into public.journal_entries (entry_date, memo, source, source_table, source_id, created_by, is_closing)
    values (p_date, p_memo, p_source, p_source_table, p_source_id, auth.uid(), p_is_closing)
    returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    insert into public.journal_lines (entry_id, account_id, debit, credit, memo, line_no)
      values (
        v_entry,
        (v_line->>'account_id')::uuid,
        round(coalesce((v_line->>'debit')::numeric, 0), 2),
        round(coalesce((v_line->>'credit')::numeric, 0), 2),
        v_line->>'memo',
        v_i
      );
  end loop;

  return v_entry;
end; $$;

-- ============================================================
-- BACKFILL LEDGER from invoices / payments / expenses (idempotent).
-- Accrual spine: AR recognized at invoice date; cash collected at payment.
-- Skips any source row that already produced an entry.
-- ============================================================
create or replace function public.backfill_ledger() returns table(entries_created int)
language plpgsql security definer set search_path = public as $$
declare
  v_cash uuid; v_ar uuid; v_tax uuid; v_rev uuid;
  v_n int := 0;
  r record;
  v_exp uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  select id into v_cash from public.accounts where system_key = 'bluevine_cash';
  select id into v_ar   from public.accounts where system_key = 'ar';
  select id into v_tax  from public.accounts where system_key = 'sales_tax_payable';
  select id into v_rev  from public.accounts where system_key = 'hauling_income';
  if v_cash is null then raise exception 'Seed the chart of accounts first.'; end if;

  -- 1) Invoice revenue recognition (sent or paid) — Dr AR / Cr Revenue (+ Cr Sales Tax)
  for r in
    select i.id, i.total, i.subtotal, coalesce(i.issued_at, i.created_at) as at, i.invoice_number
    from public.invoices i
    where i.status in ('sent','paid')
      and not exists (select 1 from public.journal_entries je
                      where je.source = 'invoice' and je.source_id = i.id)
  loop
    perform public.post_entry(
      r.at::date,
      'Invoice #' || coalesce(r.invoice_number::text, '') || ' — revenue recognized',
      'invoice', 'invoices', r.id,
      (case when (r.total - r.subtotal) > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit',  r.total,               'credit', 0, 'memo','Accounts receivable'),
          jsonb_build_object('account_id', v_rev, 'debit',  0, 'credit', r.subtotal,            'memo','Hauling income'),
          jsonb_build_object('account_id', v_tax, 'debit',  0, 'credit', r.total - r.subtotal,  'memo','Sales tax'))
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit',  r.total, 'credit', 0,       'memo','Accounts receivable'),
          jsonb_build_object('account_id', v_rev, 'debit',  0,       'credit', r.total, 'memo','Hauling income'))
      end)
    );
    v_n := v_n + 1;
  end loop;

  -- 2a) Recorded payments — Dr Cash / Cr AR
  for r in
    select p.id, p.invoice_id, p.amount, p.paid_at, p.method, p.kind
    from public.payments p
    where not exists (select 1 from public.journal_entries je
                      where je.source = 'payment' and je.source_id = p.id)
  loop
    perform public.post_entry(
      r.paid_at::date,
      initcap(r.kind) || ' via ' || r.method || ' — cash collected',
      'payment', 'payments', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', r.amount, 'credit', 0,        'memo','Bluevine cash'),
        jsonb_build_object('account_id', v_ar,   'debit', 0,        'credit', r.amount,  'memo','Applied to AR'))
    );
    v_n := v_n + 1;
  end loop;

  -- 2b) Paid invoices with NO payment rows (historical) — settle AR at paid_at
  for r in
    select i.id, i.total, i.paid_at, i.invoice_number
    from public.invoices i
    where i.status = 'paid' and i.paid_at is not null
      and not exists (select 1 from public.payments p where p.invoice_id = i.id)
      and not exists (select 1 from public.journal_entries je
                      where je.source = 'payment' and je.source_table = 'invoices' and je.source_id = i.id)
  loop
    perform public.post_entry(
      r.paid_at::date,
      'Invoice #' || coalesce(r.invoice_number::text, '') || ' — paid (no payment row)',
      'payment', 'invoices', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', r.total, 'credit', 0,       'memo','Bluevine cash'),
        jsonb_build_object('account_id', v_ar,   'debit', 0,       'credit', r.total, 'memo','Applied to AR'))
    );
    v_n := v_n + 1;
  end loop;

  -- 3) Expenses — Dr Expense[category] / Cr Cash (assumed paid from Bluevine;
  --    reconciliation reveals anything actually paid by credit card).
  for r in
    select e.id, e.amount, e.incurred_on, e.category, e.vendor
    from public.expenses e
    where not exists (select 1 from public.journal_entries je
                      where je.source = 'expense' and je.source_id = e.id)
  loop
    select id into v_exp from public.accounts where system_key = 'exp_' || r.category;
    if v_exp is null then select id into v_exp from public.accounts where system_key = 'exp_misc'; end if;
    perform public.post_entry(
      r.incurred_on,
      replace(r.category::text,'_',' ') || coalesce(' — ' || r.vendor, ''),
      'expense', 'expenses', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_exp,  'debit', r.amount, 'credit', 0,       'memo', r.category::text),
        jsonb_build_object('account_id', v_cash, 'debit', 0,        'credit', r.amount, 'memo','Bluevine cash'))
    );
    v_n := v_n + 1;
  end loop;

  return query select v_n;
end; $$;

-- ============================================================
-- MONTH-END CLOSE
-- ============================================================
create or replace function public.close_period(p_month date, p_override boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_month date := public.period_first(p_month);
  v_end   date := (v_month + interval '1 month - 1 day')::date;
  v_period uuid;
  v_re uuid;
  v_recon_ok boolean;
  v_net numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  r record;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  insert into public.periods (period_month) values (v_month) on conflict (period_month) do nothing;
  select id into v_period from public.periods where period_month = v_month;
  if (select status from public.periods where id = v_period) = 'closed' then
    raise exception 'Period % is already closed.', to_char(v_month,'YYYY-MM');
  end if;

  -- Gate: reconciliation for the cash account must be complete, unless overridden.
  select exists (
    select 1 from public.reconciliations rc
    where rc.period_month = v_month and rc.status = 'reconciled'
      and rc.account_id = (select cash_account_id from public.accounting_settings where id)
  ) into v_recon_ok;
  if not v_recon_ok and not p_override then
    raise exception 'Bank reconciliation for % is not complete. Reconcile or close with an override note.',
      to_char(v_month,'YYYY-MM');
  end if;

  select id into v_re from public.accounts where system_key = 'retained_earnings';

  -- Build the closing entry: zero every revenue/expense account's balance through month-end.
  for r in
    select account_id, type, normal_side, balance
    from public.ledger_balances(null, v_end)
    where type in ('revenue','expense') and balance <> 0
  loop
    if r.type = 'revenue' then
      -- revenue is credit-normal (+balance) → debit it to zero, adds to net income
      v_lines := v_lines || jsonb_build_object('account_id', r.account_id, 'debit', r.balance, 'credit', 0, 'memo','Close revenue');
      v_net := v_net + r.balance;
    else
      -- expense is debit-normal (+balance) → credit it to zero, subtracts from net income
      v_lines := v_lines || jsonb_build_object('account_id', r.account_id, 'debit', 0, 'credit', r.balance, 'memo','Close expense');
      v_net := v_net - r.balance;
    end if;
  end loop;

  -- Balancing line to Retained Earnings for net income (credit) or net loss (debit).
  if v_net > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_re, 'debit', 0, 'credit', v_net, 'memo','Net income to retained earnings');
  elsif v_net < 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_re, 'debit', -v_net, 'credit', 0, 'memo','Net loss to retained earnings');
  end if;

  if jsonb_array_length(v_lines) > 0 then
    perform public.post_entry(v_end, 'Month-end close ' || to_char(v_month,'YYYY-MM'),
                              'close', 'periods', v_period, v_lines, true);
  end if;

  -- Snapshot post-close balances for every account.
  delete from public.close_snapshots where period_id = v_period;
  insert into public.close_snapshots (period_id, account_id, account_number, account_name, account_type, closing_balance)
    select v_period, b.account_id, b.number, b.name, b.type, b.balance
    from public.ledger_balances(null, v_end) b;

  update public.periods
    set status = 'closed', closed_at = now(), closed_by = auth.uid(),
        note = coalesce(p_note, note)
    where id = v_period;
end; $$;

create or replace function public.reopen_period(p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare v_month date := public.period_first(p_month); v_period uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;
  select id into v_period from public.periods where period_month = v_month;
  if v_period is null then raise exception 'No such period.'; end if;

  update public.periods set status = 'open', reopened_at = now() where id = v_period;
  -- Remove the closing entry (cascade removes its lines) and the snapshot.
  delete from public.journal_entries where source = 'close' and source_id = v_period;
  delete from public.close_snapshots where period_id = v_period;
end; $$;

-- ============================================================
-- ROW LEVEL SECURITY — staff (admin / dispatcher) only
-- ============================================================
alter table public.accounts              enable row level security;
alter table public.periods               enable row level security;
alter table public.journal_entries       enable row level security;
alter table public.journal_lines         enable row level security;
alter table public.bank_transactions     enable row level security;
alter table public.bank_import_batches   enable row level security;
alter table public.reconciliations       enable row level security;
alter table public.close_snapshots       enable row level security;
alter table public.depreciation_schedules enable row level security;
alter table public.accounting_settings   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts','periods','journal_entries','journal_lines','bank_transactions',
    'bank_import_batches','reconciliations','close_snapshots','depreciation_schedules','accounting_settings'
  ] loop
    execute format('drop policy if exists %I_staff on public.%I', t, t);
    execute format(
      'create policy %I_staff on public.%I for all to authenticated '
      || 'using (public.app_role() in (''admin'',''dispatcher'')) '
      || 'with check (public.app_role() in (''admin'',''dispatcher''))', t, t);
  end loop;
end $$;

grant execute on function public.seed_chart_of_accounts()      to authenticated;
grant execute on function public.backfill_ledger()             to authenticated;
grant execute on function public.post_entry(date,text,je_source,text,uuid,jsonb,boolean) to authenticated;
grant execute on function public.close_period(date,boolean,text) to authenticated;
grant execute on function public.reopen_period(date)           to authenticated;
grant execute on function public.ledger_balances(date,date)    to authenticated;
