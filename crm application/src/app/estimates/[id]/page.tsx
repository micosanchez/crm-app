import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import EstimateEditor from './EstimateEditor';
import type { Estimate, ServiceItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EstimateDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: estimate }, { data: serviceItems }] = await Promise.all([
    supabase.from('estimates').select('*, customers(id,name), estimate_items(*)').eq('id', params.id).single(),
    supabase.from('service_items').select('*').eq('active', true).order('name'),
  ]);

  if (!estimate) return <p>Estimate not found.</p>;
  const est = estimate as Estimate;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="no-print">
        <Link href="/estimates" className="text-sm text-brand-600 hover:underline">← Estimates</Link>
      </div>
      <div className="card p-8 print:border-0 print:shadow-none">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-brand-700">ESTIMATE #{est.estimate_number}</h1>
            <p className="text-sm text-gray-500">
              {est.customer_id
                ? <Link href={`/customers/${est.customer_id}`} className="text-brand-600 hover:underline">{est.customers?.name}</Link>
                : est.customers?.name}
              {' · '}{new Date(est.created_at).toLocaleDateString()}
              {est.job_id && <> · <Link href={`/jobs/${est.job_id}`} className="text-brand-600 hover:underline">view job →</Link></>}
            </p>
          </div>
          <span className="badge bg-gray-100 capitalize text-gray-700">{est.status}</span>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-gray-400"><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {est.estimate_items?.map((it) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-2">
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
        <div className="mt-4 ml-auto w-48 text-sm">
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>${Number(est.total).toFixed(2)}</span></div>
        </div>
        {est.payment_instructions && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-xs font-bold uppercase text-gray-400">Payment instructions</p>
            <p className="text-sm">{est.payment_instructions}</p>
          </div>
        )}
        {est.comments && <p className="mt-3 text-sm text-gray-500">{est.comments}</p>}
        {est.notes && <p className="mt-4 text-sm text-gray-500">{est.notes}</p>}
      </div>
      <EstimateEditor estimate={est} serviceItems={(serviceItems ?? []) as ServiceItem[]} />
    </div>
  );
}
