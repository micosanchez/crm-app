/** Address → miles from the shop. SERVER ONLY (Nominatim asks for a real user agent and 1 req/s). */
export const BASE = { lat: 42.2294853, lng: -83.1908337, label: '1746 Riverbank St, Lincoln Park, MI' };

export interface Geo { lat: number; lng: number; display: string; miles: number }

const cache = new Map<string, Geo | null>();

export async function geocode(address: string): Promise<Geo | null> {
  const q = address.trim().replace(/\s+/g, ' ');
  if (q.length < 6) return null;
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  // shortcut: Nominatim free tier, ~1 req/s; swap for Google Geocoding once bookings pass ~50/day
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(/\bmi\b|michigan/i.test(q) ? q : `${q}, MI`)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sjhc-crm/1.0 (sanchezhaulco@gmail.com)' }, cache: 'no-store' });
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const r = rows[0];
    const geo = r ? { lat: Number(r.lat), lng: Number(r.lon), display: r.display_name, miles: milesBetween(BASE, { lat: Number(r.lat), lng: Number(r.lon) }) } : null;
    cache.set(key, geo);
    return geo;
  } catch { return null; }
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // straight line × 1.3 ≈ road miles for Downriver's grid
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
}

const driveCache = new Map<string, number>();
/** Drive minutes from the shop (no traffic). OSRM public router; if it is down, estimate from road miles. */
export async function driveMinutes(g: Pick<Geo, 'lat' | 'lng' | 'miles'>): Promise<number> {
  const key = `${g.lat.toFixed(4)},${g.lng.toFixed(4)}`;
  if (driveCache.has(key)) return driveCache.get(key)!;
  let min = Math.round(g.miles * 1.35);   // fallback: ~44 mph average across the metro
  try {
    // shortcut: OSRM demo server (fair use, no key); move to a keyed routing API once bookings pass ~50/day
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${BASE.lng},${BASE.lat};${g.lng},${g.lat}?overview=false`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const j = (await res.json()) as { routes?: { duration: number }[] };
    if (j.routes?.[0]) min = Math.round(j.routes[0].duration / 60);
  } catch { /* keep the estimate */ }
  driveCache.set(key, min);
  return min;
}
