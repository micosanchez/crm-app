import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import EstimateEditor from './EstimateEditor';
import QuoteComposer, { type ComposerCustomer, type ComposerSettings, type ComposerPriceItem } from '../QuoteComposer';
import type { Estimate } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EstimateDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: estimate }, { data: customers }, { data: settings }, { data: priceItems }] = await Promise.all([
    supabase.from('estimates').select('*, customers(id,name), estimate_items(*)').eq('id', params.id).single(),
    supabase.from('customers').select('id,name,phone,address').order('name'),
    supabase.from('business_settings').select('*').eq('id', true).maybeSingle(),
    supabase.from('service_items').select('id,name,default_price,description').eq('active', true).order('name'),
  ]);

  if (!estimate) return <p>Estimate not found.</p>;
  const est = estimate as Estimate;
  const editable = est.status === 'draft' || est.status === 'sent';

  const s: ComposerSettings = {
    default_valid_days: settings?.default_valid_days ?? 14,
    default_line_item: settings?.default_line_item ?? null,
    default_payment_terms: settings?.default_payment_terms ?? null,
    default_additional_terms: settings?.default_additional_terms ?? null,
    business_name: settings?.business_name ?? null,
    tagline: settings?.tagline ?? null,
    phone: settings?.phone ?? null,
    email: settings?.email ?? null,
    website: settings?.website ?? null,
    service_area: settings?.service_area ?? null,
    licensed_insured: settings?.licensed_insured ?? null,
    ein: settings?.ein ?? null,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="no-print flex items-center justify-between">
        <Link href="/estimates" className="text-sm text-brand-600 hover:underline">← Estimates</Link>
        <span className="badge bg-gray-100 capitalize text-gray-700">{est.status}</span>
      </div>

      {editable ? (
        // Edit the quote in the composer — same live document the customer signs.
        <QuoteComposer estimate={est} customers={(customers ?? []) as ComposerCustomer[]} settings={s} priceItems={(priceItems ?? []) as ComposerPriceItem[]} />
      ) : (
        // Locked (accepted / declined): read-only document.
        <div className="card p-8 print:border-0 print:shadow-none">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-brand-700">ESTIMATE #{est.estimate_number}</h1>
            <p className="text-sm text-gray-500">
              {est.customer_id
                ? <Link href={`/customers/${est.customer_id}`} className="text-brand-600 hover:underline">{est.customers?.name}</Link>
                : est.customers?.name}
              {' · '}{new Date(est.created_at).toLocaleDateString()}
              {est.job_id && <> · <Link href={`/jobs/${est.job_id}`} className="text-brand-600 hover:underline">view job →</Link></>}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-gray-400"><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {est.line_item ? (
                <tr className="border-b border-gray-100">
                  <td className="py-2">
                    <p className="font-semibold">{est.line_item}</p>
                    {est.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-500">{est.description}</p>}
                  </td>
                  <td className="text-right align-top">1</td>
                  <td className="text-right align-top">${Number(est.total).toFixed(2)}</td>
                </tr>
              ) : (
                est.estimate_items?.map((it) => (
                  <tr key={it.id} className="border-b border-gray-100">
                    <td className="py-2">
                      <p className="font-semibold">{it.description}</p>
                      {it.details && <p className="mt-0.5 text-xs text-gray-500">{it.details}</p>}
                    </td>
                    <td className="text-right align-top">{Number(it.quantity)}</td>
                    <td className="text-right align-top">${Number(it.amount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-4 ml-auto w-48 text-sm">
            <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span>${Number(est.total).toFixed(2)}</span></div>
          </div>
          {(est.payment_terms ?? est.payment_instructions) && (
            <div className="mt-4 rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-bold uppercase text-gray-400">Payment</p>
              <p className="whitespace-pre-wrap text-sm">{est.payment_terms ?? est.payment_instructions}</p>
            </div>
          )}
          {(est.additional_terms ?? est.comments) && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-500">{est.additional_terms ?? est.comments}</p>}
          {(est.internal_notes ?? est.notes) && (
            <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3">
              <p className="text-xs font-bold uppercase text-amber-700">🔒 Internal notes — not shown to the customer</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{est.internal_notes ?? est.notes}</p>
            </div>
          )}
        </div>
      )}

      <EstimateEditor estimate={est} />
    </div>
  );
}
