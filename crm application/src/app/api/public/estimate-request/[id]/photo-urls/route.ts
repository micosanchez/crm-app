import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_PHOTOS, REQUEST_PHOTOS_BUCKET } from '@/lib/requests';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUBLIC — fresh signed upload URLs for a request whose photos didn't all land
 * the first time (dead cell service mid-upload is the normal case).
 *
 * The server picks the slots: it lists what's actually in the bucket and mints
 * URLs for the next free indexes, so a retry can never overwrite a photo that
 * did make it, and the total stays capped.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

  const { data: row } = await admin
    .from('estimate_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (row.status !== 'new') {
    return NextResponse.json({ error: 'That request has already been worked.' }, { status: 409 });
  }

  let want = 0;
  try {
    const body = (await req.json()) as { count?: number };
    want = Math.max(0, Math.min(Number(body.count) || 0, MAX_PHOTOS));
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  if (!want) return NextResponse.json({ ok: true, uploads: [] });

  const { data: objects } = await admin.storage
    .from(REQUEST_PHOTOS_BUCKET)
    .list(`requests/${id}`, { limit: MAX_PHOTOS + 1 });
  const taken = new Set((objects ?? []).map((o) => o.name));

  const uploads: { path: string; token: string }[] = [];
  for (let n = 0; n < MAX_PHOTOS && uploads.length < want; n++) {
    const name = `${n}.jpg`;
    if (taken.has(name)) continue;
    const path = `requests/${id}/${name}`;
    const { data: signed } = await admin.storage
      .from(REQUEST_PHOTOS_BUCKET)
      .createSignedUploadUrl(path);
    if (signed) uploads.push({ path, token: signed.token });
  }

  return NextResponse.json({ ok: true, uploads });
}
