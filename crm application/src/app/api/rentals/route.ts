import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/rentals/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/** The connector holds Supabase's newer secret key, not the legacy service-role JWT. Any key that can read a
 *  staff-only (RLS) table through REST bypasses RLS, so it is a server key; the anon key gets an empty list. */
async function isServerKey(key: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || key.length < 20) return false;
  try {
    const r = await fetch(`${url}/rest/v1/rental_settings?select=id&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (!r.ok) return false;
    const j = (await r.json()) as unknown;
    return Array.isArray(j) && j.length > 0;
  } catch { return false; }
}

/**
 * Staff writes for Rentals (session auth) and the connector's ops channel (service-role bearer).
 * POST { action, ...args }. Every action returns the updated record.
 */
export async function POST(req: NextRequest) {
  let by: string | null = null;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (bearer && ((serviceKey && bearer === serviceKey) || (await isServerKey(bearer)))) by = 'connector';
  else {
    const role = await getRole();
    if (role !== 'admin' && role !== 'dispatcher') return NextResponse.json({ error: 'Staff only.' }, { status: 403 });
    const { data: { user } } = await createClient().auth.getUser();
    by = user?.id ?? null;
  }
  let body: { action?: string } & Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  if (!body.action) return NextResponse.json({ error: 'action required' }, { status: 400 });
  try {
    const result = await runAction(body.action, body, { by });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
