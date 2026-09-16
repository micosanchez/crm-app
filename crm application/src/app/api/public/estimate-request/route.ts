import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  MAX_PHOTOS, RATE_LIMIT_PER_HOUR, REQUEST_PHOTOS_BUCKET,
  clientIp, toE164, validateRequest, verifyTurnstile, type RequestInput,
} from '@/lib/requests';
import { sendNotification, APP_URL } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * PUBLIC — no session. The customer's browser posts the typed fields here and
 * gets back a request id plus short-lived signed upload URLs for their photos.
 *
 * Text lands FIRST, on purpose: if a photo upload later fails, the lead is
 * already saved and the customer sees a retry instead of an empty form.
 *
 * The browser never holds a Supabase key — every write on this path goes
 * through the service-role client here, behind validation, a honeypot, a
 * Turnstile check and a per-IP hourly cap.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "The request form isn't configured yet. Please call us instead." },
      { status: 503 },
    );
  }

  let body: Partial<RequestInput> & {
    website?: string;          // honeypot — real people never fill this
    turnstile_token?: string;
    photo_count?: number;
    ref?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  // Honeypot: answer 200 so a bot can't tell it was caught, but store nothing.
  if ((body.website ?? '').trim()) {
    return NextResponse.json({ ok: true, id: null, uploads: [] });
  }

  const ip = clientIp(req.headers);

  // Per-IP hourly cap. Counted across every status so marking something spam
  // doesn't hand the sender a fresh allowance.
  if (ip) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('estimate_requests')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        { error: "You've sent a few requests already. Give us a call at (734) 537-8061 and we'll sort it out." },
        { status: 429 },
      );
    }
  }

  const errors = validateRequest(body);
  if (Object.keys(errors).length) {
    return NextResponse.json({ error: 'Some fields need a fix.', errors }, { status: 400 });
  }

  const turnstile = await verifyTurnstile(body.turnstile_token, ip);
  if (turnstile.configured && !turnstile.ok) {
    return NextResponse.json(
      { error: "We couldn't verify that you're human. Reload the page and try again." },
      { status: 400 },
    );
  }

  const t = (s?: string) => (s ?? '').trim();
  const phone = toE164(t(body.phone))!; // validateRequest already proved this parses

  const { data: row, error } = await admin
    .from('estimate_requests')
    .insert({
      status: 'new',
      first_name: t(body.first_name),
      last_name: t(body.last_name),
      email: t(body.email).toLowerCase(),
      phone,
      address: t(body.address) || null,
      city: t(body.city) || null,
      state: t(body.state) || 'MI',
      postal_code: t(body.postal_code) || null,
      description: t(body.description),
      lead_source: t(body.ref).slice(0, 40).toLowerCase() || null,
      ip,
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
      turnstile_verified: turnstile.configured && turnstile.ok,
    })
    .select('id')
    .single();

  if (error || !row) {
    return NextResponse.json(
      { error: "We couldn't save that just now. Try again in a moment." },
      { status: 500 },
    );
  }

  // Signed upload URLs — one per photo the browser says it has, capped.
  const wanted = Math.max(0, Math.min(Number(body.photo_count) || 0, MAX_PHOTOS));
  const uploads: { path: string; token: string; signedUrl: string }[] = [];
  for (let i = 0; i < wanted; i++) {
    const path = `requests/${row.id}/${i}.jpg`;
    const { data: signed } = await admin.storage
      .from(REQUEST_PHOTOS_BUCKET)
      .createSignedUploadUrl(path);
    if (signed) uploads.push({ path, token: signed.token, signedUrl: signed.signedUrl });
  }

  // Tell Mico. A failure here must never fail the customer's submission.
  if (wanted === 0) void notifyOwner(row.id, body, phone);

  return NextResponse.json({ ok: true, id: row.id, uploads });
}

/** Owner email. Fired here when there are no photos; otherwise photos-done sends it. */
async function notifyOwner(id: string, body: Partial<RequestInput>, phone: string) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const name = `${(body.first_name ?? '').trim()} ${(body.last_name ?? '').trim()}`.trim();
  try {
    await sendNotification({
      event: 'estimate_request',
      to,
      subject: `New estimate request — ${name}`,
      text: [
        `${name} just sent an estimate request.`,
        '',
        `Phone: ${phone}`,
        `Email: ${(body.email ?? '').trim()}`,
        `Address: ${[body.address, body.city, body.state, body.postal_code].filter(Boolean).join(', ')}`,
        '',
        (body.description ?? '').trim(),
        '',
        `${APP_URL}/estimates/requests/${id}`,
      ].join('\n'),
      entityKind: 'estimate_request',
      entityId: id,
    });
  } catch {
    /* outbox already records what it can; never break the customer's submit */
  }
}
