/**
 * Stripe REST helpers for Rentals. SERVER ONLY. No SDK (same approach as /api/stripe/checkout).
 * Card data never touches us: we only ever hold Stripe ids, brand, last4 and expiry.
 * Requires env: STRIPE_SECRET_KEY (test key until Stage 11 passes), NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
 */
const API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(message: string, public code?: string, public declineCode?: string, public status?: number, public raw?: unknown) { super(message); }
}

function form(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) out.push(...form(v as Record<string, unknown>, key));
    else if (Array.isArray(v)) v.forEach((x, i) => out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(path: string, params?: Record<string, unknown>, opts: { method?: 'GET' | 'POST' | 'DELETE'; idempotencyKey?: string } = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError('Stripe is not configured (STRIPE_SECRET_KEY).', 'not_configured');
  const method = opts.method ?? (params ? 'POST' : 'GET');
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let url = `${API}${path}`;
  let body: string | undefined;
  if (params && method === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = form(params).join('&'); }
  else if (params) url += `?${form(params).join('&')}`;
  const res = await fetch(url, { method, headers, body, cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { message?: string; code?: string; decline_code?: string; payment_intent?: unknown } }).error ?? {};
    throw new StripeError(e.message ?? `Stripe ${res.status}`, e.code, e.decline_code, res.status, json);
  }
  return json as T;
}

export const publishableKey = () => process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
export const isTestMode = () => (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_');

export interface CardInfo { payment_method_id: string; brand: string | null; last4: string | null; exp: string | null; }

export async function cardInfo(paymentMethodId: string): Promise<CardInfo> {
  const pm = await stripe<{ id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } }>(`/payment_methods/${paymentMethodId}`);
  return { payment_method_id: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null, exp: pm.card ? `${String(pm.card.exp_month).padStart(2, '0')}/${String(pm.card.exp_year).slice(-2)}` : null };
}

/** Find or create the Stripe Customer for a CRM customer. */
export async function ensureStripeCustomer(existingId: string | null, c: { name: string; email?: string | null; phone?: string | null; crm_customer_id: string }): Promise<string> {
  if (existingId) return existingId;
  const cust = await stripe<{ id: string }>('/customers', { name: c.name, email: c.email ?? undefined, phone: c.phone ?? undefined, metadata: { crm_customer_id: c.crm_customer_id } });
  return cust.id;
}

/** Deposit at booking: saves the card for later merchant-initiated charges. */
export function createDepositIntent(a: { cents: number; customer: string; rental_id: string; rental_number: string; receipt_email?: string | null }) {
  return stripe<{ id: string; client_secret: string }>('/payment_intents', {
    amount: a.cents, currency: 'usd', customer: a.customer, setup_future_usage: 'off_session',
    automatic_payment_methods: { enabled: true }, receipt_email: a.receipt_email ?? undefined,
    description: `Tote rental ${a.rental_number} deposit`, statement_descriptor_suffix: 'TOTES',
    metadata: { rental_id: a.rental_id, rental_number: a.rental_number, charge_type: 'deposit' },
  }, { idempotencyKey: `deposit:${a.rental_id}` });
}

/** $0 deposit: just save the card. */
export function createSetupIntent(a: { customer: string; rental_id: string }) {
  return stripe<{ id: string; client_secret: string }>('/setup_intents', { customer: a.customer, usage: 'off_session', automatic_payment_methods: { enabled: true }, metadata: { rental_id: a.rental_id } });
}

export interface OffSessionResult { ok: boolean; payment_intent_id: string; status: string; requires_action?: boolean; error?: string; decline_code?: string }

/** Merchant-initiated charge on the saved card. Idempotency key must be unique per charge line. */
export async function chargeOffSession(a: { cents: number; customer: string; payment_method: string; description: string; rental_id: string; rental_number: string; charge_id: string; charge_type: string }): Promise<OffSessionResult> {
  try {
    const pi = await stripe<{ id: string; status: string }>('/payment_intents', {
      amount: a.cents, currency: 'usd', customer: a.customer, payment_method: a.payment_method, off_session: true, confirm: true,
      description: a.description, statement_descriptor_suffix: 'TOTES',
      metadata: { rental_id: a.rental_id, rental_number: a.rental_number, charge_id: a.charge_id, charge_type: a.charge_type },
    }, { idempotencyKey: `charge:${a.charge_id}` });
    return { ok: pi.status === 'succeeded', payment_intent_id: pi.id, status: pi.status };
  } catch (e) {
    if (e instanceof StripeError) {
      const raw = e.raw as { error?: { payment_intent?: { id?: string; status?: string } } } | undefined;
      const pi = raw?.error?.payment_intent;
      const needsAuth = e.code === 'authentication_required' || pi?.status === 'requires_action';
      return { ok: false, payment_intent_id: pi?.id ?? '', status: pi?.status ?? 'failed', requires_action: needsAuth, error: e.message, decline_code: e.declineCode ?? e.code };
    }
    throw e;
  }
}

export async function refundIntent(a: { payment_intent: string; cents?: number; reason?: string; idempotencyKey: string }) {
  return stripe<{ id: string; status: string; amount: number }>('/refunds', { payment_intent: a.payment_intent, amount: a.cents, metadata: { reason: a.reason ?? '' } }, { idempotencyKey: a.idempotencyKey });
}

/** Stripe-hosted page for a failed/extra charge: the customer authenticates there. */
export async function createHostedPaymentLink(a: { cents: number; description: string; rental_id: string; charge_id: string; customer: string }): Promise<string> {
  const price = await stripe<{ id: string }>('/prices', { currency: 'usd', unit_amount: a.cents, product_data: { name: a.description } });
  const link = await stripe<{ url: string }>('/payment_links', {
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { rental_id: a.rental_id, charge_id: a.charge_id, charge_type: 'payment_link' },
    payment_intent_data: { metadata: { rental_id: a.rental_id, charge_id: a.charge_id, charge_type: 'payment_link' }, setup_future_usage: 'off_session' },
    after_completion: { type: 'redirect', redirect: { url: `${process.env.URL ?? 'https://crmsjh.netlify.app'}/rental/paid` } },
  });
  return link.url;
}

/** Test cards to try (Stage 4 asked for the list). */
export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', what: 'Succeeds, card saved' },
  { number: '4000 0025 0000 3155', what: 'Needs authentication (3D Secure) at booking and again off-session' },
  { number: '4000 0000 0000 9995', what: 'Declines (insufficient funds)' },
  { number: '4000 0000 0000 0341', what: 'Attaches fine, then declines when charged off-session' },
  { number: '4000 0000 0000 0259', what: 'Succeeds, then raises a dispute' },
];
