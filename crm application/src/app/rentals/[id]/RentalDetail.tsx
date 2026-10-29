'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { act, uploadPhotos, money, prettyDate, STATUS_LABEL } from '@/lib/rentals/client';
import { DEFAULT_TEMPLATES } from '@/lib/rentals/templates';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

export default function RentalDetail({ rental: r, items, charges, agreement, events, addons, freeAssets, settings, messages, junk, testMode, testCards }: { rental: Any; items: Any[]; charges: Any[]; agreement: Any | null; events: Any[]; addons: Any[]; freeAssets: Any[]; settings: Any; messages: Any[]; junk: Any | null; testMode: boolean; testCards: { number: string; what: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const c = r.customers ?? {};
  const active = ['booked', 'delivered', 'out', 'pickup_scheduled'].includes(r.status);

  async function run(label: string, fn: () => Promise<unknown>, after?: (res: any) => string | void) {
    setBusy(label); setErr(null); setMsg(null);
    try { const res = await fn(); const m = after?.(res); if (m) setMsg(m); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }
  const ask = (q: string) => typeof window !== 'undefined' && window.confirm(q);

  // ---- delivery check-out ----
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [delPhotos, setDelPhotos] = useState<FileList | null>(null);
  const needTotes = r.tote_count - items.filter((i) => i.rental_assets?.asset_type === 'tote').length;
  const needDollies = r.dolly_count - items.filter((i) => i.rental_assets?.asset_type === 'dolly').length;
  const addTag = (t: string) => { const tag = t.trim().toUpperCase(); if (!tag) return; if (!freeAssets.some((a) => a.asset_tag === tag)) { setErr(`${tag} is not an available asset.`); return; } if (!tags.includes(tag)) setTags([...tags, tag]); setTagInput(''); setErr(null); };
  // one tap: take the lowest-numbered available totes so the driver just loads those numbers
  const fillTotes = () => { const have = tags.filter((t) => freeAssets.find((a) => a.asset_tag === t)?.asset_type === 'tote').length; const pick = freeAssets.filter((a) => a.asset_type === 'tote' && !tags.includes(a.asset_tag)).slice(0, Math.max(0, needTotes - have)).map((a) => a.asset_tag); setTags([...tags, ...pick]); setErr(null); };
  const scan = async () => {
    const BD = (window as any).BarcodeDetector;
    if (!BD) { setErr('Camera scanning needs Chrome on Android; on iPhone tap the tags instead.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video'); video.srcObject = stream; await video.play();
      const det = new BD({ formats: ['qr_code'] });
      const stop = () => stream.getTracks().forEach((t) => t.stop());
      const tick = async () => { const codes = await det.detect(video).catch(() => []); if (codes[0]?.rawValue) { addTag(String(codes[0].rawValue).split('/').pop() ?? ''); stop(); return; } setTimeout(tick, 250); };
      tick(); setTimeout(stop, 20000);
    } catch { setErr('Could not open the camera.'); }
  };
  // ---- pickup check-in ----
  const [cond, setCond] = useState<Record<string, { condition: string; files: FileList | null }>>({});
  const [lids, setLids] = useState(0);
  const outItems = items.filter((i) => !i.checked_in_at);

  const [customAmt, setCustomAmt] = useState(''); const [customDesc, setCustomDesc] = useState(''); const [customType, setCustomType] = useState('adjustment');
  const [refundAmt, setRefundAmt] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [resched, setResched] = useState({ delivery_date: r.delivery_date, delivery_window: r.delivery_window, pickup_date: r.pickup_date, pickup_window: r.pickup_window ?? '', customer_requested: false, expedited: false });
  const [tpl, setTpl] = useState('on_my_way'); const [custom, setCustom] = useState('');
  const windows = [...(settings?.slot_windows?.weekday ?? []), ...(settings?.slot_windows?.weekend ?? [])];
  // a request has no date yet: text two windows, then set the one the customer picked
  const [offer, setOffer] = useState('Hi, this is Mico with Sanchez Junk & Haul Co. For your tote rental, I can deliver [window 1] or [window 2]. Which works for you?');
  const [conf, setConf] = useState({ delivery_date: '', delivery_window: '' });

  return (
    <div className="space-y-4">
      <Link href="/rentals" className="btn-ghost inline-flex">← Back to rentals</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="panel-label">Rental · <Link href="/rentals" className="underline">board</Link></p><h1 className="text-2xl">{r.rental_number} · {c.name}</h1>
          <p className="text-sm text-gray-500">{STATUS_LABEL[r.status] ?? r.status}{r.rental_packages?.name ? ` · ${r.rental_packages.name}` : ''} · {r.tote_count} totes{r.dolly_count ? ` + ${r.dolly_count} dolly` : ''}{r.rental_partners ? ` · partner ${r.rental_partners.name} (${r.rental_partners.referral_code})` : ''}{r.lead_source ? ` · ${r.lead_source}` : ''}</p></div>
        <div className="flex flex-wrap gap-2">
          {c.phone && <a className="btn-ghost" href={`tel:${c.phone}`}>Call</a>}{c.phone && <a className="btn-ghost" href={`sms:${c.phone}`}>Text</a>}
          <a className="btn-ghost" href={`/rental/${r.public_token}`} target="_blank" rel="noreferrer">Customer page</a>
          <Link className="btn-ghost" href={`/rentals/${r.id}/evidence`}>Evidence packet</Link>
        </div>
      </div>
      {r.disputed_at && <div className="rounded-lg bg-red-50 p-3 text-red-800">Dispute opened {new Date(r.disputed_at).toLocaleString()}. Upload the <Link href={`/rentals/${r.id}/evidence`} className="underline">evidence packet</Link> to Stripe.</div>}
      {junk && <p className="badge bg-emerald-50 text-emerald-700">Junk quote requested · <Link href={`/estimates/requests/${junk.id}`} className="underline">request {junk.status}</Link></p>}
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}{msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p>}

      {r.status === 'awaiting_confirmation' && <section className="card space-y-2" style={{ border: '2px solid #f59e0b' }}>
        <p className="panel-label">Request · text delivery windows, then set the date</p>
        <p className="text-sm">Moving day <b>{prettyDate(r.move_date) || 'not given'}</b> · total due at pickup <b>{money(r.total)}</b>{r.notes_customer ? <> · {r.notes_customer}</> : null}</p>
        <textarea className="input" rows={2} value={offer} onChange={(e) => setOffer(e.target.value)} aria-label="Delivery windows text" />
        <button className="btn-ghost" disabled={!!busy || /\[window/.test(offer) || !c.phone} onClick={() => run('offer', () => act('send_text', { rental_id: r.id, content: offer }), (res: any) => `Sent: ${res.sent}`)}>Text these windows</button>
        <div className="grid grid-cols-2 gap-2"><input className="input" type="date" value={conf.delivery_date} onChange={(e) => setConf({ ...conf, delivery_date: e.target.value })} aria-label="Delivery date" /><select className="input" value={conf.delivery_window} onChange={(e) => setConf({ ...conf, delivery_window: e.target.value })} aria-label="Delivery window"><option value="">window</option>{windows.map((w: string) => <option key={w}>{w}</option>)}</select></div>
        <button className="btn-primary" disabled={!!busy || !conf.delivery_date || !conf.delivery_window} onClick={() => run('confirm', () => act('confirm_date', { rental_id: r.id, ...conf }), () => `Booked. Pickup set ${r.rental_days ?? 14} days after delivery; confirmation text sent.`)}>Confirm date &amp; reserve totes</button>
      </section>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <p className="panel-label">Schedule</p>
          <p><b>Deliver</b> {prettyDate(r.delivery_date)} {r.delivery_window} · <a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(r.delivery_address)}`} target="_blank" rel="noreferrer">{r.delivery_address}</a></p>
          <p><b>Pick up</b> {prettyDate(r.pickup_date)} {r.pickup_window ?? ''} · <a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(r.pickup_address ?? r.delivery_address)}`} target="_blank" rel="noreferrer">{r.pickup_address ?? r.delivery_address}</a></p>
          {r.actual_delivered_at && <p className="text-sm text-gray-500">Delivered {new Date(r.actual_delivered_at).toLocaleString()}</p>}{r.actual_picked_up_at && <p className="text-sm text-gray-500">Picked up {new Date(r.actual_picked_up_at).toLocaleString()}</p>}
          {r.notes_customer && <p className="text-sm"><b>Customer notes:</b> {r.notes_customer}</p>}
          {active && <details><summary className="cursor-pointer text-sm text-brand-700">Reschedule</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input className="input" type="date" value={resched.delivery_date} onChange={(e) => setResched({ ...resched, delivery_date: e.target.value })} /><select className="input" value={resched.delivery_window} onChange={(e) => setResched({ ...resched, delivery_window: e.target.value })}>{windows.map((w: string) => <option key={w}>{w}</option>)}</select>
              <input className="input" type="date" value={resched.pickup_date} onChange={(e) => setResched({ ...resched, pickup_date: e.target.value })} /><select className="input" value={resched.pickup_window} onChange={(e) => setResched({ ...resched, pickup_window: e.target.value })}><option value="">window</option>{windows.map((w: string) => <option key={w}>{w}</option>)}</select>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!resched.customer_requested} onChange={(e) => setResched({ ...resched, customer_requested: e.target.checked })} /> Customer asked for this change ({money(settings?.reschedule_fee_inside_window ?? 25)} if the delivery moves with under {settings?.cancel_full_refund_hours ?? 48} hours&apos; notice; a later pickup must use Extend)</label>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!resched.expedited} disabled={!resched.customer_requested} onChange={(e) => setResched({ ...resched, expedited: e.target.checked })} /> Expedited early pickup, special trip ({money(settings?.expedited_pickup_fee ?? 25)}). Leave off when it fits the normal route.</label>
              <button className="btn-primary col-span-2" disabled={!!busy} onClick={() => run('resched', async () => { const p: any = await act('reschedule', { rental_id: r.id, ...resched, preview: true }); const fee = Number(p?.preview?.total_fee ?? 0); if (!ask(fee > 0 ? `This charges the saved card ${money(fee)} (${p.preview.fees.map((f: any) => f.description).join('; ')}). Save?` : resched.customer_requested ? 'No fee for this change. Save?' : 'Company-side change: no fee, and any pending late weeks are voided. Save?')) return null; return act('reschedule', { rental_id: r.id, ...resched }); }, (res: any) => res ? 'Rescheduled. The customer gets a text with the new window.' : undefined)}>Save new dates</button></div></details>}
          {active && <div className="flex flex-wrap items-center gap-2 text-sm"><span>Extend</span><input className="input w-16" type="number" min={1} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /><button className="btn-ghost" disabled={!!busy} onClick={() => run('extend', () => act('extend', { rental_id: r.id, weeks }), (res: any) => res.ok ? `Extended to ${prettyDate(res.pickup_date)}, ${money(res.amount)} charged.` : res.error)}>week(s) · {money((r.rental_packages?.extra_week_price ?? 0) * weeks)}</button></div>}
          {['booked', 'awaiting_confirmation'].includes(r.status) && <button className="btn-ghost text-red-700" disabled={!!busy} onClick={() => run('cancel', async () => { const p: any = await act('cancel', { rental_id: r.id }); if (!ask(`${p.preview.full_refund ? 'Free cancellation' : `${money(p.preview.kept)} kept per policy`} (${money(p.preview.refund_amount)} back). Cancel ${r.rental_number}?`)) return null; return act('cancel', { rental_id: r.id, confirm: true, reason: 'cancelled by staff' }); }, (res: any) => res ? 'Cancelled.' : undefined)}>Cancel rental</button>}
        </section>

        <section className="card space-y-1 text-sm" id="move">
          <p className="panel-label">Move and junk lead</p>
          <p>Moving day <b>{r.move_date ?? 'not given'}</b> · {r.zone ?? 'zone ?'} · rental {r.rental_days ?? '?'} days{r.home_size ? ` · ${r.home_size}` : ''}{r.move_reason ? ` · ${String(r.move_reason).replace('_', ' ')}` : ''}</p>
          <p>Junk removal at checkout: <b>{r.junk_interest ?? 'not asked'}</b> · lead score <b>{r.lead_score ?? 0}/10</b> {Number(r.lead_score) >= 7 ? <span className="badge bg-red-50 text-red-700">text within the hour</span> : Number(r.lead_score) >= 4 ? <span className="badge bg-amber-50 text-amber-700">ask on pickup day</span> : null}{r.junk_request_id ? <> · <a className="underline" href={`/requests/${r.junk_request_id}`}>junk request</a></> : null}</p>
          <p className="text-gray-500">Marketing texts {r.marketing_sms_consent_at ? 'allowed' : 'not allowed'} · marketing email {r.marketing_email_consent_at ? 'allowed' : 'not allowed'} · junk removal discount $25 off $250+, no code, through 7 days after pickup{r.junk_discount_estimate_id ? <> · <b>used</b> on <a className="underline" href={`/estimates/${r.junk_discount_estimate_id}`}>this quote</a></> : ''}</p>
        </section>

        <section className="card space-y-2" id="payment">
          <p className="panel-label">Payment</p>
          {testMode && <p className="badge bg-amber-50 text-amber-700">Stripe TEST mode</p>}
          <p>Card on file: {r.card_last4 ? <b>{r.card_brand} •••• {r.card_last4} exp {r.card_exp}</b> : <span className="text-red-700">none</span>}</p>
          <p>Total {money(r.total)} · Deposit {money(r.deposit_amount)} <span className="badge">{r.deposit_status}</span>{Number(r.deposit_applied) > 0 ? ` (${money(r.deposit_applied)} applied)` : ''} · <b>Balance due {money(r.balance_due)}</b></p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy || Number(r.balance_due) <= 0 || !r.card_last4} onClick={() => run('bal', () => act('charge_balance', { rental_id: r.id }), (res: any) => res.ok ? 'Balance charged.' : res.requires_action ? 'Bank wants authentication; the customer was texted a secure link.' : `Declined: ${res.error}`)}>Charge balance</button>
            <button className="btn-ghost" disabled={!!busy || r.deposit_status !== 'held'} onClick={() => run('settle', () => ask('Apply the held deposit to what is owed and charge the rest?') ? act('settle', { rental_id: r.id }) : Promise.resolve(null), (res: any) => res ? 'Deposit applied.' : undefined)}>Apply deposit to balance</button>
            <button className="btn-ghost" disabled={!!busy || !r.card_last4} onClick={() => run('cardlink', () => act('update_card_link', { rental_id: r.id }), () => 'Secure update-card link texted.')}>Send update-card link</button>
          </div>
          {r.deposit_status === 'held' && <div className="flex items-center gap-2 text-sm"><span>Refund deposit</span><input className="input w-24" placeholder={String(r.deposit_amount)} value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} /><button className="btn-ghost" disabled={!!busy} onClick={() => { const dep = charges.find((x) => x.type === 'deposit' && x.status === 'succeeded'); if (!dep) { setErr('No deposit charge found.'); return; } run('refund', () => act('refund', { charge_id: dep.id, amount: refundAmt ? Number(refundAmt) : null, reason: 'deposit refund' }), () => 'Deposit refunded.'); }}>{refundAmt ? 'Partial' : 'Full'} refund</button></div>}
          <div className="grid grid-cols-3 gap-2 text-sm"><select className="input" value={customType} onChange={(e) => setCustomType(e.target.value)}>{['adjustment', 'late_fee', 'missing_item', 'damage', 'cleaning', 'failed_trip', 'extension', 'reschedule_fee', 'expedited_pickup'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select><input className="input" placeholder="$" value={customAmt} onChange={(e) => setCustomAmt(e.target.value)} /><input className="input" placeholder="Reason" value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} />
            <button className="btn-ghost col-span-3" disabled={!!busy || !customAmt || !customDesc} onClick={() => run('charge', () => act('charge', { rental_id: r.id, type: customType, amount: Number(customAmt), description: customDesc }), (res: any) => res.ok ? `Charged ${money(customAmt)}.` : res.requires_action ? 'Needs authentication; link texted.' : `Declined: ${res.error}`)}>Charge saved card</button></div>
          <table className="w-full text-sm"><tbody>{charges.map((x) => (<tr key={x.id} className="border-t"><td className="py-1">{new Date(x.created_at).toLocaleDateString()} · {x.description ?? x.type} <span className="badge">{x.status.replace('_', ' ')}</span>{x.failure_reason ? <span className="text-xs text-red-700"> {x.failure_reason}</span> : null}{x.payment_link_url && x.status !== 'succeeded' ? <> · <button className="underline" onClick={() => run('link', () => act('send_payment_link', { rental_id: r.id, charge_id: x.id }), () => 'Payment link texted.')}>text pay link</button></> : null}{x.status === 'succeeded' && x.type !== 'refund' && x.type !== 'deposit' ? <> · <button className="underline" onClick={() => { const a = prompt(`Refund how much of ${money(x.amount)}? (blank = full)`); if (a === null) return; run('refund', () => act('refund', { charge_id: x.id, amount: a ? Number(a) : null, reason: prompt('Reason?') ?? 'refund' }), () => 'Refunded.'); }}>refund</button></> : null}</td><td className="py-1 text-right">{money(x.amount)}</td></tr>))}</tbody></table>
          {testMode && <details className="text-xs text-gray-500"><summary className="cursor-pointer">Test cards</summary>{testCards.map((t) => <p key={t.number}><code>{t.number}</code> {t.what}</p>)}</details>}
        </section>
      </div>

      {['booked', 'delivered'].includes(r.status) && (needTotes > 0 || needDollies > 0) && <section className="card space-y-2">
        <p className="panel-label">Delivery check-out</p>
        <p className="text-sm text-gray-500">Assign {needTotes > 0 ? `${needTotes} totes` : ''}{needTotes > 0 && needDollies > 0 ? ' and ' : ''}{needDollies > 0 ? `${needDollies} dolly` : ''}. Tap tags or scan their QR label.</p>
        <div className="flex flex-wrap gap-1">{tags.map((t) => <button key={t} className="badge bg-brand-50" onClick={() => setTags(tags.filter((x) => x !== t))}>{t} ✕</button>)}</div>
        <div className="flex gap-2"><input className="input" list="free-assets" placeholder="T-001" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }} /><datalist id="free-assets">{freeAssets.map((a) => <option key={a.asset_tag} value={a.asset_tag}>{a.asset_type}</option>)}</datalist><button className="btn-ghost" onClick={() => addTag(tagInput)}>Add</button><button className="btn-ghost" onClick={scan}>Scan</button></div>
        {needTotes > 0 && <button className="btn-ghost w-full" onClick={fillTotes}>Fill the next {needTotes} available totes</button>}
        <div className="flex flex-wrap gap-1">{freeAssets.slice(0, 48).map((a) => <button key={a.asset_tag} className={`badge ${tags.includes(a.asset_tag) ? 'bg-brand-500 text-white' : 'bg-gray-100'}`} onClick={() => addTag(a.asset_tag)}>{a.asset_tag}</button>)}</div>
        <label className="block text-sm">Delivery photos <input type="file" accept="image/*" multiple capture="environment" onChange={(e) => setDelPhotos(e.target.files)} /></label>
        <button className="btn-primary btn-big w-full" disabled={!!busy || tags.length === 0} onClick={() => run('deliver', async () => { const photo_urls = delPhotos?.length ? await uploadPhotos(r.id, delPhotos, 'delivery') : []; return act('record_delivery', { rental_id: r.id, tags, photo_urls }); }, (res: any) => `Delivered. ${res.balance_charge?.ok ? 'Balance charged.' : res.balance_charge?.error ? `Balance not charged: ${res.balance_charge.error}` : ''}`)}>✓ Mark delivered</button>
        {active && <button className="btn-ghost text-red-700" onClick={() => run('ft', async () => { if (!ask(`Log a missed delivery? The first one is free and the customer is texted to pick a new time. After that the ${money(settings?.failed_trip_fee ?? 20)} trip fee is charged.`)) return null; const photo_urls = delPhotos?.length ? await uploadPhotos(r.id, delPhotos, 'failed-trip') : []; return act('failed_trip', { rental_id: r.id, kind: 'delivery', photo_urls }); }, (res: any) => res ? (res.free ? 'Missed delivery logged, no fee (first one). Customer texted to pick a new time.' : 'Missed delivery logged, trip fee charged. Customer texted.') : undefined)}>No one here / totes not ready</button>}
      </section>}

      {items.length > 0 && <section className="card space-y-2">
        <p className="panel-label">Items on this rental</p>
        <div className="flex flex-wrap gap-1">{items.map((i) => <span key={i.id} className="badge bg-gray-100">{i.rental_assets?.asset_tag} {i.return_condition ? `· ${i.return_condition}` : i.checked_out_at ? '· out' : ''}</span>)}</div>
        {items.some((i) => i.return_condition === 'missing') && <div className="flex gap-2 text-sm"><select className="input" id="found"><option value="">Found a missing item…</option>{items.filter((i) => i.return_condition === 'missing').map((i) => <option key={i.id} value={i.rental_assets.asset_tag}>{i.rental_assets.asset_tag}</option>)}</select><button className="btn-ghost" onClick={() => { const tag = (document.getElementById('found') as HTMLSelectElement).value; if (tag) run('found', () => act('found_item', { rental_id: r.id, tag }), () => `${tag} back in stock; replacement fee refunded.`); }}>Return found item</button></div>}
      </section>}

      {outItems.length > 0 && ['delivered', 'out', 'pickup_scheduled'].includes(r.status) && <section className="card space-y-2">
        <p className="panel-label">Pickup check-in</p>
        {outItems.map((i) => { const tag = i.rental_assets.asset_tag; const cur = cond[tag] ?? { condition: 'good', files: null }; return (
          <div key={i.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-t py-2 text-sm"><b>{tag}</b>
            <div className="flex gap-1">{['good', 'dirty', 'damaged', 'missing'].map((k) => <button key={k} className={`badge ${cur.condition === k ? 'bg-brand-500 text-white' : 'bg-gray-100'}`} onClick={() => setCond({ ...cond, [tag]: { ...cur, condition: k } })}>{k}</button>)}</div>
            {cur.condition !== 'good' ? <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setCond({ ...cond, [tag]: { ...cur, files: e.target.files } })} /> : <span />}</div>); })}
        <label className="flex items-center gap-2 border-t pt-2 text-sm">Missing lids <input className="input w-20" type="number" min={0} value={lids} onChange={(e) => setLids(Math.max(0, Number(e.target.value) || 0))} /> <span className="text-gray-500">{money(settings?.lid_fee ?? 6)} each</span></label>
        <button className="btn-primary btn-big w-full" disabled={!!busy} onClick={() => run('pickup', async () => { const list = []; for (const i of outItems) { const tag = i.rental_assets.asset_tag; const cur = cond[tag] ?? { condition: 'good', files: null }; const photo_urls = cur.files?.length ? await uploadPhotos(r.id, cur.files, `checkin-${tag}`) : []; list.push({ tag, condition: cur.condition, photo_urls }); } return act('record_pickup', { rental_id: r.id, items: list, missing_lids: lids }); }, (res: any) => `Picked up. ${res.review.lines.length} charge line(s) to review below.`)}>✓ Mark picked up</button>
        <button className="btn-ghost text-red-700" onClick={() => run('ft', async () => ask(`Log a missed pickup (totes not accessible) and charge the ${money(settings?.failed_trip_fee ?? 20)} re-trip fee?`) ? act('failed_trip', { rental_id: r.id, kind: 'pickup' }) : null, (res: any) => res ? 'Failed trip logged.' : undefined)}>No one here / totes not ready</button>
      </section>}

      {['returned', 'inspected'].includes(r.status) && <ChargesReview rentalId={r.id} charges={charges.filter((x) => ['pending', 'failed', 'requires_action'].includes(x.status))} balance={Number(r.balance_due)} deposit={r.deposit_status === 'held' ? Number(r.deposit_amount) : 0} busy={busy} run={run} />}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2"><p className="panel-label">Agreement</p>
          {agreement ? <><p className="text-sm">Signed by <b>{agreement.signer_name}</b> {new Date(agreement.signed_at).toLocaleString()} · terms v{agreement.terms_version} · IP {agreement.ip_address}</p>{agreement.pdf_signed_url ? <a className="btn-ghost" href={agreement.pdf_signed_url} target="_blank" rel="noreferrer">Download signed PDF</a> : <p className="text-xs text-gray-500">PDF not generated.</p>}<details><summary className="cursor-pointer text-sm">Terms as signed</summary><pre className="whitespace-pre-wrap text-xs">{agreement.terms_snapshot}</pre></details></> : <p className="text-sm text-red-700">Not signed yet.</p>}</section>
        <section className="card space-y-2"><p className="panel-label">Text the customer</p>
          <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}>{Object.entries(DEFAULT_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="">Custom…</option></select>
          {!tpl && <textarea className="input" rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="No prices in texts." />}
          <button className="btn-primary" disabled={!!busy || (!tpl && !custom.trim())} onClick={() => run('sms', () => act('send_text', { rental_id: r.id, template: tpl || undefined, content: tpl ? undefined : custom }), (res: any) => `Sent: ${res.sent}`)}>Send text now</button>
          <p className="text-xs text-gray-500">SMS consent: {r.sms_consent_at ? 'yes' : 'no (automated texts are skipped)'}. Automated messages: {messages.filter((m) => m.status === 'queued').length} queued, {messages.filter((m) => m.status === 'sent').length} sent.</p>
          <details><summary className="cursor-pointer text-xs">Message log</summary>{messages.map((m, i) => <p key={i} className="text-xs text-gray-500">{m.channel} {m.template} · {m.status} · {new Date(m.sent_at ?? m.scheduled_at).toLocaleString()}{m.error ? ` · ${m.error}` : ''}</p>)}</details>
        </section>
      </div>

      <section className="card"><p className="panel-label">Notes & log</p>
        <NotesEditor rentalId={r.id} value={r.notes_internal ?? ''} />
        <details className="mt-2"><summary className="cursor-pointer text-sm">Events ({events.length})</summary>{events.map((e) => <p key={e.id} className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()} · {e.event} {Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail) : ''}</p>)}</details>
        <p className="mt-2 text-xs text-gray-400">Add-ons: {addons.map((a) => `${a.qty} × ${a.rental_addons?.name}`).join(', ') || 'none'} · Lead source {r.lead_source ?? 'unknown'} · Created {new Date(r.created_at).toLocaleString()}</p>
      </section>
    </div>
  );
}

function ChargesReview({ rentalId, charges, balance, deposit, busy, run }: { rentalId: string; charges: Any[]; balance: number; deposit: number; busy: string | null; run: (l: string, fn: () => Promise<unknown>, after?: (r: any) => string | void) => void }) {
  const [edit, setEdit] = useState<Record<string, { amount: string; description: string }>>({});
  const [adj, setAdj] = useState({ amount: '', description: '' });
  return (
    <section className="card space-y-2"><p className="panel-label">Charges review</p>
      <table className="w-full text-sm"><tbody>
        {charges.map((x) => { const e = edit[x.id] ?? { amount: String(x.amount), description: x.description ?? '' }; return (<tr key={x.id} className="border-t"><td className="py-1"><input className="input" value={e.description} onChange={(ev) => setEdit({ ...edit, [x.id]: { ...e, description: ev.target.value } })} />{x.photo_urls?.length ? <span className="text-xs text-gray-500"> {x.photo_urls.length} photo(s)</span> : null}</td><td className="w-24 py-1"><input className="input" value={e.amount} onChange={(ev) => setEdit({ ...edit, [x.id]: { ...e, amount: ev.target.value } })} /></td><td className="py-1 text-right"><button className="underline" onClick={() => run('line', () => act('update_line', { rental_id: rentalId, charge_id: x.id, amount: Number(e.amount), description: e.description }))}>save</button> · <button className="underline text-red-700" onClick={() => run('line', () => act('update_line', { rental_id: rentalId, charge_id: x.id, remove: true, description: x.description }))}>remove</button></td></tr>); })}
        <tr className="border-t"><td className="py-1"><input className="input" placeholder="Custom adjustment reason" value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.target.value })} /></td><td className="w-24 py-1"><input className="input" placeholder="$" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></td><td className="py-1 text-right"><button className="underline" disabled={!adj.amount || !adj.description} onClick={() => run('add', () => act('add_line', { rental_id: rentalId, amount: Number(adj.amount), description: adj.description }), () => { setAdj({ amount: '', description: '' }); })}>add</button></td></tr>
      </tbody></table>
      <p className="text-sm">Owed <b>{money(balance)}</b> · deposit held {money(deposit)} → {deposit >= balance ? `deposit covers it, ${money(deposit - balance)} refunded` : `${money(balance - deposit)} charged to the saved card`}</p>
      <button className="btn-primary btn-big w-full" disabled={!!busy} onClick={() => run('settle', () => act('settle', { rental_id: rentalId }), (res: any) => res.charge?.ok ? 'Settled. Receipt with photos sent.' : res.charge?.requires_action ? 'Deposit applied; the remainder needs authentication, link texted.' : `Deposit applied; card declined: ${res.charge?.error ?? ''}`)}>Settle: apply deposit, charge the rest</button>
    </section>
  );
}

function NotesEditor({ rentalId, value }: { rentalId: string; value: string }) {
  const [v, setV] = useState(value); const [saved, setSaved] = useState(false);
  return (<div className="flex gap-2"><textarea className="input" rows={2} value={v} onChange={(e) => { setV(e.target.value); setSaved(false); }} placeholder="Internal notes (never shown to the customer)" /><button className="btn-ghost" onClick={async () => { await act('update', { rental_id: rentalId, notes_internal: v }); setSaved(true); }}>{saved ? 'Saved' : 'Save'}</button></div>);
}
