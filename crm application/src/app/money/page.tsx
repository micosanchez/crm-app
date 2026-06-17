import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import type { Expense } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface ProfitRow { job_id: string; title: string; service: string; status: string; revenue: number; costs: number; profit: number }

/** Money — P&L lite + job costing. Visible data is RLS-guarded (admin/dispatcher). */
export default async function MoneyPage() {
  await requireStaff();
  const supabase = createClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthStartDate = monthStart.slice(0, 10);

  const [{ data: paidInvoices }, { data: monthExpenses }, { data: profitRows }, { data: leads }] = await Promise.all([
    supabase.from('invoices').select('total, paid_at').eq('status', 'paid').gte('paid_at', monthStart),
    supabase.from('expenses').select('*').gte('incurred_on', monthStartDate),
    supabase.from('job_profitability').select('*').order('profit', { ascending: false }).limit(50),
    supabase.from('leads').select('source, status, est_value'),
  ]);

  const revenue = (paidInvoices ?? []).reduce((s, i) => s + Number(i.total), 0);
  const expenses = ((monthExpenses ?? []) as Expense[]).reduce((s, e) => s + Number(e.amount), 0);
  const profit = revenue - expenses;

  const byCategory = new Map<string, number>();
  ((monthExpenses ?? []) as Expense[]).forEach((e) => byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount)));

  const byService = new Map<string, { revenue: number; profit: number }>();
  ((profitRows ?? []) as ProfitRow[]).forEach((r) => {
    const cur = byService.get(r.service) ?? { revenue: 0, profit: 0 };
    byService.set(r.service, { revenue: cur.revenue + Number(r.revenue), profit: cur.profit + Number(r.profit) });
  });

  const bySource = new Map<string, { total: number; won: number }>();
  (leads ?? []).forEach((l) => {
    const cur = bySource.get(l.source) ?? { total: 0, won: 0 };
    bySource.set(l.source, { total: cur.total + 1, won: cur.won + (l.status === 'won' ? 1 : 0) });
  });

  const monthName = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Money — {monthName}</h1>

      <div className="grid grid-cols-3 gap-3">
        <div className="card"><p className="text-2xl font-bold text-brand-700">${revenue.toFixed(0)}</p><p className="text-sm text-gray-500">Revenue collected</p></div>
        <div className="card"><p className="text-2xl font-bold text-red-700">${expenses.toFixed(0)}</p><p className="text-sm text-gray-500">Expenses</p></div>
        <div className="card"><p className={`text-2xl font-bold ${profit >= 0 ? 'text-brand-700' : 'text-red-700'}`}>${profit.toFixed(0)}</p><p className="text-sm text-gray-500">Profit{revenue > 0 && ` (${Math.round((profit / revenue) * 100)}%)`}</p></div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Expenses by category</h2>
        <div className="card divide-y divide-gray-100 p-0">
          {Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <div key={cat} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
              <span className="font-medium">${amt.toFixed(2)}</span>
            </div>
          ))}
          {byCategory.size === 0 && <p className="p-4 text-sm text-gray-500">No expenses this month.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Profit by service line <span className="text-xs font-normal text-gray-400">(all time, paid jobs)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {Array.from(byService.entries()).map(([svc, v]) => (
            <div key={svc} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{svc.replace(/_/g, ' ')}</span>
              <span>rev ${v.revenue.toFixed(0)} · <b className={v.profit >= 0 ? 'text-brand-700' : 'text-red-700'}>profit ${v.profit.toFixed(0)}</b></span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Leads by source</h2>
        <div className="card divide-y divide-gray-100 p-0">
          {Array.from(bySource.entries()).sort((a, b) => b[1].total - a[1].total).map(([src, v]) => (
            <div key={src} className="flex justify-between px-4 py-2 text-sm">
              <span className="capitalize">{src.replace(/_/g, ' ')}</span>
              <span>{v.total} leads · {v.won} won{v.total > 0 && ` (${Math.round((v.won / v.total) * 100)}%)`}</span>
            </div>
          ))}
          {bySource.size === 0 && <p className="p-4 text-sm text-gray-500">No leads yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Top jobs by profit</h2>
        <div className="card divide-y divide-gray-100 p-0">
          {((profitRows ?? []) as ProfitRow[]).filter((r) => Number(r.revenue) > 0 || Number(r.costs) > 0).slice(0, 15).map((r) => (
            <div key={r.job_id} className="flex justify-between px-4 py-2 text-sm">
              <span>{r.title}</span>
              <span>rev ${Number(r.revenue).toFixed(0)} − costs ${Number(r.costs).toFixed(0)} = <b className={Number(r.profit) >= 0 ? 'text-brand-700' : 'text-red-700'}>${Number(r.profit).toFixed(0)}</b></span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
