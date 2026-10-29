'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import SignaturePad from '@/components/SignaturePad';
import { TOTE_CSS, JunkCallout, junkLink } from '@/components/ToteBrand';
import { HEARD_ABOUT_US } from '@/lib/requests';

type Pkg = { id: string; name: string; description: string | null; best_for: string | null; badge: string | null; tote_count: number; rental_days_included: number; price: number; week_price: number | null; extra_week_price: number | null; is_test?: boolean };
type Addon = { id: string; name: string; asset_type: string; kind: 'rent' | 'sell' | 'bundle'; price: number; per: string; max_qty: number; taxable: boolean; description: string | null; requires: Record<string, number>; featured: boolean; stock: number };
type Catalog = { packages: Pkg[]; addons: Addon[]; settings: Record<string, any>; slot_counts: Record<string, number>; availability: { day: string; totes_free: number; dollies_free: number }[]; today: string; stripe: { publishable_key: string; test_mode: boolean } }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Quote = { error?: string; gear?: string; free?: number; total?: number; deposit?: number; balance?: number; subtotal?: number; addons_total?: number; delivery_fee?: number; zone?: string | null; rush_fee?: number; tax?: number; duration?: number; discount?: number; delivery_miles?: number; pickup_miles?: number; rental_days?: number; tote_count?: number; dolly_count?: number; delivery_geo?: string; pickup_geo?: string; balance_charge_mode?: string; addons?: { name: string; qty: number; line: number }[] };

const PHONE = '(734) 537-8061';
const money = (n: number | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
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
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    // a new step is usually shorter: without this the page stays where the Next button was and shows whatever is below the form
    if (initial.embed && window.parent !== window) window.parent.postMessage({ type: 'sjhc_rent_step', step }, '*');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!err) return;
    // the error box is at the top of the form; on a phone the customer is down at the button and never saw it
    if (initial.embed && window.parent !== window) window.parent.postMessage({ type: 'sjhc_rent_step', step }, '*');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [err]);
  const [busy, setBusy] = useState(false);
  const [pkgId, setPkgId] = useState<string | null>(initial.package);
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [duration, setDuration] = useState<7 | 14>(14);
  const [moreAddons, setMoreAddons] = useState(false);
  const [moveDate, setMoveDate] = useState(initial.date ?? '');   // ?date= from the landing page now means moving day
  const [timing, setTiming] = useState('');
  const [ios, setIos] = useState(false);   // iOS shows an empty date field as a blank box (Android/desktop show mm/dd/yyyy)
  useEffect(() => setIos(/iPhone|iPad|iPod/.test(navigator.userAgent)), []);
  const [profile, setProfile] = useState({ home_size: '', move_reason: '', saved: false });
  const [addr, setAddr] = useState('');
  const [pickupDiff, setPickupDiff] = useState(false);
  const [pickupAddr, setPickupAddr] = useState('');
  const [promo, setPromo] = useState((initial.promo ?? '').toUpperCase());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [contact, setContact] = useState({ name: '', phone: '', email: '', heard: '', notes: '', junk: '' as '' | 'yes' | 'maybe' | 'no', mkt_sms: false, mkt_email: true, payer: false, payer_name: '', payer_email: '' });
  const [hold, setHold] = useState<{ rental_id: string; public_token: string; rental_number: string } | null>(null);
  const [terms, setTerms] = useState<{ text: string; version: number } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [pay, setPay] = useState<{ kind: 'payment' | 'setup'; client_secret: string; intent_id: string; amount: number; publishable_key: string } | null>(null);
  const [done, setDone] = useState<{ rental_number: string; token: string } | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const stripeRef = useRef<{ stripe: any; elements: any } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const leadSource = useMemo(() => {
    const s = (initial.utm.source ?? initial.utm.ref ?? '').toLowerCase();
    if (initial.utm.fbclid || /facebook|fb|meta|instagram/.test(s)) return 'meta_ads';
    if (initial.utm.gclid || /google/.test(s)) return 'google_ads';
    if (/nextdoor/.test(s)) return 'nextdoor';
    return 'website_direct';
  }, [initial.utm]);

  useEffect(() => {
    fetch(`/api/public/rentals/catalog${initial.package ? `?package=${encodeURIComponent(initial.package)}` : ''}`).then((r) => r.json()).then((c: Catalog) => { setCat(c); if (!pkgId && c.packages?.length === 1) setPkgId(c.packages[0].id); }).catch(() => setErr('Could not load packages. Please refresh.'));
    // resume an abandoned booking: prefill from the public view of the expired hold
    if (initial.resume) fetch(`/api/public/rentals/me?token=${initial.resume}`).then((r) => r.json()).then((d) => {
      if (!d || d.error) return;
      // a request Mico started over the phone is still open: skip straight to sign and save card
      if (d.status === 'pending_payment' && Date.now() - new Date(d.created_at).getTime() < 25 * 60_000) {
        setHold({ rental_id: d.id, public_token: initial.resume!, rental_number: d.rental_number });
        fetch(`/api/public/rentals/sign?token=${initial.resume}`).then((x) => x.json()).then(setTerms);
        setStep(6); return;
      }
      setAddr(d.delivery_address ?? ''); if (d.pickup_address && d.pickup_address !== d.delivery_address) { setPickupDiff(true); setPickupAddr(d.pickup_address); }
      setContact((c) => ({ ...c, name: d.customer?.name ?? '', phone: d.customer?.phone ?? '', email: d.customer?.email ?? '', notes: d.notes_customer ?? '', junk: d.junk_interest ?? '', mkt_sms: !!d.marketing_sms, mkt_email: !!d.marketing_email })); if (d.move_date) setMoveDate(d.move_date);
    }).catch(() => {});
    // embedded on sanchezhaulco.com: tell the parent page how tall we are so the iframe never scrolls inside
    if (initial.embed && window.parent !== window) {
      // min-height is dropped in embed mode (see style below) so the content height never depends on the iframe height; otherwise this loops
      // measure the content box, never body/html: the CRM's global css gives body a viewport-relative height, so a taller iframe made a taller body made a taller iframe (the long blank strip on desktop)
      let last = 0;
      const box = () => document.querySelector('.tote') as HTMLElement | null;
      const post = () => { const h = box()?.offsetHeight ?? 0; if (h && Math.abs(h - last) > 2) { last = h; window.parent.postMessage({ type: 'sjhc_rent_height', height: h }, '*'); } };
      const ro = new ResizeObserver(post); if (box()) ro.observe(box()!); post();
    }
    // back from a 3D Secure redirect
    const q = new URLSearchParams(window.location.search);
    const pi = q.get('payment_intent') ?? q.get('setup_intent');
    if (initial.token && pi) { setStep(7); confirmWith(initial.token, pi, q.get('setup_intent') ? 'setup' : 'payment'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pkg = cat?.packages.find((p) => p.id === pkgId) ?? null;
  const s = cat?.settings ?? {};
  const rentalDays = (duration === 7 && pkg?.week_price != null ? 7 : (pkg?.rental_days_included ?? 14)) + extraWeeks * 7;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  async function getQuote() {
    setErr(null); setBusy(true);
    const r = await fetch('/api/public/rentals/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package_id: pkgId, duration, extra_weeks: extraWeeks, addons: Object.entries(addons).filter(([, q]) => q > 0).map(([addon_id, qty]) => ({ addon_id, qty })), delivery_address: addr, pickup_address: pickupDiff ? pickupAddr : undefined, promo_code: promo || undefined }) }).then((x) => x.json() as Promise<Quote>);
    setBusy(false);
    if (r.error === 'address_not_found' || r.error === 'pickup_address_not_found') { setErr(`We couldn't find that ${r.error.startsWith('pickup') ? 'pickup ' : ''}address. Try adding the city and ZIP.`); return false; }
    if (r.error === 'out_of_area') { setErr(`That address is outside our delivery zones right now. Call or text ${PHONE} and we'll quote it.`); return false; }
    if (r.error === 'zip_required') { setErr('Please add the ZIP code to the address.'); return false; }
    if (r.error) { setErr(r.error); return false; }
    setQuote(r); return true;
  }

  async function createHold() {
    setErr(null); setBusy(true);
    const body = { package_id: pkgId, duration, extra_weeks: extraWeeks, addons: Object.entries(addons).filter(([, q]) => q > 0).map(([addon_id, qty]) => ({ addon_id, qty })), delivery_address: addr, pickup_address: pickupDiff ? pickupAddr : null, promo_code: promo || null,
      name: contact.name, phone: contact.phone, email: contact.email, lead_source: contact.heard ? heardToSource(contact.heard, leadSource) : leadSource,
      notes_customer: [timing.trim() && `Timing: ${timing.trim()}`, contact.notes.trim()].filter(Boolean).join('\n'), move_date: moveDate || null, resume: initial.resume, junk_interest: contact.junk || null, marketing_sms: contact.mkt_sms, marketing_email: contact.mkt_email, payer_name: contact.payer ? contact.payer_name : null, payer_email: contact.payer ? contact.payer_email : null, fbp: initial.utm.fbp, fbc: initial.utm.fbc, fbclid: initial.utm.fbclid, website: '' };
    const r = await fetch('/api/public/rentals/hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    setBusy(false);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mount = () => {
      const w = window as unknown as { Stripe?: (k: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!w.Stripe || cancelled) return;
      const stripe = w.Stripe(pay.publishable_key);
      const elements = stripe.elements({ clientSecret: pay.client_secret, appearance: { theme: 'night', variables: { colorPrimary: '#c81d3c', fontFamily: 'Barlow Condensed, system-ui, sans-serif', borderRadius: '10px' } } });
      let ready = false;
      const make = (retry: boolean) => {
        const el = elements.create('payment', { layout: 'tabs' });
        el.on('ready', () => { ready = true; setCardReady(true); });
        el.on('loaderror', () => setErr(`The card form didn't load. Refresh the page, or call or text ${PHONE} and we'll finish it with you.`));
        el.mount('#payment-element');
        // Stripe sometimes sits on its loader without a loaderror: remount once, then tell the customer instead of a dead button
        timer = setTimeout(() => {
          if (ready || cancelled) return;
          if (retry) { el.destroy(); make(false); } else setErr(`The card form is taking too long. Refresh the page, or call or text ${PHONE} and we'll finish it with you.`);
        }, 15000);
      };
      make(true);
      stripeRef.current = { stripe, elements };
    };
    if ((window as unknown as { Stripe?: unknown }).Stripe) mount();
    else { const sc = document.createElement('script'); sc.src = 'https://js.stripe.com/v3/'; sc.onload = mount; sc.onerror = () => setErr(`The card form didn't load. Refresh the page, or call or text ${PHONE} and we'll finish it with you.`); document.head.appendChild(sc); }
    return () => { cancelled = true; clearTimeout(timer); };
  }, [step, pay]);

  async function submitPayment() {
    if (!stripeRef.current || !pay || !hold) { setErr('The card form is still loading. Give it a second and try again.'); return; }
    setErr(null); setBusy(true);
    const { stripe, elements } = stripeRef.current;
    const return_url = `${window.location.origin}/rent?token=${hold.public_token}${initial.embed ? '&embed=1' : ''}`;
    const fn = pay.kind === 'setup' ? stripe.confirmSetup : stripe.confirmPayment;
    let res;
    try { res = await fn.call(stripe, { elements, confirmParams: pay.kind === 'setup' ? { return_url } : { return_url, receipt_email: contact.email || undefined }, redirect: 'if_required' }); }
    catch { setBusy(false); setErr(`Something went wrong saving the card. Try again, or call or text ${PHONE}.`); return; }
    if (res.error) { setBusy(false); setErr(res.error.message ?? 'The card was declined. Try another card.'); return; }
    const intent = res.paymentIntent ?? res.setupIntent;
    await confirmWith(hold.public_token, intent?.id ?? pay.intent_id, pay.kind);
  }

  async function confirmWith(token: string, intentId: string, kind: 'payment' | 'setup') {
    setBusy(true);
    const r = await fetch('/api/public/rentals/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, intent_id: intentId, kind }) }).then((x) => x.json()).catch(() => ({ error: `Your card was saved but we couldn't finish the request. Tap the button again, or call or text ${PHONE}.` }));
    setBusy(false);
    if (r.error) { setErr(r.error); setStep(7); return; }
    setDone({ rental_number: r.rental_number, token: r.token });
    if (!r.already && !r.is_test) fireConversion({ rental_number: r.rental_number, value: Number(r.total ?? 0), currency: 'USD' });
    setStep(8);
  }

  const steps = ['Package', 'Address', 'Moving day', 'Contact', 'Review', 'Sign', 'Save card', 'Done'];
  const junk = junkLink({ rental: hold?.rental_number ?? done?.rental_number, name: contact.name, phone: contact.phone, email: contact.email, address: pickupDiff ? pickupAddr : addr });

  return (
    <div className="tote">
      <style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} />
      {/* embed: the layout's <main> padding sat outside the measured .tote, so the iframe was ~88px short and scrolled inside itself, trapping the thumb; no padding + no inner scroll */}
      {initial.embed && <style>{`html,body{height:auto!important;min-height:0!important;overflow:hidden!important;background:#2a0712!important}main{padding-top:0!important;padding-bottom:0!important}.tote{min-height:0}.tote .wrap{padding-bottom:24px}.tote .sticky{position:static;padding:12px 0;background:none;border:0;backdrop-filter:none}`}</style>}
      <div className="wrap">
        {!initial.embed && (<header style={{ marginBottom: 8 }}><p className="pill">Sanchez Junk &amp; Haul Co.</p><h1 className="grad-text">Rent moving totes</h1><p className="muted">Delivered to your door. Picked up when you&apos;re done. {cat?.stripe.test_mode ? <span className="pill">test mode</span> : null}</p></header>)}
        <div className="progress" aria-label={`Step ${step} of 8: ${steps[step - 1]}`}>{steps.map((_, i) => <i key={i} className={i < step ? 'on' : ''} />)}</div>
        {err && <div className="err" role="alert">{err}</div>}
        {!cat && <><div className="skel" /><div className="skel" /><div className="skel" /></>}

        {cat && step === 1 && (<section>
          <h2>1. Pick your package</h2>
          <p className="muted">Every rental includes heavy duty 27 gallon totes with lids, a label for every tote, 2 markers, 2 full weeks, and delivery and pickup (from {money(Math.min(...((s.zones?.length ? s.zones : [{ fee: 10 }]) as { fee: number }[]).map((z) => Number(z.fee))))} depending on your address).</p>
          {cat.packages.length === 0 && <p className="muted">Packages are being set up. Call or text {PHONE} to book.</p>}
          {cat.packages.map((p) => (
            <button key={p.id} type="button" className={`card ${pkgId === p.id ? 'sel' : ''}`} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setPkgId(p.id)} aria-pressed={pkgId === p.id}>
              <div className="row"><div><h3>{p.name} {p.badge && <span className="pill" style={{ background: 'var(--grad)', color: '#fff' }}>{p.badge}</span>}</h3><p className="muted">{p.tote_count} totes · {duration === 7 && p.week_price != null ? 7 : p.rental_days_included} days{p.best_for ? ` · ${p.best_for}` : ''}</p>{p.description && <p className="muted">{p.description}</p>}</div><div className="price" style={{ flex: '0 0 auto' }}>{money(duration === 7 && p.week_price != null ? p.week_price : p.price)}</div></div>
              {p.extra_week_price ? <p className="muted">Extra week {money(p.extra_week_price)}</p> : null}
            </button>
          ))}
          <p className="muted">Not sure? Text us, and you can add totes later if we have them. {cat.packages.some((p) => p.week_price != null) && (duration === 14 ? <a href="#" onClick={(e) => { e.preventDefault(); setDuration(7); }}>Need just 1 week? Short move prices</a> : <a href="#" onClick={(e) => { e.preventDefault(); setDuration(14); }}>Back to 2 week prices</a>)}</p>
          {cat.addons.length > 0 && (() => {
            const featured = cat.addons.filter((a) => a.featured); const rest = cat.addons.filter((a) => !a.featured);
            const row = (a: Addon) => { const q = addons[a.id] ?? 0; const max = Math.min(a.max_qty, Math.max(a.stock ?? 99, 0)); return (
              <div key={a.id} className="card row"><div><b style={{ fontSize: 18 }}>{a.name}</b><p className="muted">{money(a.price)}{a.kind === 'sell' ? ' each, yours to keep' : a.per === 'day' ? ' per day' : ' per rental'}{max === 0 ? ' · none free right now' : ''}</p>{a.description && <p className="muted">{a.description}</p>}</div>
                <div className="stepper" style={{ flex: '0 0 auto' }}><button type="button" aria-label={`Fewer ${a.name}`} onClick={() => setAddons({ ...addons, [a.id]: Math.max(0, q - 1) })}>−</button><span>{q}</span><button type="button" aria-label={`More ${a.name}`} disabled={q >= max} onClick={() => setAddons({ ...addons, [a.id]: Math.min(max, q + 1) })}>+</button></div></div>); };
            return (<>
              <h3 style={{ marginTop: 16 }}>How are you moving the heavy stuff?</h3>
              {featured.map(row)}
              {rest.length > 0 && (moreAddons ? rest.map(row) : <button type="button" className="btn ghost sm" onClick={() => setMoreAddons(true)}>Packing supplies ({rest.length})</button>)}
            </>);
          })()}
          <div className="sticky"><div className="inner"><button className="btn" disabled={!pkg} onClick={() => { setErr(null); setStep(2); }}>Next: delivery address</button></div></div>
        </section>)}

        {cat && step === 2 && (<section>
          <h2>2. Where do we deliver?</h2>
          <label htmlFor="addr">Delivery address</label>
          <input id="addr" autoComplete="street-address" placeholder="123 Main St, Lincoln Park, MI 48146" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={pickupDiff} onChange={(e) => setPickupDiff(e.target.checked)} /> Picking up at a different address? (your new place)</label>
          {pickupDiff && <><label htmlFor="paddr">Pickup address</label><input id="paddr" placeholder="Your new address" value={pickupAddr} onChange={(e) => setPickupAddr(e.target.value)} /></>}
          <label htmlFor="promo">Promo, realtor or property manager code (optional)</label>
          <input id="promo" placeholder="CODE" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
          <div className="muted" style={{ fontSize: 15 }}>{(s.zones ?? []).map((z: { name: string; fee: number; label: string }) => <p key={z.name} style={{ margin: '2px 0' }}><b style={{ color: '#fff' }}>{z.fee ? money(z.fee) : 'Free'}</b> delivery and pickup: {z.label}</p>)}{s.far_zone_fee ? <p style={{ margin: '2px 0' }}><b style={{ color: '#fff' }}>{money(s.far_zone_fee)}</b> delivery and pickup: {s.far_zone_minutes ?? 45}+ minutes&apos; drive from Lincoln Park</p> : null}<p style={{ margin: '2px 0' }}>Somewhere else? Call or text <a href="sms:+17345378061">{PHONE}</a> for a quote.</p></div>
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(1)}>Back</button><button className="btn" disabled={busy || addr.trim().length < 8 || (pickupDiff && pickupAddr.trim().length < 8)} onClick={async () => { if (await getQuote()) setStep(3); }}>{busy ? 'Checking address…' : 'Next: moving day'}</button></div></div>
        </section>)}

        {cat && step === 3 && (<section>
          <h2>3. Moving details</h2>
          {quote?.delivery_geo && <p className="muted">Delivering to {quote.delivery_geo.split(',').slice(0, 3).join(',')}{quote.pickup_geo ? ', pickup at your new place' : ''}. {quote.zone ?? ''}: {Number(quote.delivery_fee) > 0 ? `${money(quote.delivery_fee)} delivery and pickup` : 'free delivery and pickup'}. We text you delivery windows after you book.</p>}
          <label htmlFor="movedate">When are you moving?</label>
          <div style={{ position: 'relative' }}>
            <input id="movedate" type="date" min={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
            {ios && !moveDate && <span aria-hidden style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'none', color: 'var(--silver)' }}>📅 Tap to pick your moving day</span>}
          </div>
          <p className="muted">We text you to schedule delivery and pickup around your move.</p>
          <label htmlFor="timing">Anything about timing we should know? (optional)</label>
          <textarea id="timing" placeholder="Need morning if possible, apartment stairs" value={timing} onChange={(e) => setTiming(e.target.value)} />
          {pkg?.extra_week_price ? <><label>Need longer than {rentalDays - extraWeeks * 7} days? Add weeks ({money(pkg.extra_week_price)} each)</label><div className="stepper"><button type="button" onClick={() => setExtraWeeks(Math.max(0, extraWeeks - 1))}>−</button><span>{extraWeeks}</span><button type="button" onClick={() => setExtraWeeks(Math.min(8, extraWeeks + 1))}>+</button></div></> : null}
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(2)}>Back</button><button className="btn" disabled={!moveDate || busy} onClick={async () => { if (await getQuote()) setStep(4); }}>Next: your info</button></div></div>
        </section>)}

        {cat && step === 4 && (<section>
          <h2>4. Your info</h2>
          <label htmlFor="name">Full name</label><input id="name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <label htmlFor="phone">Phone</label><input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          <label htmlFor="email">Email</label><input id="email" type="email" inputMode="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <label htmlFor="heard">How did you hear about us?</label>
          <select id="heard" value={contact.heard} onChange={(e) => setContact({ ...contact, heard: e.target.value })}><option value="">Pick one</option>{HEARD_ABOUT_US.map((h) => <option key={h} value={h}>{h}</option>)}</select>
          <label htmlFor="notes">Notes (stairs, gate code, apartment number)</label><textarea id="notes" value={contact.notes} onChange={(e) => setContact({ ...contact, notes: e.target.value })} />
          <label>Will you have anything to get rid of before your move?</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>{(['yes', 'maybe', 'no'] as const).map((v) => <button key={v} type="button" className="btn ghost sm" style={contact.junk === v ? { background: 'var(--grad)', borderColor: 'transparent' } : {}} onClick={() => setContact({ ...contact, junk: v })}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
          {contact.junk === 'yes' && <p className="muted">We'll text you a free junk removal quote. Tote renters get $25 off any job of $250 or more.</p>}
          <p className="muted">We text booking, delivery and pickup updates to this number. Msg &amp; data rates may apply. Reply STOP to opt out.</p>
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={contact.mkt_sms} onChange={(e) => setContact({ ...contact, mkt_sms: e.target.checked })} /><span>Yes, text me occasional offers from Sanchez Junk &amp; Haul Co.<br /><span className="muted">Msg &amp; data rates may apply. Reply STOP to opt out.</span></span></label>
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={contact.mkt_email} onChange={(e) => setContact({ ...contact, mkt_email: e.target.checked })} /><span>Yes, email me occasional offers. Unsubscribe any time.</span></label>
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'center' }}><input type="checkbox" checked={contact.payer} onChange={(e) => setContact({ ...contact, payer: e.target.checked })} /> Someone else is paying (a realtor or family member)</label>
          {contact.payer && <div className="card"><label htmlFor="pname">Payer name</label><input id="pname" value={contact.payer_name} onChange={(e) => setContact({ ...contact, payer_name: e.target.value })} /><label htmlFor="pemail">Payer email (for the receipt)</label><input id="pemail" type="email" value={contact.payer_email} onChange={(e) => setContact({ ...contact, payer_email: e.target.value })} /><p className="muted">They pay with their card; you still get the delivery texts.</p></div>}
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(3)}>Back</button><button className="btn" disabled={!contact.name.trim() || contact.phone.replace(/\D/g, '').length < 10 || !/.+@.+\..+/.test(contact.email)} onClick={() => { setErr(null); setStep(5); }}>Next: review</button></div></div>
        </section>)}

        {cat && step === 5 && quote && pkg && (<section>
          <h2>5. Review</h2>
          <div className="card"><table><tbody>
            <tr><td>{pkg.name} · {pkg.tote_count} totes · {rentalDays} days</td><td>{money(quote.subtotal)}</td></tr>
            {(quote.addons ?? []).map((a) => <tr key={a.name}><td>{a.qty} × {a.name}</td><td>{money(a.line)}</td></tr>)}
            <tr><td>Delivery and pickup{pickupDiff ? ' (two addresses)' : ''} · {quote.zone ?? ''}</td><td>{Number(quote.delivery_fee) > 0 ? money(quote.delivery_fee) : 'Free'}</td></tr>
            {Number(quote.rush_fee) > 0 && <tr><td>Rush (booked under {s.rush_hours ?? 48} hours out)</td><td>{money(quote.rush_fee)}</td></tr>}
            {Number(quote.tax) > 0 && <tr><td>Michigan sales tax on supplies</td><td>{money(quote.tax)}</td></tr>}
            {Number(quote.discount) > 0 && <tr><td>Code {promo}</td><td>−{money(quote.discount)}</td></tr>}
            <tr><td><b>Total rental</b></td><td><b>{money(quote.total)}</b></td></tr>
            <tr><td>Due today</td><td>{money(0)}</td></tr>
            <tr><td>Due at pickup</td><td>{money(quote.total)}</td></tr>
          </tbody></table>
          <p className="muted" style={{ marginTop: 8 }}>Moving day {moveDate ? pretty(moveDate) : ''} · we text you to schedule delivery · pickup {rentalDays} days after delivery<br />{addr}{pickupDiff ? ` → ${pickupAddr}` : ''}</p></div>
          <p className="muted">There is no grace period: if the totes are not ready at pickup, the next week is billed at {money(pkg.extra_week_price ?? 0)}. Cancel or change the delivery date free with {s.cancel_full_refund_hours ?? 48}+ hours&apos; notice, {money(s.cancel_fee_inside_window ?? 25)} with less. Totes damaged beyond use or returned excessively dirty are {money(s.damage_fee_per_tote ?? 10)} and {money(s.cleaning_fee_per_tote ?? 10)} each; normal wear is free.</p>
          <p>You will not be charged today. Your card is saved at booking so we can bill you when we pick up the totes. We will text you the amount before charging. If you are not home for delivery, a second delivery trip is billed at your zone delivery rate.</p>
          <div className="sticky"><div className="inner"><button className="btn ghost sm" onClick={() => setStep(4)}>Back</button><button className="btn" disabled={busy} onClick={createHold}>{busy ? 'One moment…' : 'Continue'}</button></div></div>
        </section>)}

        {step === 6 && hold && (<section>
          <h2>6. Sign the rental agreement</h2>
          <p className="muted">Rental request {hold.rental_number}.</p>
          {terms ? <div className="terms" tabIndex={0} aria-label="Rental terms">{terms.text}</div> : <div className="skel" />}
          <label style={{ textTransform: 'none', fontSize: 16, display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12 }}><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>I agree to the rental terms and authorize future charges to my card as described.</span></label>
          {agreed && !signed && <div style={{ marginTop: 12 }}><SignaturePad onSign={sign} busy={busy} /></div>}
          {signed && <div className="ok">Signed. Loading the secure card form…</div>}
          <div style={{ height: 80 }} />
        </section>)}

        {step === 7 && pay && (<section>
          <h2>7. Save your card</h2>
          <p className="muted">You will not be charged today. Your card is saved so we can bill you when we pick up the totes. We will text you the amount before charging.</p>
          <div id="payment-element" className="card" style={{ minHeight: 120 }} />
          <div className="sticky"><div className="inner"><button className="btn" disabled={busy || !cardReady} onClick={submitPayment}>{busy ? 'Saving…' : !cardReady ? 'Loading card form…' : 'Save card & request booking'}</button></div></div>
        </section>)}

        {step === 8 && done && (<section>
          <h2 className="grad-text">Request received!</h2>
          <div className="ok">Request received! We&apos;ll text you delivery windows within a few hours. Your totes are reserved once you confirm a date with us.</div>
          {pkg && quote && <div className="card"><table><tbody>
            <tr><td>{pkg.name} · {pkg.tote_count} totes</td><td /></tr>
            <tr><td>Moving day</td><td>{moveDate ? pretty(moveDate) : ''}</td></tr>
            <tr><td>Delivery and pickup · {quote.zone ?? ''}</td><td>{Number(quote.delivery_fee) > 0 ? money(quote.delivery_fee) : 'Free'}</td></tr>
            <tr><td><b>Total due at pickup</b></td><td><b>{money(quote.total)}</b></td></tr>
          </tbody></table><p className="muted">Questions? Call or text <a href="sms:+17345378061">{PHONE}</a>.</p></div>}
          <a className="btn" href={`/rental/${done.token}`} target={initial.embed ? '_blank' : undefined} rel="noreferrer">Open my rental page</a>
          <div className="card" style={{ marginTop: 12 }}><h3>Two quick questions (optional)</h3><p className="muted">They help us plan your delivery.</p>
            <label htmlFor="hs">Home type and size</label><select id="hs" value={profile.home_size} onChange={(e) => setProfile({ ...profile, home_size: e.target.value })}><option value="">Pick one</option>{['Studio', '1 bedroom apartment', '2 bedroom apartment', '3+ bedroom apartment', 'Small house', 'Large house', 'Office'].map((h) => <option key={h}>{h}</option>)}</select>
            <label htmlFor="mr">Reason for the move</label><select id="mr" value={profile.move_reason} onChange={(e) => setProfile({ ...profile, move_reason: e.target.value })}><option value="">Pick one</option>{[['new_home', 'New home'], ['downsizing', 'Downsizing'], ['renting', 'New rental'], ['estate', 'Estate or family home'], ['office', 'Office move'], ['other', 'Other']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="btn sm" disabled={profile.saved || (!profile.home_size && !profile.move_reason)} onClick={async () => { await fetch('/api/public/rentals/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: done.token, action: 'profile', home_size: profile.home_size || undefined, move_reason: profile.move_reason || undefined }) }); setProfile({ ...profile, saved: true }); }}>{profile.saved ? 'Saved, thanks' : 'Save'}</button></div>
          <JunkCallout href={junk} offer={s.junk_offer_text} />
        </section>)}
      </div>
    </div>
  );
}

function heardToSource(h: string, fallback: string) {
  const m: Record<string, string> = { Google: 'google_search_organic', Facebook: 'facebook_organic_page', Nextdoor: 'nextdoor', 'Referral / word of mouth': 'referral', 'Saw the truck or trailer': 'truck_trailer_signage', 'Yard sign / flyer': 'yard_sign_flyer', 'Repeat customer': 'repeat_customer' };
  return m[h] ?? fallback;
}
