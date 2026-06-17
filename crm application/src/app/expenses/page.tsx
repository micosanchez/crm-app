import { createClient } from '@/lib/supabase/server';
import ExpenseManager from './ExpenseManager';
import { requireStaff } from '@/lib/auth';
import type { Expense, Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage() {
  await requireStaff();
  const supabase = createClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const [{ data: expenses }, { data: jobs }] = await Promise.all([
    supabase.from('expenses').select('*, jobs(id,title)').order('incurred_on', { ascending: false }).limit(300),
    supabase.from('jobs').select('id,title').order('created_at', { ascending: false }).limit(100),
  ]);

  const all = (expenses ?? []) as Expense[];
  const monthTotal = all.filter((e) => e.incurred_on >= monthStart).reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Expenses</h1>
        <span className="badge bg-red-50 text-red-700">This month: ${monthTotal.toFixed(2)}</span>
      </div>
      <ExpenseManager expenses={all} jobs={(jobs ?? []) as Pick<Job, 'id' | 'title'>[]} />
    </div>
  );
}
