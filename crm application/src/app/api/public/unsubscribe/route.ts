import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_TEMPLATES } from '@/lib/rentals/templates';

export const dynamic = 'force-dynamic';

const page = (title: string, body: string, status = 200) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#2a0712"><h1 style="font-size:22px">${title}</h1><p>${body}</p><p style="color:#777">Sanchez Junk &amp; Haul Co. · 734-537-8061</p></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/** GET ?t=<token> only shows a button: email security scanners open every link, so a GET must never unsubscribe. */
export async function GET(req: NextRequest) {
  if (!/^[0-9a-f-]{36}$/i.test(req.nextUrl.searchParams.get('t') ?? '')) return page('Link not recognized', 'Please reply to the email and we will take you off the list.', 400);
  return page('Unsubscribe from offers?', `<form method="post"><button type="submit" style="font-size:17px;padding:12px 22px;border-radius:8px;border:0;background:#2a0712;color:#fff;cursor:pointer">Unsubscribe me</button></form></p><p>You'll still get messages about any rental you book, like delivery and pickup times.`);
}

/** POST ?t=<rental public_token> (the button above) → stop marketing email for that customer (every rental), cancel queued promotional emails. */
export async function POST(req: NextRequest) {
  const db = createAdminClient();
  const t = req.nextUrl.searchParams.get('t') ?? '';
  if (!db) return page('Something went wrong', 'Please reply to the email and we will take you off the list.', 503);
  if (!/^[0-9a-f-]{36}$/i.test(t)) return page('Link not recognized', 'Please reply to the email and we will take you off the list.', 400);
  const { data: r } = await db.from('rentals').select('id, customer_id').eq('public_token', t).maybeSingle();
  if (!r) return page('Link not recognized', 'Please reply to the email and we will take you off the list.', 404);
  const { data: all } = await db.from('rentals').select('id').eq('customer_id', r.customer_id);
  const ids = (all ?? []).map((x) => x.id);
  await db.from('rentals').update({ marketing_email_consent_at: null }).in('id', ids);
  const promo = Object.entries(DEFAULT_TEMPLATES).filter(([, d]) => d.kind === 'promotional').map(([k]) => k);
  await db.from('rental_messages').update({ status: 'cancelled', error: 'unsubscribed' }).in('rental_id', ids).eq('channel', 'email').eq('status', 'queued').in('template', promo);
  await db.from('rental_events').insert({ rental_id: r.id, event: 'email_unsubscribed', detail: { rentals: ids.length } });
  return page("You're unsubscribed", "You won't get offers by email from us anymore. You'll still get messages about any rental you book, like delivery and pickup times.");
}
