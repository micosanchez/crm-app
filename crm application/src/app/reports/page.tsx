import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Label, Cluster, Cell, Stack, Row } from '@/components/Hud';
import type { Job, Expense, TimeEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (k: string) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); };

function Bar({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-white">{label}</span>
        <span className="metric" style={{ color: 'var(--metal-titanium)' }}>{display}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--brand-accent)' }} />
      </div>
    </div>
  );
}

export default async function ReportsPage() {
  await requireStaff();
  const supabase = createClient();
  const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1); since.setHours(0, 0, 0, 0);

  const [{ data: paid }, { data: jobs }, { data: estimates }, { data: expenses }, { data: times }] = await Promise.all([
    supabase.from('invoices').select('total,paid_at,customers(id,name)').eq('status', 'paid').gte('paid_at', since.toISOString()),
    supabase.from('jobs').select('status,estimated_value,scheduled_start,created_at'),
    supabase.from('estimates').select('status'),
    supabase.from('expenses').select('amount,category').gte('incurred_on', since.toISOString().slice(0, 10)),
    supabase.from('time_entries').select('started_at,ended_at,users(id,full_name)').gte('started_at', since.toISOString()),
  ]);

  // Revenue by month
  const revByMonth = new Map<string, number>();
  (paid ?? []).forEach((i) => { const k = monthKey(new Date(i.paid_at as string)); revByMonth.set(k, (revByMonth.get(k) ?? 0) + Number(i.total)); });
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(since); d.setMonth(since.getMonth() + i); return monthKey(d); });
  const revRows = months.map((k) => ({ k, v: revByMonth.get(k) ?? 0 }));
  const revMax = Math.max(1, ...revRows.map((r) => r.v));
  const collected = (paid ?? []).reduce((s, i) => s + Number(i.total), 0);

  // Jobs
  const allJobs = (jobs ?? []) as Job[];
  const byStatus = new Map<string, number>();
  allJobs.forEach((j) => byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1));
  const completed = allJobs.filter((j) => ['completed', 'invoiced', 'paid'].includes(j.status)).length;
  const completionRate = allJobs.length ? Math.round((completed / allJobs.length) * 100) : 0;
  const avgJob = allJobs.length ? allJobs.reduce((s, j) => s + Number(j.estimated_value ?? 0), 0) / allJobs.length : 0;
  const statusMax = Math.max(1, ...Array.from(byStatus.values()));

  // Estimates conversion
  const est = (estimates ?? []) as { status: string }[];
  const accepted = est.filter((e) => e.status === 'accepted').length;
  const declined = est.filter((e) => e.status === 'declined').length;
  const conversion = accepted + declined ? Math.round((accepted / (accepted + declined)) * 100) : 0;

  // Expenses by category
  const expByCat = new Map<string, number>();
  ((expenses ?? []) as Pick<Expense, 'amount' | 'category'>[]).forEach((e) => expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + Number(e.amount)));
  const expRows = Array.from(expByCat.entries()).sort((a, b) => b[1] - a[1]);
  const expMax = Math.max(1, ...expRows.map((r) => r[1]));
  const expTotal = expRows.reduce((s, r) => s + r[1], 0);

  // Labor hours by tech
  const hoursByTech = new Map<string, number>();
  ((times ?? []) as (TimeEntry & { users?: { full_name?: string } })[]).forEach((t) => {
    if (!t.ended_at) return;
    const h = (new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 3600000;
    const name = t.users?.full_name ?? 'Unassigned';
    hoursByTech.set(name, (hoursByTech.get(name) ?? 0) + h);
  });
  const laborRows = Array.from(hoursByTech.entries()).sort((a, b) => b[1] - a[1]);
  const laborMax = Math.max(1, ...laborRows.map((r) => r[1]));
  const totalHours = laborRows.reduce((s, r) => s + r[1], 0);

  // Top customers
  const byCust = new Map<string, number>();
  (paid ?? []).forEach((i) => { const n = (i.customers as { name?: string } | null)?.name ?? 'Unknown'; byCust.set(n, (byCust.get(n) ?? 0) + Number(i.total)); });
  const topCust = Array.from(byCust.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <p className="panel-label">Reports</p>
        <h1 className="text-2xl">Operations &amp; performance <span className="text-sm" style={{ color: 'var(--text-muted)' }}>· last 6 months</span></h1>
      </div>

      <Cluster cols="grid-cols-2 sm:grid-cols-3">
        <Cell label="Collected" value={money(collected)} tone="var(--brand-text)" />
        <Cell label="Jobs completed" value={String(completed)} sub={`${completionRate}% completion`} />
        <Cell label="Avg job" value={money(avgJob)} />
        <Cell label="Est. conversion" value={`${conversion}%`} sub={`${accepted} won · ${declined} lost`} />
        <Cell label="Labor hours" value={`${totalHours.toFixed(0)}h`} />
        <Cell label="Expenses" value={money(expTotal)} tone="var(--status-danger)" />
      </Cluster>

      <section>
        <Label right="paid_at">Revenue by month</Label>
        <Stack>{revRows.map((r) => <Bar key={r.k} label={monthLabel(r.k)} value={r.v} max={revMax} display={money(r.v)} />)}</Stack>
      </section>

      <section>
        <Label>Jobs by stage</Label>
        <Stack>{Array.from(byStatus.entries()).map(([s, n]) => <Bar key={s} label={s.replace(/_/g, ' ')} value={n} max={statusMax} display={String(n)} />)}</Stack>
      </section>

      <section>
        <Label right="closed entries">Labor hours by crew</Label>
        {laborRows.length ? (
          <Stack>{laborRows.map(([name, h]) => <Bar key={name} label={name} value={h} max={laborMax} display={`${h.toFixed(1)}h`} />)}</Stack>
        ) : (
          <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>No clocked time yet.</div>
        )}
      </section>

      <section>
        <Label right={money(expTotal)}>Expenses by category</Label>
        <Stack>{expRows.map(([c, v]) => <Bar key={c} label={c.replace(/_/g, ' ')} value={v} max={expMax} display={money(v)} />)}</Stack>
      </section>

      <section>
        <Label right="by collected">Top customers</Label>
        <Stack>{topCust.map(([name, v]) => <Row key={name} title={name} tag={money(v)} tagColor="var(--brand-text)" />)}
          {!topCust.length && <Row title="No paid invoices yet" />}
        </Stack>
      </section>
    </div>
  );
}
