import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geocode } from '@/lib/rentals/geo';

/** Zones are keyed on ZIP. If the customer left it off, borrow the ZIP the geocoder found. */
function withZip(addr: string, display: string | null | undefined) { if (/\d{5}(-\d{4})?\s*$/.test(addr.trim())) return addr.trim(); const z = ((display ?? '').match(/\b\d{5}\b/g) ?? []).pop(); return z ? `${addr.trim()}, ${z}` : addr.trim(); }   // last 5-digit group: the ZIP, not the house number

export const dynamic = 'force-dynamic';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/** PUBLIC: price an order. Miles are computed here (server) from the typed addresses; the DB does the math. */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 503, headers: CORS });
  let b: { package_id?: string; duration?: number; extra_weeks?: number; addons?: { addon_id: string; qty: number }[]; delivery_address?: string; pickup_address?: string; promo_code?: string; delivery_date?: string };
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
  const { data, error } = await admin.rpc('rental_quote', { p: { package_id: b.package_id, duration: b.duration ?? 14, extra_weeks: b.extra_weeks ?? 0, addons: b.addons ?? [], delivery_address: b.delivery_address ? withZip(b.delivery_address, delivery_geo) : null, pickup_address: pickup_geo ? withZip(b.pickup_address!, pickup_geo) : null, delivery_place: delivery_geo, pickup_place: pickup_geo, delivery_miles, pickup_miles, promo_code: b.promo_code ?? null, delivery_date: b.delivery_date ?? null } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  return NextResponse.json({ ...(data as object), delivery_geo, pickup_geo }, { headers: CORS });
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
