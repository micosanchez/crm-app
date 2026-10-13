import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishableKey, isTestMode } from '@/lib/rentals/stripe';

export const dynamic = 'force-dynamic';

/** PUBLIC: packages, add-ons, safe settings, slot counts, 90 days of availability. Counts a page view. */
export async function GET() {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 90 * 86400_000).toISOString().slice(0, 10);
  const [{ data: catalog, error }, { data: avail }] = await Promise.all([
    admin.rpc('rental_public_catalog'),
    admin.rpc('get_tote_availability', { start_date: start, end_date: end }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  admin.rpc('rental_track_view').then(() => {}, () => {});
  return NextResponse.json({ ...(catalog as object), availability: avail ?? [], today: start, stripe: { publishable_key: publishableKey(), test_mode: isTestMode() } }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
