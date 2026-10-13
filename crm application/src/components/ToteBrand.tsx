/** Sanchez brand for the public tote pages: dark maroon, red-to-purple gradient, silver/white bold text. */
export const TOTE_FONTS = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;500;600;700&display=swap';

export const TOTE_CSS = `
:root{--maroon:#3d0a1a;--maroon2:#2a0712;--grad:linear-gradient(135deg,#c81d3c 0%,#8a1e6b 100%);--silver:#d9d6dc;--white:#fff;--ink:#1b1016;--muted:#8d8491;--ok:#2fbf71;--warn:#ffb347;--err:#ff6b6b}
.tote{font-family:'Barlow Condensed',system-ui,sans-serif;background:var(--maroon2);color:var(--white);min-height:100vh;-webkit-font-smoothing:antialiased}
.tote h1,.tote h2,.tote h3,.tote .h{font-family:'Bebas Neue','Barlow Condensed',sans-serif;letter-spacing:.02em;font-weight:400;line-height:1}
.tote h1{font-size:40px}.tote h2{font-size:26px;margin:0 0 8px}.tote h3{font-size:20px;margin:0 0 6px}
.tote .wrap{max-width:640px;margin:0 auto;padding:16px 16px 120px}
.tote .grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.tote .card{background:#4a1024;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px;margin-bottom:12px;color:#fff}
.tote .card.sel{outline:3px solid #ff3d5e;outline-offset:-3px}
.tote .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 20px;border-radius:12px;border:0;background:var(--grad);color:#fff;font:600 18px 'Barlow Condensed',sans-serif;letter-spacing:.03em;cursor:pointer;width:100%;text-decoration:none}
.tote .btn[disabled]{opacity:.5;cursor:not-allowed}
.tote .btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.25);color:var(--silver)}
.tote .btn.sm{min-height:40px;width:auto;font-size:16px;padding:0 14px}
.tote label{display:block;font-size:14px;color:var(--silver);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.06em}
.tote input,.tote select,.tote textarea{width:100%;min-height:48px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:#1f0710;color:#fff;padding:10px 12px;font:500 17px 'Barlow Condensed',sans-serif}
.tote textarea{min-height:80px}
.tote input[type=checkbox]{width:22px;height:22px;min-height:0;display:inline-block;vertical-align:middle;margin-right:8px}
.tote .row{display:flex;gap:10px;align-items:center}.tote .row>*{flex:1}
.tote .muted{color:var(--muted);font-size:15px}
.tote .price{font-family:'Bebas Neue',sans-serif;font-size:30px;color:#fff}
.tote .pill{display:inline-block;padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.1);font-size:13px;color:var(--silver);letter-spacing:.05em;text-transform:uppercase}
.tote .progress{display:flex;gap:4px;margin:12px 0 18px}.tote .progress i{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.12)}.tote .progress i.on{background:var(--grad)}
.tote .err{color:#ffb4b4;background:rgba(255,80,80,.12);border:1px solid rgba(255,80,80,.3);padding:10px 12px;border-radius:10px;margin:10px 0;font-size:16px}
.tote .ok{color:#b8f5d0;background:rgba(47,191,113,.12);border:1px solid rgba(47,191,113,.35);padding:10px 12px;border-radius:10px;margin:10px 0}
.tote .stepper{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.25);border-radius:10px;overflow:hidden}
.tote .stepper button{width:44px;height:44px;border:0;background:#1f0710;color:#fff;font-size:22px;cursor:pointer}.tote .stepper span{min-width:40px;text-align:center;font-size:20px}
.tote .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.tote .cal button{aspect-ratio:1;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#1f0710;color:#fff;font:500 16px 'Barlow Condensed',sans-serif;cursor:pointer}
.tote .cal button[disabled]{opacity:.25;cursor:not-allowed;text-decoration:line-through}
.tote .cal button.sel{background:var(--grad);border-color:transparent}
.tote .cal .dow{text-align:center;font-size:12px;color:var(--muted);text-transform:uppercase}
.tote .terms{max-height:220px;overflow:auto;background:#1f0710;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:12px;font-size:15px;line-height:1.4;white-space:pre-wrap;color:var(--silver)}
.tote .sticky{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(42,7,18,.96);backdrop-filter:blur(8px);border-top:1px solid rgba(255,255,255,.1)}
.tote .sticky .inner{max-width:640px;margin:0 auto;display:flex;gap:10px;align-items:center}
.tote .skel{background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.14),rgba(255,255,255,.06));background-size:200% 100%;animation:sk 1.2s infinite;border-radius:10px;min-height:80px;margin-bottom:12px}
@keyframes sk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.tote canvas.sig{width:100%;height:160px;background:#fff;border-radius:10px;touch-action:none}
.tote .callout{background:var(--grad);border-radius:14px;padding:16px;margin:16px 0;color:#fff}
.tote .callout h3{font-size:24px;margin-bottom:4px}.tote .callout p{margin:0 0 10px;font-size:16px}
.tote .callout a{display:inline-block;background:#fff;color:#8a1e6b;font-weight:700;padding:10px 16px;border-radius:10px;text-decoration:none;font-size:17px}
.tote table{width:100%;border-collapse:collapse;font-size:16px}.tote td{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)}.tote td:last-child{text-align:right;white-space:nowrap}
.tote a{color:#ffb4c6}
`;

/** Stage 12 cross-sell callout. Never lists prices. */
export function JunkCallout({ href }: { href: string }) {
  return (
    <div className="callout">
      <h3>If it doesn&apos;t go in your tote, let us give you a quote.</h3>
      <p>Old furniture, mattresses, boxes of stuff you&apos;re not moving? We haul it away.</p>
      <a href={href} target="_blank" rel="noreferrer">Get a junk removal quote</a>
    </div>
  );
}

export function junkLink(p: { rental?: string | null; name?: string | null; phone?: string | null; email?: string | null; address?: string | null }) {
  const q = new URLSearchParams({ source: 'tote_rental' });
  if (p.rental) q.set('rental', p.rental); if (p.name) q.set('name', p.name); if (p.phone) q.set('phone', p.phone); if (p.email) q.set('email', p.email); if (p.address) q.set('address', p.address);
  // shortcut: goes to the CRM request page (not the website form) so lead_source and rental_id are recorded without a webhook change
  return `https://crmsjh.netlify.app/request?${q.toString()}`;
}
