'use client';
import { useEffect, useState } from 'react';
import { TOTE_CSS } from '@/components/ToteBrand';

const PHONE = '734-537-8061';
export default function QuoteForm({ tag }: { tag: string }) {
  const [info, setInfo] = useState<{ rental: { id: string; name: string } | null; offer: string | null } | null>(null);
  const [v, setV] = useState({ name: '', phone: '', details: '' });
  const [state, setState] = useState<'form' | 'busy' | 'done' | 'err'>('form');
  const [msg, setMsg] = useState('');
  useEffect(() => { fetch(`/api/public/q?t=${encodeURIComponent(tag)}`).then((r) => r.json()).then((d) => { setInfo(d); if (d.rental) setV((x) => ({ ...x, name: d.rental.name })); }).catch(() => setInfo({ rental: null, offer: null })); }, [tag]);
  async function send() {
    setState('busy');
    const r = await fetch('/api/public/q', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, tag, rental_id: info?.rental?.id, website: '' }) }).then((x) => x.json()).catch(() => ({ error: 'network' }));
    if (r.error) { setState('err'); setMsg(r.error === 'network' ? 'That did not go through. Text us instead.' : r.error); } else setState('done');
  }
  return (
    <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} /><div className="wrap">
      <p className="pill">Sanchez Junk &amp; Haul Co.</p>
      <h1 className="grad-text">Moving? Don&apos;t take the junk with you.</h1>
      <p className="muted">{info?.rental ? `Hi ${info.rental.name.split(' ')[0]}, thanks for renting our totes.` : 'Thanks for scanning.'} Tell us what needs to go and we text you a free quote, usually the same day.</p>
      <div className="callout"><h3>Tote renters get $25 off</h3><p>{info?.offer ?? '$25 off any junk removal job of $250 or more, booked during your rental or within 7 days after pickup. No code needed.'}</p></div>
      {state === 'done' ? <div className="ok">Got it. We&apos;ll text you a quote shortly. Need it faster? <a href={`sms:+1${PHONE.replace(/-/g, '')}`}>Text {PHONE}</a>.</div> : (<>
        <label htmlFor="n">Name</label><input id="n" autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <label htmlFor="p">Phone</label><input id="p" type="tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        <label htmlFor="d">What needs to go?</label><textarea id="d" placeholder="Couch, old mattress, boxes in the garage..." value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
        <p className="muted">Photos help with the price. Text them to {PHONE} after you send this.</p>
        {state === 'err' && <div className="err">{msg}</div>}
        <button className="btn" disabled={state === 'busy' || !v.name.trim() || v.phone.replace(/\D/g, '').length < 10} onClick={send}>{state === 'busy' ? 'Sending…' : 'Get my free quote'}</button>
        <a className="btn ghost" style={{ marginTop: 10 }} href={`sms:+1${PHONE.replace(/-/g, '')}?&body=${encodeURIComponent('Hi Sanchez Junk & Haul Co., I rented totes and have some junk to get rid of.')}`}>Or tap to text {PHONE}</a>
      </>)}
    </div></div>
  );
}
