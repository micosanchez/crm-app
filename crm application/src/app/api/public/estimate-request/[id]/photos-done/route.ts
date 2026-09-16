import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_PHOTOS, REQUEST_PHOTOS_BUCKET, type RequestPhoto } from '@/lib/requests';
import { sendNotification, APP_URL } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUBLIC — called by the form once the browser has finished pushing photos to
 * the signed upload URLs. We don't trust the reported list: the bucket is
 * listed server-side and only objects that actually landed are recorded. The
 * browser's numbers are used for pixel dimensions only.
 *
 * Safe to call more than once (a retry after a partial upload re-lists and
 * rewrites the array), but only while the request is still untouched.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  const { data: row } = await admin
    .from('estimate_requests')
    .select('id, status, first_name, last_name, email, phone, address, city, state, postal_code, description, photos')
    .eq('id', id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  // Once Mico has worked the request, the photo set is settled.
  if (row.status !== 'new') return NextResponse.json({ ok: true, photos: row.photos ?? [] });

  let reported: RequestPhoto[] = [];
  try {
    const body = (await req.json()) as { photos?: RequestPhoto[] };
    if (Array.isArray(body.photos)) reported = body.photos;
  } catch {
    /* dimensions are a nicety — an unparseable body still confirms the upload */
  }
  const dims = new Map(reported.map((p) => [p.path, p]));

  const { data: objects } = await admin.storage
    .from(REQUEST_PHOTOS_BUCKET)
    .list(`requests/${id}`, { limit: MAX_PHOTOS + 1 });

  const photos: RequestPhoto[] = (objects ?? [])
    .filter((o) => o.name && !o.name.startsWith('.'))
    .slice(0, MAX_PHOTOS)
    .map((o) => {
      const path = `requests/${id}/${o.name}`;
      const meta = (o.metadata ?? {}) as { size?: number };
      const d = dims.get(path);
      return {
        path,
        bytes: Number(meta.size ?? d?.bytes ?? 0),
        width: d?.width ?? null,
        height: d?.height ?? null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  const alreadyNotified = Array.isArray(row.photos) && row.photos.length > 0;
  await admin.from('estimate_requests').update({ photos }).eq('id', id);

  if (!alreadyNotified) {
    const to = process.env.NOTIFY_EMAIL;
    const name = `${row.first_name} ${row.last_name}`.trim();
    if (to) {
      try {
        await sendNotification({
          event: 'estimate_request',
          to,
          subject: `New estimate request — ${name}`,
          text: [
            `${name} just sent an estimate request${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}.`,
            '',
            `Phone: ${row.phone}`,
            `Email: ${row.email}`,
            `Address: ${[row.address, row.city, row.state, row.postal_code].filter(Boolean).join(', ')}`,
            '',
            row.description,
            '',
            `${APP_URL}/estimates/requests/${id}`,
          ].join('\n'),
          entityKind: 'estimate_request',
          entityId: id,
        });
      } catch {
        /* never fail the customer's submit over an email */
      }
    }
  }

  return NextResponse.json({ ok: true, photos });
}
