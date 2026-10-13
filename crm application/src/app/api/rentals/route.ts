import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { runAction } from '@/lib/rentals/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/**
 * Staff writes for Rentals (session auth) and the connector's ops channel (service-role bearer).
 * POST { action, ...args }. Every action returns the updated record.
 */
export async function POST(req: NextRequest) {
  let by: string | null = null;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (bearer && serviceKey && bearer === serviceKey) by = 'connector';
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
