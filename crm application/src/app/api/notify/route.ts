import { NextRequest, NextResponse } from 'next/server';

/**
 * Owner email notifications via Resend.
 * Fired from the public sign pages (viewed / signed events).
 * Requires env vars: RESEND_API_KEY, NOTIFY_EMAIL.
 * Without a verified domain, Resend only delivers to the account owner's email.
 */
export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return NextResponse.json({ skipped: 'notifications not configured' });

  let body: { event?: string; kind?: string; number?: number; customer?: string; total?: number; signer?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }

  const { event, kind, number, customer, total, signer } = body;
  if (!event || !kind || !number) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  const docName = `${kind === 'invoice' ? 'Invoice' : 'Estimate'} #${number}`;
  const amount = total != null ? ` — $${Number(total).toFixed(2)}` : '';
  const who = customer ? ` (${customer})` : '';

  const subject = event === 'signed'
    ? `✍️ ${signer ?? 'Customer'} signed ${docName}${amount}`
    : `👁 ${docName}${who} was just opened`;

  const text = event === 'signed'
    ? `${signer ?? 'Your customer'} signed ${docName}${who}${amount}.\n\n${kind === 'estimate' ? 'A job was created automatically — schedule it in the app.' : 'Waiting on payment — mark it paid when the money lands.'}\n\nhttps://crmsjh.netlify.app`
    : `${docName}${who}${amount} was just viewed by the customer.\n\nhttps://crmsjh.netlify.app`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: 'SJHC Command Center <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err.slice(0, 300) }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}
