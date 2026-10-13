import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocode } from '@/lib/rentals/geo';

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** PUBLIC: price an order. Miles are computed here (server) from the typed addresses; the DB does the math. */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  let b: { package_id?: string; extra_weeks?: number; addons?: { addon_id: string; qty: number }[]; delivery_address?: string; pickup_address?: string; promo_code?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  let delivery_miles: number | null = null, pickup_miles: number | null = null, delivery_geo: string | null = null, pickup_geo: string | null = null;
  if (b.delivery_address) {
    const g = await geocode(b.delivery_address);
    if (!g) return NextResponse.json({ error: 'address_not_found' }, { headers: CORS });
    delivery_miles = g.miles; delivery_geo = g.display;
  }
  if (b.pickup_address && b.pickup_address.trim() && b.pickup_address.trim() !== b.delivery_address?.trim()) {
    const g = await geocode(b.pickup_address);
    if (!g) return NextResponse.json({ error: 'pickup_address_not_found' }, { headers: CORS });
    pickup_miles = g.miles; pickup_geo = g.display;
  }
  const { data, error } = await admin.rpc('rental_quote', { p: { package_id: b.package_id, extra_weeks: b.extra_weeks ?? 0, addons: b.addons ?? [], delivery_miles, pickup_miles, promo_code: b.promo_code ?? null } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ ...(data as object), delivery_geo, pickup_geo }, { headers: CORS });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
