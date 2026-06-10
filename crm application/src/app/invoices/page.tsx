import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import type { Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const supabase = createClient();
  const { data: invoices } = await supabase
    .from('invoices')
    .select('*, customers(id,name,email,address)')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Invoices</h1>
      <p className="text-sm text-gray-500">Invoices are generated from completed jobs (open a job → Generate invoice).</p>
      <div className="card divide-y divide-gray-100 p-0">
        {(invoices as Invoice[] | null)?.map((inv) => (
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
        {!invoices?.length && <p className="p-4 text-sm text-gray-500">No invoices yet.</p>}
      </div>
    </div>
  );
}
