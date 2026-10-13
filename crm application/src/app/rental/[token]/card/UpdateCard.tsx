'use client';
import { useEffect, useRef, useState } from 'react';
import { TOTE_CSS } from '@/components/ToteBrand';

export default function UpdateCard({ token }: { token: string }) {
  const [setup, setSetup] = useState<{ client_secret: string; intent_id: string; publishable_key: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<{ stripe: any; elements: any } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const si = q.get('setup_intent');
    if (si) { confirm(si); return; }
    fetch('/api/public/rentals/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'card_setup' }) }).then((x) => x.json()).then((d) => (d.error ? setErr(d.error) : setSetup(d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!setup) return;
    const mount = () => {
      const w = window as unknown as { Stripe?: (k: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!w.Stripe) return;
      const stripe = w.Stripe(setup.publishable_key);
      const elements = stripe.elements({ clientSecret: setup.client_secret, appearance: { theme: 'night', variables: { colorPrimary: '#c81d3c' } } });
      elements.create('payment').mount('#card-element');
      ref.current = { stripe, elements };
    };
    if ((window as unknown as { Stripe?: unknown }).Stripe) mount(); else { const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = mount; document.head.appendChild(s); }
  }, [setup]);

  async function confirm(intentId: string) {
    setBusy(true);
    const d = await fetch('/api/public/rentals/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action: 'card_confirm', intent_id: intentId }) }).then((x) => x.json());
    setBusy(false);
    if (d.error) setErr(d.error); else setDone(`${d.card.brand} ending in ${d.card.last4} is now on file.`);
  }
  async function save() {
    if (!ref.current || !setup) return;
    setBusy(true); setErr(null);
    const { stripe, elements } = ref.current;
    const res = await stripe.confirmSetup({ elements, confirmParams: { return_url: `${window.location.origin}/rental/${token}/card` }, redirect: 'if_required' });
    if (res.error) { setBusy(false); setErr(res.error.message); return; }
    await confirm(res.setupIntent?.id ?? setup.intent_id);
  }

  return (
    <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} />
      <div className="wrap"><p className="pill">Sanchez Junk &amp; Haul Co. Totes</p><h1 className="grad-text">Update your card</h1>
        <p className="muted">Replaces the card on file for your rental. Used for the balance and any post-rental charges you authorized.</p>
        {err && <div className="err">{err}</div>}
        {done ? <><div className="ok">{done}</div><a className="btn" href={`/rental/${token}`}>Back to my rental</a></> : <>
          <div id="card-element" className="card" style={{ minHeight: 120 }}>{!setup && <div className="skel" />}</div>
          <button className="btn" disabled={busy || !setup} onClick={save}>{busy ? 'Saving…' : 'Save card'}</button></>}
      </div>
    </div>
  );
}
