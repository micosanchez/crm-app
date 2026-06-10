'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import SignaturePad from '@/components/SignaturePad';

interface DocItem { description: string; quantity: number; unit_price: number; amount: number }
interface Doc {
  kind: string; number: number; status: string; total: number;
  created_at: string; customer_name: string | null; items: DocItem[];
  signed_name: string | null; signed_at: string | null;
  notes?: string | null; valid_until?: string | null; due_at?: string | null;
}

export default function SignClient({ kind, token }: { kind: 'estimate' | 'invoice'; token: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSigned, setJustSigned] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc(kind === 'invoice' ? 'invoice_by_token' : 'estimate_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) setError('This link is invalid or has expired.');
        else setDoc(data as Doc);
      });
  }, [kind, token]);

  async function sign(name: string, dataUrl: string) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc(kind === 'invoice' ? 'sign_invoice' : 'sign_estimate', {
      p_token: token, p_name: name, p_signature: dataUrl,
    });
    setBusy(false);
    if (error || !data) setError('Could not submit signature. Please try again.');
    else { setJustSigned(true); setDoc((d) => d && { ...d, signed_name: name, signed_at: new Date().toISOString() }); }
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#2a0a1c] p-4">
      <div className="mx-auto max-w-lg py-8">
        <div className="mb-6 text-center">
          <p className="text-2xl font-extrabold tracking-wide text-white">SANCHEZ <span className="font-semibold text-gray-300">JUNK &amp; HAUL CO.</span></p>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#a8527f]">Remove · Refresh · Reclaim</p>
        </div>

        {error && <div className="card p-6 text-center text-red-600">{error}</div>}
        {!doc && !error && <div className="card p-6 text-center text-gray-500">Loading…</div>}

        {doc && (
          <div className="card space-y-5 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-brand-700">{kind === 'invoice' ? 'INVOICE' : 'ESTIMATE'} #{doc.number}</h1>
                <p className="text-sm text-gray-500">For {doc.customer_name ?? 'customer'} · {new Date(doc.created_at).toLocaleDateString()}</p>
              </div>
              <span className="badge bg-brand-50 capitalize text-brand-700">{doc.status}</span>
            </div>

            <table className="w-full text-sm">
              <tbody>
                {doc.items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2">{it.description}</td>
                    <td className="py-2 text-right text-gray-500">{Number(it.quantity)} × ${Number(it.unit_price).toFixed(2)}</td>
                    <td className="py-2 text-right font-medium">${Number(it.amount).toFixed(2)}</td>
                  </tr>
                ))}
                <tr><td colSpan={2} className="pt-3 font-bold">Total</td><td className="pt-3 text-right text-lg font-bold text-brand-700">${Number(doc.total).toFixed(2)}</td></tr>
              </tbody>
            </table>

            {doc.notes && <p className="text-sm text-gray-500">{doc.notes}</p>}

            {doc.signed_at ? (
              <div className="rounded-lg bg-brand-50 p-4 text-center">
                <p className="font-semibold text-brand-700">{justSigned ? '✓ Thank you!' : '✓ Signed'}</p>
                <p className="text-sm text-gray-600">Signed by {doc.signed_name} on {new Date(doc.signed_at).toLocaleDateString()}</p>
                {justSigned && kind === 'estimate' && <p className="mt-1 text-sm text-gray-500">We&apos;ll be in touch to schedule your job.</p>}
              </div>
            ) : (
              <div>
                <p className="mb-2 text-sm font-semibold">
                  {kind === 'estimate' ? 'Approve this estimate by signing below:' : 'Acknowledge this invoice by signing below:'}
                </p>
                <SignaturePad onSign={sign} busy={busy} />
              </div>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-500">Sanchez Junk &amp; Haul Co. · Questions? Reply to the message that sent you this link.</p>
      </div>
    </div>
  );
}
