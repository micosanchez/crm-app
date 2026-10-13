import { NextRequest, NextResponse } from 'next/server';
import { admin, getRentalByToken, getSettings, cents, logEvent } from '@/lib/rentals/ops';
import { ensureStripeCustomer, createDepositIntent, createSetupIntent, publishableKey } from '@/lib/rentals/stripe';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** POST {token} → client_secret for the booking PaymentIntent (full total when balance is due at booking, else the deposit; card saved for later) or a SetupIntent when nothing is due today. */
export async function POST(req: NextRequest) {
  let b: { token?: string; payer_name?: string; payer_email?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (!b.token) return NextResponse.json({ error: 'missing token' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(b.token, db);
    if (r.status !== 'pending_payment') return NextResponse.json({ error: r.status === 'cancelled' ? 'This booking expired. Please start again.' : 'This rental is already paid.' }, { status: 409, headers: CORS });
    const { data: agreement } = await db.from('rental_agreements').select('id').eq('rental_id', r.id).limit(1);
    if (!agreement?.length) return NextResponse.json({ error: 'Please sign the rental agreement first.' }, { status: 409, headers: CORS });
    const c = r.customers!;
    // "Someone else is paying": the payer gets their own Stripe Customer so the renter's record stays clean.
    const payer = b.payer_name?.trim() ? { name: b.payer_name.trim(), email: b.payer_email?.trim() || null, phone: null, crm_customer_id: c.id } : { name: c.name, email: c.email, phone: c.phone, crm_customer_id: c.id };
    const { data: crmCust } = await db.from('customers').select('stripe_customer_id').eq('id', c.id).single();
    const existing = b.payer_name?.trim() ? null : (crmCust?.stripe_customer_id ?? r.stripe_customer_id);
    const stripeCustomer = await ensureStripeCustomer(existing, payer);
    if (!b.payer_name?.trim() && !crmCust?.stripe_customer_id) await db.from('customers').update({ stripe_customer_id: stripeCustomer }).eq('id', c.id);
    await db.from('rentals').update({ stripe_customer_id: stripeCustomer, payer_name: b.payer_name?.trim() || null, payer_email: b.payer_email?.trim() || null }).eq('id', r.id);
    const s = await getSettings(db);
    const dep = cents(Number(r.deposit_amount));
    const due = s.balance_charge_mode === 'booking' ? cents(Number(r.total)) : dep;   // paid in full up front
    if (due > 0) {
      const isDeposit = dep > 0 && due === dep;
      const pi = await createDepositIntent({ cents: due, customer: stripeCustomer, rental_id: r.id, rental_number: r.rental_number, receipt_email: payer.email ?? c.email });
      await db.from('rental_charges').upsert({ rental_id: r.id, type: isDeposit ? 'deposit' : 'rental_payment', amount: due / 100, description: isDeposit ? 'Deposit (held)' : 'Rental paid at booking', status: 'pending', stripe_payment_intent_id: pi.id }, { onConflict: 'stripe_payment_intent_id' });
      await logEvent(r.id, 'payment_intent:created', { pi: pi.id, amount: due / 100 }, db);
      return NextResponse.json({ kind: 'payment', client_secret: pi.client_secret, intent_id: pi.id, amount: due / 100, publishable_key: publishableKey() }, { headers: CORS });
    }
    const si = await createSetupIntent({ customer: stripeCustomer, rental_id: r.id });
    await logEvent(r.id, 'setup_intent:created', { si: si.id }, db);
    return NextResponse.json({ kind: 'setup', client_secret: si.client_secret, intent_id: si.id, amount: 0, publishable_key: publishableKey() }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: CORS }); }
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
