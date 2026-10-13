import { NextRequest, NextResponse } from 'next/server';
import { admin, getRentalByToken, getSettings, logEvent, queueMessage, scheduleLifecycle, chargeBalance, getRental } from '@/lib/rentals/ops';
import { stripe, cardInfo } from '@/lib/rentals/stripe';
import { sendNotification, APP_URL } from '@/lib/notify';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** POST {token, intent_id, kind} after Stripe confirms on the client. Verified against Stripe, never trusted from the browser. Idempotent. */
export async function POST(req: NextRequest) {
  let b: { token?: string; intent_id?: string; kind?: 'payment' | 'setup' };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (!b.token || !b.intent_id) return NextResponse.json({ error: 'missing fields' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(b.token, db);
    if (r.status !== 'pending_payment') return NextResponse.json({ ok: true, already: true, rental_number: r.rental_number, token: r.public_token }, { headers: CORS });
    const intent = await stripe<{ id: string; status: string; payment_method?: string; metadata?: Record<string, string>; customer?: string }>(`/${b.kind === 'setup' ? 'setup_intents' : 'payment_intents'}/${b.intent_id}`);
    if (intent.metadata?.rental_id !== r.id) return NextResponse.json({ error: 'That payment does not belong to this booking.' }, { status: 400, headers: CORS });
    if (intent.status !== 'succeeded') return NextResponse.json({ error: `Payment is ${intent.status.replace(/_/g, ' ')}. Please try again.` }, { status: 402, headers: CORS });
    if (!intent.payment_method) return NextResponse.json({ error: 'No card was saved. Please try again.' }, { status: 402, headers: CORS });
    const ci = await cardInfo(intent.payment_method);
    const dep = Number(r.deposit_amount);
    await db.from('rentals').update({ status: 'booked', deposit_status: dep > 0 ? 'held' : 'none', stripe_payment_method_id: ci.payment_method_id, card_brand: ci.brand, card_last4: ci.last4, card_exp: ci.exp, stripe_customer_id: intent.customer ?? r.stripe_customer_id }).eq('id', r.id);
    if (b.kind !== 'setup') await db.from('rental_charges').update({ status: 'succeeded' }).eq('stripe_payment_intent_id', intent.id);
    await logEvent(r.id, 'booked', { intent: intent.id, deposit: dep, card: `${ci.brand} ${ci.last4}` }, db);
    const fresh = await getRental(r.id, db);
    await queueMessage(fresh, 'booking_confirmed', {}, { email: true }, db);
    await scheduleLifecycle(fresh, db);
    const s = await getSettings(db);
    if (s.balance_charge_mode === 'booking') await chargeBalance(r.id, db).catch(() => {});
    sendNotification({ event: 'rental_booked', to: process.env.NOTIFY_EMAIL ?? '', subject: `Tote rental booked: ${fresh.rental_number} ${fresh.customers?.name}`, text: `${fresh.tote_count} totes · delivery ${fresh.delivery_date} ${fresh.delivery_window} · pickup ${fresh.pickup_date}\n${fresh.delivery_address}\n${APP_URL}/rentals/${fresh.id}` }).catch(() => {});
    return NextResponse.json({ ok: true, rental_number: fresh.rental_number, token: fresh.public_token, total: fresh.total, deposit: dep }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: CORS }); }
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
