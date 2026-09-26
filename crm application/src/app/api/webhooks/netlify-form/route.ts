import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_PHOTOS, REQUEST_PHOTOS_BUCKET, toE164, type RequestPhoto } from '@/lib/requests';
import { sendNotification, APP_URL } from '@/lib/notify';
import {
  WEBSITE_FORM_NAME, mapWebsiteSubmission, submissionTag, verifyNetlifySignature,
  type NetlifyFormPayload, type WebsiteLead,
} from '@/lib/websiteLead';

export const dynamic = 'force-dynamic';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Netlify outgoing webhook for the website's "quote-request" form. The website
 * keeps its own form (Meta Pixel Lead event + ad attribution stay intact); every
 * verified submission is copied here into estimate_requests as a 'new' request.
 *
 * Trust comes from the JWS signature (NETLIFY_FORM_WEBHOOK_SECRET, the same value
 * set as the webhook's "JWS secret token" in Netlify) — no Turnstile or IP cap,
 * since the caller is Netlify, which already ran its own spam filtering.
 *
 * Idempotent: Netlify retries until it gets a 2xx, so a submission already on file
 * is not inserted twice — only its photos are retried if the first copy didn't land.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.NETLIFY_FORM_WEBHOOK_SECRET;
  const admin = createAdminClient();
  if (!secret || !admin) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  const raw = await req.text();
  if (!verifyNetlifySignature(raw, req.headers.get('x-webhook-signature'), secret)) {
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  let payload: NetlifyFormPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  // Only the quote form becomes a request; anything else is acknowledged and dropped.
  if (payload.form_name !== WEBSITE_FORM_NAME) return NextResponse.json({ ok: true, skipped: 'form' });

  const lead = mapWebsiteSubmission(payload);
  if (!lead) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const { data: existing } = await admin
    .from('estimate_requests')
    .select('id, photos')
    .ilike('internal_notes', `%${submissionTag(lead.submissionId)}%`)
    .limit(1)
    .maybeSingle();

  let id: string;
  if (existing) {
    id = existing.id;
    if (Array.isArray(existing.photos) && existing.photos.length) return NextResponse.json({ ok: true, id });
  } else {
    const { data: row, error } = await admin
      .from('estimate_requests')
      .insert({
        status: 'new',
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        phone: toE164(lead.phone) ?? lead.phone,
        address: lead.address,
        city: lead.city,
        state: lead.state,
        postal_code: lead.postal_code,
        description: lead.description,
        lead_source: lead.lead_source,
        heard_about_us: lead.heard_about_us,
        utm_source: lead.utm_source,
        utm_medium: lead.utm_medium,
        utm_campaign: lead.utm_campaign,
        internal_notes: lead.internal_notes,
        ip: lead.ip,
        user_agent: lead.user_agent,
        turnstile_verified: false,
      })
      .select('id')
      .single();
    // 500 → Netlify retries later, so the lead isn't lost on a transient failure.
    if (error || !row) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
    id = row.id;
  }

  const photos = await copyPhotos(admin, id, lead.photoUrls);
  if (photos.length) await admin.from('estimate_requests').update({ photos }).eq('id', id);

  if (!existing) await notifyOwner(id, lead, photos.length);
  return NextResponse.json({ ok: true, id, photos: photos.length });
}

/** Pull each uploaded photo from Netlify and store it where the Requests queue looks. */
async function copyPhotos(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  id: string,
  urls: string[],
): Promise<RequestPhoto[]> {
  const results = await Promise.all(
    urls.slice(0, MAX_PHOTOS).map(async (url, i): Promise<RequestPhoto | null> => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? 'image/jpeg';
        if (!type.startsWith('image/')) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
        const ext = (type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `requests/${id}/${i}.${ext}`;
        const { error } = await admin.storage
          .from(REQUEST_PHOTOS_BUCKET)
          .upload(path, buf, { contentType: type, upsert: true });
        return error ? null : { path, bytes: buf.length, width: null, height: null };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((p): p is RequestPhoto => p !== null);
}

async function notifyOwner(id: string, lead: WebsiteLead, photoCount: number) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  const name = `${lead.first_name} ${lead.last_name}`.trim() || 'Someone';
  try {
    await sendNotification({
      event: 'estimate_request',
      to,
      subject: `New website quote request — ${name}`,
      text: [
        `${name} sent a quote request from sanchezhaulco.com${photoCount ? ` with ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}.`,
        `Source: ${lead.lead_source}`,
        '',
        `Phone: ${lead.phone}`,
        `Email: ${lead.email || '—'}`,
        `Address: ${[lead.address, lead.city, lead.state, lead.postal_code].filter(Boolean).join(', ') || '—'}`,
        '',
        lead.description,
        '',
        `${APP_URL}/estimates/requests/${id}`,
      ].join('\n'),
      entityKind: 'estimate_request',
      entityId: id,
    });
  } catch {
    /* never fail the webhook over an email */
  }
}
