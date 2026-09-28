-- 0046 — Phase 5: reports as SQL functions (exposed by the MCP connector + app). Requires 0041–0045.
-- Every report excludes is_test rows and internal jobs from job counts, cash basis, Detroit dates.

create or replace function public.r2(n numeric) returns numeric language sql immutable as $$ select round(coalesce(n, 0), 2) $$;
create or replace function public.pct(a numeric, b numeric) returns numeric language sql immutable as $$
  select case when coalesce(b, 0) = 0 then null else round(a / b * 100, 1) end $$;
create or replace function public.detroit_today() returns date language sql stable as $$ select (now() at time zone 'America/Detroit')::date $$;

-- "Real" jobs for metrics
create or replace view public.real_jobs with (security_invoker = true) as
  select j.* from public.jobs j where j.deleted_at is null and not j.is_test and j.job_kind = 'customer';

-- Owner hours in a window (labor entries by the owner worker)
create or replace function public.owner_hours(p_from date, p_to date) returns numeric language sql stable as $$
  select coalesce(sum(l.hours), 0) from public.labor_entries l join public.workers w on w.id = l.worker_id
  where w.is_owner and l.deleted_at is null and l.worked_on between p_from and p_to
$$;

-- Vehicle cost for a window per app_settings.vehicle_cost_mode
create or replace function public.vehicle_cost(p_from date, p_to date) returns numeric language sql stable as $$
  select case when (select value#>>'{}' from public.app_settings where key = 'vehicle_cost_mode') = 'actual'
    then public.setting_num('vehicle_actual_monthly') * greatest(1, ((extract(year from p_to) - extract(year from p_from)) * 12 + extract(month from p_to) - extract(month from p_from) + 1))
    else coalesce((select sum(amount) from public.mileage_log where logged_on between p_from and p_to), 0) end
$$;

-- ============ pnl_report ============
create or replace function public.pnl_report(p_from date default null, p_to date default null, p_group_by text default 'month')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, date_trunc('month', public.detroit_today())::date);
        v_to date := coalesce(p_to, public.detroit_today());
        v_out jsonb;
begin
  with periods as (
    select case when p_group_by = 'all' then v_from else greatest(d::date, v_from) end as pstart,
           case when p_group_by = 'all' then v_to else least((d + interval '1 month' - interval '1 day')::date, v_to) end as pend
    from generate_series(date_trunc('month', v_from), date_trunc('month', v_to), interval '1 month') d
    where p_group_by <> 'all' or d = date_trunc('month', v_from)
  ),
  rev as (
    select p.pstart, sum(i.total - coalesce(i.tip,0)) as job_revenue, sum(coalesce(i.tip,0)) as tips, count(*) as paid_invoices
    from periods p join public.invoices i on (i.paid_at at time zone 'America/Detroit')::date between p.pstart and p.pend
    join public.jobs j on j.id = i.job_id
    where i.status = 'paid' and i.voided_at is null and i.deleted_at is null and not i.is_test and j.job_kind = 'customer' and not j.is_test
    group by p.pstart),
  exp as (
    select p.pstart, e.expense_class, e.category::text as category, sum(e.amount) as amt
    from periods p join public.expenses e on e.incurred_on between p.pstart and p.pend
    where e.deleted_at is null and e.labor_entry_id is null
    group by p.pstart, e.expense_class, e.category),
  labor as (
    select p.pstart, sum(coalesce(l.amount, l.hours*l.rate)) as helper_pay
    from periods p join public.labor_entries l on l.worked_on between p.pstart and p.pend
    join public.workers w on w.id = l.worker_id where not w.is_owner and l.deleted_at is null group by p.pstart),
  veh as (select p.pstart, public.vehicle_cost(p.pstart, p.pend) as vehicle_cost from periods p),
  rows as (
    select p.pstart, p.pend,
      coalesce(r.job_revenue,0) as job_revenue, coalesce(r.tips,0) as tips, coalesce(r.paid_invoices,0) as paid_invoices,
      coalesce((select jsonb_object_agg(category, public.r2(amt)) from exp e where e.pstart = p.pstart and e.expense_class = 'direct_job_cost'), '{}') as direct_by_category,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'direct_job_cost'), 0) + coalesce(l.helper_pay, 0) as direct_costs,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'overhead'), 0) as overhead,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'capital'), 0) as capex,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'owner_draw'), 0) as owner_draws,
      coalesce((select sum(amt) from exp e where e.pstart = p.pstart and e.expense_class = 'personal'), 0) as personal,
      coalesce(v.vehicle_cost, 0) as vehicle_cost,
      public.owner_hours(p.pstart, p.pend) as owner_hours
    from periods p left join rev r on r.pstart = p.pstart left join labor l on l.pstart = p.pstart left join veh v on v.pstart = p.pstart)
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'basis', 'cash', 'group_by', p_group_by,
    'periods', jsonb_agg(jsonb_build_object(
      'period', to_char(pstart, 'YYYY-MM'), 'start', pstart, 'end', pend,
      'partial', pend >= public.detroit_today() and pstart <= public.detroit_today(),
      'job_revenue', public.r2(job_revenue), 'tips', public.r2(tips), 'paid_invoices', paid_invoices,
      'direct_costs', public.r2(direct_costs), 'direct_by_category', direct_by_category,
      'gross_profit', public.r2(job_revenue - direct_costs), 'gross_margin_pct', public.pct(job_revenue - direct_costs, job_revenue),
      'overhead', public.r2(overhead),
      'operating_profit', public.r2(job_revenue - direct_costs - overhead), 'operating_margin_pct', public.pct(job_revenue - direct_costs - overhead, job_revenue),
      'capex', public.r2(capex), 'cash_profit_after_capex', public.r2(job_revenue - direct_costs - overhead - capex),
      'owner_draws', public.r2(owner_draws), 'personal_memo', public.r2(personal),
      'vehicle_cost', public.r2(vehicle_cost), 'profit_after_vehicle', public.r2(job_revenue - direct_costs - overhead - vehicle_cost),
      'owner_hours', public.r2(owner_hours),
      'pace_projection', case when pend >= public.detroit_today() and pstart <= public.detroit_today() and (public.detroit_today() - pstart + 1) > 0
        then public.r2((job_revenue - direct_costs - overhead) * ((pend - pstart + 1)::numeric / (public.detroit_today() - pstart + 1))) end
    ) order by pstart),
    'totals', jsonb_build_object(
      'job_revenue', public.r2(sum(job_revenue)), 'tips', public.r2(sum(tips)),
      'direct_costs', public.r2(sum(direct_costs)), 'gross_profit', public.r2(sum(job_revenue - direct_costs)),
      'overhead', public.r2(sum(overhead)), 'operating_profit', public.r2(sum(job_revenue - direct_costs - overhead)),
      'operating_margin_pct', public.pct(sum(job_revenue - direct_costs - overhead), sum(job_revenue)),
      'capex', public.r2(sum(capex)), 'owner_draws', public.r2(sum(owner_draws)), 'personal_memo', public.r2(sum(personal)),
      'vehicle_cost', public.r2(sum(vehicle_cost)), 'profit_after_vehicle', public.r2(sum(job_revenue - direct_costs - overhead - vehicle_cost)),
      'all_outflows', public.r2(sum(direct_costs + overhead + capex + owner_draws + personal)),
      'owner_hours', public.r2(sum(owner_hours)),
      'owner_earnings_per_hour', case when sum(owner_hours) > 0 then public.r2(sum(job_revenue - direct_costs - overhead - vehicle_cost) / sum(owner_hours)) end
    ))
  into v_out from rows;
  return v_out;
end $$;

-- ============ unit_economics ============
create or replace function public.unit_economics(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, date_trunc('month', public.detroit_today())::date);
        v_to date := coalesce(p_to, public.detroit_today()); v_out jsonb;
        v_mkt numeric; v_overhead numeric; v_owner_hours numeric; v_target numeric := public.setting_num('owner_target_hourly', 100);
begin
  select coalesce(sum(amount),0) into v_mkt from public.expenses where category = 'marketing' and deleted_at is null and incurred_on between v_from and v_to;
  select coalesce(sum(amount),0) into v_overhead from public.expenses where expense_class = 'overhead' and deleted_at is null and incurred_on between v_from and v_to;
  v_owner_hours := public.owner_hours(v_from, v_to);
  with jp as (
    select p.*, coalesce(j.completed_on, (j.scheduled_start at time zone 'America/Detroit')::date) as done_on
    from public.job_profitability p join public.jobs j on j.id = p.job_id
    where p.job_kind = 'customer' and not p.is_test and p.revenue > 0
      and coalesce(j.completed_on, (j.scheduled_start at time zone 'America/Detroit')::date) between v_from and v_to),
  dumps as (select coalesce(sum(e.amount),0) as dump from public.expenses e where e.job_id in (select job_id from jp) and e.category in ('dump_fees','dumpster_rental') and e.deleted_at is null),
  agg as (
    select count(*) as n, sum(revenue) as revenue, avg(revenue) as mean_rev, percentile_cont(0.5) within group (order by revenue) as median_rev,
      sum(direct_expenses) as direct, sum(allocated_dump_cost) as dump_alloc, sum(helper_labor) as helper, sum(helper_hours) as helper_hours,
      sum(owner_hours) as owner_hours_on_jobs, sum(profit) as gross_profit, sum(vehicle_cost) as vehicle,
      count(*) filter (where owner_hours = 0) as no_owner_hours, count(*) filter (where allocated_dump_cost = 0 and direct_expenses = 0) as no_disposal
    from jp)
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'jobs', n,
    'revenue', jsonb_build_object('total', public.r2(revenue), 'mean', public.r2(mean_rev), 'median', public.r2(median_rev)),
    'per_job', jsonb_build_object(
      'disposal', public.r2((d.dump + dump_alloc) / nullif(n,0)),
      'helper_labor', public.r2(helper / nullif(n,0)),
      'other_direct', public.r2((direct - d.dump) / nullif(n,0)),
      'marketing', public.r2(v_mkt / nullif(n,0)),
      'gross_profit', public.r2(gross_profit / nullif(n,0)),
      'operating_profit', public.r2((gross_profit - v_overhead) / nullif(n,0)),
      'vehicle', public.r2(vehicle / nullif(n,0))),
    'gross_margin_pct', public.pct(gross_profit, revenue),
    'labor_hours', jsonb_build_object('helper', public.r2(helper_hours), 'owner_on_jobs', public.r2(owner_hours_on_jobs), 'owner_total', public.r2(v_owner_hours)),
    'revenue_per_labor_hour', case when helper_hours + owner_hours_on_jobs > 0 then public.r2(revenue / (helper_hours + owner_hours_on_jobs)) end,
    'owner_earnings_per_owner_hour', case when v_owner_hours > 0 then public.r2((gross_profit - v_overhead - vehicle) / v_owner_hours) end,
    'owner_target_hourly', v_target,
    'jobs_missing_owner_hours', no_owner_hours,
    'jobs_missing_disposal', no_disposal
  ) into v_out from agg, dumps d;
  return v_out;
end $$;

-- ============ owner_hourly ============
create or replace function public.owner_hourly(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, (public.detroit_today() - 90)); v_to date := coalesce(p_to, public.detroit_today());
        v_pnl jsonb; v_hours numeric; v_out jsonb;
begin
  v_pnl := public.pnl_report(v_from, v_to, 'all')->'totals';
  v_hours := public.owner_hours(v_from, v_to);
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'owner_hours', public.r2(v_hours),
    'by_activity', coalesce((select jsonb_object_agg(activity, hrs) from (select l.activity, public.r2(sum(l.hours)) as hrs from public.labor_entries l join public.workers w on w.id = l.worker_id where w.is_owner and l.deleted_at is null and l.worked_on between v_from and v_to group by l.activity) a), '{}'),
    'billable_share_pct', public.pct((select sum(l.hours) from public.labor_entries l join public.workers w on w.id = l.worker_id where w.is_owner and l.deleted_at is null and l.worked_on between v_from and v_to and l.activity in ('on_job','drive','dump_run')), v_hours),
    'operating_profit', v_pnl->'operating_profit',
    'operating_profit_per_owner_hour', case when v_hours > 0 then public.r2((v_pnl->>'operating_profit')::numeric / v_hours) end,
    'after_vehicle_per_owner_hour', case when v_hours > 0 then public.r2((v_pnl->>'profit_after_vehicle')::numeric / v_hours) end,
    'target_hourly', public.setting_num('owner_target_hourly', 100),
    'jobs_with_owner_hours_pct', public.pct((select count(*) from public.job_profitability where job_kind='customer' and not is_test and revenue > 0 and owner_hours > 0 and completed_on between v_from and v_to),
                                            (select count(*) from public.job_profitability where job_kind='customer' and not is_test and revenue > 0 and completed_on between v_from and v_to))
  ) into v_out;
  return v_out;
end $$;

-- ============ quote_win_rate ============
create or replace function public.quote_win_rate(p_from date default null, p_to date default null, p_by text default 'size_bucket')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, '2026-01-01'); v_to date := coalesce(p_to, public.detroit_today()); v_out jsonb;
begin
  with q as (
    select e.*, c.lead_source as cust_source,
      case p_by when 'service_type' then coalesce(e.service_type::text, 'unknown')
                when 'lead_source' then coalesce(c.lead_source::text, 'unknown')
                when 'month' then to_char(coalesce(e.sent_at, e.created_at) at time zone 'America/Detroit', 'YYYY-MM')
                when 'deposit' then case when e.deposit_required then 'deposit' else 'no_deposit' end
                when 'options' then case when e.options is not null and jsonb_array_length(e.options) > 1 then 'two_option' else 'single' end
                else e.quote_size_bucket end as grp
    from public.estimates e left join public.customers c on c.id = e.customer_id
    where e.deleted_at is null and not e.is_test and e.status not in ('draft','cancelled')
      and (coalesce(e.sent_at, e.created_at) at time zone 'America/Detroit')::date between v_from and v_to),
  g as (
    select grp, count(*) as quotes, count(*) filter (where status = 'accepted') as won, count(*) filter (where status in ('declined','expired')) as lost,
      count(*) filter (where status = 'sent') as open, sum(total) as quoted_value, sum(total) filter (where status = 'accepted') as won_value,
      sum(total) filter (where status in ('declined','expired')) as lost_value
    from q group by grp)
  select jsonb_build_object('from', v_from, 'to', v_to, 'by', p_by,
    'overall', (select jsonb_build_object('quotes', count(*), 'won', count(*) filter (where status='accepted'), 'lost', count(*) filter (where status in ('declined','expired')), 'open', count(*) filter (where status='sent'),
       'win_rate_pct', public.pct(count(*) filter (where status='accepted'), count(*) filter (where status in ('accepted','declined','expired'))),
       'win_rate_by_value_pct', public.pct(sum(total) filter (where status='accepted'), sum(total) filter (where status in ('accepted','declined','expired'))),
       'lost_value', public.r2(sum(total) filter (where status in ('declined','expired'))), 'open_value', public.r2(sum(total) filter (where status='sent'))) from q),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('group', grp, 'quotes', quotes, 'won', won, 'lost', lost, 'open', open,
       'win_rate_pct', public.pct(won, won+lost), 'quoted_value', public.r2(quoted_value), 'won_value', public.r2(won_value), 'lost_value', public.r2(lost_value)) order by grp), '[]') from g),
    'top_loss_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n, 'value', v) order by n desc), '[]') from
       (select coalesce(loss_reason::text, 'not_recorded') as reason, count(*) as n, public.r2(sum(total)) as v from q where status in ('declined','expired') group by 1) r),
    'lost_without_reason', (select count(*) from q where status in ('declined','expired') and loss_reason is null)
  ) into v_out;
  return v_out;
end $$;

-- ============ channel_roi ============
create or replace function public.channel_roi(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, '2026-01-01'); v_to date := coalesce(p_to, public.detroit_today()); v_out jsonb;
begin
  with src as (select unnest(enum_range(null::public.lead_source))::text as s),
  leads as (select coalesce(source::text,'unknown') as s, count(*) as n from public.leads where deleted_at is null and not is_test and (created_at at time zone 'America/Detroit')::date between v_from and v_to group by 1),
  quotes as (select coalesce(c.lead_source::text,'unknown') as s, count(*) as n from public.estimates e left join public.customers c on c.id = e.customer_id
             where e.deleted_at is null and not e.is_test and e.status <> 'draft' and (coalesce(e.sent_at, e.created_at) at time zone 'America/Detroit')::date between v_from and v_to group by 1),
  jobs as (select coalesce(j.lead_source,'unknown') as s, count(*) as n, sum(p.revenue) as revenue, sum(p.profit) as gross_profit
           from public.real_jobs j join public.job_profitability p on p.job_id = j.id
           where j.status <> 'cancelled' and coalesce(j.completed_on, (j.scheduled_start at time zone 'America/Detroit')::date, (j.created_at at time zone 'America/Detroit')::date) between v_from and v_to group by 1),
  spend as (select coalesce(mc.channel::text, 'meta_ads') as s, sum(e.amount) as spend from public.expenses e left join public.marketing_campaigns mc on mc.id = e.campaign_id
            where e.category = 'marketing' and e.deleted_at is null and e.incurred_on between v_from and v_to group by 1),
  rows as (
    select s.s as source, coalesce(l.n,0) as leads, coalesce(q.n,0) as quotes, coalesce(j.n,0) as booked_jobs, coalesce(j.revenue,0) as revenue, coalesce(j.gross_profit,0) as gross_profit, coalesce(sp.spend,0) as spend
    from src s left join leads l on l.s = s.s left join quotes q on q.s = s.s left join jobs j on j.s = s.s left join spend sp on sp.s = s.s
    where coalesce(l.n,0)+coalesce(q.n,0)+coalesce(j.n,0)+coalesce(sp.spend,0) > 0)
  select jsonb_build_object('from', v_from, 'to', v_to,
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'leads', leads, 'quotes', quotes, 'booked_jobs', booked_jobs,
        'lead_to_job_pct', public.pct(booked_jobs, leads), 'revenue', public.r2(revenue), 'gross_profit', public.r2(gross_profit), 'spend', public.r2(spend),
        'cost_per_lead', case when leads > 0 and spend > 0 then public.r2(spend / leads) end,
        'cost_per_booked_job', case when booked_jobs > 0 and spend > 0 then public.r2(spend / booked_jobs) end,
        'roas', case when spend > 0 then public.r2(revenue / spend) end,
        'gross_profit_per_dollar', case when spend > 0 then public.r2(gross_profit / spend) end) order by revenue desc), '[]') from rows),
    'unknown_share_pct', public.pct((select booked_jobs from rows where source = 'unknown'), (select sum(booked_jobs) from rows)),
    'total_spend', (select public.r2(sum(spend)) from rows)) into v_out;
  return v_out;
end $$;

-- ============ service_line_profitability ============
create or replace function public.service_line_profitability(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, '2026-01-01'); v_to date := coalesce(p_to, public.detroit_today()); v_out jsonb;
begin
  select jsonb_build_object('from', v_from, 'to', v_to, 'services', coalesce(jsonb_agg(row order by (row->>'revenue')::numeric desc), '[]')) into v_out from (
    select jsonb_build_object('service_type', coalesce(p.service_type::text,'unknown'), 'jobs', count(*), 'revenue', public.r2(sum(p.revenue)),
      'avg_ticket', public.r2(avg(p.revenue)), 'median_ticket', public.r2(percentile_cont(0.5) within group (order by p.revenue)),
      'costs', public.r2(sum(p.costs)), 'gross_profit', public.r2(sum(p.profit)), 'margin_pct', public.pct(sum(p.profit), sum(p.revenue)),
      'labor_hours', public.r2(sum(p.helper_hours + p.owner_hours)),
      'revenue_per_labor_hour', case when sum(p.helper_hours + p.owner_hours) > 0 then public.r2(sum(p.revenue) / sum(p.helper_hours + p.owner_hours)) end) as row
    from public.job_profitability p join public.jobs j on j.id = p.job_id
    where p.job_kind = 'customer' and not p.is_test and p.revenue > 0 and coalesce(j.completed_on, (j.scheduled_start at time zone 'America/Detroit')::date) between v_from and v_to
    group by p.service_type) x;
  return v_out;
end $$;

-- ============ customer_metrics ============
create or replace function public.customer_metrics(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce(p_from, '2026-01-01'); v_to date := coalesce(p_to, public.detroit_today()); v_out jsonb;
begin
  with paid as (
    select j.customer_id, j.id as job_id, j.lead_source, j.account_id, c.segment, i.total - coalesce(i.tip,0) as rev, (i.paid_at at time zone 'America/Detroit')::date as paid_on
    from public.invoices i join public.real_jobs j on j.id = i.job_id join public.customers c on c.id = j.customer_id
    where i.status='paid' and i.voided_at is null and i.deleted_at is null and not i.is_test and (i.paid_at at time zone 'America/Detroit')::date between v_from and v_to),
  cust as (select customer_id, count(*) as n, sum(rev) as rev from paid group by 1),
  monthly as (select to_char(paid_on,'YYYY-MM') as m, sum(rev) as total, max(rev) as largest from paid group by 1)
  select jsonb_build_object('from', v_from, 'to', v_to,
    'unique_customers', (select count(*) from cust),
    'repeat_customers', (select count(*) from public.customer_stats where job_count >= 2 and not is_test),
    'repeat_rate_pct', public.pct((select count(*) from paid p where (select job_count from public.customer_stats s where s.customer_id = p.customer_id) >= 2), (select count(*) from paid)),
    'referral_rate_pct', public.pct((select count(*) from paid where lead_source in ('referral')), (select count(*) from paid)),
    'segment_mix', coalesce((select jsonb_object_agg(segment, n) from (select coalesce(segment::text,'residential') as segment, count(*) as n from paid group by 1) s), '{}'),
    'commercial_revenue_pct', public.pct((select sum(rev) from paid where segment in ('commercial','property_manager','landlord','realtor','contractor','nonprofit') or account_id is not null), (select sum(rev) from paid)),
    'recurring_revenue_pct', public.pct((select sum(p.rev) from paid p join public.accounts_crm a on a.id = p.account_id where a.stage = 'active' and a.recurring_cadence <> 'none'), (select sum(rev) from paid)),
    'top_customers', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', c.customer_id, 'name', cu.name, 'jobs', c.n, 'revenue', public.r2(c.rev)) order by c.rev desc), '[]') from (select * from cust order by rev desc limit 10) c join public.customers cu on cu.id = c.customer_id),
    'concentration_by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'revenue', public.r2(total), 'largest_job', public.r2(largest), 'largest_share_pct', public.pct(largest, total)) order by m), '[]') from monthly),
    'reactivation_due', (select count(*) from public.customer_stats where reactivation_due_at <= public.detroit_today() and not is_test)
  ) into v_out;
  return v_out;
end $$;

-- ============ pipeline_report ============
create or replace function public.pipeline_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  select jsonb_build_object(
    'open_leads', (select coalesce(jsonb_agg(jsonb_build_object('lead_id', id, 'name', name, 'phone', phone, 'source', source, 'status', status, 'channel', channel_in, 'age_hours', round(extract(epoch from now() - created_at)/3600),
        'responded', first_response_at is not null, 'speed_to_lead_min', round(extract(epoch from first_response_at - created_at)/60)) order by created_at desc), '[]')
        from public.leads where deleted_at is null and not is_test and status in ('new','contacted')),
    'leaking_leads', (select coalesce(jsonb_agg(jsonb_build_object('lead_id', id, 'name', name, 'phone', phone, 'status', status, 'age_hours', round(extract(epoch from now() - created_at)/3600))), '[]')
        from public.leads where deleted_at is null and not is_test and status in ('new','contacted','accepted') and quote_id is null and created_at < now() - interval '48 hours'),
    'open_quotes', (select coalesce(jsonb_agg(jsonb_build_object('quote_id', e.id, 'number', e.estimate_number, 'customer', c.name, 'total', e.total, 'age_days', public.detroit_today() - (coalesce(e.sent_at, e.created_at) at time zone 'America/Detroit')::date,
        'opened', coalesce(e.view_count,0) > 0, 'follow_ups', e.follow_up_count, 'next_follow_up_at', e.next_follow_up_at, 'valid_until', e.valid_until) order by e.created_at), '[]')
        from public.estimates e left join public.customers c on c.id = e.customer_id where e.status = 'sent' and e.deleted_at is null and not e.is_test),
    'open_quote_value', (select public.r2(sum(total)) from public.estimates where status='sent' and deleted_at is null and not is_test),
    'expiring_in_3_days', (select coalesce(jsonb_agg(jsonb_build_object('quote_id', id, 'number', estimate_number, 'total', total, 'valid_until', valid_until)), '[]') from public.estimates where status='sent' and deleted_at is null and valid_until between public.detroit_today() and public.detroit_today() + 3),
    'jobs_awaiting_invoice_or_payment', (select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'title', j.title, 'status', j.status, 'balance', public.r2(i.total - i.amount_paid))), '[]')
        from public.real_jobs j left join public.invoices i on i.job_id = j.id and i.voided_at is null and i.deleted_at is null
        where j.status in ('completed','invoiced'))
  ) into v_out;
  return v_out;
end $$;

-- ============ data_health_check ============
create or replace function public.data_health_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'; v_ct numeric := public.setting_num('capital_threshold', 250);
begin
  with issues as (
    select 'critical' as severity, 'paid_job_without_payments' as kind, 'jobs' as entity, j.id, j.title as detail, 'Record the payment on the invoice, or reopen the job (reopen_job).' as fix
      from public.real_jobs j where j.status = 'paid' and not exists (select 1 from public.invoices i join public.payments p on p.invoice_id = i.id where i.job_id = j.id and i.voided_at is null and i.deleted_at is null)
    union all
    select 'critical', 'paid_job_without_invoice', 'jobs', j.id, j.title, 'complete_job creates the invoice; then record_payment.' from public.real_jobs j where j.status = 'paid' and not exists (select 1 from public.invoices i where i.job_id = j.id and i.voided_at is null and i.deleted_at is null)
    union all
    select 'critical', 'invoice_amount_paid_mismatch', 'invoices', i.id, format('#%s amount_paid %s vs payments %s', i.invoice_number, i.amount_paid, coalesce(p.s,0)), 'amount_paid is derived: re-save the invoice or fix the payments rows.'
      from public.invoices i left join (select invoice_id, sum(amount) s from public.payments group by 1) p on p.invoice_id = i.id
      where i.deleted_at is null and i.voided_at is null and not i.is_test and abs(i.amount_paid - coalesce(p.s,0)) > 0.005
    union all
    select 'critical', 'paid_invoice_zero_collected', 'invoices', i.id, format('#%s total %s, paid_at %s', i.invoice_number, i.total, i.paid_at), 'Add the legacy payment row (method unknown_legacy) or revert the invoice to sent.'
      from public.invoices i where i.status='paid' and i.total > 0 and i.amount_paid = 0 and i.deleted_at is null and i.voided_at is null and not i.is_test
    union all
    select 'warning', 'job_missing_lead_source', 'jobs', j.id, j.title, 'update_job(lead_source)' from public.real_jobs j where coalesce(j.lead_source,'unknown') = 'unknown' and j.status <> 'cancelled'
    union all
    select 'warning', 'job_missing_service_type', 'jobs', j.id, j.title, 'update_job(service_type)' from public.real_jobs j where j.service_type is null or j.service_type = 'other'
    union all
    select 'warning', 'job_missing_owner_hours', 'jobs', j.id, j.title, 'log_owner_time(job_id, hours)' from public.real_jobs j join public.job_profitability p on p.job_id = j.id where j.status in ('completed','invoiced','paid') and p.owner_hours = 0 and j.date_precision = 'exact'
    union all
    select 'warning', 'job_missing_dump_allocation', 'jobs', j.id, j.title, 'log_dump_ticket with this job_id, or allocate an existing ticket' from public.real_jobs j join public.job_profitability p on p.job_id = j.id
      where j.status in ('completed','invoiced','paid') and p.allocated_dump_cost = 0 and not exists (select 1 from public.expenses e where e.job_id = j.id and e.category in ('dump_fees','dumpster_rental') and e.deleted_at is null) and j.date_precision = 'exact'
    union all
    select 'warning', 'quote_decided_without_reason', 'estimates', e.id, format('#%s %s', e.estimate_number, e.status), 'update_quote_status(..., loss_reason)' from public.estimates e where e.status in ('declined','expired') and e.loss_reason is null and e.deleted_at is null and not e.is_test
    union all
    select 'critical', 'accepted_quote_cancelled_job', 'estimates', e.id, format('#%s', e.estimate_number), 'Set the quote to cancelled.' from public.estimates e join public.jobs j on j.id = e.job_id where e.status = 'accepted' and j.status = 'cancelled' and e.deleted_at is null
    union all
    select 'warning', 'possible_duplicate_customer', 'customers', c.id, format('%s shares phone %s', c.name, c.phone_e164), 'Merge / delete_customer' from public.customers c where c.deleted_at is null and not c.is_test and c.phone_e164 is not null and exists (select 1 from public.customers d where d.phone_e164 = c.phone_e164 and d.id <> c.id and d.deleted_at is null and not d.is_test)
    union all
    select 'warning', 'possible_duplicate_expense', 'expenses', a.id, format('%s %s %s ~ %s', a.incurred_on, a.vendor, a.amount, b.id), 'delete_expense one of them' from public.expenses a join public.expenses b on b.id > a.id and abs(a.amount - b.amount) <= 0.5 and abs(a.incurred_on - b.incurred_on) <= 2 and lower(coalesce(a.vendor,'')) = lower(coalesce(b.vendor,'')) and a.vendor is not null
      where a.deleted_at is null and b.deleted_at is null and a.category <> 'marketing'
    union all
    select 'warning', 'payroll_expense_without_labor_entry', 'expenses', e.id, format('%s %s %s', e.incurred_on, e.vendor, e.amount), 'log_hours for the helper, then mark_hours_paid (generates the expense); delete this one.' from public.expenses e where e.category='payroll' and e.labor_entry_id is null and e.deleted_at is null and e.expense_class = 'direct_job_cost' and e.job_id is not null
    union all
    select 'warning', 'equipment_purchase_small_not_supplies', 'expenses', e.id, format('%s %s %s', e.incurred_on, e.vendor, e.amount), 'update_expense(category job_supplies or expense_class)' from public.expenses e where e.category='equipment_purchase' and e.amount < v_ct and e.asset_id is null and e.deleted_at is null
    union all
    select 'warning', 'capital_without_asset', 'expenses', e.id, format('%s %s %s', e.incurred_on, e.vendor, e.amount), 'Create the asset row and set asset_id' from public.expenses e where e.expense_class='capital' and e.asset_id is null and e.deleted_at is null
    union all
    select 'warning', 'unpaid_dump_ticket', 'dump_tickets', t.id, format('%s %s $%s', t.dumped_on, t.site_name, t.cost), 'Mark paid once settled' from public.dump_tickets t where not t.paid
    union all
    select 'warning', 'unpaid_dump_fee_note', 'expenses', e.id, e.description, 'Confirm paid and clear the note' from public.expenses e where e.description ~* 'not yet paid' and e.deleted_at is null
    union all
    select 'warning', 'test_looking_record', 'jobs', j.id, j.title, 'Set is_test = true' from public.jobs j where not j.is_test and j.deleted_at is null and (j.title ~* '(^|\W)(test|delete me)(\W|$)' or j.estimated_value = 1)
    union all
    select 'warning', 'test_looking_record', 'invoices', i.id, format('#%s $%s', i.invoice_number, i.total), 'Set is_test = true' from public.invoices i where not i.is_test and i.deleted_at is null and i.total = 1
    union all
    select 'warning', 'tip_recorded_as_job', 'jobs', j.id, j.title, 'Move to tip on the payment; delete the job.' from public.real_jobs j where j.title ~* '^tip\M'
    union all
    select 'info', 'month_precision_record', 'jobs', j.id, j.title, 'Legacy backfill; excluded from sub-monthly reports.' from public.jobs j where j.date_precision = 'month' and j.deleted_at is null
    union all
    select 'warning', 'leaking_lead', 'leads', l.id, format('%s (%s) no quote after %sh', l.name, l.status, round(extract(epoch from now()-l.created_at)/3600)), 'Quote it or mark lost / not_a_fit' from public.leads l where l.deleted_at is null and not l.is_test and l.status in ('new','contacted','accepted') and l.quote_id is null and l.created_at < now() - interval '48 hours'
    union all
    select 'warning', 'disposal_over_24h', 'jobs', j.id, format('%s: %sh between pickup and disposal', j.title, round(extract(epoch from j.disposed_at - j.picked_up_at)/3600)), '24-hour disposal rule' from public.real_jobs j where j.picked_up_at is not null and j.disposed_at is not null and j.disposed_at - j.picked_up_at > interval '24 hours'
    union all
    select 'warning', 'stale_integration', 'integration_runs', null::uuid, r.source, 'run_sync(source)' from (select source, max(started_at) as last_ok from public.integration_runs where status='ok' group by source) r where r.last_ok < now() - interval '48 hours'
    union all
    select 'warning', 'unmatched_bank_transaction', 'bank_transactions', b.id, format('%s %s %s', b.posted_date, b.description, b.amount), 'match_transaction(txn_id, expense_id|payment_id)' from public.bank_transactions b where b.status = 'unmatched' and b.posted_date < public.detroit_today() - 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('severity', severity, 'kind', kind, 'entity', entity, 'id', id, 'detail', detail, 'fix', fix) order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, kind), '[]') into v from issues;
  return jsonb_build_object('checked_at', now(), 'critical', (select count(*) from jsonb_array_elements(v) x where x->>'severity'='critical'),
    'warnings', (select count(*) from jsonb_array_elements(v) x where x->>'severity'='warning'), 'issues', v);
end $$;

-- ============ weekly_scorecard ============
create or replace function public.weekly_scorecard(p_week date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_start date := date_trunc('week', coalesce(p_week, public.detroit_today()))::date; v_end date; v_out jsonb;
begin
  v_end := v_start + 6;
  select jsonb_build_object('week_start', v_start, 'week_end', v_end,
    'quotes_sent', (select count(*) from public.estimates where deleted_at is null and not is_test and (sent_at at time zone 'America/Detroit')::date between v_start and v_end),
    'quotes_won', (select jsonb_build_object('count', count(*), 'value', public.r2(sum(total)), 'by_bucket', coalesce((select jsonb_object_agg(b, n) from (select quote_size_bucket b, count(*) n from public.estimates where status='accepted' and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end group by 1) x), '{}'))
                    from public.estimates where status='accepted' and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end),
    'quotes_lost', (select jsonb_build_object('count', count(*), 'value', public.r2(sum(total))) from public.estimates where status in ('declined','expired') and deleted_at is null and not is_test and (decided_at at time zone 'America/Detroit')::date between v_start and v_end),
    'jobs_completed', (select count(*) from public.real_jobs where completed_on between v_start and v_end and status in ('completed','invoiced','paid')),
    'revenue_collected', (select public.r2(sum(i.total - coalesce(i.tip,0))) from public.invoices i join public.real_jobs j on j.id=i.job_id where i.status='paid' and i.voided_at is null and i.deleted_at is null and (i.paid_at at time zone 'America/Detroit')::date between v_start and v_end),
    'owner_hours', public.owner_hours(v_start, v_end),
    'speed_to_lead_median_min', (select round(percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at)/60)) from public.leads where first_response_at is not null and (created_at at time zone 'America/Detroit')::date between v_start and v_end),
    'leads_in', (select count(*) from public.leads where deleted_at is null and not is_test and (created_at at time zone 'America/Detroit')::date between v_start and v_end),
    'open_pipeline_value', (select public.r2(sum(total)) from public.estimates where status='sent' and deleted_at is null and not is_test),
    'ad_spend', (select public.r2(sum(amount)) from public.expenses where category='marketing' and deleted_at is null and incurred_on between v_start and v_end)
  ) into v_out;
  return v_out;
end $$;

-- ============ monthly_close ============
create table if not exists public.monthly_snapshots (
  month date primary key,
  closed_at timestamptz not null default now(),
  overridden boolean not null default false,
  health jsonb not null,
  pnl jsonb not null, unit_economics jsonb not null, owner_hourly jsonb not null, quote_win_rate jsonb not null,
  channel_roi jsonb not null, customer_metrics jsonb not null
);
alter table public.monthly_snapshots enable row level security;
drop policy if exists monthly_snapshots_staff on public.monthly_snapshots;
create policy monthly_snapshots_staff on public.monthly_snapshots for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.monthly_close(p_month date, p_override boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_start date := date_trunc('month', p_month)::date; v_end date; v_health jsonb;
begin
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from public.monthly_snapshots where month = v_start) then
    return jsonb_build_object('ok', false, 'error', format('%s is already closed and locked.', to_char(v_start, 'YYYY-MM')));
  end if;
  v_health := public.data_health_check();
  if (v_health->>'critical')::int > 0 and not p_override then
    return jsonb_build_object('ok', false, 'error', 'data_health_check has critical issues; fix them or pass override', 'health', v_health);
  end if;
  insert into public.monthly_snapshots (month, overridden, health, pnl, unit_economics, owner_hourly, quote_win_rate, channel_roi, customer_metrics)
  values (v_start, p_override, v_health, public.pnl_report(v_start, v_end, 'month'), public.unit_economics(v_start, v_end), public.owner_hourly(v_start, v_end),
          public.quote_win_rate(v_start, v_end, 'size_bucket'), public.channel_roi(v_start, v_end), public.customer_metrics(v_start, v_end));
  return jsonb_build_object('ok', true, 'month', to_char(v_start, 'YYYY-MM'), 'pnl', public.pnl_report(v_start, v_end, 'month')->'totals');
end $$;

-- ============ full_time_readiness ============
create or replace function public.full_time_readiness() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t jsonb := (select value from public.app_settings where key = 'ft_thresholds');
        v_today date := public.detroit_today(); v_from date := (date_trunc('month', v_today) - interval '6 months')::date; v_to date := (date_trunc('month', v_today) - interval '1 day')::date;
        pnl jsonb; cm jsonb; cr jsonb; oh jsonb; v_months numeric := 6;
        req_income numeric := public.setting_num('required_owner_income', 5000);
        avg_op numeric; conc_ok int; vol_ok boolean; winter numeric; summer numeric; leads_pm numeric; free_share numeric; recurring numeric; paid_eff numeric; owner_rate numeric; owner_logged numeric; reserve numeric; avg_ticket numeric;
        checks jsonb := '[]';
begin
  pnl := public.pnl_report(v_from, v_to, 'month');
  cm  := public.customer_metrics(v_from, v_to);
  cr  := public.channel_roi(v_from, v_to);
  oh  := public.owner_hourly(v_today - 90, v_today);
  avg_op := coalesce((pnl->'totals'->>'profit_after_vehicle')::numeric, 0) / v_months;
  select count(*) into conc_ok from jsonb_array_elements(cm->'concentration_by_month') m where (m->>'largest_share_pct')::numeric < (t->>'concentration_max_share')::numeric * 100;
  select bool_or(ok) into vol_ok from (
    select (n >= (t->>'volume_jobs_per_month')::int and lag(n,1) over (order by m) >= (t->>'volume_jobs_per_month')::int and lag(n,2) over (order by m) >= (t->>'volume_jobs_per_month')::int) as ok
    from (select to_char(completed_on,'YYYY-MM') m, count(*) n from public.real_jobs where status in ('completed','invoiced','paid') and completed_on >= v_from - interval '3 months' group by 1) x) y;
  select coalesce(avg(rev),0) into winter from (select sum(total) rev from public.invoices i join public.real_jobs j on j.id=i.job_id where i.status='paid' and i.voided_at is null and extract(month from i.paid_at at time zone 'America/Detroit') in (12,1,2) group by to_char(i.paid_at,'YYYY-MM')) w;
  select coalesce(avg(rev),0) into summer from (select sum(total) rev from public.invoices i join public.real_jobs j on j.id=i.job_id where i.status='paid' and i.voided_at is null and extract(month from i.paid_at at time zone 'America/Detroit') in (6,7,8) group by to_char(i.paid_at,'YYYY-MM')) s;
  select count(*)::numeric / v_months into leads_pm from public.leads where deleted_at is null and not is_test and (created_at at time zone 'America/Detroit')::date between v_from and v_to;
  select coalesce(sum(case when source::text in ('referral','repeat_customer','google_search_organic','google_business_profile','commercial_account') then 1 else 0 end)::numeric / nullif(count(*),0), 0) into free_share
    from public.leads where deleted_at is null and not is_test and (created_at at time zone 'America/Detroit')::date between v_from and v_to;
  recurring := coalesce((cm->>'recurring_revenue_pct')::numeric, 0) / 100;
  select case when sum(booked) > 0 then sum(spend)/sum(booked) end into paid_eff from (select (c->>'spend')::numeric spend, (c->>'booked_jobs')::numeric booked from jsonb_array_elements(cr->'channels') c where c->>'source' in ('meta_ads','google_ads')) p;
  select coalesce(avg(revenue), 0) into avg_ticket from public.job_profitability where job_kind='customer' and not is_test and revenue > 0;
  owner_rate := (oh->>'after_vehicle_per_owner_hour')::numeric; owner_logged := coalesce((oh->>'jobs_with_owner_hours_pct')::numeric, 0)/100;
  reserve := public.setting_num('cash_reserve');
  checks := jsonb_build_array(
    jsonb_build_object('check','profit','pass', avg_op >= req_income * (t->>'profit_multiple')::numeric, 'value', public.r2(avg_op), 'threshold', public.r2(req_income * (t->>'profit_multiple')::numeric), 'unit','$/month avg operating profit after vehicle (6 mo)'),
    jsonb_build_object('check','concentration','pass', conc_ok >= (t->>'concentration_months_of_6')::int, 'value', conc_ok, 'threshold', (t->>'concentration_months_of_6')::int, 'unit','months of 6 where largest job < 30% of revenue'),
    jsonb_build_object('check','volume','pass', coalesce(vol_ok,false), 'value', (select count(*) from public.real_jobs where status in ('completed','invoiced','paid') and completed_on >= date_trunc('month', v_today - interval '1 month')), 'threshold', (t->>'volume_jobs_per_month')::int, 'unit','customer jobs/month for 3 consecutive months'),
    jsonb_build_object('check','seasonality','pass', case when winter = 0 or summer = 0 then null else winter >= summer * (t->>'seasonality_winter_ratio')::numeric end, 'value', public.r2(winter), 'threshold', public.r2(summer * (t->>'seasonality_winter_ratio')::numeric), 'unit','Dec–Feb avg revenue vs 60% of Jun–Aug (null until a winter has passed)'),
    jsonb_build_object('check','lead_flow','pass', leads_pm >= (t->>'leads_per_month')::numeric and free_share >= (t->>'free_channel_share')::numeric, 'value', jsonb_build_object('leads_per_month', public.r2(leads_pm), 'free_channel_share', public.r2(free_share)), 'threshold', jsonb_build_object('leads_per_month', t->'leads_per_month', 'free_channel_share', t->'free_channel_share')),
    jsonb_build_object('check','recurring','pass', recurring >= (t->>'recurring_revenue_share')::numeric, 'value', public.r2(recurring), 'threshold', t->'recurring_revenue_share', 'unit','share of revenue from active recurring accounts'),
    jsonb_build_object('check','paid_efficiency','pass', case when paid_eff is null then null else paid_eff <= (t->>'paid_cost_per_job_max_share')::numeric * avg_ticket end, 'value', public.r2(paid_eff), 'threshold', public.r2((t->>'paid_cost_per_job_max_share')::numeric * avg_ticket), 'unit','paid $ per booked job vs 15% of avg ticket'),
    jsonb_build_object('check','owner_economics','pass', coalesce(owner_rate,0) >= (t->>'owner_hourly_min')::numeric and owner_logged >= (t->>'owner_hours_logged_share')::numeric, 'value', jsonb_build_object('owner_hourly_after_vehicle', owner_rate, 'jobs_with_owner_hours', public.r2(owner_logged)), 'threshold', jsonb_build_object('owner_hourly_min', t->'owner_hourly_min', 'owner_hours_logged_share', t->'owner_hours_logged_share')),
    jsonb_build_object('check','cash_reserve','pass', reserve >= public.setting_num('reserve_target'), 'value', reserve, 'threshold', public.setting_num('reserve_target'), 'unit','manual input app_settings.cash_reserve')
  );
  return jsonb_build_object('window', jsonb_build_object('from', v_from, 'to', v_to), 'passed', (select count(*) from jsonb_array_elements(checks) c where (c->>'pass')::boolean), 'of', jsonb_array_length(checks), 'checks', checks);
end $$;

-- ============ write helpers shared by the connector and the app ============
-- Owner time: one row in labor_entries at $0 for the owner worker.
create or replace function public.log_owner_time(p_hours numeric, p_activity public.labor_activity default 'on_job', p_job_id uuid default null, p_worked_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w uuid; v_id uuid;
begin
  select id into w from public.workers where is_owner limit 1;
  if w is null then raise exception 'No owner worker record (workers.is_owner).'; end if;
  if p_hours <= 0 then raise exception 'hours must be > 0'; end if;
  insert into public.labor_entries (worker_id, worked_on, hours, rate, job_id, note, activity, created_by)
  values (w, coalesce(p_worked_on, public.detroit_today()), round(p_hours, 2), 0, p_job_id, p_note, p_activity, auth.uid())
  returning id into v_id;
  return jsonb_build_object('labor_entry_id', v_id, 'hours', round(p_hours,2), 'activity', p_activity, 'job_id', p_job_id, 'worked_on', coalesce(p_worked_on, public.detroit_today()));
end $$;
grant execute on function public.log_owner_time(numeric, public.labor_activity, uuid, date, text) to authenticated;

-- Dump ticket + allocation in one call. p_site matches a disposal_sites name/alias, else free text.
create or replace function public.log_dump_ticket(p_cost numeric, p_site text, p_job_ids uuid[] default '{}', p_dumped_on date default null, p_weight_tons numeric default null,
  p_material public.dump_material default 'mixed_junk', p_paid boolean default true, p_paid_with text default 'bluevine', p_receipt_url text default null, p_notes text default null,
  p_external_source text default null, p_external_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_id uuid; v_alloc jsonb := '[]';
begin
  select id into v_site from public.disposal_sites where lower(name) = lower(p_site) or lower(p_site) = any(aliases) or lower(name) like lower(p_site) || '%' limit 1;
  if p_external_id is not null then
    select id into v_id from public.dump_tickets where external_source = p_external_source and external_id = p_external_id;
  end if;
  if v_id is null then
    insert into public.dump_tickets (dumped_on, site_id, site_name, cost, weight_tons, material, paid, paid_with, receipt_url, notes, external_source, external_id, created_by)
    values (coalesce(p_dumped_on, public.detroit_today()), v_site, case when v_site is null then p_site end, p_cost, p_weight_tons, p_material, p_paid, p_paid_with, p_receipt_url, p_notes, p_external_source, p_external_id, auth.uid())
    returning id into v_id;
  end if;
  if cardinality(p_job_ids) > 0 then v_alloc := public.allocate_dump_ticket(v_id, p_job_ids); end if;
  return jsonb_build_object('dump_ticket_id', v_id, 'site', coalesce((select name from public.disposal_sites where id = v_site), p_site), 'cost', p_cost, 'paid', p_paid, 'allocations', v_alloc,
    'expense_id', (select expense_id from public.dump_tickets where id = v_id));
end $$;
grant execute on function public.log_dump_ticket(numeric, text, uuid[], date, numeric, public.dump_material, boolean, text, text, text, text, text) to authenticated;

-- Close-out scope capture in one transaction (used by complete_job / the Field screen).
create or replace function public.job_close_out(p_job_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j record; missing text[] := '{}'; v_owner numeric; v_alloc jsonb;
begin
  select * into j from public.jobs where id = p_job_id and deleted_at is null;
  if j is null then raise exception 'No job %', p_job_id; end if;
  update public.jobs set
    service_type   = coalesce((p->>'service_type')::public.job_service_type, service_type),
    hauling_unit   = coalesce((p->>'hauling_unit')::public.hauling_unit, hauling_unit),
    load_fraction  = coalesce((p->>'load_fraction')::numeric, load_fraction),
    est_weight_lbs = coalesce((p->>'est_weight_lbs')::numeric, est_weight_lbs),
    mattress_count = coalesce((p->>'mattress_count')::int, mattress_count),
    box_spring_count = coalesce((p->>'box_spring_count')::int, box_spring_count),
    heavy_item_count = coalesce((p->>'heavy_item_count')::int, heavy_item_count),
    access_flags   = coalesce((select array_agg(x::public.access_flag) from jsonb_array_elements_text(p->'access_flags') x), access_flags),
    crew_size      = coalesce((p->>'crew_size')::int, crew_size),
    on_site_minutes = coalesce((p->>'on_site_minutes')::int, on_site_minutes),
    picked_up_at   = coalesce((p->>'picked_up_at')::timestamptz, picked_up_at),
    disposed_at    = coalesce((p->>'disposed_at')::timestamptz, disposed_at),
    staged         = coalesce((p->>'staged')::boolean, staged),
    review_requested_at = case when (p->>'review_requested')::boolean then coalesce(review_requested_at, now()) else review_requested_at end,
    internal_notes = coalesce(p->>'internal_notes', internal_notes)
  where id = p_job_id;
  if (p->>'owner_hours') is not null and (p->>'owner_hours')::numeric > 0 then
    perform public.log_owner_time((p->>'owner_hours')::numeric, 'on_job', p_job_id, coalesce((p->>'completed_on')::date, j.completed_on, public.detroit_today()));
  end if;
  if (p->>'owner_drive_hours') is not null and (p->>'owner_drive_hours')::numeric > 0 then
    perform public.log_owner_time((p->>'owner_drive_hours')::numeric, 'drive', p_job_id, coalesce((p->>'completed_on')::date, j.completed_on, public.detroit_today()));
  end if;
  if p ? 'dump_ticket' then
    v_alloc := public.log_dump_ticket((p->'dump_ticket'->>'cost')::numeric, coalesce(p->'dump_ticket'->>'site', 'Other'), array[p_job_id], coalesce((p->'dump_ticket'->>'dumped_on')::date, j.completed_on),
      (p->'dump_ticket'->>'weight_tons')::numeric, coalesce((p->'dump_ticket'->>'material')::public.dump_material, 'mixed_junk'), coalesce((p->'dump_ticket'->>'paid')::boolean, true), coalesce(p->'dump_ticket'->>'paid_with', 'bluevine'));
  end if;
  if p ? 'allocate_ticket_ids' then
    perform public.allocate_dump_ticket(t::uuid, array[p_job_id]) from jsonb_array_elements_text(p->'allocate_ticket_ids') t;
  end if;
  select * into j from public.jobs where id = p_job_id;
  if j.service_type is null or j.service_type = 'other' then missing := missing || 'service_type'; end if;
  if j.load_fraction is null then missing := missing || 'load_fraction'; end if;
  if j.hauling_unit is null then missing := missing || 'hauling_unit'; end if;
  if coalesce(j.lead_source,'unknown') = 'unknown' then missing := missing || 'lead_source'; end if;
  select coalesce(owner_hours,0) into v_owner from public.job_profitability where job_id = p_job_id;
  if v_owner = 0 then missing := missing || 'owner_hours'; end if;
  if not exists (select 1 from public.dump_ticket_allocations where job_id = p_job_id) and not exists (select 1 from public.expenses where job_id = p_job_id and category in ('dump_fees','dumpster_rental') and deleted_at is null) then missing := missing || 'dump_ticket'; end if;
  return jsonb_build_object('job_id', p_job_id, 'service_type', j.service_type, 'load_fraction', j.load_fraction, 'est_cubic_yards', j.est_cubic_yards, 'hauling_unit', j.hauling_unit,
    'crew_size', j.crew_size, 'owner_hours', v_owner, 'dump', v_alloc, 'still_missing', to_jsonb(missing));
end $$;
grant execute on function public.job_close_out(uuid, jsonb) to authenticated;

grant execute on function public.pnl_report(date, date, text) to authenticated;
grant execute on function public.unit_economics(date, date) to authenticated;
grant execute on function public.owner_hourly(date, date) to authenticated;
grant execute on function public.quote_win_rate(date, date, text) to authenticated;
grant execute on function public.channel_roi(date, date) to authenticated;
grant execute on function public.service_line_profitability(date, date) to authenticated;
grant execute on function public.customer_metrics(date, date) to authenticated;
grant execute on function public.pipeline_report() to authenticated;
grant execute on function public.data_health_check() to authenticated;
grant execute on function public.weekly_scorecard(date) to authenticated;
grant execute on function public.monthly_close(date, boolean) to authenticated;
grant execute on function public.full_time_readiness() to authenticated;
