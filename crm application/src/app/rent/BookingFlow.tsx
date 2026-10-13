'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SignaturePad from '@/components/SignaturePad';
import { TOTE_CSS, JunkCallout, junkLink } from '@/components/ToteBrand';
import { HEARD_ABOUT_US } from '@/lib/requests';

type Pkg = { id: string; name: string; description: string | null; tote_count: number; rental_days_included: number; price: number; extra_week_price: number | null; deposit_amount: number | null };
type Addon = { id: string; name: string; asset_type: string; price: number; per: string; max_qty: number };
type Catalog = { packages: Pkg[]; addons: Addon[]; settings: Record<string, any>; slot_counts: Record<string, number>; availability: { day: string; totes_free: number; dollies_free: number }[]; today: string; stripe: { publishable_key: string; test_mode: boolean } }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Quote = { error?: string; total?: number; deposit?: number; balance?: number; subtotal?: number; addons_total?: number; delivery_fee?: number; discount?: number; delivery_miles?: number; pickup_miles?: number; rental_days?: number; tote_count?: number; dolly_count?: number; delivery_geo?: string; pickup_geo?: string; balance_charge_mode?: string; addons?: { name: string; qty: number; line: number }[] };

const PHONE = '(734) 537-8061';
const money = (n: number | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pretty = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Meta pixel / Google Ads conversion. Fires in the parent site when embedded, locally when standalone.
function fireConversion(detail: Record<string, unknown>) {
  try {
    const w = window as unknown as { fbq?: (...a: unknown[]) => void; gtag?: (...a: unknown[]) => void; parent?: Window };
    w.fbq?.('trackCustom', 'tote_booking', detail);
    w.gtag?.('event', 'conversion', { send_to: 'tote_booking', ...detail });
    if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'tote_booking', ...detail }, '*');
  } catch { /* tracking must never break booking */ }
}

export default function BookingFlow({ initial }: { initial: { package: string | null; date: string | null; embed: boolean; resume: string | null; token: string | null; promo: string | null; utm: Record<string, string | null> } }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [step, setStep] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pkgId, setPkgId] = useState<string | null>(initial.package);
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [addr, setAddr] = useState('');
  const [pickupDiff, setPickupDiff] = useState(false);
  const [pickupAddr, setPickupAddr] = useState('');
  const [promo, setPromo] = useState((initial.promo ?? '').toUpperCase());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [date, setDate] = useState<string | null>(initial.date);
  const [win, setWin] = useState('');
  const [pickupWin, setPickupWin] = useState('');
  const [month, setMonth] = useState<string>(() => (initial.date ?? new Date().toISOString().slice(0, 10)).slice(0, 7));
  const [contact, setContact] = useState({ name: '', phone: '', email: '', heard: '', notes: '', sms: false, payer: false, payer_name: '', payer_email: '' });
  const [hold, setHold] = useState<{ rental_id: string; public_token: string; rental_number: string } | null>(null);
  const [terms, setTerms] = useState<{ text: string; version: number } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [pay, setPay] = useState<{ kind: 'payment' | 'setup'; client_secret: string; intent_id: string; amount: number; publishable_key: string } | null>(null);
  const [done, setDone] = useState<{ rental_number: string; token: string } | null>(null);
  const [waitlist, setWaitlist] = useState(false);
  const stripeRef = useRef<{ stripe: any; elements: any } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const leadSource = useMemo(() => {
    const s = (initial.utm.source ?? initial.utm.ref ?? '').toLowerCase();
    if (initial.utm.fbclid || /facebook|fb|meta|instagram/.test(s)) return 'meta_ads';
    if (initial.utm.gclid || /google/.test(s)) return 'google_ads';
    if (/nextdoor/.test(s)) return 'nextdoor';
    return 'website_direct';
  }, [initial.utm]);

  useEffect(() => {
    fetch('/api/public/rentals/catalog').then((r) => r.json()).then((c: Catalog) => { setCat(c); if (!pkgId && c.packages?.length === 1) setPkgId(c.packages[0].id); }).catch(() => setErr('Could not load packages. Please refresh.'));
    // resume an abandoned booking: prefill from the public view of the expired hold
    if (initial.resume) fetch(`/api/public/rentals/me?token=${initial.resume}`).then((r) => r.json()).then((d) => {
      if (!d || d.error) return;
      // a hold Mico made over the phone is still live: skip straight to sign and pay
      if (d.status === 'pending_payment' && Date.now() - new Date(d.created_at).getTime() < 25 * 60_000) {
        setHold({ rental_id: d.id, public_token: initial.resume!, rental_number: d.rental_number });
        fetch(`/api/public/rentals/sign?token=${initial.resume}`).then((x) => x.json()).then(setTerms);
        setStep(6); return;
      }
      setAddr(d.delivery_address ?? ''); if (d.pickup_address && d.pickup_address !== d.delivery_address) { setPickupDiff(true); setPickupAddr(d.pickup_address); }
      setDate(d.delivery_date); setWin(d.delivery_window ?? ''); setMonth(String(d.delivery_date).slice(0, 7));
      setContact((c) => ({ ...c, name: d.customer?.name ?? '', phone: d.customer?.phone ?? '', email: d.customer?.email ?? '', notes: d.notes_customer ?? '', sms: !!d.sms_consent }));
    }).catch(() => {});
    // embedded on sanchezhaulco.com: tell the parent page how tall we are so the iframe never scrolls inside
    if (initial.embed && window.parent !== window) {
      // min-height is dropped in embed mode (see style below) so the content height never depends on the iframe height; otherwise this loops
      let last = 0;
      const post = () => { const h = document.body.scrollHeight; if (Math.abs(h - last) > 2) { last = h; window.parent.postMessage({ type: 'sjhc_rent_height', height: h }, '*'); } };
      const ro = new ResizeObserver(post); ro.observe(document.body); post();
    }
    // back from a 3D Secure redirect
    const q = new URLSearchParams(window.location.search);
    const pi = q.get('payment_intent') ?? q.get('setup_intent');
    if (initial.token && pi) { setStep(7); confirmWith(initial.token, pi, q.get('setup_intent') ? 'setup' : 'payment'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pkg = cat?.packages.find((p) => p.id === pkgId) ?? null;
  const s = cat?.settings ?? {};
  const totes = pkg?.tote_count ?? 0;
  const dollies = Object.entries(addons).reduce((n, [id, q]) => n + (cat?.addons.find((a) => a.id === id)?.asset_type === 'dolly' ? q : 0), 0);
  const rentalDays = (pkg?.rental_days_included ?? 14) + extraWeeks * 7;
  const turnaround = Number(s.turnaround_days ?? 1);
  const leadHours = Number(s.booking_lead_time_hours ?? 24);
  const availMap = useMemo(() => new Map((cat?.availability ?? []).map((d) => [d.day, d])), [cat]);
  const minDate = useMemo(() => { const d = new Date(Date.now() + leadHours * 3600_000); return new Date(d.toLocaleString('en-US', { timeZone: 'America/Detroit' })).toISOString().slice(0, 10); }, [leadHours]);

  const dateOk = useCallback((ymd: string) => {
    if (!cat || ymd < minDate) return false;
    const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
    if (!(s.service_days ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow)) return false;
    if ((s.blackout_dates ?? []).includes(ymd)) return false;
    for (let i = 0; i <= rentalDays + turnaround; i++) { const a = availMap.get(addDays(ymd, i)); if (!a) return i > 89; if (a.totes_free < totes || a.dollies_free < dollies) return false; }
    return true;
  }, [cat, minDate, s, rentalDays, turnaround, availMap, totes, dollies]);

  const windowsFor = (ymd: string) => { const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); const w = s.slot_windows ?? {}; return (dow === 0 || dow === 6 ? w.weekend : w.weekday) ?? []; };
  const slotFull = (ymd: string, w: string) => (cat?.slot_counts?.[`${ymd}|${w}`] ?? 0) >= Number(s.max_bookings_per_slot ?? 3);

  async function getQuote() {
    setErr(null); setBusy(true);
    const r = await fetch('/api/public/rentals/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package_id: pkgId, extra_weeks: extraWeeks, addons: Object.entries(addons).filter(([, q]) => q > 0).map(([addon_id, qty]) => ({ addon_id, qty })), delivery_address: addr, pickup_address: pickupDiff ? pickupAddr : undefined, promo_code: promo || undefined }) }).then((x) => x.json() as Promise<Quote>);
    setBusy(false);
    if (r.error === 'address_not_found' || r.error === 'pickup_address_not_found') { setErr(`We couldn't find that ${r.error.startsWith('pickup') ? 'pickup ' : ''}address. Try adding the city and ZIP.`); return false; }
    if (r.error === 'out_of_area') { setErr(`That address is outside our delivery area right now. Call or text ${PHONE} and we'll see what we can do.`); return false; }
    if (r.error) { setErr(r.error); return false; }
    setQuote(r); return true;
  }

  async function createHold() {
    setErr(null); setBusy(true);
    const body = { package_id: pkgId, extra_weeks: extraWeeks, addons: Object.entries(addons).filter(([, q]) => q > 0).map(([addon_id, qty]) => ({ addon_id, qty })), delivery_address: addr, pickup_address: pickupDiff ? pickupAddr : null, promo_code: promo || null,
      delivery_date: date, delivery_window: win, pickup_window: pickupWin || win, name: contact.name, phone: contact.phone, email: contact.email, lead_source: contact.heard ? heardToSource(contact.heard, leadSource) : leadSource,
      notes_customer: contact.notes, sms_consent: contact.sms, payer_name: contact.payer ? contact.payer_name : null, payer_email: contact.payer ? contact.payer_email : null, website: '' };
    const r = await fetch('/api/public/rentals/hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    setBusy(false);
    if (r.error === 'sold_out') { setErr('Those dates just filled up. Pick another date, or join the waitlist and we will text you when totes free up.'); setWaitlist(true); setStep(3); return; }
    if (r.error === 'slot_full') { setErr('That delivery window is full. Pick another window.'); setStep(3); return; }
    if (r.error) { setErr(r.error); return; }
    setHold(r);
    const t = await fetch(`/api/public/rentals/sign?token=${r.public_token}`).then((x) => x.json());
    setTerms(t);
    setStep(6);
  }

  async function sign(name: string, dataUrl: string) {
    if (!hold) return;
    setErr(null); setBusy(true);
    const r = await fetch('/api/public/rentals/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: hold.public_token, name, signature: dataUrl, agreed }) }).then((x) => x.json());
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setSigned(true);
    await startPayment();
  }

  async function startPayment() {
    if (!hold) return;
    setErr(null); setBusy(true);
    const p = await fetch('/api/public/rentals/payment-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: hold.public_token, payer_name: contact.payer ? contact.payer_name : undefined, payer_email: contact.payer ? contact.payer_email : undefined }) }).then((x) => x.json());
    setBusy(false);
    if (p.error) { setErr(p.error); return; }
    setPay(p); setStep(7);
  }

  // Stripe Payment Element (cards, Apple Pay, Google Pay). Loaded from js.stripe.com, no npm dependency.
  useEffect(() => {
    if (step !== 7 || !pay) return;
    let cancelled = false;
    const mount = () => {
      const w = window as unknown as { Stripe?: (k: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!w.Stripe || cancelled) return;
      const stripe = w.Stripe(pay.publishable_key);
      const elements = stripe.elements({ clientSecret: pay.client_secret, appearance: { theme: 'night', variables: { colorPrimary: '#c81d3c', fontFamily: 'Barlow Condensed, system-ui, sans-serif', borderRadius: '10px' } } });
      elements.create('payment', { layout: 'tabs' }).mount('#payment-element');
      stripeRef.current = { stripe, elements };
    };
    if ((window as unknown as { Stripe?: unknown }).Stripe) mount();
    else { const sc = document.createElement('script'); sc.src = 'https://js.stripe.com/v3/'; sc.onload = mount; document.head.appendChild(sc); }
    return () => { cancelled = true; };
  }, [step, pay]);

  async function submitPayment() {
    if (!stripeRef.current || !pay || !hold) return;
    setErr(null); setBusy(true);
    const { stripe, elements } = stripeRef.current;
    const return_url = `${window.location.origin}/rent?token=${hold.public_token}${initial.embed ? '&embed=1' : ''}`;
    const fn = pay.kind === 'setup' ? stripe.confirmSetup : stripe.confirmPayment;
    const res = await fn.call(stripe, { elements, confirmParams: { return_url, receipt_email: contact.email || undefined }, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message ?? 'The card was declined. Try another card.'); return; }
    const intent = res.paymentIntent ?? res.setupIntent;
    await confirmWith(hold.public_token, intent?.id ?? pay.intent_id, pay.kind);
  }

  async function confirmWith(token: string, intentId: string, kind: 'payment' | 'setup') {
    setBusy(true);
    const r = await fetch('/api/public/rentals/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, intent_id: intentId, kind }) }).then((x) => x.json());
    setBusy(false);
    if (r.error) { setErr(r.error); setStep(7); return; }
    setDone({ rental_number: r.rental_number, token: r.token });
    if (!r.already) fireConversion({ rental_number: r.rental_number, value: Number(r.total ?? 0), currency: 'USD' });
    setStep(8);
  }

  async function joinWaitlist() {
    if (!date || !contact.name || !contact.phone) { setErr('Add your name and phone so we can text you.'); return; }
    setBusy(true);
    const r = await fetch('/api/public/rentals/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: contact.name, phone: contact.phone, email: contact.email, start_date: date, end_date: addDays(date, rentalDays), tote_count: totes }) }).then((x) => x.json());
    setBusy(false);
    if (r.error) setErr(r.error); else { setWaitlist(false); setErr(null); alert("You're on the list. We'll text the first person when totes open up for those dates."); }
  }

  const steps = ['Package', 'Address', 'Dates', 'Contact', 'Review', 'Sign', 'Pay', 'Done'];
  const junk = junkLink({ rental: hold?.rental_number ?? done?.rental_number, name: contact.name, phone: contact.phone, email: contact.email, address: pickupDiff ? pickupAddr : addr });

  return (
    <div className="tote">
      <style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} />
      {initial.embed && <style>{`.tote{min-height:0}.tote .sticky{position:static;padding:12px 0;background:none;border:0;backdrop-filter:none}`}</style>}
      <div className="wrap">
        {!initial.embed && (<header style={{ marginBottom: 8 }}><p className="pill">Sanchez Junk &amp; Haul Co.</p><h1 className="grad-text">Rent moving totes</h1><p className="muted">Delivered to your door. Picked up when you&apos;re done. {cat?.stripe.test_mode ? <span className="pill">test mode</span> : null}</p></header>)}
        <div className="progress" aria-label={`Step ${step} of 8: ${steps[step - 1]}`}>{steps.map((_, i) => <i key={i} className={i < step ? 'on' : ''} />)}</div>
        {err && <div className="err" role="alert">{err}</div>}
        {!cat && <><div className="skel" /><div className="skel" /><div className="skel" /></>}

        {cat && step === 1 && (<section>
          <h2>1. Pick your package</h2>
          {cat.packages.length === 0 && <p className="muted">Packages are being set up. Call or text {PHONE} to book.</p>}
          {cat.packages.map((p) => (
            <button key={p.id} type="button" className={`card ${pkgId === p.id ? 'sel' : ''}`} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setPkgId(p.id)} aria-pressed={pkgId === p.id}>
              <div className="row"><div><h3>{p.name}</h3><p className="muted">{p.tote_count} totes · {p.rental_days_included} days{p.description ? ` · ${p.description}` : ''}</p></div><div className="price" style={{ flex: '0 0 auto' }}>{money(p.price)}</div></div>
              {p.extra_week_price ? <p className="muted">Extra week {money(p.extra_week_price)}</p> : null}
            </button>
          ))}
          {cat.addons.length > 0 && <><h3 style={{ marginTop: 16 }}>Add-ons</h3>
            {cat.addons.map((a) => { const q = addons[a.id] ?? 0; const freeToday = a.asset_type === 'dolly' ? Math.min(...(cat.availability.slice(0, 14).map((d) => d.dollies_free))) : 99; const max = Math.min(a.max_qty, Math.max(freeToday, 0)); return (
              <div key={a.id} className="card row"><div><b style={{ fontSize: 18 }}>{a.name}</b><p className="muted">{money(a.price)} per {a.per}{max === 0 ? ' · none free right now' : ''}</p></div>
                <div className="stepper" style={{ flex: '0 0 auto' }}><button type="button" aria-label={`Fewer ${a.name}`} onClick={() => setAddons({ ...addons, [a.id]: Math.max(0, q - 1) })}>−</button><span>{q}</span><button type="button" aria-label={`More ${a.name}`} disabled={q >= max} onClick={() => setAddons({ ...addons, [a.id]: Math.min(max, q + 1) })}>+</button></div></div>); })}</>}
          <div className="sticky"><div className="inner"><button className="btn" disabled={!pkg} onClick={() => { setErr(null); setStep(2); }}>Next: delivery address</button></div></div>
        </section>)}

        {cat && step === 2 && (<section>
          <h2>2. Where do we deliver?</h2>
          <label htmlFor="addr">Delivery address</label>
          <input id="addr" autoComplete="street-address" placeholder="123 Main St, Lincoln Park, MI 48146" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={pickupDiff} onChange={(e) => setPickupDiff(e.target.checked)} /> Picking up at a different address? (your new place)</label>
          {pickupDiff && <><label htmlFor="paddr">Pickup address</label><input id="paddr" placeholder="Your new address" value={pickupAddr} onChange={(e) => setPickupAddr(e.target.value)} /></>}
          <label htmlFor="promo">Promo or realtor code (optional)</label>
          <input id="promo" placeholder="CODE" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
          <p className="muted">Delivery is {s.delivery_fee_base ? money(s.delivery_fee_base) : 'included'}{s.free_delivery_radius_miles ? ` within ${s.free_delivery_radius_miles} miles of Lincoln Park` : ''}{s.per_mile_fee ? `, then ${money(s.per_mile_fee)} a mile` : ''}. Outside {s.max_service_radius_miles ?? 25} miles? Call or text <a href={`sms:+17345378061`}>{PHONE}</a>.</p>
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(1)}>Back</button><button className="btn" disabled={busy || addr.trim().length < 8 || (pickupDiff && pickupAddr.trim().length < 8)} onClick={async () => { if (await getQuote()) setStep(3); }}>{busy ? 'Checking address…' : 'Next: pick dates'}</button></div></div>
        </section>)}

        {cat && step === 3 && (<section>
          <h2>3. Delivery date and window</h2>
          {quote?.delivery_geo && <p className="muted">Delivering to {quote.delivery_geo.split(',').slice(0, 3).join(',')} ({quote.delivery_miles} mi){quote.pickup_geo ? `, pickup ${quote.pickup_miles} mi away` : ''}. Delivery fee {money(quote.delivery_fee)}.</p>}
          <Calendar month={month} setMonth={setMonth} selected={date} ok={dateOk} onPick={(d) => { setDate(d); setWin(''); setErr(null); }} />
          {date && <><p className="muted" style={{ marginTop: 8 }}>Delivery {pretty(date)}. Pickup {pretty(addDays(date, rentalDays))} ({rentalDays} days).</p>
            <label>Delivery window</label>
            <div className="row" style={{ flexWrap: 'wrap' }}>{windowsFor(date).map((w: string) => <button key={w} type="button" className={`btn ghost sm ${win === w ? 'sel' : ''}`} style={win === w ? { background: 'var(--grad)', borderColor: 'transparent' } : {}} disabled={slotFull(date, w)} onClick={() => setWin(w)}>{w}{slotFull(date, w) ? ' (full)' : ''}</button>)}</div>
            <label>Pickup window ({pretty(addDays(date, rentalDays))})</label>
            <div className="row" style={{ flexWrap: 'wrap' }}>{windowsFor(addDays(date, rentalDays)).map((w: string) => <button key={w} type="button" className="btn ghost sm" style={pickupWin === w ? { background: 'var(--grad)', borderColor: 'transparent' } : {}} onClick={() => setPickupWin(w)}>{w}</button>)}</div>
            {pkg?.extra_week_price ? <><label>Need longer? Add weeks ({money(pkg.extra_week_price)} each)</label><div className="stepper"><button type="button" onClick={() => setExtraWeeks(Math.max(0, extraWeeks - 1))}>−</button><span>{extraWeeks}</span><button type="button" onClick={() => setExtraWeeks(Math.min(8, extraWeeks + 1))}>+</button></div></> : null}</>}
          {waitlist && <div className="card"><h3>Join the waitlist</h3><p className="muted">We text the first person on the list when totes open up for your dates.</p><input placeholder="Name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /><input type="tel" placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} style={{ marginTop: 8 }} /><button className="btn sm" style={{ marginTop: 8 }} disabled={busy} onClick={joinWaitlist}>Text me when it opens</button></div>}
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(2)}>Back</button><button className="btn" disabled={!date || !win || !dateOk(date) || busy} onClick={async () => { if (await getQuote()) setStep(4); }}>Next: your info</button></div></div>
        </section>)}

        {cat && step === 4 && (<section>
          <h2>4. Your info</h2>
          <label htmlFor="name">Full name</label><input id="name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <label htmlFor="phone">Phone</label><input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          <label htmlFor="email">Email</label><input id="email" type="email" inputMode="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <label htmlFor="heard">How did you hear about us?</label>
          <select id="heard" value={contact.heard} onChange={(e) => setContact({ ...contact, heard: e.target.value })}><option value="">Pick one</option>{HEARD_ABOUT_US.map((h) => <option key={h} value={h}>{h}</option>)}</select>
          <label htmlFor="notes">Notes (stairs, gate code, apartment number)</label><textarea id="notes" value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} />
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={contact.sms} onChange={(e) => setContact({ ...contact, sms: e.target.checked })} /><span>Text me updates about my rental<br /><span className="muted">Msg &amp; data rates may apply. Reply STOP to opt out.</span></span></label>
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={contact.payer} onChange={(e) => setContact({ ...contact, payer: e.target.checked })} /> Someone else is paying (a realtor or family member)</label>
          {contact.payer && <div className="card"><label htmlFor="pname">Payer name</label><input id="pname" value={contact.payer_name} onChange={(e) => setContact({ ...contact, payer_name: e.target.value })} /><label htmlFor="pemail">Payer email (for the receipt)</label><input id="pemail" type="email" value={contact.payer_email} onChange={(e) => setContact({ ...contact, payer_email: e.target.value })} /><p className="muted">They pay with their card; you still get the delivery texts.</p></div>}
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(3)}>Back</button><button className="btn" disabled={!contact.name.trim() || contact.phone.replace(/\D/g, '').length < 10 || !/.+@.+\..+/.test(contact.email)} onClick={() => { setErr(null); setStep(5); }}>Next: review</button></div></div>
        </section>)}

        {cat && step === 5 && quote && pkg && date && (<section>
          <h2>5. Review</h2>
          <div className="card"><table><tbody>
            <tr><td>{pkg.name} · {pkg.tote_count} totes · {rentalDays} days</td><td>{money(quote.subtotal)}</td></tr>
            {(quote.addons ?? []).map((a) => <tr key={a.name}><td>{a.qty} × {a.name}</td><td>{money(a.line)}</td></tr>)}
            <tr><td>Delivery{pickupDiff ? ' + pickup at a 2nd address' : ''} ({quote.delivery_miles} mi)</td><td>{money(quote.delivery_fee)}</td></tr>
            {Number(quote.discount) > 0 && <tr><td>Code {promo}</td><td>−{money(quote.discount)}</td></tr>}
            <tr><td><b>Total due today</b></td><td><b>{money(quote.balance_charge_mode === 'booking' ? quote.total : quote.deposit)}</b></td></tr>
            {quote.balance_charge_mode !== 'booking' && <tr><td>Balance {money(quote.balance)} charged to the same card {quote.balance_charge_mode === 'pickup' ? 'at pickup' : 'on delivery day'}</td><td /></tr>}
          </tbody></table>
          <p className="muted" style={{ marginTop: 8 }}>Delivery {pretty(date)} {win} · Pickup {pretty(addDays(date, rentalDays))} {pickupWin || win}<br />{addr}{pickupDiff ? ` → ${pickupAddr}` : ''}</p></div>
          <p className="muted">Next you&apos;ll sign the rental terms and pay. Your card stays on file for extensions or any fees after pickup, and you get a receipt for every charge.</p>
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(4)}>Back</button><button className="btn" disabled={busy} onClick={createHold}>{busy ? 'Holding your totes…' : 'Continue to sign & pay'}</button></div></div>
        </section>)}

        {step === 6 && hold && (<section>
          <h2>6. Sign the rental agreement</h2>
          <p className="muted">Rental {hold.rental_number}. Your totes are held for 30 minutes while you finish.</p>
          {terms ? <div className="terms" tabIndex={0} aria-label="Rental terms">{terms.text}</div> : <div className="skel" />}
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12 }}><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>I agree to the rental terms and authorize future charges to my card as described.</span></label>
          {agreed && !signed && <div style={{ marginTop: 12 }}><SignaturePad onSign={sign} busy={busy} /></div>}
          {signed && <div className="ok">Signed. Loading secure payment…</div>}
          <div style={{ height: 80 }} />
        </section>)}

        {step === 7 && pay && (<section>
          <h2>7. {pay.kind === 'setup' ? 'Save a card' : `Pay ${money(pay.amount)}`}</h2>
          <p className="muted">{pay.kind === 'setup' ? 'Nothing due today. Your card is saved for any charges you authorized.' : 'Paid in full today. Your card stays on file for extensions or post-rental fees, as you authorized. Cards, Apple Pay and Google Pay.'}</p>
          <div id="payment-element" className="card" style={{ minHeight: 120 }} />
          <div className="sticky"><div className="inner"><button className="btn" disabled={busy} onClick={submitPayment}>{busy ? 'Processing…' : pay.kind === 'setup' ? 'Save card & book' : `Pay ${money(pay.amount)} & book`}</button></div></div>
        </section>)}

        {step === 8 && done && (<section>
          <h2 className="grad-text">You&apos;re booked!</h2>
          <div className="ok">Rental {done.rental_number}. We texted and emailed your confirmation. Delivery {date ? pretty(date) : ''} {win}.</div>
          <a className="btn" href={`/rental/${done.token}`} target={initial.embed ? '_blank' : undefined} rel="noreferrer">Open my rental page</a>
          <JunkCallout href={junk} />
        </section>)}
      </div>
    </div>
  );
}

function heardToSource(h: string, fallback: string) {
  const m: Record<string, string> = { Google: 'google_search_organic', Facebook: 'facebook_organic_page', Nextdoor: 'nextdoor', 'Referral / word of mouth': 'referral', 'Saw the truck or trailer': 'truck_trailer_signage', 'Yard sign / flyer': 'yard_sign_flyer', 'Repeat customer': 'repeat_customer' };
  return m[h] ?? fallback;
}

function Calendar({ month, setMonth, selected, ok, onPick }: { month: string; setMonth: (m: string) => void; selected: string | null; ok: (d: string) => boolean; onPick: (d: string) => void }) {
  const [y, m] = month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}><button type="button" className="btn ghost sm" style={{ flex: '0 0 auto' }} onClick={() => shift(-1)} aria-label="Previous month">‹</button><b style={{ textAlign: 'center', fontSize: 18 }}>{label}</b><button type="button" className="btn ghost sm" style={{ flex: '0 0 auto' }} onClick={() => shift(1)} aria-label="Next month">›</button></div>
      <div className="cal">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }).map((_, i) => { const d = `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; const can = ok(d); return <button key={d} type="button" disabled={!can} className={selected === d ? 'sel' : ''} onClick={() => onPick(d)} aria-label={`${d}${can ? '' : ' unavailable'}`}>{i + 1}</button>; })}
      </div>
      <p className="muted" style={{ marginTop: 8 }}>Greyed dates are full for your order or not a delivery day.</p>
    </div>
  );
}
