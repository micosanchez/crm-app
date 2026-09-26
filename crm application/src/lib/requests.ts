/**
 * Estimate-request intake helpers — shared by the public API routes and the
 * CRM's Requests queue. Pure functions plus two small server-side checks;
 * nothing here touches the browser bundle's Supabase keys.
 */

import { LEAD_SOURCES as ENUM_LEAD_SOURCES } from './types';

export const MAX_PHOTOS = 8;
export const RATE_LIMIT_PER_HOUR = 5;
export const REQUEST_PHOTOS_BUCKET = 'request-photos';

/**
 * Sources we hand Mico a pre-built ?ref= link for. The raw ref is stored on the
 * request verbatim; `maps` is the existing customers.lead_source enum value it
 * becomes when the request is accepted, so no enum change is needed here.
 */
export const LEAD_SOURCES = [
  { ref: 'facebook', label: 'Facebook', maps: 'facebook' },
  { ref: 'instagram', label: 'Instagram', maps: 'instagram' },
  { ref: 'google', label: 'Google', maps: 'google' },
  { ref: 'nextdoor', label: 'Nextdoor', maps: 'other' },
  { ref: 'text', label: 'Text message', maps: 'referral' },
  { ref: 'yard_sign', label: 'Truck or yard sign', maps: 'yard_sign' },
  { ref: 'website', label: 'Website', maps: 'website' },
] as const;

/** Valid values of the customers.lead_source enum — one list, in types.ts. */
const LEAD_SOURCE_ENUM = new Set<string>(ENUM_LEAD_SOURCES);

/**
 * Raw ?ref= → a value customers.lead_source will actually accept. Anything we
 * don't recognise lands on 'website', since that's where the form lives.
 */
export function refToLeadSource(ref: string | null | undefined): string {
  const r = (ref || '').trim().toLowerCase();
  if (!r) return 'website';
  const known = LEAD_SOURCES.find((s) => s.ref === r);
  if (known) return known.maps;
  return LEAD_SOURCE_ENUM.has(r) ? r : 'website';
}

export type RequestStatus = 'new' | 'accepted' | 'declined' | 'spam';

export interface RequestPhoto {
  path: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
}

export interface EstimateRequest {
  id: string;
  created_at: string;
  status: RequestStatus;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  description: string;
  photos: RequestPhoto[];
  lead_source: string | null;
  turnstile_verified: boolean;
  customer_id: string | null;
  quote_id: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  internal_notes: string | null;
}

/* ---------------- Phone ---------------- */

/**
 * US/Canada E.164. Returns null when the digits can't be a real NANP number,
 * so a bad number is rejected at the door rather than stored unsendable.
 */
export function toE164(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  let ten: string;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith('1')) ten = digits.slice(1);
  else return null;
  // NANP: area code and exchange both start 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** (734) 537-8061 — for display and for reading back to the customer. */
export function formatPhone(e164OrRaw: string | null | undefined): string {
  const digits = (e164OrRaw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return e164OrRaw || '';
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Progressive formatting while the customer types. */
export function formatPhoneInput(raw: string): string {
  const d = (raw || '').replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/* ---------------- Other fields ---------------- */

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test((s || '').trim());
export const isZip = (s: string) => /^\d{5}(-\d{4})?$/.test((s || '').trim());

export interface RequestInput {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  description: string;
  heard_about_us?: string;
}

export const HEARD_ABOUT_US = ['Google', 'Facebook', 'Nextdoor', 'Referral / word of mouth', 'Saw the truck or trailer', 'Yard sign / flyer', 'Repeat customer', 'Other'] as const;

/** Field name → plain-language problem. Empty object means the form is good. */
export function validateRequest(v: Partial<RequestInput>): Record<string, string> {
  const e: Record<string, string> = {};
  const t = (s?: string) => (s ?? '').trim();

  if (!t(v.first_name)) e.first_name = 'Add your first name.';
  if (!t(v.last_name)) e.last_name = 'Add your last name.';
  if (!t(v.email)) e.email = 'Add your email.';
  else if (!isEmail(t(v.email))) e.email = "That email doesn't look right.";
  if (!t(v.phone)) e.phone = 'Add your phone number.';
  else if (!toE164(t(v.phone))) e.phone = 'Enter a 10-digit US phone number.';
  if (!t(v.address)) e.address = 'Add the street address.';
  if (!t(v.city)) e.city = 'Add the city.';
  if (!t(v.postal_code)) e.postal_code = 'Add the ZIP code.';
  else if (!isZip(t(v.postal_code))) e.postal_code = 'ZIP codes are 5 digits.';
  if (!t(v.description)) e.description = 'Tell us what needs to go.';
  else if (t(v.description).length < 10) e.description = 'A few more words helps us price it.';

  return e;
}

/** "123 Main St, Lincoln Park, MI 48146" — customer record + maps link. */
export function oneLineAddress(r: {
  address?: string | null; city?: string | null; state?: string | null; postal_code?: string | null;
}): string {
  const t = (s?: string | null) => (s || '').trim();
  const region = [t(r.city), [t(r.state), t(r.postal_code)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [t(r.address), region].filter(Boolean).join(', ');
}

export const fullName = (r: { first_name: string; last_name: string }) =>
  `${(r.first_name || '').trim()} ${(r.last_name || '').trim()}`.trim();

/* ---------------- Server-side checks ---------------- */

/**
 * Cloudflare Turnstile. When TURNSTILE_SECRET_KEY isn't configured the widget
 * isn't rendered either, so this reports `configured: false` and the caller
 * falls back to the honeypot + IP rate limit rather than blocking real people.
 */
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<{
  configured: boolean; ok: boolean;
}> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { configured: false, ok: false };
  if (!token) return { configured: true, ok: false };

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as { success?: boolean };
    return { configured: true, ok: !!json.success };
  } catch {
    return { configured: true, ok: false };
  }
}

/** First public IP from the proxy chain, or null when we can't tell. */
export function clientIp(headers: Headers): string | null {
  const raw = headers.get('x-nf-client-connection-ip')
    ?? headers.get('x-forwarded-for')
    ?? headers.get('x-real-ip');
  if (!raw) return null;
  const first = raw.split(',')[0]!.trim();
  // Strip an IPv4 port if one came along; inet won't take it.
  const noPort = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(first) ? first.split(':')[0]! : first;
  return noPort || null;
}
