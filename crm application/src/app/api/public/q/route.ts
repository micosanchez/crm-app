import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientIp, toE164 } from '@/lib/requests';
import { sendNotification, APP_URL } from '@/lib/notify';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** GET ?t=T-014 → who holds that tote right now (prefill), and log the scan as a top-of-funnel event, never a lead. */
export async function GET(req: NextRequest) {
  const db = createAdminClient();
  const tag = (req.nextUrl.searchParams.get('t') ?? '').toUpperCase().trim();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  type Active = { id: string; rental_number: string; customer_id: string; delivery_address: string; customers: { name: string; phone: string | null; email: string | null } | null };
  let rental: Active | null = null;
  if (tag) {
    const { data: item } = await db.from('rental_items').select('rental_id, rental_assets!inner(asset_tag)').eq('rental_assets.asset_tag', tag).is('checked_in_at', null).limit(1).maybeSingle();
    if (item?.rental_id) {
      const { data } = await db.from('rentals').select('id, rental_number, customer_id, delivery_address, customers(name, phone, email)').eq('id', item.rental_id).maybeSingle();
      rental = (data as unknown as Active | null) ?? null;
    }
  }
  await db.from('lead_events').insert({ type: 'qr_scan', rental_id: rental?.id ?? null, customer_id: rental?.customer_id ?? null, asset_tag: tag || null, detail: { active_rental: !!rental, ua: (req.headers.get('user-agent') ?? '').slice(0, 120) } });
  const { data: s } = await db.from('rental_settings').select('junk_offer_text').eq('id', true).maybeSingle();
  return NextResponse.json({ tag, rental: rental ? { id: rental.id, rental_number: rental.rental_number, name: rental.customers?.name ?? '', phone: rental.customers?.phone ?? '', email: rental.customers?.email ?? '', address: rental.delivery_address } : null, offer: s?.junk_offer_text ?? null }, { headers: CORS });
}

/** POST {name, phone, details, tag?, rental_id?} → an estimate request tagged tote_qr; this is the lead. */
export async function POST(req: NextRequest) {
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  let b: { name?: string; phone?: string; details?: string; tag?: string; rental_id?: string; website?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (b.website) return NextResponse.json({ ok: true }, { headers: CORS }); // honeypot
  const phone = toE164((b.phone ?? '').trim());
  const name = (b.name ?? '').trim();
  if (!name || !phone) return NextResponse.json({ error: 'Add your name and a 10 digit phone number.' }, { status: 400, headers: CORS });
  const [first = '', ...rest] = name.split(/\s+/);
  const rentalId = /^[0-9a-f-]{36}$/i.test(b.rental_id ?? '') ? b.rental_id! : null;
  let address: string | null = null; let email = '';
  if (rentalId) { const { data: r } = await db.from('rentals').select('delivery_address, customers(email)').eq('id', rentalId).maybeSingle(); address = r?.delivery_address ?? null; email = (r?.customers as unknown as { email?: string } | null)?.email ?? ''; }
  // one lead per phone number: a repeat scan tops up the open request instead of making a second one
  const { data: dup } = await db.from('estimate_requests').select('id').eq('phone', phone).in('status', ['new', 'contacted']).limit(1).maybeSingle();
  const description = `${(b.details ?? '').trim() || 'Scanned the tote sticker, wants a junk removal quote.'} (QR ${b.tag ?? '?'}${rentalId ? ', tote renter, TOTE25 applies' : ''})`;
  let id = dup?.id ?? null;
  if (dup) await db.from('estimate_requests').update({ description }).eq('id', dup.id);
  else {
    const { data: row, error } = await db.from('estimate_requests').insert({ status: 'new', first_name: first, last_name: rest.join(' ') || '-', email, phone, address, state: 'MI', description, lead_source: 'tote_rental_crosssell', rental_id: rentalId, ip: clientIp(req.headers), turnstile_verified: false }).select('id').single();
    if (error) return NextResponse.json({ error: 'Could not save that. Text us at 734-537-8061.' }, { status: 500, headers: CORS });
    id = row.id;
    if (rentalId) await db.from('rentals').update({ junk_request_id: row.id }).eq('id', rentalId).is('junk_request_id', null);
  }
  await db.from('lead_events').insert({ type: 'quote_form', rental_id: rentalId, asset_tag: b.tag ?? null, detail: { source: 'qr', estimate_request_id: id, duplicate: !!dup } });
  sendNotification({ event: 'estimate_request', to: process.env.NOTIFY_EMAIL ?? '', subject: `Junk quote from a tote sticker: ${name}`, text: `${name} ${phone}\n${description}\n${APP_URL}/requests/${id}` }).catch(() => {});
  return NextResponse.json({ ok: true, id }, { headers: CORS });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
