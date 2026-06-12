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

  let body: {
    event?: string; kind?: string; number?: number; customer?: string; total?: number; signer?: string;
    to?: string; crewName?: string; jobTitle?: string; when?: string; address?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }

  const { event, kind, number, customer, total, signer } = body;

  // Crew assignment notification → goes to the crew member's email.
  // NOTE: until a domain is verified in Resend, delivery only works to the
  // Resend account owner's address; others are rejected by Resend.
  if (event === 'assigned') {
    if (!body.to || !body.jobTitle) return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: 'SJHC Command Center <onboarding@resend.dev>',
        to: [body.to],
        subject: `You're on a job: ${body.jobTitle}${body.when ? ` — ${body.when}` : ''}`,
        text: `${body.crewName ?? 'Hey'}, you've been assigned to a job.\n\nJob: ${body.jobTitle}\n${body.when ? `When: ${body.when}\n` : ''}${body.address ? `Where: ${body.address}\n` : ''}${customer ? `Customer: ${customer}\n` : ''}\nDetails, photos, and directions are in the app: https://crmsjh.netlify.app/field\n\n— Sanchez Junk & Haul Co.`,
      }),
    });
    if (!res.ok) return NextResponse.json({ error: (await res.text()).slice(0, 300) }, { status: 502 });
    return NextResponse.json({ sent: true });
  }

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
