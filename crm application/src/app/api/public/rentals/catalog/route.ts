import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publishableKey, isTestMode } from '@/lib/rentals/stripe';

export const dynamic = 'force-dynamic';

/** PUBLIC: packages, add-ons, safe settings, slot counts, 90 days of availability. Counts a page view. Test packages only show when ?package= names one. */
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 90 * 86400_000).toISOString().slice(0, 10);
  const [{ data: catalog, error }, { data: avail }, { data: tests }] = await Promise.all([
    admin.rpc('rental_public_catalog'),
    admin.rpc('get_tote_availability', { start_date: start, end_date: end }),
    admin.from('rental_packages').select('id').eq('is_test', true),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const want = req.nextUrl.searchParams.get('package');
  const testIds = (tests ?? []).map((t) => t.id as string);
  const c = catalog as { packages?: { id: string; is_test?: boolean }[] };
  c.packages = (c.packages ?? []).filter((p) => !testIds.includes(p.id) || p.id === want).map((p) => (testIds.includes(p.id) ? { ...p, is_test: true } : p));
  admin.rpc('rental_track_view').then(() => {}, () => {});
  return NextResponse.json({ ...(catalog as object), availability: avail ?? [], today: start, stripe: { publishable_key: publishableKey(), test_mode: isTestMode() } }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
