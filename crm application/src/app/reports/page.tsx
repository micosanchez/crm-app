import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Label, Cluster, Cell, Stack, Row } from '@/components/Hud';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function Bar({ label, value, max, display, href, tone }: { label: string; value: number; max: number; display: string; href?: string; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const inner = (
    <div className="bg-surface px-4 py-2.5 transition-colors group-hover:bg-[var(--bg-tertiary)]">
      <div className="flex items-baseline justify-between text-sm">
        <span className="truncate text-gray-900">{label}</span>
        <span className="metric shrink-0 pl-2" style={{ color: tone ?? 'var(--metal-titanium)' }}>{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone ?? 'var(--brand-accent)' }} />
      </div>
    </div>
  );
  return href ? <Link href={href} className="group block">{inner}</Link> : <div className="group">{inner}</div>;
}

type PaidInv = { total: number | string; customer_id: string; job_id: string | null; customers: { id: string; name: string } | null };
type JobRow = { id: string; lead_source: string | null; service: string; status: string };
type ExpRow = { category: string; amount: number | string; vendor: string | null; incurred_on: string };
type ProfitRow = { service: string; revenue: number | string; costs: number | string; profit: number | string };

export default async function ReportsPage() {
  await requireStaff();
  const supabase = createClient();

  const [{ data: paid }, { data: jobs }, { data: expenses }, { data: estimates }, { data: profit }] = await Promise.all([
    supabase.from('invoices').select('total,customer_id,job_id,customers(id,name)').eq('status', 'paid'),
    supabase.from('jobs').select('id,lead_source,service,status'),
    supabase.from('expenses').select('category,amount,vendor,incurred_on'),
    supabase.from('estimates').select('status,total'),
    supabase.from('job_profitability').select('service,revenue,costs,profit'),
  ]);

  const paidRows = (paid ?? []) as unknown as PaidInv[];
  const jobRows = (jobs ?? []) as JobRow[];
  const expRows = (expenses ?? []) as ExpRow[];
  const estRows = (estimates ?? []) as { status: string; total: number | string }[];
  const profitRows = (profit ?? []) as ProfitRow[];

  const totalRevenue = paidRows.reduce((s, i) => s + Number(i.total), 0);

  // ---- Customer LTV ranking ----
  const byCustomer = new Map<string, { name: string; total: number }>();
  paidRows.forEach((i) => {
    const id = i.customer_id;
    const name = i.customers?.name ?? 'Unknown';
    const cur = byCustomer.get(id) ?? { name, total: 0 };
    cur.total += Number(i.total);
    byCustomer.set(id, cur);
  });
  const ltv = Array.from(byCustomer.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total).slice(0, 12);
  const ltvMax = Math.max(1, ...ltv.map((r) => r.total));

  // ---- Lead-source ROI ----
  const jobSource = new Map<string, string>();
  jobRows.forEach((j) => jobSource.set(j.id, j.lead_source ?? 'unknown'));
  const revBySource = new Map<string, number>();
  paidRows.forEach((i) => {
    const src = (i.job_id && jobSource.get(i.job_id)) || 'unknown';
    revBySource.set(src, (revBySource.get(src) ?? 0) + Number(i.total));
  });
  const sourceRows = Array.from(revBySource.entries()).sort((a, b) => b[1] - a[1]);
  const sourceMax = Math.max(1, ...sourceRows.map((r) => r[1]));

  const marketing = expRows.filter((e) => e.category === 'marketing');
  const marketingTotal = marketing.reduce((s, e) => s + Number(e.amount), 0);
  const marketingByVendor = new Map<string, number>();
  marketing.forEach((e) => marketingByVendor.set(e.vendor ?? 'unknown', (marketingByVendor.get(e.vendor ?? 'unknown') ?? 0) + Number(e.amount)));
  const marketingRows = Array.from(marketingByVendor.entries()).sort((a, b) => b[1] - a[1]);
  const marketingMax = Math.max(1, ...marketingRows.map((r) => r[1]));
  const roas = marketingTotal > 0 ? totalRevenue / marketingTotal : null;

  // ---- Quote → cash funnel ----
  const estSent = estRows.length;
  const estAccepted = estRows.filter((e) => e.status === 'accepted').length;
  const paidJobs = jobRows.filter((j) => j.status === 'paid').length;
  const quotedValue = estRows.reduce((s, e) => s + Number(e.total), 0);

  // ---- Dump-fee trend (last 12 months) ----
  const dumpByMonth = new Map<string, number>();
  expRows.filter((e) => e.category === 'dump_fees').forEach((e) => {
    const k = e.incurred_on.slice(0, 7);
    dumpByMonth.set(k, (dumpByMonth.get(k) ?? 0) + Number(e.amount));
  });
  const now = new Date();
  const dumpTrend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { k, label: d.toLocaleDateString(undefined, { month: 'short' }), v: dumpByMonth.get(k) ?? 0 };
  });
  const dumpMax = Math.max(1, ...dumpTrend.map((t) => t.v));

  // ---- Profit by service ----
  const bySvc = new Map<string, { revenue: number; costs: number; profit: number }>();
  profitRows.forEach((r) => {
    const cur = bySvc.get(r.service) ?? { revenue: 0, costs: 0, profit: 0 };
    cur.revenue += Number(r.revenue); cur.costs += Number(r.costs); cur.profit += Number(r.profit);
    bySvc.set(r.service, cur);
  });
  const svcRows = Array.from(bySvc.entries()).filter(([, v]) => v.revenue > 0).sort((a, b) => b[1].profit - a[1].profit);

  return (
    <div className="space-y-6">
      <div>
        <p className="panel-label">Reports</p>
        <h1 className="text-2xl">Business intelligence</h1>
      </div>

      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Lifetime revenue" value={money(totalRevenue)} tone="var(--brand-text)" sub={`${paidRows.length} paid invoices`} />
        <Cell label="Paid jobs" value={String(paidJobs)} />
        <Cell label="Marketing spend" value={money(marketingTotal)} href="/expenses" />
        <Cell label="Return on ad $" value={roas == null ? '—' : `${roas.toFixed(1)}x`} sub="revenue ÷ marketing" tone={roas && roas >= 3 ? 'var(--status-success)' : undefined} />
      </Cluster>

      {/* Customer LTV */}
      <section>
        <Label right="top 12">Customer lifetime value</Label>
        {ltv.length ? (
          <Stack>
            {ltv.map((r) => (
              <Bar key={r.id} href={`/customers/${r.id}`} label={r.name} value={r.total} max={ltvMax} display={money(r.total)} tone="var(--brand-accent)" />
            ))}
          </Stack>
        ) : <Empty>No paid revenue yet.</Empty>}
      </section>

      {/* Lead-source ROI */}
      <section>
        <Label right="paid revenue">Revenue by lead source</Label>
        {sourceRows.length ? (
          <Stack>
            {sourceRows.map(([src, v]) => <Bar key={src} label={pretty(src)} value={v} max={sourceMax} display={money(v)} />)}
          </Stack>
        ) : <Empty>No lead source recorded on jobs yet.</Empty>}
        <p className="mt-2 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Tag each job&apos;s lead source (on the job form) to make this a true source-by-source ROI against the marketing spend below.
        </p>
      </section>

      <section>
        <Label right={money(marketingTotal)}>Marketing spend by channel</Label>
        {marketingRows.length ? (
          <Stack>
            {marketingRows.map(([v, amt]) => <Bar key={v} label={v} value={amt} max={marketingMax} display={money(amt)} tone="var(--metal-titanium)" />)}
          </Stack>
        ) : <Empty>No marketing spend recorded.</Empty>}
      </section>

      {/* Quote → cash funnel */}
      <section>
        <Label right="all time">Quote → cash funnel</Label>
        <Cluster cols="grid-cols-2 sm:grid-cols-4">
          <Cell label="Estimates" value={String(estSent)} href="/estimates" sub={money(quotedValue) + ' quoted'} />
          <Cell label="Accepted" value={String(estAccepted)} />
          <Cell label="Paid jobs" value={String(paidJobs)} href="/jobs" />
          <Cell label="Collected" value={money(totalRevenue)} href="/money" tone="var(--brand-text)" />
        </Cluster>
      </section>

      {/* Profit by service */}
      <section>
        <Label right="revenue − linked costs">Profit by service type</Label>
        {svcRows.length ? (
          <Stack>
            {svcRows.map(([svc, v]) => (
              <Row key={svc} title={pretty(svc)} meta={`${money(v.revenue)} in · ${money(v.costs)} costs`} tag={money(v.profit)} tagColor="var(--brand-text)" />
            ))}
          </Stack>
        ) : <Empty>No paid jobs yet.</Empty>}
      </section>

      {/* Dump-fee trend */}
      <section>
        <Label right="last 12 months">Dump &amp; disposal cost trend</Label>
        <Stack>
          {dumpTrend.map((t) => <Bar key={t.k} label={t.label} value={t.v} max={dumpMax} display={money(t.v)} tone="var(--status-danger)" />)}
        </Stack>
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
      {children}
    </div>
  );
}
