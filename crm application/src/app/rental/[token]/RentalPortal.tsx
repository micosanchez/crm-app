'use client';
import { useEffect, useState } from 'react';
import { TOTE_CSS, JunkCallout, junkLink } from '@/components/ToteBrand';

type View = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const money = (n: number | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const pretty = (ymd: string | null) => ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
const STATUS: Record<string, string> = { pending_payment: 'Checkout not finished', awaiting_confirmation: 'Request received: we will text you delivery windows', expired: 'Request expired', booked: 'Booked', delivered: 'Totes delivered', out: 'Totes out', pickup_scheduled: 'Pickup scheduled', returned: 'Picked up', inspected: 'Checked in', closed: 'Closed', cancelled: 'Cancelled' };

export default function RentalPortal({ token }: { token: string }) {
  const [r, setR] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const [newPickup, setNewPickup] = useState('');
  const [newDelivery, setNewDelivery] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => fetch(`/api/public/rentals/me?token=${token}`).then((x) => x.json()).then((d) => (d.error ? setErr(d.error) : setR(d)));
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(null); setMsg(null);
    const d = await fetch('/api/public/rentals/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, ...extra }) }).then((x) => x.json());
    setBusy(false);
    if (d.error) { setErr(d.error); return d; }
    await load();
    return d;
  }

  if (err && !r) return <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} /><div className="wrap"><div className="err">{err}</div></div></div>;
  if (!r) return <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} /><div className="wrap"><div className="skel" /><div className="skel" /></div></div>;
  const active = ['booked', 'delivered', 'out', 'pickup_scheduled'].includes(r.status);
  const junk = junkLink({ rental: r.rental_number, name: r.customer?.name, phone: r.customer?.phone, email: r.customer?.email, address: r.pickup_address });
  const canCancel = ['booked', 'awaiting_confirmation'].includes(r.status);

  return (
    <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} />
      <div className="wrap">
        <p className="pill">Sanchez Junk &amp; Haul Co. Totes</p>
        <h1 className="grad-text">Rental {r.rental_number}</h1>
        <p className="muted">{STATUS[r.status] ?? r.status} · {r.customer?.name}</p>
        {err && <div className="err">{err}</div>}{msg && <div className="ok">{msg}</div>}
        <div className="card"><table><tbody>
          <tr><td>Delivery</td><td>{r.delivery_date ? `${pretty(r.delivery_date)} ${r.delivery_window ?? ''}` : 'We text you delivery windows to pick from'}</td></tr>
          <tr><td>Pickup</td><td>{r.pickup_date ? `${pretty(r.pickup_date)} ${r.pickup_window ?? ''}` : `${r.rental_days ?? 14} days after delivery`}</td></tr>
          <tr><td>Deliver to</td><td style={{ whiteSpace: 'normal' }}>{r.delivery_address}</td></tr>
          {r.pickup_address !== r.delivery_address && <tr><td>Pick up at</td><td style={{ whiteSpace: 'normal' }}>{r.pickup_address}</td></tr>}
          <tr><td>Totes</td><td>{r.tote_count}{r.dolly_count ? ` + ${r.dolly_count} dolly` : ''}</td></tr>
          <tr><td>Total</td><td>{money(r.total)}</td></tr>
          {Number(r.deposit_amount) > 0 && <tr><td>Deposit ({r.deposit_status})</td><td>{money(r.deposit_amount)}</td></tr>}
          <tr><td>Balance due</td><td>{money(r.balance_due)}</td></tr>
          {r.card_last4 && <tr><td>Card on file</td><td>{r.card_brand} •••• {r.card_last4} (exp {r.card_exp})</td></tr>}
        </tbody></table></div>

        {active && <div className="card"><h3>Need more time?</h3>
          <div className="row"><div className="stepper"><button type="button" onClick={() => setWeeks(Math.max(1, weeks - 1))}>−</button><span>{weeks}</span><button type="button" onClick={() => setWeeks(Math.min(8, weeks + 1))}>+</button></div>
            <button className="btn sm" disabled={busy} onClick={async () => { const d = await act('extend', { weeks }); if (d?.ok) setMsg(`Extended. New pickup ${pretty(d.pickup_date)}.`); }}>Extend {weeks} week{weeks > 1 ? 's' : ''}{r.package?.extra_week_price ? ` (${money(r.package.extra_week_price * weeks)})` : ''}</button></div>
          <p className="muted">Charged to your card on file, if the totes are free. There is no grace period: if the totes are not ready by your pickup date, the next week is billed at this rate.</p></div>}

        {['delivered', 'out', 'pickup_scheduled'].includes(r.status) && <div className="card"><h3>Done early?</h3>
          <div className="row"><input type="date" value={newPickup} min={r.delivery_date} max={r.pickup_date} onChange={(e) => setNewPickup(e.target.value)} aria-label="Early pickup date" /><button className="btn sm" disabled={busy || !newPickup} onClick={async () => { const d = await act('request_early_pickup', { pickup_date: newPickup }); if (d?.ok) setMsg('Request sent. We will text you to confirm the pickup time.'); }}>Request early pickup</button></div>
          <p className="muted">If we can fit it into our normal schedule there&apos;s no charge. An expedited pickup that needs a special trip is {money(r.settings?.expedited_pickup_fee ?? 25)}, subject to availability, and we confirm with you first. Returning early does not give a partial refund.</p></div>}

        {r.status === 'booked' && <div className="card"><h3>Change your delivery date</h3>
          <div className="row"><input type="date" value={newDelivery} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setNewDelivery(e.target.value)} aria-label="New delivery date" /><button className="btn sm" disabled={busy || !newDelivery} onClick={async () => { const d = await act('request_delivery_change', { delivery_date: newDelivery }); if (d?.ok) setMsg(Number(d.fee) > 0 ? `Request sent. Because it is under ${r.settings?.cancel_full_refund_hours ?? 48} hours before your delivery, a ${money(d.fee)} change fee applies once we confirm the new date.` : 'Request sent, no fee. We will text you to confirm the new date and window.'); }}>Request change</button></div>
          <p className="muted">Free with at least {r.settings?.cancel_full_refund_hours ?? 48} hours&apos; notice before your delivery window. With less notice the change fee is {money(r.settings?.reschedule_fee_inside_window ?? 25)}.</p></div>}

        {r.card_last4 && active && <a className="btn ghost" href={`/rental/${token}/card`}>Update the card on file</a>}

        {canCancel && <div className="card"><h3>Cancel</h3><p className="muted">Free with at least {r.settings?.cancel_full_refund_hours ?? 48} hours&apos; notice before your delivery window. With less notice a {money(r.settings?.cancel_fee_inside_window ?? 25)} cancellation fee is kept and the rest is refunded.</p>
          <button className="btn ghost sm" disabled={busy} onClick={async () => { const p = await act('cancel'); if (p?.preview && confirm(`${p.preview.full_refund ? 'Free cancellation' : `${money(p.preview.kept)} cancellation fee`}: ${money(p.preview.refund_amount)} back to your card. Cancel this rental?`)) { const d = await act('cancel', { confirm: true }); if (d?.ok) setMsg('Cancelled. Any refund lands in 5 business days.'); } }}>Cancel rental</button></div>}

        {r.items?.length > 0 && <div className="card"><h3>Your items</h3><p className="muted">{r.items.map((i: { tag: string; condition: string | null }) => `${i.tag}${i.condition ? ` (${i.condition})` : ''}`).join(', ')}</p></div>}

        <div className="card" id="receipts"><h3>Receipts</h3><p><a className="btn ghost sm" href={`/rental/${token}/receipt`}>View your full receipt</a></p>
          {r.charges?.length ? <table><tbody>{r.charges.map((c: { id: string; type: string; description: string | null; amount: number; status: string; created_at: string; photo_urls: string[]; payment_link_url: string | null }) => (
            <tr key={c.id}><td style={{ whiteSpace: 'normal' }}>{new Date(c.created_at).toLocaleDateString('en-US', { timeZone: 'America/Detroit' })} · {c.description ?? c.type} <span className="pill">{c.status.replace(/_/g, ' ')}</span>{c.photo_urls?.length ? <> · {c.photo_urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer">photo {i + 1} </a>)}</> : null}{c.payment_link_url && c.status !== 'succeeded' ? <> · <a href={c.payment_link_url}>pay securely</a></> : null}</td><td>{money(c.amount)}</td></tr>))}</tbody></table> : <p className="muted">No charges yet.</p>}</div>

        {r.agreement && <div className="card"><h3>Signed agreement</h3><p className="muted">Signed by {r.agreement.signer_name} on {new Date(r.agreement.signed_at).toLocaleString('en-US', { timeZone: 'America/Detroit' })} (terms v{r.agreement.terms_version}).</p>{r.agreement.pdf_url && <a className="btn ghost sm" href={r.agreement.pdf_url} target="_blank" rel="noreferrer">Download PDF</a>}</div>}

        {r.status !== 'closed' && <JunkCallout href={junk} />}
        <p className="muted">Questions? Call or text <a href="sms:+17345378061">(734) 537-8061</a>.</p>
      </div>
    </div>
  );
}
