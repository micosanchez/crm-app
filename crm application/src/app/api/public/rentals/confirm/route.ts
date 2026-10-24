import { NextRequest, NextResponse } from 'next/server';
import { admin, getRentalByToken, confirmBooking } from '@/lib/rentals/ops';
import { stripe } from '@/lib/rentals/stripe';
import { clientIp } from '@/lib/requests';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** POST {token, intent_id, kind} after Stripe confirms on the client. Verified against Stripe, never trusted from the browser. Idempotent; the Stripe webhook books it too if this never arrives. */
export async function POST(req: NextRequest) {
  let b: { token?: string; intent_id?: string; kind?: 'payment' | 'setup' };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (!b.token || !b.intent_id) return NextResponse.json({ error: 'missing fields' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(b.token, db);
    if (r.status !== 'pending_payment' && r.status !== 'cancelled') return NextResponse.json({ ok: true, already: true, rental_number: r.rental_number, token: r.public_token }, { headers: CORS });
    const kind = b.kind === 'setup' ? 'setup' : 'payment';
    const intent = await stripe<{ id: string; status: string; payment_method?: string; metadata?: Record<string, string>; customer?: string }>(`/${kind === 'setup' ? 'setup_intents' : 'payment_intents'}/${b.intent_id}`);
    if (intent.metadata?.rental_id !== r.id) return NextResponse.json({ error: 'That payment does not belong to this booking.' }, { status: 400, headers: CORS });
    if (intent.status !== 'succeeded') return NextResponse.json({ error: `Payment is ${intent.status.replace(/_/g, ' ')}. Please try again.` }, { status: 402, headers: CORS });
    if (!intent.payment_method) return NextResponse.json({ error: 'No card was saved. Please try again.' }, { status: 402, headers: CORS });
    const res = await confirmBooking(r.id, { id: intent.id, kind, payment_method: intent.payment_method, customer: intent.customer ?? null }, { ip: clientIp(req.headers), user_agent: req.headers.get('user-agent') }, db);
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'This booking expired. Please start again.' }, { status: 409, headers: CORS });
    return NextResponse.json({ ok: true, already: res.already, rental_number: res.rental.rental_number, token: res.rental.public_token, total: res.rental.total, deposit: Number(res.rental.deposit_amount) }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: CORS }); }
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
