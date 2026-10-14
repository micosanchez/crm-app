import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { admin, getRentalByToken, extendRental, cancelRental, logEvent, getSettings, hoursBeforeDelivery, money, fmtDate } from '@/lib/rentals/ops';
import { sendNotification, APP_URL } from '@/lib/notify';
import { ensureStripeCustomer, createSetupIntent, publishableKey, cardInfo, stripe } from '@/lib/rentals/stripe';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** GET ?token= → the customer's view of their rental. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const db = createAdminClient();
  if (!token || !db) return NextResponse.json({ error: 'missing' }, { status: 400, headers: CORS });
  const { data, error } = await db.rpc('rental_by_token', { p_token: token });
  if (error || !data) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404, headers: CORS });
  const d = data as { agreement?: { pdf_url?: string | null } | null; charges?: { photo_urls?: string[] | null }[] };
  const sign = async (path: string) => (await db.storage.from('documents').createSignedUrl(path, 3600)).data?.signedUrl ?? null;
  if (d.agreement?.pdf_url) d.agreement.pdf_url = await sign(d.agreement.pdf_url);
  for (const c of d.charges ?? []) if (c.photo_urls?.length) c.photo_urls = (await Promise.all(c.photo_urls.map(sign))).filter((u): u is string => !!u);
  return NextResponse.json(data, { headers: CORS });
}

/** POST {token, action, ...} → extend | request_early_pickup | request_delivery_change | cancel (preview or confirm) | card_setup | card_confirm. */
export async function POST(req: NextRequest) {
  let b: { token?: string; action?: string; weeks?: number; pickup_date?: string; pickup_window?: string; delivery_date?: string; note?: string; confirm?: boolean; intent_id?: string; home_size?: string; move_reason?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (!b.token || !b.action) return NextResponse.json({ error: 'missing' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(b.token, db);
    switch (b.action) {
      case 'extend': {
        if (!['booked', 'delivered', 'out', 'pickup_scheduled'].includes(r.status)) throw new Error('This rental cannot be extended.');
        return NextResponse.json(await extendRental(r.id, Number(b.weeks ?? 1), db), { headers: CORS });
      }
      case 'request_early_pickup':
      case 'request_delivery_change': {
        // requests, not self-service moves: the owner confirms the route, then charges any fee shown here from the rental page
        const early = b.action === 'request_early_pickup';
        const day = String((early ? b.pickup_date : b.delivery_date) ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Pick a date.');
        const s = await getSettings(db);
        if (early) {
          if (!['delivered', 'out', 'pickup_scheduled'].includes(r.status)) throw new Error('Early pickup can be requested once the totes are delivered.');
          if (day >= r.pickup_date) throw new Error(`Pick a day before ${fmtDate(r.pickup_date)}. Need longer? Use Extend.`);
        } else if (r.status !== 'booked') throw new Error('The delivery date can only be changed before delivery.');
        const hours = hoursBeforeDelivery(r);
        const fee = early ? Number(s.expedited_pickup_fee ?? 0) : hours < Number(s.cancel_full_refund_hours ?? 48) ? Number(s.reschedule_fee_inside_window ?? 0) : 0;
        const note = String(b.note ?? '').slice(0, 300);
        await logEvent(r.id, early ? 'early_pickup_requested' : 'delivery_change_requested', { date: day, note, fee_quoted: fee, hours_before_delivery: Math.round(hours) }, db);
        await sendNotification({ event: 'rental_change_request', to: process.env.NOTIFY_EMAIL ?? '', subject: `${r.rental_number}: ${early ? 'early pickup' : 'new delivery date'} requested for ${fmtDate(day)}`,
          text: `${r.customers?.name ?? 'Customer'} asked to ${early ? `have the totes picked up early on ${fmtDate(day)} (now ${fmtDate(r.pickup_date)})` : `move delivery to ${fmtDate(day)} (now ${fmtDate(r.delivery_date)} ${r.delivery_window})`}.\n${note ? `Note: ${note}\n` : ''}${early ? `If it fits the normal route there is no charge. A special expedited trip is ${money(fee)}: tick "Expedited" when you save the new date.` : fee > 0 ? `Inside the ${s.cancel_full_refund_hours} hour window: tick "Customer asked" and the ${money(fee)} change fee is charged.` : 'With 48+ hours notice: free. Tick "Customer asked" when you save.'}\nConfirm with the customer, then reschedule here: ${APP_URL}/rentals/${r.id}` }).catch(() => {});
        return NextResponse.json({ ok: true, fee, early }, { headers: CORS });
      }
      case 'profile': {
        const patch: Record<string, string> = {};
        if (b.home_size) patch.home_size = String(b.home_size).slice(0, 40);
        if (b.move_reason) patch.move_reason = String(b.move_reason).slice(0, 40);
        if (Object.keys(patch).length) await db.from('rentals').update(patch).eq('id', r.id);
        return NextResponse.json({ ok: true }, { headers: CORS });
      }
      case 'cancel': return NextResponse.json(await cancelRental(r.id, { reason: 'customer request', by: 'customer', preview: !b.confirm }, db), { headers: CORS });
      case 'card_setup': {
        const c = r.customers!;
        const cust = await ensureStripeCustomer(r.stripe_customer_id, { name: c.name, email: c.email, phone: c.phone, crm_customer_id: c.id });
        if (!r.stripe_customer_id) await db.from('rentals').update({ stripe_customer_id: cust }).eq('id', r.id);
        const si = await createSetupIntent({ customer: cust, rental_id: r.id });
        return NextResponse.json({ client_secret: si.client_secret, intent_id: si.id, publishable_key: publishableKey() }, { headers: CORS });
      }
      case 'card_confirm': {
        const si = await stripe<{ status: string; payment_method?: string; metadata?: Record<string, string> }>(`/setup_intents/${b.intent_id}`);
        if (si.metadata?.rental_id !== r.id || si.status !== 'succeeded' || !si.payment_method) throw new Error('Card was not saved.');
        const ci = await cardInfo(si.payment_method);
        await db.from('rentals').update({ stripe_payment_method_id: ci.payment_method_id, card_brand: ci.brand, card_last4: ci.last4, card_exp: ci.exp }).eq('id', r.id);
        await logEvent(r.id, 'card:updated', { brand: ci.brand, last4: ci.last4, by: 'customer' }, db);
        return NextResponse.json({ ok: true, card: ci }, { headers: CORS });
      }
      default: throw new Error('Unknown action');
    }
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: CORS }); }
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
