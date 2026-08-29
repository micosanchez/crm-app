import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Label, Cluster, Cell, Stack, Row } from '@/components/Hud';
import type { Expense } from '@/lib/types';

export const dynamic = 'force-dynamic';

type PaidRow = { total: number | string; paid_at: string; customers: { name: string } | null };
type ProfitRow = { job_id: string; title: string; service: string; status: string; revenue: number; costs: number; profit: number };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * How each expense category lands on a Schedule C. This is a filing aid — it
 * sorts real spending into the buckets a preparer works in. It is not tax advice.
 */
const SCHEDULE_C: Record<string, { line: string; bucket: string }> = {
  fuel:               { line: 'Line 9',   bucket: 'Car & truck' },
  vehicle_repair:     { line: 'Line 9',   bucket: 'Car & truck' },
  marketing:          { line: 'Line 8',   bucket: 'Advertising' },
  payroll:            { line: 'Line 11',  bucket: 'Contract labor' },
  equipment_purchase: { line: 'Line 13',  bucket: 'Depreciation / Sec. 179' },
  insurance:          { line: 'Line 15',  bucket: 'Insurance' },
  office:             { line: 'Line 18',  bucket: 'Office expense' },
  software:           { line: 'Line 18',  bucket: 'Office expense' },
  equipment_repair:   { line: 'Line 21',  bucket: 'Repairs & maintenance' },
  permits:            { line: 'Line 23',  bucket: 'Taxes & licenses' },
  utilities:          { line: 'Line 25',  bucket: 'Utilities' },
  dump_fees:          { line: 'Line 27a', bucket: 'Other — disposal fees' },
  misc:               { line: 'Line 27a', bucket: 'Other' },
};

function Bar({ label, value, max, display, tone }: { label: string; value: number; max: number; display: string; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-900">{label}</span>
        <span className="metric" style={{ color: tone ?? 'var(--metal-titanium)' }}>{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone ?? 'var(--brand-accent)' }} />
      </div>
    </div>
  );
}

/** Local (Detroit) YYYY-MM-DD for a Date — the server runs with TZ=America/Detroit. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default async function MoneyPage({ searchParams }: { searchParams: { year?: string; month?: string } }) {
  await requireStaff();
  const supabase = createClient();

  /* ---------- period ---------- */
  const now = new Date();
  const yearMode = !!searchParams.year && !searchParams.month;
  const year = Number(searchParams.year ?? now.getFullYear());
  const monthKey = searchParams.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [mY, mM] = monthKey.split('-').map(Number);

  const start = yearMode ? new Date(year, 0, 1) : new Date(mY, mM - 1, 1);
  const end = yearMode ? new Date(year + 1, 0, 1) : new Date(mY, mM, 1);
  const periodLabel = yearMode
    ? String(year)
    : start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /* ---------- data (cash basis: money in when paid, money out when incurred) ---------- */
  const trailingStart = new Date(start);
  trailingStart.setMonth(trailingStart.getMonth() - (yearMode ? 0 : 11));

  const [{ data: paidPeriod }, { data: expPeriod }, { data: paidTrailing }, { data: profitRows }, { data: openInvoices }] =
    await Promise.all([
      supabase.from('invoices').select('total,paid_at,customers(id,name)').eq('status', 'paid').is('voided_at', null)
        .gte('paid_at', start.toISOString()).lt('paid_at', end.toISOString()),
      supabase.from('expenses').select('amount,category,incurred_on,vendor,description')
        .gte('incurred_on', ymd(start)).lt('incurred_on', ymd(end)),
      supabase.from('invoices').select('total,paid_at').eq('status', 'paid').is('voided_at', null)
        .gte('paid_at', trailingStart.toISOString()).lt('paid_at', end.toISOString()),
      supabase.from('job_profitability').select('*').order('profit', { ascending: false }).limit(200),
      supabase.from('invoices').select('total,amount_paid,customers(id,name)').eq('status', 'sent').is('voided_at', null),
    ]);

  const paidRows = (paidPeriod ?? []) as unknown as PaidRow[];
  const expenses = (expPeriod ?? []) as Pick<Expense, 'amount' | 'category' | 'incurred_on' | 'vendor' | 'description'>[];

  const revenue = paidRows.reduce((s, i) => s + Number(i.total), 0);
  const spend = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const profit = revenue - spend;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;

  const outstanding = ((openInvoices ?? []) as any[])
    .reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid)), 0);

  /* ---------- revenue trend ---------- */
  const byMonth = new Map<string, number>();
  ((paidTrailing ?? []) as { total: number | string; paid_at: string }[]).forEach((i) => {
    const d = new Date(i.paid_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(k, (byMonth.get(k) ?? 0) + Number(i.total));
  });
  const trendKeys = yearMode
    ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    : Array.from({ length: 12 }, (_, i) => {
        const d = new Date(trailingStart); d.setMonth(trailingStart.getMonth() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
  const trend = trendKeys.map((k) => {
    const [y, m] = k.split('-').map(Number);
    return { k, v: byMonth.get(k) ?? 0, label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' }) };
  });
  const trendMax = Math.max(1, ...trend.map((t) => t.v));

  /* ---------- expenses ---------- */
  const byCat = new Map<string, number>();
  expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount)));
  const catRows = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...catRows.map((r) => r[1]));

  /* ---------- write-offs, grouped the way a Schedule C reads ---------- */
  const byBucket = new Map<string, { line: string; total: number; cats: string[] }>();
  catRows.forEach(([cat, amt]) => {
    const map = SCHEDULE_C[cat] ?? { line: 'Line 27a', bucket: 'Other' };
    const cur = byBucket.get(map.bucket) ?? { line: map.line, total: 0, cats: [] };
    cur.total += amt;
    cur.cats.push(cat);
    byBucket.set(map.bucket, cur);
  });
  const bucketRows = Array.from(byBucket.entries()).sort((a, b) => b[1].total - a[1].total);

  /* ---------- job profit ---------- */
  const jobs = ((profitRows ?? []) as ProfitRow[]).filter((r) => Number(r.revenue) > 0);
  const topJobs = jobs.slice(0, 10);

  /* ---------- period switcher ---------- */
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) };
  });
  const years = Array.from(new Set([now.getFullYear(), now.getFullYear() - 1]));

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-xl px-3 py-1.5 text-sm transition ${
      active ? 'text-white' : 'text-gray-600 hover:text-gray-900'
    }`;
  const chipStyle = (active: boolean) =>
    active
      ? { background: 'var(--brand-accent)' }
      : { background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' };

  return (
    <div className="space-y-6">
      <div>
        <p className="panel-label">Money</p>
        <h1 className="text-2xl">
          Profit &amp; expenses{' '}
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>· {periodLabel} · cash basis</span>
        </h1>
      </div>

      {/* period switcher */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {years.map((y) => (
          <Link key={y} href={`/money?year=${y}`} className={chip(yearMode && year === y)} style={chipStyle(yearMode && year === y)}>
            {y}
          </Link>
        ))}
        <span className="self-center px-1" style={{ color: 'var(--border-subtle)' }}>|</span>
        {months.map((m) => (
          <Link key={m.key} href={`/money?month=${m.key}`} className={chip(!yearMode && monthKey === m.key)} style={chipStyle(!yearMode && monthKey === m.key)}>
            {m.label}
          </Link>
        ))}
      </div>

      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Money in" value={money(revenue)} tone="var(--brand-text)" sub={`${paidRows.length} paid invoice${paidRows.length === 1 ? '' : 's'}`} />
        <Cell label="Money out" value={money(spend)} tone="var(--status-danger)" sub={`${expenses.length} expense${expenses.length === 1 ? '' : 's'}`} />
        <Cell label="Profit" value={money(profit)} tone={profit >= 0 ? 'var(--brand-text)' : 'var(--status-danger)'} sub={revenue > 0 ? `${margin}% margin` : undefined} />
        <Cell label="Still owed" value={money(outstanding)} href="/invoices" sub="unpaid invoices" />
      </Cluster>

      <section>
        <Label right={yearMode ? String(year) : 'last 12 months'}>Money in by month</Label>
        <Stack>
          {trend.map((t) => <Bar key={t.k} label={t.label} value={t.v} max={trendMax} display={money(t.v)} tone="var(--brand-accent)" />)}
        </Stack>
      </section>

      <section>
        <Label right={money(spend)}>Where it went</Label>
        {catRows.length ? (
          <Stack>
            {catRows.map(([c, v]) => <Bar key={c} label={pretty(c)} value={v} max={catMax} display={money2(v)} />)}
          </Stack>
        ) : (
          <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            No expenses recorded for {periodLabel}.
          </div>
        )}
      </section>

      <section>
        <Label right={money(spend)}>Write-offs — {yearMode ? year : 'this month'}</Label>
        {bucketRows.length ? (
          <>
            <Stack>
              {bucketRows.map(([bucket, v]) => (
                <Row
                  key={bucket}
                  title={bucket}
                  meta={`${v.line} · ${v.cats.map(pretty).join(', ')}`}
                  tag={money2(v.total)}
                  tagColor="var(--brand-text)"
                />
              ))}
              <Row title="Total deductible" tag={money2(spend)} tagColor="var(--brand-text)" />
            </Stack>
            <p className="mt-2 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Grouped the way a Schedule C reads, so you can hand it to whoever files. Not tax advice — equipment
              over the Section 179 threshold and any personal-use split still need a preparer&apos;s call.
            </p>
          </>
        ) : (
          <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            Nothing to write off yet for this period.
          </div>
        )}
      </section>

      <section>
        <Label right="revenue − job costs">Profit by job <span className="font-normal">(all time)</span></Label>
        <Stack>
          {topJobs.map((r) => (
            <Row
              key={r.job_id}
              href={`/jobs/${r.job_id}`}
              title={r.title}
              meta={`${money(Number(r.revenue))} in · ${money(Number(r.costs))} costs`}
              tag={money(Number(r.profit))}
              tagColor={Number(r.profit) >= 0 ? 'var(--brand-text)' : 'var(--status-danger)'}
            />
          ))}
          {!topJobs.length && <Row title="No paid jobs yet" />}
        </Stack>
      </section>
    </div>
  );
}
