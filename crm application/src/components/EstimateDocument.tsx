import type { ReactNode } from 'react';

/* ---------- Types ---------- */
export interface DocItem { description: string; details?: string | null; quantity: number; unit_price: number; amount: number }
export interface Doc {
  kind: string; number: number | string; status: string; total: number; tip?: number; amount_paid?: number;
  created_at: string; customer_name: string | null; customer_address?: string | null; items: DocItem[];
  signed_name?: string | null; signed_at?: string | null; signature_data?: string | null;
  valid_until?: string | null; due_at?: string | null;
  payment_instructions?: string | null; comments?: string | null;
  view_count?: number;
}

/* ---------- Business identity (Phase: source from business_settings). ---------- */
export const BIZ = {
  name: 'Sanchez Junk & Haul Co.',
  tagline: 'Remove · Refresh · Reclaim',
  phone: '313-348-3325',
  email: 'sanchezhaulco@gmail.com',
  website: 'sanchezhaulco.com',
  area: 'Lincoln Park · Taylor · Allen Park & surrounding Downriver MI',
  monogram: 'SJH',
};

/* ---------- Formatting ---------- */
export const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const ymdLong = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const pad4 = (n: number | string) => (typeof n === 'number' ? String(n).padStart(4, '0') : String(n));

/* Scoped Direction-A design system for the customer-facing document. Fonts + tokens
   live under .sjhc-sign so nothing here touches the rest of the app. */
export const DOC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;500;600;700&display=swap');
.sjhc-sign{--maroon:#3d0a1a;--maroon-2:#5b1225;--ink:#1c1b1a;--muted:#6b6560;--line:#e7e2dd;--paper:#fff;
  --grad:linear-gradient(90deg,#c8213f 0%,#8d1d55 55%,#5b2a8c 100%);
  min-height:100vh;background:#f4f1ee;padding:clamp(0px,3vw,32px);
  font-family:'Barlow Condensed',system-ui,sans-serif;color:var(--ink);line-height:1.4;-webkit-font-smoothing:antialiased}
.sjhc-sign.preview{min-height:0;background:transparent;padding:0}
.sjhc-sign *{box-sizing:border-box}
.sjhc-sign .sheet{max-width:660px;margin:0 auto;background:var(--paper);border-radius:14px;overflow:hidden;
  box-shadow:0 12px 40px rgba(61,10,26,.14),0 2px 6px rgba(0,0,0,.06)}
.sjhc-sign .bn{font-family:'Bebas Neue',sans-serif;font-weight:400;letter-spacing:.02em;line-height:.96}
.sjhc-sign .util{background:#2b0713;color:#e7c3ce;display:flex;flex-wrap:wrap;justify-content:center;gap:6px 20px;
  padding:8px 16px;font-size:clamp(10.5px,2.9vw,12px);letter-spacing:.14em;text-transform:uppercase;text-align:center}
.sjhc-sign .util b{color:#fff;font-weight:600}
.sjhc-sign .head{background:var(--maroon);color:#fff;padding:clamp(18px,4.5vw,28px) clamp(20px,5vw,34px) clamp(16px,4vw,22px)}
.sjhc-sign .brandrow{display:flex;align-items:center;gap:14px}
.sjhc-sign .mark{width:clamp(48px,12vw,58px);height:clamp(48px,12vw,58px);flex:0 0 auto;border:2px solid rgba(255,255,255,.85);
  border-radius:12px;display:grid;place-items:center;font-family:'Bebas Neue';font-size:clamp(20px,5.4vw,25px);letter-spacing:.05em}
.sjhc-sign .brandname{font-family:'Bebas Neue';font-size:clamp(26px,7.5vw,40px);letter-spacing:.03em;line-height:.96}
.sjhc-sign .tag{font-size:clamp(11px,3vw,13px);letter-spacing:.32em;text-transform:uppercase;color:#e7b9c6;margin-top:2px}
.sjhc-sign .contact{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:15px;font-size:clamp(12px,3.3vw,14px);color:#eddfe3}
.sjhc-sign .contact b{font-weight:600;color:#fff}
.sjhc-sign .area{margin-top:6px;font-size:clamp(11px,3vw,12.5px);letter-spacing:.05em;color:#d7b3bf;text-transform:uppercase}
.sjhc-sign .gradbar{height:5px;background:var(--grad)}
.sjhc-sign .meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;padding:clamp(18px,4.5vw,26px) clamp(20px,5vw,34px);border-bottom:1px solid var(--line)}
.sjhc-sign .doctitle{font-family:'Bebas Neue';font-size:clamp(30px,8vw,44px);color:var(--maroon);letter-spacing:.02em;line-height:.95}
.sjhc-sign .num{font-size:clamp(13px,3.6vw,15px);color:var(--muted);letter-spacing:.04em;margin-top:2px}
.sjhc-sign .status{display:inline-block;margin-top:8px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;padding:4px 11px;border-radius:999px;font-weight:600}
.sjhc-sign .st-open{background:#f3e7d9;color:#8a5a12}
.sjhc-sign .st-done{background:#e4f0e7;color:#1e7a56}
.sjhc-sign .dates{text-align:right;font-size:clamp(12px,3.4vw,14px)}
.sjhc-sign .dates .k{color:var(--muted);letter-spacing:.12em;text-transform:uppercase;font-size:10.5px}
.sjhc-sign .dates .v{font-weight:600;font-size:clamp(14px,3.8vw,16px)}
.sjhc-sign .billto{padding:clamp(16px,4vw,22px) clamp(20px,5vw,34px);border-bottom:1px solid var(--line)}
.sjhc-sign .lbl{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:5px}
.sjhc-sign .billto .name{font-family:'Bebas Neue';font-size:clamp(22px,6vw,28px);color:var(--ink);letter-spacing:.02em}
.sjhc-sign .billto .sub{font-size:clamp(13px,3.6vw,15px);color:#4a4540}
.sjhc-sign .items{padding:clamp(10px,3vw,18px) clamp(20px,5vw,34px) 0}
.sjhc-sign table{width:100%;border-collapse:collapse}
.sjhc-sign thead th{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 0;border-bottom:2px solid var(--maroon);font-weight:600}
.sjhc-sign thead th.r{text-align:right}
.sjhc-sign td{padding:16px 0;vertical-align:top;border-bottom:1px solid var(--line)}
.sjhc-sign td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.sjhc-sign .it-title{font-family:'Bebas Neue';font-size:clamp(19px,5vw,24px);color:var(--ink);letter-spacing:.02em}
.sjhc-sign .it-desc{font-size:clamp(14px,3.7vw,15.5px);color:#4a4540;margin-top:5px;max-width:46ch;white-space:pre-wrap}
.sjhc-sign .qty{font-size:clamp(14px,3.7vw,16px);color:#4a4540}
.sjhc-sign .amt{font-size:clamp(14px,3.7vw,16px);color:var(--ink);font-weight:600}
.sjhc-sign colgroup .cdesc{width:62%}
.sjhc-sign .total-wrap{display:flex;justify-content:flex-end;padding:clamp(14px,3.5vw,20px) clamp(20px,5vw,34px)}
.sjhc-sign .total{min-width:min(72%,300px);border:2px solid var(--maroon);border-radius:12px;overflow:hidden}
.sjhc-sign .total .row{display:flex;justify-content:space-between;padding:11px 18px;font-size:14px;color:#4a4540}
.sjhc-sign .total .grand{background:var(--maroon);color:#fff;padding:15px 18px;display:flex;justify-content:space-between;align-items:baseline}
.sjhc-sign .total .grand .k{font-family:'Bebas Neue';letter-spacing:.06em;font-size:20px}
.sjhc-sign .total .grand .v{font-family:'Bebas Neue';font-size:clamp(30px,9vw,42px);letter-spacing:.01em}
.sjhc-sign .paybtn{width:100%;border:none;border-radius:12px;padding:15px;margin:0 clamp(20px,5vw,34px);width:auto;
  display:block;color:#fff;font-family:'Bebas Neue';font-size:clamp(18px,5vw,21px);letter-spacing:.05em;cursor:pointer;
  background:var(--maroon);position:relative;overflow:hidden}
.sjhc-sign .paywrap{padding:0 clamp(20px,5vw,34px)}
.sjhc-sign .paybtn::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--grad)}
.sjhc-sign .paid{margin:0 clamp(20px,5vw,34px);border-radius:12px;padding:14px;text-align:center;background:#eef7f2}
.sjhc-sign .paid b{color:#1e7a56}
.sjhc-sign .terms{padding:clamp(12px,3vw,18px) clamp(20px,5vw,34px);display:grid;gap:16px}
.sjhc-sign .term h3{font-family:'Bebas Neue';font-size:clamp(16px,4.4vw,20px);color:var(--maroon);letter-spacing:.04em;margin-bottom:4px}
.sjhc-sign .term p{font-size:clamp(13.5px,3.6vw,15px);color:#4a4540;max-width:60ch;white-space:pre-wrap}
.sjhc-sign .sign{background:#faf7f4;border-top:1px solid var(--line);padding:clamp(20px,5vw,30px) clamp(20px,5vw,34px)}
.sjhc-sign .attest{font-size:12px;color:var(--muted);margin-top:14px;max-width:64ch}
.sjhc-sign .preparedby{font-size:12.5px;color:#4a4540;margin-top:10px}
.sjhc-sign .preparedby b{color:var(--ink)}
.sjhc-sign .sig-record{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:18px;margin-top:12px}
.sjhc-sign .sig-img{height:60px;width:auto;border-bottom:1px solid #9ca3af}
.sjhc-sign .sig-cursive{font-family:cursive;font-size:22px;border-bottom:1px solid #9ca3af;padding-bottom:2px;min-width:170px;display:inline-block}
.sjhc-sign .notice{margin:12px auto 0;max-width:660px;text-align:center;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8d1d55}
.sjhc-sign .foot{text-align:center;padding:16px;font-size:11.5px;color:var(--muted);letter-spacing:.06em;background:#fff}
.sjhc-sign .foot .g{height:3px;width:60px;margin:0 auto 12px;border-radius:2px;background:var(--grad)}
.sjhc-sign .printbar{max-width:660px;margin:14px auto 0;display:flex;align-items:center;justify-content:space-between;padding:0 4px}
.sjhc-sign .printbar span{font-size:12px;color:var(--muted);letter-spacing:.05em}
.sjhc-sign .printbtn{border:none;border-radius:8px;padding:8px 14px;font-family:'Bebas Neue';font-size:15px;letter-spacing:.05em;color:#fff;background:var(--maroon);cursor:pointer}
@media print{.sjhc-sign{background:#fff;padding:0}.sjhc-sign .sheet{box-shadow:none;border-radius:0;max-width:none}.sjhc-sign .no-print{display:none!important}}
`;

/* Presentational SJHC customer-facing document. Same render used by the public
   signing page AND the composer live-preview, so what Mico sees is what the
   customer sees. Interactive bits (pay button, signature pad) come in as slots.
   NOTHING internal is rendered here — only the fields on `doc`. */
export default function EstimateDocument({
  doc, kind, payArea, signSlot, hasOnlinePay = false,
}: {
  doc: Doc;
  kind: 'estimate' | 'invoice';
  payArea?: ReactNode;
  signSlot: ReactNode;
  hasOnlinePay?: boolean;
}) {
  const isInvoice = kind === 'invoice';
  const label = isInvoice ? 'Invoice' : 'Estimate';
  const prefix = isInvoice ? 'INV' : 'EST';
  const subtotal = doc.items.reduce((s, it) => s + Number(it.amount || 0), 0);
  const tip = Number(doc.tip ?? 0);
  const expired = !!(!doc.signed_at && doc.valid_until && doc.valid_until < new Date().toISOString().slice(0, 10));

  const statusLabel = (() => {
    if (doc.signed_at) return isInvoice ? 'Acknowledged' : 'Accepted';
    if (isInvoice) return doc.status === 'paid' ? 'Paid' : 'Amount due';
    return expired ? 'Expired' : 'Awaiting your approval';
  })();
  const statusDone = !!doc.signed_at || doc.status === 'paid';

  return (
    <div className="sheet">
      {/* Trust bar */}
      <div className="util">
        <span><b>Licensed &amp; Insured</b></span>
        <span>EIN &amp; W-9 on request</span>
        <span>Serving Downriver MI</span>
      </div>

      {/* Letterhead */}
      <div className="head">
        <div className="brandrow">
          <div className="mark" aria-hidden="true">{BIZ.monogram}</div>
          <div>
            <div className="brandname">{BIZ.name}</div>
            <div className="tag">{BIZ.tagline}</div>
          </div>
        </div>
        <div className="contact">
          <span><b>{BIZ.phone}</b></span><span>{BIZ.email}</span><span>{BIZ.website}</span>
        </div>
        <div className="area">{BIZ.area}</div>
      </div>
      <div className="gradbar" />

      {/* Meta */}
      <div className="meta">
        <div>
          <div className="doctitle">{label}</div>
          <div className="num"># {prefix}{pad4(doc.number)}</div>
          <div className={`status ${statusDone ? 'st-done' : 'st-open'}`}>{statusLabel}</div>
        </div>
        <div className="dates">
          <div className="k">Issued</div>
          <div className="v">{longDate(doc.created_at)}</div>
          {!isInvoice && doc.valid_until && (
            <>
              <div className="k" style={{ marginTop: 8 }}>Valid until</div>
              <div className="v">{ymdLong(doc.valid_until)}</div>
            </>
          )}
          {isInvoice && doc.due_at && (
            <>
              <div className="k" style={{ marginTop: 8 }}>Due</div>
              <div className="v">{longDate(doc.due_at)}</div>
            </>
          )}
        </div>
      </div>

      {/* Bill to */}
      <div className="billto">
        <div className="lbl">Prepared for</div>
        <div className="name">{doc.customer_name ?? 'Customer'}</div>
        {doc.customer_address && <div className="sub">{doc.customer_address}</div>}
      </div>

      {/* Line item — sentence case, columns that hold */}
      <div className="items">
        <table>
          <colgroup><col className="cdesc" /><col /><col /></colgroup>
          <thead>
            <tr><th>Description</th><th className="r">Qty</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i}>
                <td>
                  <div className="it-title">{it.description}</div>
                  {it.details && <div className="it-desc">{it.details}</div>}
                </td>
                <td className="r qty">{Number(it.quantity)}</td>
                <td className="r amt">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Total */}
      <div className="total-wrap">
        <div className="total">
          <div className="row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {isInvoice && tip > 0 && <div className="row"><span>Tip — thank you!</span><span>{money(tip)}</span></div>}
          <div className="grand"><span className="k">Total</span><span className="v">{money(doc.total)}</span></div>
        </div>
      </div>

      {/* Online payment area (slot) */}
      {payArea}

      {/* Terms — labeled sections. Internal notes are NEVER rendered here. */}
      {(doc.payment_instructions || doc.comments) && (
        <div className="terms">
          {doc.payment_instructions && (
            <div className="term">
              <h3>{isInvoice && hasOnlinePay ? 'Other ways to pay' : 'Payment'}</h3>
              <p>{doc.payment_instructions}</p>
            </div>
          )}
          {doc.comments && (
            <div className="term">
              <h3>Additional Terms</h3>
              <p>{doc.comments}</p>
            </div>
          )}
        </div>
      )}

      {/* Signature block (slot) */}
      <div className="sign">{signSlot}</div>

      <div className="foot">
        <div className="g" />
        {BIZ.name} · {BIZ.phone} · {BIZ.website} · Downriver Michigan
      </div>
    </div>
  );
}

export { longDate, ymdLong, pad4 };
