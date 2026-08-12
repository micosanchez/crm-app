import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import { requireStaff } from '@/lib/auth';
import type { Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  await requireStaff();
  const supabase = createClient();
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*, customers(id,name,email,address)')
    .order('created_at', { ascending: false });

  const rows = (invoices as Invoice[] | null) ?? [];
  const outstanding = rows.filter((i) => i.status !== 'paid').reduce((s, i) => s + Number(i.total), 0);
  const collected = rows.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Invoices</h1>
      <p className="text-sm text-gray-500">Invoices are generated from completed jobs (open a job → Generate invoice).</p>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3"><p className="text-xs uppercase tracking-wide text-gray-400">Invoices</p><p className="text-xl font-bold">{rows.length}</p></div>
          <div className="card p-3"><p className="text-xs uppercase tracking-wide text-gray-400">Outstanding</p><p className="text-xl font-bold text-amber-600">${outstanding.toFixed(2)}</p></div>
          <div className="card p-3"><p className="text-xs uppercase tracking-wide text-gray-400">Collected</p><p className="text-xl font-bold text-green-700">${collected.toFixed(2)}</p></div>
        </div>
      )}

      <div className="card divide-y divide-gray-100 p-0">
        {rows.map((inv) => (
          <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
            <div>
              <p className="font-medium">#{inv.invoice_number} · {inv.customers?.name}</p>
              <p className="text-xs text-gray-500">{new Date(inv.created_at).toLocaleDateString()}{inv.due_at && ` · due ${new Date(inv.due_at).toLocaleDateString()}`}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={inv.status} />
              <span className="font-semibold">${Number(inv.total).toFixed(2)}</span>
            </div>
          </Link>
        ))}
        {!rows.length && (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-gray-600">No invoices yet</p>
            <p className="mt-1 text-sm text-gray-500">Invoices come from finished jobs. Complete a job, then hit “Generate invoice” on it.</p>
            <Link href="/jobs" className="btn-primary mt-4 inline-block">Go to Jobs →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
