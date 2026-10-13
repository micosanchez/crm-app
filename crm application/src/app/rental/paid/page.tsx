import { TOTE_CSS, TOTE_FONTS } from '@/components/ToteBrand';

/** Landing page after a Stripe-hosted payment link (failed or extra charge). */
export default function PaidPage() {
  return (
    <><link rel="stylesheet" href={TOTE_FONTS} />
      <div className="tote"><style dangerouslySetInnerHTML={{ __html: TOTE_CSS }} />
        <div className="wrap"><p className="pill">Sanchez Junk &amp; Haul Co. Totes</p><h1 className="grad-text">Payment received</h1>
          <div className="ok">Thanks! Your receipt is on its way by text and email. You can close this page.</div>
          <p className="muted">Questions? Call or text (734) 537-8061.</p></div></div></>
  );
}
