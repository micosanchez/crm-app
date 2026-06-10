import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import InvoiceEditor from './InvoiceEditor';
import type { Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*, customers(id,name,email,address), invoice_items(*)')
    .eq('id', params.id)
    .single();

  if (!invoice) return <p>Invoice not found.</p>;
  const inv = invoice as Invoice;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="no-print">
        <Link href="/invoices" className="text-sm text-brand-600 hover:underline">← Invoices</Link>
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
                <td className="py-2 capitalize">{it.kind}</td>
                <td>{it.description}</td>
                <td className="text-right">{Number(it.quantity)}</td>
                <td className="text-right">${Number(it.unit_price).toFixed(2)}</td>
                <td className="text-right">${Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-48 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${Number(inv.subtotal).toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Tax ({(Number(inv.tax_rate) * 100).toFixed(1)}%)</span><span>${(Number(inv.total) - Number(inv.subtotal)).toFixed(2)}</span></div>
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>${Number(inv.total).toFixed(2)}</span></div>
        </div>
      </div>

      <InvoiceEditor invoice={inv} />
    </div>
  );
}
