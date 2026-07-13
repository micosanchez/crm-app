'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import SignaturePad from '@/components/SignaturePad';
import { flags } from '@/lib/flags';

interface DocItem { description: string; details?: string | null; quantity: number; unit_price: number; amount: number }
interface Doc {
  kind: string; number: number; status: string; total: number; tip?: number; amount_paid?: number;
  created_at: string; customer_name: string | null; customer_address?: string | null; items: DocItem[];
  signed_name: string | null; signed_at: string | null; signature_data?: string | null;
  notes?: string | null; valid_until?: string | null; due_at?: string | null;
  payment_instructions?: string | null; comments?: string | null;
  view_count?: number;
}

const BIZ = { name: 'Sanchez Junk & Haul Co.', phone: '313-348-3325', email: 'sanchezhaulco@gmail.com' };
const money = (n: number) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function notify(payload: Record<string, unknown>) {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export default function SignClient({ kind, token }: { kind: 'estimate' | 'invoice'; token: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSigned, setJustSigned] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc(kind === 'invoice' ? 'invoice_by_token' : 'estimate_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) setError('This link is invalid or has expired.');
        else {
          const d = data as Doc;
          setDoc(d);
          if (d.view_count === 1) {
            notify({ event: 'viewed', kind, token });
          }
        }
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
    else {
      setJustSigned(true);
      // Include the drawn signature so the page shows the real ink immediately
      // (it's already stored server-side; without this the view falls back to
      // a cursive-font name until the next reload).
      setDoc((d) => d && { ...d, signed_name: name, signed_at: new Date().toISOString(), signature_data: dataUrl });
      notify({ event: 'signed', kind, token });
    }
  }

  const [payBusy, setPayBusy] = useState(false);
  const justPaid = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('paid') === '1';

  async function payNow() {
    setPayBusy(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok && data.url) { window.location.href = data.url; return; }
      alert(data.error ?? 'Online payment is not available right now — please use the payment instructions above.');
    } catch {
      alert('Could not start the payment — please check your connection and try again.');
    }
    setPayBusy(false);
  }

  const label = kind === 'invoice' ? 'INVOICE' : 'ESTIMATE';
  const prefix = kind === 'invoice' ? 'INV' : 'EST';
  const subtotal = doc ? doc.items.reduce((s, it) => s + Number(it.amount), 0) : 0;
  const tip = Number(doc?.tip ?? 0);
  const balance = doc ? Math.max(Number(doc.total) - Number(doc.amount_paid ?? 0), 0) : 0;
  const canPay = kind === 'invoice' && flags.stripe && doc?.status !== 'paid' && balance > 0 && !justPaid;
  const expired = !!(doc && !doc.signed_at && doc.valid_until && doc.valid_until < new Date().toISOString().slice(0, 10));

  return (
    <div className="min-h-screen overflow-y-auto p-3 sm:p-6" style={{ background: '#e7e5ea' }}>
      <div className="mx-auto max-w-2xl py-2 sm:py-6">
        {error && (
          <div className="rounded-xl bg-white p-8 text-center text-sm" style={{ color: '#b91c1c' }}>{error}</div>
        )}
        {!doc && !error && (
          <div className="rounded-xl bg-white p-8 text-center text-sm" style={{ color: '#6b7280' }}>Loading…</div>
        )}

        {doc && (
          <>
            <div className="overflow-hidden rounded-xl bg-white shadow-xl" style={{ color: '#1f2937' }}>
              {/* Branded header */}
              <div className="flex items-center justify-between gap-4 px-6 py-5"
                style={{ background: 'linear-gradient(120deg, var(--brand-primary), var(--brand-accent))' }}>
                {logoOk ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/logo.png" alt={BIZ.name} className="h-12 w-auto rounded sm:h-16" onError={() => setLogoOk(false)} />
                ) : (
                  <div className="leading-tight text-white">
                    <p className="text-lg font-extrabold tracking-wide sm:text-xl">SANCHEZ</p>
                    <p className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: '#e6c2cf' }}>JUNK &amp; HAUL CO.</p>
                    <p className="mt-0.5 text-[9px] tracking-[0.18em]" style={{ color: '#c98aa3' }}>REMOVE · REFRESH · RECLAIM</p>
                  </div>
                )}
                <div className="text-right text-white">
                  <p className="text-2xl font-extrabold tracking-wide sm:text-3xl">{label}</p>
                  <p className="text-[11px] opacity-90">Number: #{prefix}{doc.number}</p>
                  <p className="text-[11px] opacity-90">Date: {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>

              <div className="space-y-5 px-6 py-6">
                {/* FOR / FROM */}
                <div className="flex flex-wrap justify-between gap-4 text-sm">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>For:</p>
                    <p className="font-bold">{doc.customer_name ?? 'Customer'}</p>
                    {doc.customer_address && <p style={{ color: '#6b7280' }}>{doc.customer_address}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>{label.toLowerCase()} from:</p>
                    <p className="font-bold">{BIZ.name}</p>
                    <p style={{ color: '#6b7280' }}>{BIZ.phone}</p>
                    <p style={{ color: '#6b7280' }}>{BIZ.email}</p>
                  </div>
                </div>

                {/* Line items */}
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--brand-secondary)', color: '#fff' }}>
                      <th className="px-3 py-2 text-left font-semibold">Description</th>
                      <th className="px-3 py-2 text-center font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.items.map((it, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #ececec' }}>
                        <td className="px-3 py-3 align-top">
                          <p className="font-bold uppercase" style={{ fontSize: '13px' }}>{it.description}</p>
                          {it.details && <p className="mt-1 text-xs" style={{ color: '#6b7280' }}>{it.details}</p>}
                        </td>
                        <td className="px-3 py-3 text-center align-top">{Number(it.quantity)}</td>
                        <td className="px-3 py-3 text-right align-top">{money(it.unit_price)}</td>
                        <td className="px-3 py-3 text-right align-top font-medium">{money(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="flex flex-col items-end gap-1.5 text-sm">
                  <div className="flex w-full max-w-xs justify-between">
                    <span style={{ color: '#6b7280' }}>SUBTOTAL</span>
                    <span className="font-semibold">{money(subtotal)}</span>
                  </div>
                  {kind === 'invoice' && tip > 0 && (
                    <div className="flex w-full max-w-xs justify-between">
                      <span style={{ color: '#6b7280' }}>Tip — thank you!</span>
                      <span className="font-semibold">{money(tip)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex w-full max-w-xs items-center justify-between rounded px-4 py-2.5 text-white"
                    style={{ background: 'linear-gradient(90deg, var(--brand-secondary), var(--brand-primary))' }}>
                    <span className="font-bold tracking-wide">TOTAL</span>
                    <span className="text-lg font-bold">{money(doc.total)}</span>
                  </div>
                </div>

                {/* Online payment */}
                {justPaid && (
                  <div className="rounded-lg p-4 text-center" style={{ background: '#eef7f2' }}>
                    <p className="font-semibold" style={{ color: '#1e7a56' }}>✓ Payment received — thank you!</p>
                    <p className="text-sm" style={{ color: '#6b7280' }}>Your receipt is on its way from our payment processor.</p>
                  </div>
                )}
                {canPay && (
                  <button onClick={payNow} disabled={payBusy}
                    className="no-print w-full rounded-xl py-3.5 text-base font-bold text-white disabled:opacity-60"
                    style={{ background: 'linear-gradient(90deg, var(--brand-secondary), var(--brand-primary))', boxShadow: '0 2px 10px rgba(91,18,37,0.3)' }}>
                    {payBusy ? 'Opening secure checkout…' : `Pay ${money(balance)} securely online`}
                  </button>
                )}

                {/* Payment instructions */}
                {doc.payment_instructions && (
                  <div className="rounded-lg p-3" style={{ background: '#f6f3f5' }}>
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>
                      {canPay ? 'Other ways to pay' : 'Payment instructions'}
                    </p>
                    <p className="mt-0.5 text-sm">{doc.payment_instructions}</p>
                  </div>
                )}
                {doc.comments && <p className="text-sm" style={{ color: '#6b7280' }}>{doc.comments}</p>}
                {doc.notes && <p className="text-sm" style={{ color: '#6b7280' }}>{doc.notes}</p>}

                {/* Signature block */}
                <div className="border-t pt-5" style={{ borderColor: '#ececec' }}>
                  {expired ? (
                    <div className="rounded-lg p-4 text-center" style={{ background: '#f6f3f5' }}>
                      <p className="font-semibold" style={{ color: '#374151' }}>This estimate expired on {new Date(doc.valid_until! + 'T12:00:00').toLocaleDateString()}.</p>
                      <p className="text-sm" style={{ color: '#6b7280' }}>Reply to the message that sent you this link and we&apos;ll send a fresh quote.</p>
                    </div>
                  ) : doc.signed_at ? (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>
                        {justSigned ? 'Thank you!' : 'Signature of record'}
                      </p>
                      {justSigned && kind === 'estimate' && <p className="mt-1 text-sm" style={{ color: '#6b7280' }}>We&apos;ll be in touch to schedule your job.</p>}
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
                        <div>
                          {doc.signature_data ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={doc.signature_data} alt={`Signature of ${doc.signed_name}`}
                              className="h-16 w-auto" style={{ borderBottom: '1px solid #9ca3af' }} />
                          ) : (
                            <p className="font-[cursive] text-xl" style={{ borderBottom: '1px solid #9ca3af', paddingBottom: 2, minWidth: 160 }}>{doc.signed_name}</p>
                          )}
                          <p className="mt-1 text-xs" style={{ color: '#6b7280' }}>Signature</p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold">{doc.signed_name}</p>
                          <p style={{ color: '#6b7280' }}>
                            {new Date(doc.signed_at).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 text-[11px]" style={{ color: '#9ca3af' }}>
                        Approved electronically via secure signing link. A permanent copy of this signed document is retained on record by {BIZ.name}.
                      </p>
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
              </div>
            </div>

            <div className="no-print mt-4 flex items-center justify-between px-1">
              <p className="text-xs" style={{ color: '#6b7280' }}>{BIZ.name} · Remove · Refresh · Reclaim</p>
              <button onClick={() => window.print()} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                style={{ background: 'var(--brand-primary)' }}>Print / Save PDF</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
