import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import { Cluster, Cell, Stack, Row, Label } from '@/components/Hud';
import { money } from '@/lib/rentals/format';

export const dynamic = 'force-dynamic';

export default async function RentalReports({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requireStaff();
  const supabase = createAdminClient()!;
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const from = searchParams.from ?? new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().slice(0, 10);
  const to = searchParams.to ?? today.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc('rental_report', { p_from: from, p_to: to });
  const r = (data ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const months = (r.revenue_by_month ?? []) as { month: string; net: number; by_type: Record<string, number> }[];
  const goal = r.goal ?? { low: 300, high: 500 };
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Reports</h1></div>
      <RentalsNav active="/rentals/reports" />
      <form className="flex flex-wrap items-end gap-2 text-sm"><label>From<input className="input" type="date" name="from" defaultValue={from} /></label><label>To<input className="input" type="date" name="to" defaultValue={to} /></label><button className="btn-ghost">Apply</button></form>
      {error && <p className="text-red-700">{error.message}</p>}
      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Net rental revenue" value={money(r.net_total)} tone="var(--brand-text)" sub={`${from} to ${to}`} />
        <Cell label="Tote utilization" value={`${r.utilization?.avg_pct_out ?? 0}%`} sub={`${r.utilization?.idle_totes_today ?? 0} of ${r.tote_pool ?? 0} idle today · avg ${r.utilization?.avg_rental_days ?? 0} days`} />
        <Cell label="Deposits held" value={money(r.deposits_held)} sub={`balances due ${money(r.balances_due)}`} />
        <Cell label="Failed charges open" value={String(r.failed_charges_open ?? 0)} tone={r.failed_charges_open ? 'var(--status-danger)' : undefined} />
      </Cluster>
      <section><Label right="net by month">Revenue</Label><Stack>{months.map((m) => <Row key={m.month} title={m.month} meta={Object.entries(m.by_type ?? {}).map(([k, v]) => `${k.replace('_', ' ')} ${money(v)}`).join(' · ')} tag={money(m.net)} tagColor={Number(m.net) >= goal.low ? 'var(--status-success)' : 'var(--status-danger)'} />)}{!months.length && <Row title="No rental revenue in this window" meta="" tag="" />}</Stack><p className="mt-1 text-xs text-gray-500">Goal {money(goal.low)} to {money(goal.high)} a month in net profit.</p></section>
      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Lost / damaged assets" value={`${r.losses?.lost_assets ?? 0} / ${r.losses?.damaged_assets ?? 0}`} sub={`cost ${money(r.losses?.cost)} · recovered ${money(r.losses?.fees_recovered)}`} />
        <Cell label="Payback" value={money(r.payback?.net_revenue_to_date)} sub={`of ${money(r.payback?.asset_spend)} spent on totes and dollies`} />
        <Cell label="Booking conversion" value={r.conversion?.page_views ? `${Math.round((r.conversion.paid_bookings / r.conversion.page_views) * 100)}%` : '—'} sub={`${r.conversion?.paid_bookings ?? 0} paid of ${r.conversion?.page_views ?? 0} page views`} />
        <Cell label="Cross-sell" value={String(r.crosssell?.requests ?? 0)} sub={`${r.crosssell?.quotes_won ?? 0} junk quotes won · ${money(r.crosssell?.junk_revenue)} junk revenue`} />
      </Cluster>
      <Cluster cols="grid-cols-2 sm:grid-cols-4">
        <Cell label="Bookings" value={String(r.bookings ?? 0)} sub={`avg order ${money(r.aov)} · add-ons on ${r.addon_attach_pct ?? 0}%`} />
        <Cell label="Turned away" value={String(r.turned_away ?? 0)} sub="sold out + waitlist; buy totes after 2+ a month, two months running" tone={Number(r.turned_away) >= 2 ? 'var(--status-danger)' : undefined} />
        <Cell label="Junk interest at checkout" value={`${r.leads?.checkout_yes ?? 0} yes / ${r.leads?.checkout_maybe ?? 0} maybe`} sub={`${r.leads?.hot_leads ?? 0} hot leads (score 7+)`} />
        <Cell label="Sticker scans → quote forms" value={`${r.leads?.qr_scans ?? 0} → ${r.leads?.quote_forms ?? 0}`} sub={`zone fees ${money(r.zone_fees)}`} />
      </Cluster>
      <section><Label>Utilization by week</Label><Stack>{(r.utilization?.by_week ?? []).map((w: { week: string; pct_out: number }) => <Row key={w.week} title={w.week} meta="" tag={`${w.pct_out ?? 0}% out`} />)}</Stack></section>
      <section><Label>Lead source per booking</Label><Stack>{Object.entries(r.lead_sources ?? {}).map(([k, v]) => <Row key={k} title={k.replace(/_/g, ' ')} meta="" tag={String(v)} />)}</Stack></section>
    </div>
  );
}
