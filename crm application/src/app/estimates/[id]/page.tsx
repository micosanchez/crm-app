import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import EstimateEditor from './EstimateEditor';
import type { Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EstimateDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, customers(id,name), estimate_items(*)')
    .eq('id', params.id)
    .single();

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
            <p className="text-sm text-gray-500">{est.customers?.name} · {new Date(est.created_at).toLocaleDateString()}</p>
          </div>
          <span className="badge bg-gray-100 capitalize text-gray-700">{est.status}</span>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-gray-400"><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {est.estimate_items?.map((it) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-2">{it.description}</td>
                <td className="text-right">{Number(it.quantity)}</td>
                <td className="text-right">${Number(it.unit_price).toFixed(2)}</td>
                <td className="text-right">${Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-48 text-sm">
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>${Number(est.total).toFixed(2)}</span></div>
        </div>
        {est.notes && <p className="mt-4 text-sm text-gray-500">{est.notes}</p>}
      </div>
      <EstimateEditor estimate={est} />
    </div>
  );
}
