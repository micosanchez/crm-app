-- ============================================================
-- Fieldtrack CRM — Accounting enhancements (wave 2)
--   * expenses.paid_with  (Bluevine vs credit card vs cash) — backfill honors it
--   * New accounts: Processing Fees, Depreciation Expense, Opening Balance Equity
--   * set_opening_balances()  — seed real liabilities/equity so the BS is complete
--   * post_depreciation()     — post one month of straight-line depreciation
--   * backfill_ledger() updated to credit the right account per paid_with
-- Idempotent + additive. Depends on 0020.
-- ============================================================

-- ---------- expenses: how it was paid ----------
alter table public.expenses
  add column if not exists paid_with text not null default 'bluevine'
  check (paid_with in ('bluevine','credit_card','cash','other'));

-- ---------- new accounts (idempotent) ----------
-- Added to seed_chart_of_accounts below too; this insert covers already-seeded installs.
do $$
begin
  if exists (select 1 from public.accounts limit 1) then
    insert into public.accounts (number, name, type, normal_side, system_key, sort_order) values
      ('5350','Processing / Merchant Fees','expense','debit','exp_processing_fees', 113),
      ('5360','Depreciation Expense',       'expense','debit','exp_depreciation',    124),
      ('3200','Opening Balance Equity',     'equity', 'credit','opening_balance_equity', 85)
    on conflict (system_key) do nothing;
  end if;
end $$;

-- ---------- re-seed function: include the new accounts ----------
create or replace function public.seed_chart_of_accounts() returns void
language plpgsql security definer set search_path = public as $$
declare v_cash uuid; v_ar uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  insert into public.accounts (number, name, type, normal_side, system_key, sort_order) values
    ('1000','Bluevine Cash',           'asset','debit','bluevine_cash',    10),
    ('1100','Accounts Receivable',     'asset','debit','ar',               20),
    ('1500','Equipment / Trailer',     'asset','debit','equipment',        30),
    ('1510','Accumulated Depreciation','asset','credit','accum_depr',      31),
    ('2000','Credit Card',             'liability','credit','credit_card',       50),
    ('2100','Truck Loan',              'liability','credit','truck_loan',        60),
    ('2200','Sales Tax Payable',       'liability','credit','sales_tax_payable', 70),
    ('3000','Owner''s Capital',        'equity','credit','owner_capital',   80),
    ('3200','Opening Balance Equity',  'equity','credit','opening_balance_equity', 85),
    ('3100','Owner Draws',             'equity','debit','owner_draws',      81),
    ('3900','Retained Earnings',       'equity','credit','retained_earnings',90),
    ('4000','Hauling Income',          'revenue','credit','hauling_income', 100),
    ('5000','Dump Fees',               'expense','debit','exp_dump_fees',         110),
    ('5100','Fuel',                    'expense','debit','exp_fuel',              111),
    ('5200','Payroll',                 'expense','debit','exp_payroll',           112),
    ('5300','Equipment Purchase',      'expense','debit','exp_equipment_purchase',113),
    ('5350','Processing / Merchant Fees','expense','debit','exp_processing_fees', 113),
    ('5310','Equipment Repair',        'expense','debit','exp_equipment_repair',  114),
    ('5320','Vehicle Repair',          'expense','debit','exp_vehicle_repair',    115),
    ('5400','Insurance',               'expense','debit','exp_insurance',         116),
    ('5500','Marketing',               'expense','debit','exp_marketing',         117),
    ('5600','Office',                  'expense','debit','exp_office',            118),
    ('5700','Software',                'expense','debit','exp_software',          119),
    ('5800','Utilities',               'expense','debit','exp_utilities',         120),
    ('5900','Permits',                 'expense','debit','exp_permits',           121),
    ('5990','Misc',                    'expense','debit','exp_misc',              122),
    ('5360','Depreciation Expense',    'expense','debit','exp_depreciation',      124)
  on conflict (system_key) do nothing;

  select id into v_cash from public.accounts where system_key = 'bluevine_cash';
  select id into v_ar   from public.accounts where system_key = 'ar';

  insert into public.accounting_settings (id, cash_account_id, ar_account_id)
    values (true, v_cash, v_ar)
  on conflict (id) do update set cash_account_id = excluded.cash_account_id,
                                 ar_account_id = excluded.ar_account_id,
                                 updated_at = now();
end; $$;

-- ---------- backfill: honor expenses.paid_with ----------
create or replace function public.backfill_ledger() returns table(entries_created int)
language plpgsql security definer set search_path = public as $$
declare
  v_cash uuid; v_ar uuid; v_tax uuid; v_rev uuid; v_cc uuid;
  v_n int := 0;
  r record;
  v_exp uuid; v_credit uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;

  select id into v_cash from public.accounts where system_key = 'bluevine_cash';
  select id into v_ar   from public.accounts where system_key = 'ar';
  select id into v_tax  from public.accounts where system_key = 'sales_tax_payable';
  select id into v_rev  from public.accounts where system_key = 'hauling_income';
  select id into v_cc   from public.accounts where system_key = 'credit_card';
  if v_cash is null then raise exception 'Seed the chart of accounts first.'; end if;

  -- Invoice revenue recognition
  for r in
    select i.id, i.total, i.subtotal, coalesce(i.issued_at, i.created_at) as at, i.invoice_number
    from public.invoices i
    where i.status in ('sent','paid')
      and not exists (select 1 from public.journal_entries je where je.source = 'invoice' and je.source_id = i.id)
  loop
    perform public.post_entry(
      r.at::date,
      'Invoice #' || coalesce(r.invoice_number::text, '') || ' — revenue recognized',
      'invoice', 'invoices', r.id,
      (case when (r.total - r.subtotal) > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit', r.total, 'credit', 0, 'memo','Accounts receivable'),
          jsonb_build_object('account_id', v_rev, 'debit', 0, 'credit', r.subtotal, 'memo','Hauling income'),
          jsonb_build_object('account_id', v_tax, 'debit', 0, 'credit', r.total - r.subtotal, 'memo','Sales tax'))
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit', r.total, 'credit', 0, 'memo','Accounts receivable'),
          jsonb_build_object('account_id', v_rev, 'debit', 0, 'credit', r.total, 'memo','Hauling income'))
      end)
    );
    v_n := v_n + 1;
  end loop;

  -- Payments (cash collected)
  for r in
    select p.id, p.amount, p.paid_at, p.method, p.kind
    from public.payments p
    where not exists (select 1 from public.journal_entries je where je.source = 'payment' and je.source_id = p.id)
  loop
    perform public.post_entry(
      r.paid_at::date, initcap(r.kind) || ' via ' || r.method || ' — cash collected',
      'payment', 'payments', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', r.amount, 'credit', 0, 'memo','Bluevine cash'),
        jsonb_build_object('account_id', v_ar,   'debit', 0, 'credit', r.amount, 'memo','Applied to AR'))
    );
    v_n := v_n + 1;
  end loop;

  -- Paid invoices without payment rows
  for r in
    select i.id, i.total, i.paid_at, i.invoice_number
    from public.invoices i
    where i.status = 'paid' and i.paid_at is not null
      and not exists (select 1 from public.payments p where p.invoice_id = i.id)
      and not exists (select 1 from public.journal_entries je where je.source = 'payment' and je.source_table = 'invoices' and je.source_id = i.id)
  loop
    perform public.post_entry(
      r.paid_at::date, 'Invoice #' || coalesce(r.invoice_number::text, '') || ' — paid (no payment row)',
      'payment', 'invoices', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash, 'debit', r.total, 'credit', 0, 'memo','Bluevine cash'),
        jsonb_build_object('account_id', v_ar,   'debit', 0, 'credit', r.total, 'memo','Applied to AR'))
    );
    v_n := v_n + 1;
  end loop;

  -- Expenses — credit the account it was actually paid from
  for r in
    select e.id, e.amount, e.incurred_on, e.category, e.vendor, e.paid_with
    from public.expenses e
    where not exists (select 1 from public.journal_entries je where je.source = 'expense' and je.source_id = e.id)
  loop
    select id into v_exp from public.accounts where system_key = 'exp_' || r.category;
    if v_exp is null then select id into v_exp from public.accounts where system_key = 'exp_misc'; end if;
    v_credit := case when r.paid_with = 'credit_card' and v_cc is not null then v_cc else v_cash end;
    perform public.post_entry(
      r.incurred_on,
      replace(r.category::text,'_',' ') || coalesce(' — ' || r.vendor, '')
        || case when r.paid_with = 'credit_card' then ' (credit card)' else '' end,
      'expense', 'expenses', r.id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_exp,    'debit', r.amount, 'credit', 0, 'memo', r.category::text),
        jsonb_build_object('account_id', v_credit, 'debit', 0, 'credit', r.amount, 'memo',
          case when r.paid_with = 'credit_card' then 'Credit card' else 'Bluevine cash' end))
    );
    v_n := v_n + 1;
  end loop;

  return query select v_n;
end; $$;

-- ============================================================
-- OPENING BALANCES — one balanced entry, plug to Opening Balance Equity.
-- p_lines: [{ "account_id": uuid, "balance": numeric }]  (type-normal sign)
-- Re-runnable: replaces any prior opening entry.
-- ============================================================
create or replace function public.set_opening_balances(p_as_of date, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_obe uuid; v_line jsonb; v_acct uuid; v_type account_type; v_bal numeric;
  v_debit numeric; v_credit numeric; v_sum_dr numeric := 0; v_sum_cr numeric := 0;
  v_entry_lines jsonb := '[]'::jsonb; v_plug numeric; v_entry uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;
  select id into v_obe from public.accounts where system_key = 'opening_balance_equity';

  -- Remove any prior opening entries so this is the single source of opening state.
  delete from public.journal_entries where source = 'opening';

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_acct := (v_line->>'account_id')::uuid;
    v_bal  := round(coalesce((v_line->>'balance')::numeric, 0), 2);
    if v_bal = 0 or v_acct is null then continue; end if;
    select type into v_type from public.accounts where id = v_acct;
    if v_type in ('asset','expense') then
      v_debit := case when v_bal > 0 then v_bal else 0 end;
      v_credit := case when v_bal < 0 then -v_bal else 0 end;
    else
      v_credit := case when v_bal > 0 then v_bal else 0 end;
      v_debit := case when v_bal < 0 then -v_bal else 0 end;
    end if;
    v_sum_dr := v_sum_dr + v_debit;
    v_sum_cr := v_sum_cr + v_credit;
    v_entry_lines := v_entry_lines || jsonb_build_object('account_id', v_acct, 'debit', v_debit, 'credit', v_credit, 'memo','Opening balance');
  end loop;

  -- Plug to Opening Balance Equity so the entry balances.
  v_plug := round(v_sum_dr - v_sum_cr, 2);
  if v_plug > 0 then
    v_entry_lines := v_entry_lines || jsonb_build_object('account_id', v_obe, 'debit', 0, 'credit', v_plug, 'memo','Opening balance equity');
  elsif v_plug < 0 then
    v_entry_lines := v_entry_lines || jsonb_build_object('account_id', v_obe, 'debit', -v_plug, 'credit', 0, 'memo','Opening balance equity');
  end if;

  if jsonb_array_length(v_entry_lines) = 0 then return null; end if;

  v_entry := public.post_entry(p_as_of, 'Opening balances as of ' || to_char(p_as_of,'YYYY-MM-DD'),
                               'opening', null, null, v_entry_lines, false);
  return v_entry;
end; $$;

-- ============================================================
-- DEPRECIATION — post one month (straight-line) for a schedule.
-- Dr Depreciation Expense / Cr Accumulated Depreciation. Idempotent per month.
-- ============================================================
create or replace function public.post_depreciation(p_schedule_id uuid, p_month date)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; v_end date := (public.period_first(p_month) + interval '1 month - 1 day')::date; v_entry uuid;
begin
  if public.app_role() not in ('admin','dispatcher') then
    raise exception 'Not authorized';
  end if;
  select * into s from public.depreciation_schedules where id = p_schedule_id;
  if not found then raise exception 'No such schedule.'; end if;
  if not s.active or s.months_posted >= s.useful_life_months then
    raise exception 'Schedule is complete or inactive.';
  end if;
  if exists (select 1 from public.journal_entries
             where source = 'depreciation' and source_id = p_schedule_id
               and public.period_first(entry_date) = public.period_first(p_month)) then
    raise exception 'Depreciation already posted for that month.';
  end if;

  v_entry := public.post_entry(v_end, 'Depreciation — ' || s.asset_name || ' ' || to_char(p_month,'YYYY-MM'),
    'depreciation', 'depreciation_schedules', p_schedule_id,
    jsonb_build_array(
      jsonb_build_object('account_id', s.expense_account_id, 'debit', s.monthly_amount, 'credit', 0, 'memo','Depreciation expense'),
      jsonb_build_object('account_id', s.accum_account_id,   'debit', 0, 'credit', s.monthly_amount, 'memo','Accumulated depreciation')),
    false);

  update public.depreciation_schedules set months_posted = months_posted + 1 where id = p_schedule_id;
  return v_entry;
end; $$;

-- ============================================================
-- CASH FLOW — real ledger cash movement by counterpart account.
-- inflow  = counterpart credited while cash debited (money in)
-- outflow = counterpart debited while cash credited (money out)
-- ============================================================
create or replace function public.cash_activity(p_account uuid, p_from date, p_to date)
returns table(number text, name text, type account_type, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select ca.number, ca.name, ca.type,
    coalesce(sum(case when cashline.debit  > 0 then other.credit else 0 end), 0) as inflow,
    coalesce(sum(case when cashline.credit > 0 then other.debit  else 0 end), 0) as outflow
  from public.journal_entries je
  join public.journal_lines cashline on cashline.entry_id = je.id and cashline.account_id = p_account
  join public.journal_lines other    on other.entry_id = je.id and other.account_id <> p_account
  join public.accounts ca             on ca.id = other.account_id
  where je.status = 'posted'
    and (p_from is null or je.entry_date >= p_from)
    and (p_to   is null or je.entry_date <= p_to)
  group by ca.id
  having coalesce(sum(case when cashline.debit > 0 then other.credit else 0 end), 0) <> 0
      or coalesce(sum(case when cashline.credit > 0 then other.debit else 0 end), 0) <> 0;
$$;

grant execute on function public.set_opening_balances(date,jsonb) to authenticated;
grant execute on function public.post_depreciation(uuid,date)     to authenticated;
grant execute on function public.cash_activity(uuid,date,date)    to authenticated;
