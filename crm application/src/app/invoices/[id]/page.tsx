import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import InvoiceEditor from './InvoiceEditor';
import type { Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: invoice }, { data: { user } }] = await Promise.all([
    supabase.from('invoices').select('*, customers(id,name,email,address), invoice_items(*)').eq('id', params.id).single(),
    supabase.auth.getUser(),
  ]);

  if (!invoice) return <p>Invoice not found.</p>;
  const inv = invoice as Invoice;

  const { data: me } = user ? await supabase.from('users').select('role').eq('id', user.id).single() : { data: null };
  const canEdit = me?.role === 'admin' || me?.role === 'dispatcher';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/invoices" className="text-brand-600 hover:underline">← Invoices</Link>
        {inv.customer_id && <Link href={`/customers/${inv.customer_id}`} className="text-gray-500 hover:text-brand-600 hover:underline">Customer: {inv.customers?.name}</Link>}
        {inv.job_id && <Link href={`/jobs/${inv.job_id}`} className="text-gray-500 hover:text-brand-600 hover:underline">View job →</Link>}
      </div>

      <div className="card p-8 print:border-0 print:shadow-none">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-700">INVOICE #{inv.invoice_number}</h1>
            <p className="text-sm text-gray-500">Issued {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : '(draft)'}{inv.due_at && ` · Due ${new Date(inv.due_at).toLocaleDateString()}`}</p>
          </div>
          <StatusBadge status={inv.status} />
        </div>

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase text-gray-400">Bill to</p>
          <p className="font-medium">{inv.customers?.name}</p>
          <p className="text-sm text-gray-500">{inv.customers?.address}</p>
          <p className="text-sm text-gray-500">{inv.customers?.email}</p>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-400">
              <th className="py-2">Type</th><th>Description</th>
              <th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.invoice_items?.map((it) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-2 align-top capitalize">{it.kind}</td>
                <td>
                  <p className="font-semibold uppercase">{it.description}</p>
                  {it.details && <p className="mt-0.5 text-xs text-gray-500">{it.details}</p>}
                </td>
                <td className="text-right align-top">{Number(it.quantity)}</td>
                <td className="text-right align-top">${Number(it.unit_price).toFixed(2)}</td>
                <td className="text-right align-top">${Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-48 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${Number(inv.subtotal).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Tax ({(Number(inv.tax_rate) * 100).toFixed(1)}%)</span><span>${(Number(inv.subtotal) * Number(inv.tax_rate)).toFixed(2)}</span></div>
          {Number(inv.tip ?? 0) > 0 && (
            <div className="flex justify-between"><span className="text-gray-500">Tip</span><span>${Number(inv.tip).toFixed(2)}</span></div>
          )}
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>${Number(inv.total).toFixed(2)}</span></div>
        </div>

        {inv.payment_instructions && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-xs font-bold uppercase text-gray-400">Payment instructions</p>
            <p className="text-sm">{inv.payment_instructions}</p>
          </div>
        )}
        {inv.comments && <p className="mt-3 text-sm text-gray-500">{inv.comments}</p>}
      </div>

      <InvoiceEditor invoice={inv} canEdit={canEdit} />
    </div>
  );
}
