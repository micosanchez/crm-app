import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import PrintButton from '../PrintButton';

export const dynamic = 'force-dynamic';

interface SnapItem { description: string; details?: string | null; quantity: number; unit_price: number; amount: number }
interface SnapPayload {
  created_at?: string; valid_until?: string | null; due_at?: string | null; tip?: number | null;
  notes?: string | null; payment_instructions?: string | null; comments?: string | null;
  items?: SnapItem[];
}

const BIZ = { name: 'Sanchez Junk & Haul Co.', phone: '313-348-3325', email: 'sanchezhaulco@gmail.com', tagline: 'Remove · Refresh · Reclaim' };
const money = (n: number) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The permanent, print-ready copy of a signed document. Server-rendered from the frozen snapshot. */
export default async function SignatureDetailPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const supabase = createClient();
  const { data: snap } = await supabase
    .from('document_snapshots')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!snap) notFound();

  const payload = (snap.payload ?? {}) as SnapPayload;
  const items = payload.items ?? [];
  const label = snap.kind === 'invoice' ? 'INVOICE' : 'ESTIMATE';
  const prefix = snap.kind === 'invoice' ? 'INV' : 'EST';
  const subtotal = items.reduce((s, it) => s + Number(it.amount), 0);
  const tip = Number(payload.tip ?? 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <div>
          <Link href="/signatures" className="text-sm text-gray-500 hover:text-brand-700">← Signed documents</Link>
          <h1 className="text-2xl">Signed copy — {label.toLowerCase()} #{prefix}{snap.doc_number}</h1>
          <p className="mt-1 text-sm text-gray-500">Archived record, frozen at the moment of signing. This copy cannot be edited.</p>
        </div>
        <PrintButton />
      </div>

      {/* The formal document */}
      <div className="card overflow-hidden !p-0" style={{ background: '#ffffff', color: '#1f2937' }}>
        <div className="flex items-center justify-between gap-4 px-6 py-5"
          style={{ background: 'linear-gradient(120deg, var(--brand-primary), var(--brand-accent))' }}>
          <div className="leading-tight text-white">
            <p className="text-lg font-extrabold tracking-wide">SANCHEZ</p>
            <p className="text-[11px] font-semibold tracking-[0.12em]" style={{ color: '#e6c2cf' }}>JUNK &amp; HAUL CO.</p>
            <p className="mt-0.5 text-[9px] tracking-[0.18em]" style={{ color: '#c98aa3' }}>{BIZ.tagline.toUpperCase()}</p>
          </div>
          <div className="text-right text-white">
            <p className="text-2xl font-extrabold tracking-wide">{label}</p>
            <p className="text-[11px] opacity-90">Number: #{prefix}{snap.doc_number}</p>
            {payload.created_at && (
              <p className="text-[11px] opacity-90">Date: {new Date(payload.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            )}
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="flex flex-wrap justify-between gap-4 text-sm">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>Prepared for:</p>
              <p className="font-bold">{snap.customer_name ?? 'Customer'}</p>
              {snap.customer_address && <p style={{ color: '#6b7280' }}>{snap.customer_address}</p>}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>Prepared by:</p>
              <p className="font-bold">{BIZ.name}</p>
              <p style={{ color: '#6b7280' }}>{BIZ.phone}</p>
              <p style={{ color: '#6b7280' }}>{BIZ.email}</p>
            </div>
          </div>

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
              {items.map((it, i) => (
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

          <div className="flex flex-col items-end gap-1.5 text-sm">
            <div className="flex w-full max-w-xs justify-between">
              <span style={{ color: '#6b7280' }}>SUBTOTAL</span>
              <span className="font-semibold">{money(subtotal)}</span>
            </div>
            {tip > 0 && (
              <div className="flex w-full max-w-xs justify-between">
                <span style={{ color: '#6b7280' }}>Tip</span>
                <span className="font-semibold">{money(tip)}</span>
              </div>
            )}
            <div className="mt-1 flex w-full max-w-xs items-center justify-between rounded px-4 py-2.5 text-white"
              style={{ background: 'linear-gradient(90deg, var(--brand-secondary), var(--brand-primary))' }}>
              <span className="font-bold tracking-wide">TOTAL</span>
              <span className="text-lg font-bold">{snap.total != null ? money(Number(snap.total)) : money(subtotal)}</span>
            </div>
          </div>

          {payload.payment_instructions && (
            <div className="rounded-lg p-3" style={{ background: '#f6f3f5' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>Payment instructions</p>
              <p className="mt-0.5 text-sm">{payload.payment_instructions}</p>
            </div>
          )}
          {payload.comments && <p className="text-sm" style={{ color: '#6b7280' }}>{payload.comments}</p>}
          {payload.notes && <p className="text-sm" style={{ color: '#6b7280' }}>{payload.notes}</p>}

          {/* Signature of record */}
          <div className="border-t pt-5" style={{ borderColor: '#ececec' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent)' }}>Signature of record</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
              <div>
                {snap.signature_data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={snap.signature_data} alt={`Signature of ${snap.signed_name}`}
                    className="h-20 w-auto" style={{ borderBottom: '1px solid #9ca3af' }} />
                ) : (
                  <p className="font-[cursive] text-2xl" style={{ borderBottom: '1px solid #9ca3af', paddingBottom: 2, minWidth: 200 }}>{snap.signed_name}</p>
                )}
                <p className="mt-1 text-xs" style={{ color: '#6b7280' }}>Signature</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold">{snap.signed_name}</p>
                <p style={{ color: '#6b7280' }}>
                  {new Date(snap.signed_at).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <p className="mt-4 text-[11px]" style={{ color: '#9ca3af' }}>
              This document was approved electronically via a secure signing link provided by {BIZ.name}.
              A tamper-proof copy of this record, including the signature above, is retained by {BIZ.name}. Record ID: {snap.id}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
