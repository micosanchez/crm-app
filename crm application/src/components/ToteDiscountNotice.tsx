'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { act } from '@/lib/rentals/client';

export type ToteDiscount = { rental_id: string; rental_number: string; status: string; eligible_until: string; redeemed_estimate_id: string | null; redeemed_estimate_number: number | string | null };

/** Staff-only: shows when the customer qualifies for the tote renter $25 off a $250+ junk job (no code; one use per rental). */
export default function ToteDiscountNotice({ d, estimateId, total }: { d: ToteDiscount | null; estimateId?: string; total?: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!d) return null;
  const usedHere = !!estimateId && d.redeemed_estimate_id === estimateId;
  const usedElsewhere = !!d.redeemed_estimate_id && !usedHere;
  const under = total != null && Number(total) < 250;
  const mark = async (undo = false) => { setBusy(true); setErr(null); try { await act('junk_discount_redeem', { rental_id: d.rental_id, estimate_id: estimateId, undo }); router.refresh(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="no-print card border-amber-300 bg-amber-50 text-sm">
      <p><b>Tote renter ({d.rental_number}).</b> $25 off a junk removal job of $250 or more, no code. Good through {d.eligible_until}{['delivered', 'out', 'pickup_scheduled'].includes(d.status) ? ' (rental is out now)' : ''}.</p>
      {usedElsewhere && <p className="text-red-700">Already used on <a className="underline" href={`/estimates/${d.redeemed_estimate_id}`}>quote #{d.redeemed_estimate_number}</a>. Not available again for this rental.</p>}
      {!usedElsewhere && under && !usedHere && <p className="text-gray-600">This quote is under $250, so the discount does not apply.</p>}
      {!usedElsewhere && estimateId && !usedHere && !under && <p className="mt-1"><span className="text-gray-600">Take $25 off the price, then </span><button className="underline" disabled={busy} onClick={() => mark()}>mark the discount used on this quote</button>.</p>}
      {usedHere && <p className="mt-1">Discount used on this quote. <button className="underline text-gray-500" disabled={busy} onClick={() => mark(true)}>undo</button></p>}
      {err && <p className="text-red-700">{err}</p>}
    </div>
  );
}
