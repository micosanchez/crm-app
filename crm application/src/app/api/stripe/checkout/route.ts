import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const APP_URL = 'https://crmsjh.netlify.app';

/**
 * POST /api/stripe/checkout  { token }
 * Creates a Stripe Checkout session for the remaining balance of the invoice
 * behind a sign-link token. The token is the proof of legitimacy (same model
 * as the sign pages) — amount and invoice identity are derived server-side
 * via the invoice_payment_info RPC (migration 0019), never from the client.
 *
 * Uses Stripe's REST API directly (no SDK dependency).
 * Requires env: STRIPE_SECRET_KEY.
 */
export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });

  let body: { token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }
  if (!body.token) return NextResponse.json({ error: 'missing token' }, { status: 400 });

  const supabase = createClient();
  const { data: info, error } = await supabase.rpc('invoice_payment_info', { p_token: body.token });
  if (error || !info) return NextResponse.json({ error: 'invalid link' }, { status: 404 });

  const d = info as { invoice_id: string; number: number; customer_name: string | null; balance: number };
  const cents = Math.round(Number(d.balance) * 100);
  if (!cents || cents <= 0) return NextResponse.json({ error: 'This invoice is already paid — thank you!' }, { status: 400 });

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `Invoice #INV${d.number} — Sanchez Junk & Haul Co.`,
    'metadata[invoice_id]': d.invoice_id,
    'payment_intent_data[metadata][invoice_id]': d.invoice_id,
    success_url: `${APP_URL}/sign/invoice/${body.token}?paid=1`,
    cancel_url: `${APP_URL}/sign/invoice/${body.token}`,
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const session = await res.json();
  if (!res.ok || !session.url) {
    return NextResponse.json({ error: 'Could not start checkout. Please try again or use the payment instructions.' }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
