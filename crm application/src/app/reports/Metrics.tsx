import { createClient } from '@/lib/supabase/server';
import { Label, Cluster, Cell, Stack, Row } from '@/components/Hud';
import { money } from '@/lib/money';

/* Business metrics from the 0046 report functions (cash basis, Detroit time,
   tips separate, test/internal records excluded). Every call is fail-soft: if a
   function is missing or errors the section says so instead of breaking the page. */

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const num = (v: unknown) => (v == null ? null : Number(v));
const pct = (v: unknown) => (v == null ? '—' : `${Number(v).toFixed(0)}%`);
const hrs = (v: unknown) => (v == null ? '—' : `${Number(v).toFixed(1)}h`);

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<{ data: J | null; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(name, args);
  return { data: (data as J) ?? null, error: error?.message ?? null };
}

export default async function Metrics() {
  const [pnl, unit, owner, win, health, ready, pipe] = await Promise.all([
    rpc('pnl_report', { p_group_by: 'month', p_from: firstOfMonthsAgo(2) }),
    rpc('unit_economics'),
    rpc('owner_hourly'),
    rpc('quote_win_rate', { p_by: 'size_bucket', p_from: firstOfMonthsAgo(5) }),
    rpc('data_health_check'),
    rpc('full_time_readiness'),
    rpc('pipeline_report'),
  ]);

  if (pnl.error && /does not exist|schema cache/i.test(pnl.error)) {
    return <Note>Business metrics unlock after migrations 0041–0047 run.</Note>;
  }

  const periods: J[] = pnl.data?.periods ?? [];
  const cur = periods[periods.length - 1];
  const tot = pnl.data?.totals ?? {};
  const target = num(unit.data?.owner_target_hourly) ?? 100;
  const ownerRate = num(owner.data?.after_vehicle_per_owner_hour);

  return (
    <>
      {/* This month, cash basis */}
      <section>
        <Label right={cur ? `${cur.period}${cur.partial ? ' · in progress' : ''}` : 'this month'}>P&amp;L — cash basis</Label>
        {pnl.error ? <Note>{pnl.error}</Note> : cur ? (
          <>
            <Cluster cols="grid-cols-2 sm:grid-cols-4">
              <Cell label="Job revenue" value={money(num(cur.job_revenue) ?? 0)} tone="var(--brand-text)" sub={`${cur.paid_invoices} paid · tips ${money(num(cur.tips) ?? 0)} kept separate`} />
              <Cell label="Gross profit" value={money(num(cur.gross_profit) ?? 0)} sub={`${pct(cur.gross_margin_pct)} margin · direct ${money(num(cur.direct_costs) ?? 0)}`} />
              <Cell label="Operating profit" value={money(num(cur.operating_profit) ?? 0)} sub={`after ${money(num(cur.overhead) ?? 0)} overhead`} tone={(num(cur.operating_profit) ?? 0) >= 0 ? 'var(--status-success)' : 'var(--status-danger)'} />
              <Cell label="After vehicle" value={money(num(cur.profit_after_vehicle) ?? 0)} sub={cur.pace_projection ? `pace ${money(num(cur.pace_projection) ?? 0)}` : `vehicle ${money(num(cur.vehicle_cost) ?? 0)}`} />
            </Cluster>
            <Stack>
              {periods.slice().reverse().map((p) => (
                <Row key={p.period} title={p.period} meta={`${money(num(p.job_revenue) ?? 0)} in · ${money(num(p.direct_costs) ?? 0)} direct · ${money(num(p.overhead) ?? 0)} overhead · ${money(num(p.capex) ?? 0)} capex · draws ${money(num(p.owner_draws) ?? 0)}`} tag={money(num(p.operating_profit) ?? 0)} tagColor={(num(p.operating_profit) ?? 0) >= 0 ? 'var(--brand-text)' : 'var(--status-danger)'} />
              ))}
            </Stack>
            <p className="mt-2 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              3-month operating margin {pct(tot.operating_margin_pct)} · owner draws {money(num(tot.owner_draws) ?? 0)} and personal {money(num(tot.personal_memo) ?? 0)} are out of profit, in the ledger.
            </p>
          </>
        ) : <Note>No paid invoices in this window.</Note>}
      </section>

      {/* Owner $/hr + unit economics */}
      <section>
        <Label right={`target ${money(target)}/hr`}>Owner economics — this month</Label>
        {unit.error ? <Note>{unit.error}</Note> : (
          <Cluster cols="grid-cols-2 sm:grid-cols-4">
            <Cell label="Owner $/hr after vehicle" value={ownerRate == null ? '—' : money(ownerRate)} tone={ownerRate == null ? undefined : ownerRate >= target ? 'var(--status-success)' : 'var(--status-danger)'} sub={`${hrs(owner.data?.owner_hours)} logged · ${pct(owner.data?.billable_share_pct)} on jobs`} />
            <Cell label="Avg ticket" value={money(num(unit.data?.revenue?.mean) ?? 0)} sub={`median ${money(num(unit.data?.revenue?.median) ?? 0)} · ${unit.data?.jobs ?? 0} jobs`} />
            <Cell label="Cost per job" value={money((num(unit.data?.per_job?.disposal) ?? 0) + (num(unit.data?.per_job?.helper_labor) ?? 0) + (num(unit.data?.per_job?.other_direct) ?? 0))} sub={`dump ${money(num(unit.data?.per_job?.disposal) ?? 0)} · helpers ${money(num(unit.data?.per_job?.helper_labor) ?? 0)}`} />
            <Cell label="Revenue per labor hr" value={unit.data?.revenue_per_labor_hour == null ? '—' : money(num(unit.data.revenue_per_labor_hour) ?? 0)} sub={`${unit.data?.jobs_missing_owner_hours ?? 0} jobs missing your hours`} tone={(unit.data?.jobs_missing_owner_hours ?? 0) > 0 ? 'var(--status-danger)' : undefined} />
          </Cluster>
        )}
      </section>

      {/* Quote win rate */}
      <section>
        <Label right="last 6 months">Quote win rate</Label>
        {win.error ? <Note>{win.error}</Note> : (
          <>
            <Cluster cols="grid-cols-2 sm:grid-cols-4">
              <Cell label="Win rate" value={pct(win.data?.overall?.win_rate_pct)} sub={`${win.data?.overall?.won ?? 0} won · ${win.data?.overall?.lost ?? 0} lost · ${win.data?.overall?.open ?? 0} open`} />
              <Cell label="By value" value={pct(win.data?.overall?.win_rate_by_value_pct)} sub={`${money(num(win.data?.overall?.lost_value) ?? 0)} lost`} />
              <Cell label="Open quotes" value={money(num(win.data?.overall?.open_value) ?? 0)} href="/estimates" />
              <Cell label="Lost w/o reason" value={String(win.data?.lost_without_reason ?? 0)} tone={(win.data?.lost_without_reason ?? 0) > 0 ? 'var(--status-danger)' : undefined} sub="every decline needs a reason" />
            </Cluster>
            <Stack>
              {(win.data?.groups ?? []).map((g: J) => (
                <Row key={g.group} title={pretty(String(g.group))} meta={`${g.quotes} quotes · ${g.won} won · ${g.lost} lost`} tag={pct(g.win_rate_pct)} />
              ))}
              {(win.data?.top_loss_reasons ?? []).slice(0, 4).map((r: J) => (
                <Row key={r.reason} title={`Lost: ${pretty(String(r.reason))}`} meta={money(num(r.value) ?? 0)} tag={String(r.count)} tagColor="var(--status-danger)" />
              ))}
            </Stack>
          </>
        )}
      </section>

      {/* Pipeline */}
      {pipe.data && !pipe.error && (
        <section>
          <Label right="right now">Pipeline</Label>
          <Cluster cols="grid-cols-2 sm:grid-cols-4">
            <Cell label="Open leads" value={String((pipe.data.open_leads ?? []).length)} href="/leads" sub={`${(pipe.data.leaking_leads ?? []).length} unquoted > 48h`} tone={(pipe.data.leaking_leads ?? []).length > 0 ? 'var(--status-danger)' : undefined} />
            <Cell label="Quotes out" value={String((pipe.data.open_quotes ?? []).length)} href="/estimates" sub={money(num(pipe.data.open_quote_value) ?? 0)} />
            <Cell label="Expiring in 3 days" value={String((pipe.data.expiring_in_3_days ?? []).length)} href="/estimates" />
            <Cell label="Awaiting invoice / payment" value={String((pipe.data.jobs_awaiting_invoice_or_payment ?? []).length)} href="/money" sub={money((pipe.data.jobs_awaiting_invoice_or_payment ?? []).reduce((a: number, j: J) => a + (num(j.balance) ?? 0), 0))} />
          </Cluster>
        </section>
      )}

      {/* Full-time readiness */}
      <section>
        <Label right={ready.data ? `${ready.data.passed}/${ready.data.of} passing` : 'trailing 6 months'}>Full-time readiness</Label>
        {ready.error ? <Note>{ready.error}</Note> : (
          <Stack>
            {(ready.data?.checks ?? []).map((c: J) => (
              <Row key={c.check} title={pretty(String(c.check))} meta={c.unit ?? ''} tag={c.pass == null ? 'n/a' : c.pass ? 'pass' : 'not yet'} tagColor={c.pass == null ? 'var(--text-muted)' : c.pass ? 'var(--status-success)' : 'var(--status-danger)'} />
            ))}
          </Stack>
        )}
      </section>

      {/* Data health */}
      <section>
        <Label right={health.data ? `${health.data.critical} critical · ${health.data.warnings} warnings` : ''}>Data health</Label>
        {health.error ? <Note>{health.error}</Note> : (health.data?.issues ?? []).length === 0 ? <Note>Clean. Every paid job has an invoice, every decline has a reason.</Note> : (
          <Stack>
            {Object.entries(groupBy(health.data?.issues ?? [], (i: J) => `${i.severity}:${i.kind}`)).slice(0, 14).map(([k, list]) => {
              const [sev, kind] = k.split(':');
              const first = list[0];
              const href = first.entity && first.id ? `/${first.entity === 'estimates' ? 'estimates' : first.entity}/${first.id}` : undefined;
              return <Row key={k} href={list.length === 1 ? href : undefined} title={pretty(kind)} meta={list.length === 1 ? `${first.detail} — ${first.fix}` : `${list.length} records — ${first.fix}`} tag={sev} tagColor={sev === 'critical' ? 'var(--status-danger)' : sev === 'warning' ? 'var(--status-warning, #b45309)' : 'var(--text-muted)'} />;
            })}
          </Stack>
        )}
      </section>
    </>
  );
}

function firstOfMonthsAgo(n: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  d.setDate(1); d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-4 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}
