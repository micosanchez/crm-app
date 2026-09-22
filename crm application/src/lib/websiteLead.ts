/**
 * Website quote form (sanchezhaulco.com, Netlify Forms "quote-request") →
 * estimate_requests. Netlify posts each verified submission to
 * /api/webhooks/netlify-form as an outgoing webhook signed with a JWS secret.
 *
 * Pure helpers only — no Supabase, no Next — so scripts/check-website-lead.mjs
 * can run them directly under `node --experimental-strip-types`.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const WEBSITE_FORM_NAME = 'quote-request';

/**
 * Netlify signs outgoing webhooks with an HS256 JWS in X-Webhook-Signature:
 * claims { iss: "netlify", sha256: hex(sha256(raw body)) }. Anything else —
 * missing header, wrong secret, altered body — is rejected.
 */
export function verifyNetlifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const parts = signature.split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string };
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { iss?: string; sha256?: string };
    if (header.alg !== 'HS256' || claims.iss !== 'netlify') return false;
    return claims.sha256 === createHash('sha256').update(rawBody, 'utf8').digest('hex');
  } catch {
    return false;
  }
}

type FileField = { url?: string; filename?: string; type?: string; size?: number } | string;

export interface NetlifyFormPayload {
  id?: string;
  form_name?: string;
  data?: Record<string, unknown>;
}

export interface WebsiteLead {
  submissionId: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;          // raw — the route normalises it with toE164
  address: string | null;
  city: string | null;
  state: string;
  postal_code: string | null;
  description: string;
  lead_source: string;
  internal_notes: string;
  ip: string | null;
  user_agent: string | null;
  photoUrls: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Which channel sent this visitor, from first-touch attribution the site captured. */
export function leadSourceFrom(d: Record<string, unknown>): string {
  const src = str(d.utm_source).toLowerCase();
  if (/instagram|^ig$/.test(src)) return 'instagram';
  if (str(d.fbclid) || /facebook|^fb$|meta/.test(src)) return 'facebook';
  if (/google/.test(src) || str(d.gclid)) return 'google';
  return 'website';
}

/** Netlify reports a file field as one object, an array of them, or a bare URL. */
export function photoUrlsFrom(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return (list as FileField[])
    .map((f) => (typeof f === 'string' ? f : f?.url ?? ''))
    .filter((u) => /^https:\/\//.test(u));
}

/** Tag used for dedupe — Netlify retries a webhook until it gets a 2xx. */
export const submissionTag = (id: string) => `Netlify submission ${id}`;

export function mapWebsiteSubmission(p: NetlifyFormPayload): WebsiteLead | null {
  const d = p.data ?? {};
  const submissionId = str(p.id);
  if (!submissionId) return null;

  // Current form sends first/last separately; older submissions sent one "name".
  const [first = '', ...rest] = str(d.name).split(/\s+/).filter(Boolean);
  const attribution = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'landing_page', 'referrer']
    .map((k) => [k, str(d[k]).slice(0, 300)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);

  return {
    submissionId,
    first_name: str(d.first_name) || first,
    last_name: str(d.last_name) || rest.join(' '),
    email: str(d.email).toLowerCase(),
    phone: str(d.phone),
    address: str(d.address) || null,
    city: str(d.city) || null,
    state: str(d.state).toUpperCase().slice(0, 2) || 'MI',
    postal_code: str(d.postal_code) || null,
    description: str(d.details),
    lead_source: leadSourceFrom(d),
    internal_notes: [`Website quote form · ${submissionTag(submissionId)}`, ...attribution].join('\n'),
    ip: str(d.ip) || null,
    user_agent: str(d.user_agent).slice(0, 500) || null,
    photoUrls: photoUrlsFrom(d.photos),
  };
}
