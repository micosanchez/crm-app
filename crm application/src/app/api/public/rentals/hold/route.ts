import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocode } from '@/lib/rentals/geo';
import { clientIp, RATE_LIMIT_PER_HOUR } from '@/lib/requests';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * PUBLIC: create the pending_payment hold. Availability is re-checked inside the database under a lock,
 * so two browsers racing for the last totes get exactly one winner. The hold expires in 30 minutes.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (typeof b.website === 'string' && b.website.trim()) return NextResponse.json({ ok: true, rental_number: 'R-0000' }, { headers: CORS }); // honeypot
  const ip = clientIp(req.headers);
  const { count } = await admin.from('rentals').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 3600_000).toISOString()).like('notes_internal', `%ip:${ip}%`);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return NextResponse.json({ error: 'Too many attempts. Call or text 734-537-8061 and we will book it for you.' }, { status: 429, headers: CORS });
  const dg = b.delivery_address ? await geocode(String(b.delivery_address)) : null;
  if (!dg) return NextResponse.json({ error: 'address_not_found' }, { headers: CORS });
  const pickupDifferent = typeof b.pickup_address === 'string' && b.pickup_address.trim() && b.pickup_address.trim() !== String(b.delivery_address).trim();
  const pg = pickupDifferent ? await geocode(String(b.pickup_address)) : null;
  if (pickupDifferent && !pg) return NextResponse.json({ error: 'pickup_address_not_found' }, { headers: CORS });
  const { data, error } = await admin.rpc('rental_create_hold', { p: { ...b, delivery_miles: dg.miles, pickup_miles: pg?.miles ?? null, pickup_address: pickupDifferent ? b.pickup_address : null } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  const d = data as { rental_id?: string; error?: string };
  if (d.rental_id) await admin.from('rentals').update({ notes_internal: `ip:${ip} ua:${(req.headers.get('user-agent') ?? '').slice(0, 120)}` }).eq('id', d.rental_id);
  return NextResponse.json(data, { headers: CORS });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
