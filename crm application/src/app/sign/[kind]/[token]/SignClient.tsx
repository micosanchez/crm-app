'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import SignaturePad from '@/components/SignaturePad';
import { flags } from '@/lib/flags';
import EstimateDocument, { BIZ, DOC_CSS, money, ymdLong, type Doc } from '@/components/EstimateDocument';

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

  useEffect(() => {
    const supabase = createClient();
    supabase.rpc(kind === 'invoice' ? 'invoice_by_token' : 'estimate_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) setError('This link is invalid or has expired.');
        else {
          const d = data as Doc;
          setDoc(d);
          if (d.view_count === 1) notify({ event: 'viewed', kind, token });
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok && data.url) { window.location.href = data.url; return; }
      alert(data.error ?? 'Online payment is not available right now — please use the payment instructions above.');
    } catch {
      alert('Could not start the payment — please check your connection and try again.');
    }
    setPayBusy(false);
  }

  const isInvoice = kind === 'invoice';
  const label = isInvoice ? 'Invoice' : 'Estimate';
  const balance = doc ? Math.max(Number(doc.total) - Number(doc.amount_paid ?? 0), 0) : 0;
  const canPay = isInvoice && flags.stripe && doc?.status !== 'paid' && balance > 0 && !justPaid;
  const expired = !!(doc && !doc.signed_at && doc.valid_until && doc.valid_until < new Date().toISOString().slice(0, 10));

  const payArea = doc && (justPaid || canPay) ? (
    <>
      {justPaid && (
        <div className="paid"><p><b>✓ Payment received — thank you!</b></p><p style={{ color: '#6b6560', fontSize: 13 }}>Your receipt is on its way from our payment processor.</p></div>
      )}
      {canPay && (
        <div className="paywrap no-print">
          <button onClick={payNow} disabled={payBusy} className="paybtn" style={{ opacity: payBusy ? 0.6 : 1 }}>
            {payBusy ? 'Opening secure checkout…' : `Pay ${money(balance)} securely online`}
          </button>
        </div>
      )}
    </>
  ) : null;

  const signSlot = doc && (
    expired ? (
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontWeight: 600, color: '#374151' }}>This estimate expired on {ymdLong(doc.valid_until!)}.</p>
        <p style={{ fontSize: 13, color: '#6b6560' }}>Reply to the message that sent you this link and we&apos;ll send a fresh quote.</p>
      </div>
    ) : doc.signed_at ? (
      <div>
        <div className="lbl">{justSigned ? 'Thank you!' : 'Signature of record'}</div>
        {justSigned && !isInvoice && <p style={{ fontSize: 14, color: '#6b6560', marginTop: 2 }}>We&apos;ll be in touch to schedule your job.</p>}
        <div className="sig-record">
          <div>
            {doc.signature_data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={doc.signature_data} alt={`Signature of ${doc.signed_name}`} className="sig-img" />
            ) : (
              <span className="sig-cursive">{doc.signed_name}</span>
            )}
            <p style={{ fontSize: 12, color: '#6b6560', marginTop: 4 }}>Authorized signature</p>
          </div>
          <div style={{ textAlign: 'right', fontSize: 14 }}>
            <p style={{ fontWeight: 600 }}>{doc.signed_name}</p>
            <p style={{ color: '#6b6560' }}>{new Date(doc.signed_at).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
          </div>
        </div>
        <p className="attest">Approved electronically via secure signing link. A permanent copy of this signed document is retained on record by {BIZ.name}.</p>
      </div>
    ) : (
      <div>
        <div className="lbl">Sign to accept</div>
        <p style={{ fontSize: 14, fontWeight: 600, margin: '6px 0 10px' }}>
          {isInvoice ? 'Acknowledge this invoice by signing below.' : 'Approve this estimate by signing below.'}
        </p>
        <SignaturePad onSign={sign} busy={busy} />
        <p className="attest">By signing, you approve this {label.toLowerCase()} and authorize {BIZ.name} to perform the work described above at the quoted total.</p>
        <p className="preparedby">Prepared by <b>Mico Sanchez</b>, Owner · {BIZ.name}</p>
      </div>
    )
  );

  return (
    <div className="sjhc-sign">
      <style>{DOC_CSS}</style>
      <div style={{ maxWidth: 660, margin: '0 auto', padding: '8px 0' }}>
        {error && (
          <div className="sheet" style={{ padding: 40, textAlign: 'center', color: '#b91c1c', fontSize: 14 }}>{error}</div>
        )}
        {!doc && !error && (
          <div className="sheet" style={{ padding: 40, textAlign: 'center', color: '#6b6560', fontSize: 14 }}>Loading…</div>
        )}

        {doc && (
          <>
            <EstimateDocument doc={doc} kind={kind} payArea={payArea} signSlot={signSlot} hasOnlinePay={canPay} />
            <div className="printbar no-print">
              <span>{BIZ.name} · {BIZ.tagline}</span>
              <button onClick={() => window.print()} className="printbtn">Print / Save PDF</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
