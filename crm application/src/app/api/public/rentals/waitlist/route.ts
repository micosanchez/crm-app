import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toE164 } from '@/lib/requests';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** PUBLIC: when the dates are full, keep name, phone and dates. The cron texts the first person when totes free up. */
export async function POST(req: NextRequest) {
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  let b: { name?: string; phone?: string; email?: string; start_date?: string; end_date?: string; tote_count?: number };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  const phone = toE164(b.phone ?? '');
  if (!b.name?.trim() || !phone || !b.start_date || !b.end_date) return NextResponse.json({ error: 'Name, phone and dates are required.' }, { status: 400, headers: CORS });
  const { error } = await db.from('rental_waitlist').insert({ name: b.name.trim(), phone, email: b.email?.trim() || null, start_date: b.start_date, end_date: b.end_date, tote_count: Number(b.tote_count ?? 0) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ ok: true }, { headers: CORS });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
