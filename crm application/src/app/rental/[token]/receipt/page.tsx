import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { DOC_CSS, resolveBiz, money, longDate, ymdLong } from '@/components/EstimateDocument';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Receipt — Sanchez Junk & Haul Co.', robots: { index: false, follow: false } };

type Charge = { id: string; type: string; amount: number; description: string | null; status: string; created_at: string; photo_urls: string[] | null; stripe_payment_intent_id: string | null; stripe_refund_id: string | null };
const FEES = ['late_fee', 'missing_item', 'damage', 'cleaning', 'adjustment', 'failed_trip', 'extension', 'reschedule_fee', 'expedited_pickup'];
const STATUS: Record<string, string> = { pending: 'Pending', succeeded: 'Charged', failed: 'Card declined', requires_action: 'Needs your bank OK', refunded: 'Refunded' };

/** PUBLIC (secure link per rental): the itemized receipt, same letterhead as estimates and invoices. Linked from every receipt text and email. */
export default async function RentalReceipt({ params }: { params: { token: string } }) {
  const db = createAdminClient();
  const { data: r } = db ? await db.rpc('rental_by_token', { p_token: params.token }) : { data: null };
  if (!db || !r) return <p style={{ padding: 24 }}>This receipt link is not valid.</p>;
  const [{ data: rows }, { data: bs }] = await Promise.all([
    db.from('rental_charges').select('id, type, amount, description, status, created_at, photo_urls, stripe_payment_intent_id, stripe_refund_id').eq('rental_id', r.id).neq('status', 'void').order('created_at'),
    db.from('business_settings').select('business_name, tagline, phone, email, website, service_area, licensed_insured, ein').eq('id', true).maybeSingle(),
  ]);
  const b = resolveBiz(bs ? { name: bs.business_name, tagline: bs.tagline, phone: bs.phone, email: bs.email, website: bs.website, area: bs.service_area, licensed_insured: bs.licensed_insured, ein: bs.ein } : null);
  const charges = (rows ?? []) as Charge[];
  const sign = async (path: string) => (await db.storage.from('documents').createSignedUrl(path, 3600)).data?.signedUrl ?? null;
  const photos = new Map<string, string[]>();
  for (const c of charges) if (c.photo_urls?.length) photos.set(c.id, (await Promise.all(c.photo_urls.map(sign))).filter((u): u is string => !!u));

  const refunds = charges.filter((c) => c.type === 'refund' && c.status === 'succeeded');
  const refundFor = (c: Charge) => refunds.filter((x) => c.stripe_refund_id && x.stripe_refund_id === c.stripe_refund_id).reduce((t, x) => t - Number(x.amount), 0);
  // a refund lowers the original row's amount (or marks it refunded); add it back to show what was actually charged
  const payments = charges.filter((c) => c.type !== 'refund' && c.stripe_payment_intent_id && ['succeeded', 'refunded'].includes(c.status))
    .map((c) => ({ ...c, gross: c.status === 'refunded' && Number(c.amount) > 0 ? Number(c.amount) : Number(c.amount) + refundFor(c) }));
  const fees = charges.filter((c) => FEES.includes(c.type));
  const paid = payments.reduce((t, c) => t + c.gross, 0);
  const refunded = refunds.reduce((t, c) => t - Number(c.amount), 0);
  const balance = Number(r.balance_due ?? 0);
  const cancelled = r.status === 'cancelled';
  const pkg = r.package ?? {};
  const items: { title: string; desc?: string; qty: number; amount: number }[] = [
    { title: `${pkg.name ?? 'Tote'} package`, desc: `${r.tote_count} heavy duty 27 gallon totes with lids, labels and markers · ${r.rental_days ?? pkg.rental_days_included ?? 14} days${Number(r.extra_weeks) > 0 ? ` (includes ${r.extra_weeks} extra week${Number(r.extra_weeks) > 1 ? 's' : ''})` : ''}`, qty: 1, amount: Number(r.subtotal) },
    ...((r.addons ?? []) as { name: string; qty: number; unit_price: number }[]).map((a) => ({ title: a.name, qty: Number(a.qty), amount: Number(a.qty) * Number(a.unit_price) })),
    { title: 'Delivery and pickup', desc: [r.zone, r.delivery_address].filter(Boolean).join(' · '), qty: 1, amount: Number(r.delivery_fee) },
    ...(Number(r.rush_fee) > 0 ? [{ title: 'Rush delivery', desc: 'Booked inside 48 hours of delivery', qty: 1, amount: Number(r.rush_fee) }] : []),
    ...(Number(r.tax_amount) > 0 ? [{ title: 'Michigan sales tax', desc: 'On supplies you keep', qty: 1, amount: Number(r.tax_amount) }] : []),
    ...(Number(r.discount_amount) > 0 ? [{ title: 'Discount', qty: 1, amount: -Number(r.discount_amount) }] : []),
  ];
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Detroit' });

  return (
    <div className="sjhc-sign">
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS + RECEIPT_CSS }} />
      <div className="sheet">
        <div className="util">{b.licensed_insured && <span><b>Licensed &amp; Insured</b></span>}<span>Sanchez Tote Rentals</span><span>Serving Metro Detroit</span></div>
        <div className="head">
          <div className="brandrow"><div className="mark" aria-hidden="true">{b.monogram}</div><div><div className="brandname">{b.name}</div>{b.tagline && <div className="tag">{b.tagline}</div>}</div></div>
          <div className="contact">{b.phone && <span><b>{b.phone}</b></span>}{b.email && <span>{b.email}</span>}{b.website && <span>{b.website}</span>}</div>
        </div>
        <div className="gradbar" />

        <div className="meta">
          <div>
            <div className="doctitle">Receipt</div>
            <div className="num"># {r.rental_number}</div>
            <div className={`status ${balance > 0 || cancelled ? 'st-open' : 'st-done'}`}>{cancelled ? 'Cancelled' : balance > 0 ? `Balance due ${money(balance)}` : 'Paid in full'}</div>
          </div>
          <div className="dates">
            <div className="k">Booked</div><div className="v">{longDate(r.created_at)}</div>
            <div className="k" style={{ marginTop: 8 }}>Rental</div><div className="v">{ymdLong(r.delivery_date)} to {ymdLong(r.pickup_date)}</div>
          </div>
        </div>

        <div className="billto">
          <div className="lbl">Billed to</div>
          <div className="name">{r.customer?.name ?? 'Customer'}</div>
          <div className="sub">{r.delivery_address}{r.pickup_address && r.pickup_address !== r.delivery_address ? ` → pickup at ${r.pickup_address}` : ''}</div>
          {r.card_last4 && <div className="sub">Card on file: {String(r.card_brand ?? '').toUpperCase()} ending {r.card_last4}</div>}
        </div>

        <div className="items">
          <table>
            <colgroup><col className="cdesc" /><col /><col /></colgroup>
            <thead><tr><th>Rental</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={i}><td><div className="it-title">{it.title}</div>{it.desc && <div className="it-desc">{it.desc}</div>}</td><td className="r qty">{it.qty}</td><td className="r amt">{it.amount < 0 ? `−${money(-it.amount)}` : money(it.amount)}</td></tr>
            ))}</tbody>
          </table>
        </div>

        {fees.length > 0 && <div className="items">
          <table>
            <colgroup><col className="cdesc" /><col /><col /></colgroup>
            <thead><tr><th>Charges after booking</th><th className="r">Status</th><th className="r">Amount</th></tr></thead>
            <tbody>{fees.map((c) => (
              <tr key={c.id}><td><div className="it-title">{(c.description ?? c.type).replace(/ \((in settlement|covered by deposit)\)$/, '')}</div><div className="it-desc">{fmt(c.created_at)}{photos.get(c.id)?.length ? <> · {photos.get(c.id)!.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="ph">photo {i + 1}</a>)}</> : null}</div></td>
                <td className="r qty">{/in settlement|covered by deposit/.test(c.description ?? '') ? 'Charged' : STATUS[c.status] ?? c.status}</td><td className="r amt">{money(Number(c.amount))}</td></tr>
            ))}</tbody>
          </table>
        </div>}

        <div className="items">
          <table>
            <colgroup><col className="cdesc" /><col /><col /></colgroup>
            <thead><tr><th>Payments and refunds</th><th className="r">Date</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {payments.map((c) => <tr key={c.id}><td><div className="it-title">{c.type === 'rental_payment' ? 'Rental payment' : (c.description ?? 'Payment').replace(/^Settlement after check-in.*/, 'Charges after pickup')}</div><div className="it-desc">{r.card_last4 ? `${String(r.card_brand ?? 'Card').toUpperCase()} ending ${r.card_last4}` : 'Card'}</div></td><td className="r qty">{fmt(c.created_at)}</td><td className="r amt">{money(c.gross)}</td></tr>)}
              {refunds.map((c) => <tr key={c.id}><td><div className="it-title">{c.description ?? 'Refund'}</div><div className="it-desc">Back to the original card, 5 to 10 business days</div></td><td className="r qty">{fmt(c.created_at)}</td><td className="r amt">−{money(-Number(c.amount))}</td></tr>)}
              {payments.length === 0 && refunds.length === 0 && <tr><td colSpan={3}><div className="it-desc">No payments yet.</div></td></tr>}
            </tbody>
          </table>
        </div>

        <div className="total-wrap">
          <div className="total">
            <div className="row"><span>Rental total</span><span>{money(Number(r.total))}</span></div>
            {fees.length > 0 && <div className="row"><span>Charges after booking</span><span>{money(fees.reduce((t, c) => t + Number(c.amount), 0))}</span></div>}
            <div className="row"><span>Paid</span><span>{money(paid)}</span></div>
            {refunded > 0 && <div className="row"><span>Refunded</span><span>−{money(refunded)}</span></div>}
            <div className="grand"><span className="k">{balance > 0 ? 'Balance due' : 'Total paid'}</span><span className="v">{money(balance > 0 ? balance : paid - refunded)}</span></div>
          </div>
        </div>

        <div className="terms">
          <div className="term"><h3>Questions about a charge?</h3><p>Call or text {b.phone}. Every charge after booking comes with a text first, and photos when it is for a missing, damaged or dirty item. Your signed rental agreement and the full terms are on your rental page.</p></div>
        </div>
        <div className="foot"><div className="g" />{[b.name, b.phone, b.website].filter(Boolean).join(' · ')} · Metro Detroit</div>
      </div>
      <div className="printbar no-print"><span>Save or print this page for your records.</span><a className="printbtn" href={`/rental/${params.token}`} style={{ textDecoration: 'none' }}>Back to your rental</a></div>
    </div>
  );
}

const RECEIPT_CSS = `.sjhc-sign .items+.items{padding-top:6px}.sjhc-sign .ph{color:#8d1d55;margin-right:8px}`;
