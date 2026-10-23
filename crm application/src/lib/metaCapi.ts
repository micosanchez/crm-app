/**
 * Meta Conversions API — server-side copies of the browser pixel events, so ad
 * attribution survives ad blockers and iOS. One call = one event. Never throws
 * and never blocks a customer: no token or a Meta error is logged and dropped.
 *
 * Dedup: pass the same event_id the browser pixel used (quote form: the
 * meta_event_id hidden field; tote booking: the rental number) and Meta keeps one.
 *
 * Env: META_CAPI_ACCESS_TOKEN (Events Manager → Settings → Conversions API),
 * META_TEST_EVENT_CODE (optional, from the Test events tab — remove after testing).
 */
import { createHash } from 'node:crypto';

export const META_PIXEL_ID = '2159736844938215';
const API = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`;

export interface MetaUser {
  email?: string | null; phone?: string | null; first_name?: string | null; last_name?: string | null;
  city?: string | null; state?: string | null; zip?: string | null;
  ip?: string | null; user_agent?: string | null;
  fbp?: string | null; fbc?: string | null; fbclid?: string | null;
}

export interface MetaEvent {
  name: 'Lead' | 'Purchase';
  event_id: string;
  source_url?: string;
  user: MetaUser;
  custom?: Record<string, unknown>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hash = (v: string | null | undefined, strip: RegExp = /^\s+|\s+$/g) => {
  const s = (v ?? '').toLowerCase().replace(strip, '');
  return s ? sha(s) : undefined;
};

/** Meta's normalisation rules, then SHA-256. Blank or unusable values are left out, never hashed. */
export function buildUserData(u: MetaUser): Record<string, string> {
  const digits = (u.phone ?? '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `1${digits}` : digits.length === 11 && digits.startsWith('1') ? digits : '';
  const zip = (u.zip ?? '').replace(/\D/g, '').slice(0, 5);
  const fbc = u.fbc?.startsWith('fb.') ? u.fbc : u.fbclid ? `fb.1.${Date.now()}.${u.fbclid}` : undefined;
  const d: Record<string, string | undefined> = {
    em: hash(u.email),
    ph: phone ? sha(phone) : undefined,
    fn: hash(u.first_name, /[^a-z]/g),
    ln: hash(u.last_name, /[^a-z]/g),
    ct: hash(u.city, /[^a-z]/g),
    st: hash((u.state ?? '').trim().slice(0, 2)),
    zp: zip.length === 5 ? sha(zip) : undefined,
    client_ip_address: u.ip || undefined,
    client_user_agent: u.user_agent || undefined,
    fbp: u.fbp || undefined,
    fbc,
  };
  return Object.fromEntries(Object.entries(d).filter((e): e is [string, string] => !!e[1]));
}

/** Sends one event. Resolves false (and logs) instead of throwing. */
export async function sendMetaEvent(ev: MetaEvent): Promise<boolean> {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) return false;
  const body: Record<string, unknown> = {
    data: [{
      event_name: ev.name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: ev.event_id,
      action_source: 'website',
      event_source_url: ev.source_url,
      user_data: buildUserData(ev.user),
      custom_data: ev.custom,
    }],
    access_token: token,
  };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000), // a slow Meta must not hold up a booking or a quote
    });
    if (!res.ok) console.warn('meta capi', ev.name, res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (e) {
    console.warn('meta capi', ev.name, (e as Error).message);
    return false;
  }
}
