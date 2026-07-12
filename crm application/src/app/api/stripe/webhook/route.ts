import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/stripe/webhook — Stripe event receiver.
 * Verifies the Stripe-Signature header (HMAC SHA-256, no SDK needed), then on
 * checkout.session.completed inserts a `payments` row for the invoice. The
 * existing payments trigger recomputes amount_paid → marks the invoice paid →
 * the invoice/job sync trigger marks the job paid. One insert, whole chain.
 *
 * Requires env: STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
 * Returns 500 when unconfigured so Stripe retries after setup.
 */

function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 500 });

  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: { id: string; payment_intent?: string | null; amount_total?: number | null; metadata?: Record<string, string> } };
  };

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const invoiceId = s.metadata?.invoice_id;
    const amount = (s.amount_total ?? 0) / 100;
    if (!invoiceId || amount <= 0) return NextResponse.json({ received: true, skipped: 'no invoice metadata' });

    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'service role not configured' }, { status: 500 }); // Stripe retries

    // Idempotency: Stripe retries webhooks — don't double-record a session.
    const ref = s.payment_intent ?? s.id;
    const { data: existing } = await admin.from('payments').select('id').eq('reference', ref).limit(1);
    if (existing && existing.length > 0) return NextResponse.json({ received: true, skipped: 'duplicate' });

    const { error } = await admin.from('payments').insert({
      invoice_id: invoiceId,
      amount,
      method: 'card',
      kind: 'payment',
      reference: ref,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 }); // let Stripe retry
  }

  return NextResponse.json({ received: true });
}
