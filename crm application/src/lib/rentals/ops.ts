/**
 * Rentals operations. SERVER ONLY. Every screen, the connector ops endpoint, the webhook and the cron call these,
 * so the rules live in one place: deposit first, then the saved card; nothing charged without a rental_charges row;
 * every outgoing message queued and logged; no card data ever stored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendText } from '@/lib/quo';
import { sendNotification, APP_URL } from '@/lib/notify';
import { chargeOffSession, refundIntent, createHostedPaymentLink, cardInfo, stripe, StripeError } from './stripe';
import { DEFAULT_TEMPLATES, mergedTemplates, renderRental, type RentalTemplateKey } from './templates';
import { sendMetaEvent } from '@/lib/metaCapi';

export const SITE_JUNK_QUOTE = 'https://sanchezhaulco.com/contact.html';
export const REVIEW_LINK = 'https://g.page/r/sanchez-junk-haul/review'; // shortcut: swap for the real GBP short link in Settings when known
const FEE_TYPES = ['late_fee', 'missing_item', 'damage', 'cleaning', 'adjustment', 'failed_trip', 'extension', 'reschedule_fee', 'expedited_pickup'] as const;
const SOFT_DECLINES = new Set(['insufficient_funds', 'try_again_later', 'processing_error', 'issuer_not_available', 'card_velocity_exceeded']);

export function admin(): SupabaseClient {
  const a = createAdminClient();
  if (!a) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return a;
}
export const cents = (n: number) => Math.round(Number(n) * 100);
export const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
export const todayDetroit = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' })).toISOString().slice(0, 10);
/** First hour of a delivery window like "6-10pm", "8am-12pm" or "12-4pm" (24h clock). Unknown text = midnight, the strictest reading. */
export function windowStartHour(w: string | null | undefined): number {
  const m = /^\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*-\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i.exec(w ?? '');
  if (!m) return 0;
  let h = Number(m[1]) % 12; const startMark = m[2]?.toLowerCase(); const endMark = m[4]?.toLowerCase();
  let end = Number(m[3]) % 12; if (endMark === 'pm') end += 12;
  if (startMark === 'pm' || (!startMark && endMark === 'pm' && h + 12 <= end)) h += 12;
  return h;
}
/** Hours from now until the scheduled delivery window opens. Exactly 48 counts as 48 hours' notice. */
export function hoursBeforeDelivery(r: Pick<Rental, 'delivery_date' | 'delivery_window'>): number {
  return (new Date(detroitAt(r.delivery_date, windowStartHour(r.delivery_window))).getTime() - Date.now()) / 3600_000;
}
export function detroitAt(dateYmd: string, hour: number): string {
  // Detroit wall-clock → UTC ISO. Offset probed via the same date so DST is right.
  const probe = new Date(`${dateYmd}T12:00:00Z`);
  const local = new Date(probe.toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const offsetMs = probe.getTime() - local.getTime();
  return new Date(new Date(`${dateYmd}T${String(hour).padStart(2, '0')}:00:00Z`).getTime() + offsetMs).toISOString();
}
export const fmtDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export type Rental = {
  id: string; rental_number: string; public_token: string; customer_id: string; package_id: string | null; status: string;
  delivery_address: string; pickup_address: string | null; delivery_date: string; delivery_window: string; pickup_date: string; pickup_window: string | null;
  actual_delivered_at: string | null; actual_picked_up_at: string | null; tote_count: number; dolly_count: number; extra_weeks: number;
  subtotal: number; delivery_fee: number; addons_total: number; discount_amount: number; total: number; deposit_amount: number; deposit_status: string; deposit_applied: number; balance_due: number;
  stripe_customer_id: string | null; stripe_payment_method_id: string | null; card_brand: string | null; card_last4: string | null; card_exp: string | null;
  lead_source: string | null; partner_id: string | null; promo_code: string | null; payer_name: string | null; payer_email: string | null; sms_consent_at: string | null;
  abandoned_text_sent_at: string | null; junk_request_id: string | null; disputed_at: string | null; notes_internal: string | null; notes_customer: string | null; created_at: string;
  move_date?: string | null; move_reason?: string | null; home_size?: string | null; junk_interest?: 'yes' | 'maybe' | 'no' | null; lead_score?: number; marketing_sms_consent_at?: string | null; marketing_email_consent_at?: string | null; tax_amount?: number; rush_fee?: number; zone?: string | null; gear?: Record<string, number>; rental_days?: number | null;
  customers?: { id: string; name: string; phone: string | null; email: string | null };
};
export type Charge = { id: string; rental_id: string; type: string; amount: number; description: string | null; stripe_payment_intent_id: string | null; stripe_refund_id: string | null; status: string; failure_reason: string | null; photo_urls: string[]; retry_count: number; next_retry_at: string | null; payment_link_url: string | null; created_at: string };
export type Settings = Record<string, unknown> & { late_grace_days?: number; expedited_pickup_fee?: number | null; reschedule_fee_inside_window?: number | null; lid_fee?: number | null; rush_fee?: number | null; rush_hours?: number; sales_tax_rate?: number; cancel_fee_inside_window?: number | null; cancel_after_delivery_pct?: number; junk_offer_text?: string | null; zones?: unknown[]; late_fee_per_day: number | null; replacement_fee_per_tote: number | null; replacement_fee_per_dolly: number | null; cleaning_fee_per_tote: number | null; damage_fee_per_tote: number | null; failed_trip_fee: number | null; cancel_full_refund_hours: number; balance_charge_mode: string; turnaround_days: number; terms_text: string | null; terms_version: number; templates: Record<string, Partial<{ enabled: boolean; sms: string; email: string; email_subject: string }>> };

export async function getSettings(db = admin()): Promise<Settings> {
  const { data } = await db.from('rental_settings').select('*').eq('id', true).single();
  return data as Settings;
}
export async function getRental(id: string, db = admin()): Promise<Rental> {
  const { data, error } = await db.from('rentals').select('*, customers(id,name,phone,email)').eq('id', id).single();
  if (error || !data) throw new Error(`Rental not found: ${id}`);
  return data as Rental;
}
export async function getRentalByToken(token: string, db = admin()): Promise<Rental> {
  const { data, error } = await db.from('rentals').select('*, customers(id,name,phone,email)').eq('public_token', token).single();
  if (error || !data) throw new Error('Invalid rental link');
  return data as Rental;
}
export async function logEvent(rentalId: string, event: string, detail: Record<string, unknown> = {}, db = admin()) {
  await db.from('rental_events').insert({ rental_id: rentalId, event, detail });
}
export const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'there';
export const rentalLink = (r: Rental) => `${APP_URL}/rental/${r.public_token}`;

/* ---------------- messages ---------------- */
export async function queueMessage(r: Rental, key: RentalTemplateKey, extra: Record<string, string | number | null | undefined> = {}, opts: { at?: string; dedupe?: string; email?: boolean; force?: boolean } = {}, db = admin()) {
  const s = await getSettings(db);
  const t = mergedTemplates(s.templates)[key] ?? DEFAULT_TEMPLATES[key];
  if (!t.enabled && !opts.force) return { skipped: 'disabled' };
  const c = r.customers ?? (await getRental(r.id, db)).customers!;
  const { data: biz } = t.kind === 'promotional' && t.email ? await db.from('business_settings').select('mailing_address').eq('id', true).maybeSingle() : { data: null };
  const vars = {
    unsubscribe_link: `${APP_URL}/api/public/unsubscribe?t=${r.public_token}`, mailing_address_line: biz?.mailing_address ? ` · ${biz.mailing_address}` : '',
    first_name: first(c?.name), rental_number: r.rental_number, delivery_date: fmtDate(r.delivery_date), delivery_window: r.delivery_window,
    pickup_date: fmtDate(r.pickup_date), pickup_window: r.pickup_window ?? r.delivery_window, link: rentalLink(r), receipt_link: `${rentalLink(r)}/receipt`,
    pay_link: '', card_link: `${rentalLink(r)}/card`, junk_link: junkQuoteLink(r, c), review_link: REVIEW_LINK, totes: r.tote_count, window: '',
    junk_offer: r.marketing_sms_consent_at ? 'Tote renters also get $25 off junk removal: sanchezhaulco.com/q' : '', ...extra,
  };
  const rows: Record<string, unknown>[] = [];
  const dedupe = opts.dedupe ?? `${r.id}:${key}`;
  if (c?.phone) rows.push({ rental_id: r.id, template: key, channel: 'sms', to_phone: c.phone, body: renderRental(t.sms, vars), scheduled_at: opts.at ?? new Date().toISOString(), dedupe_key: `${dedupe}:sms` });
  if ((opts.email ?? !!t.email) && t.email && c?.email) rows.push({ rental_id: r.id, template: key, channel: 'email', to_email: c.email, subject: renderRental(t.email_subject ?? 'Your tote rental', vars), body: renderRental(t.email, vars), scheduled_at: opts.at ?? new Date().toISOString(), dedupe_key: `${dedupe}:email` });
  if (!rows.length) return { skipped: 'no_contact' };
  // upsert so a reschedule moves the reminder instead of adding a second one
  const { error } = await db.from('rental_messages').upsert(rows, { onConflict: 'dedupe_key' });
  return { queued: rows.length, error: error?.message };
}
export function junkQuoteLink(r: Rental, c?: { name?: string | null; phone?: string | null; email?: string | null } | null) {
  const q = new URLSearchParams({ source: 'tote_rental', rental: r.rental_number });
  if (c?.name) q.set('name', c.name); if (c?.phone) q.set('phone', c.phone); if (c?.email) q.set('email', c.email); q.set('address', r.pickup_address ?? r.delivery_address);
  return `${SITE_JUNK_QUOTE}?${q.toString()}`;
}
export async function cancelQueued(rentalId: string, keys?: RentalTemplateKey[], db = admin()) {
  let q = db.from('rental_messages').update({ status: 'cancelled' }).eq('rental_id', rentalId).eq('status', 'queued');
  if (keys) q = q.in('template', keys);
  await q;
}
/** Lifecycle reminders keyed by date; safe to call again after a reschedule. */
export async function scheduleLifecycle(r: Rental, db = admin()) {
  const dayBefore = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const plus = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await cancelQueued(r.id, ['delivery_reminder', 'during_rental', 'pickup_reminder'], db);
  // day-before delivery text at 5 pm, skipped when the booking is younger than a day (they just got the confirmation)
  const remindAt = detroitAt(dayBefore(r.delivery_date), 17);
  if (new Date(remindAt).getTime() - new Date(r.created_at).getTime() > 24 * 3600_000) await queueMessage(r, 'delivery_reminder', {}, { at: remindAt, dedupe: `${r.id}:delivery_reminder:${r.delivery_date}` }, db);
  // during the rental: move date plus two days, 6 pm. Promotional: needs marketing consent, not when they said no or already asked for a quote.
  if (r.junk_interest !== 'no' && !r.junk_request_id) await queueMessage(r, 'during_rental', {}, { at: detroitAt(r.move_date ? plus(r.move_date, 2) : plus(r.delivery_date, 3), 18), dedupe: `${r.id}:during_rental` }, db);
  await queueMessage(r, 'pickup_reminder', {}, { at: detroitAt(dayBefore(r.pickup_date), 17), dedupe: `${r.id}:pickup_reminder:${r.pickup_date}` }, db);
}
/** Drain due messages. Texts only inside 8am–8pm Detroit and only to customers who opted in; email any time. */
export async function sendDueMessages(db = admin()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', hour: 'numeric', hour12: false }).format(new Date())) % 24;
  const inQuiet = hour < 8 || hour >= 20;
  const { data: due } = await db.from('rental_messages').select('*, rentals(sms_consent_at, marketing_sms_consent_at, marketing_email_consent_at, status, junk_request_id)').eq('status', 'queued').lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(50);
  let sent = 0, skipped = 0, failed = 0;
  for (const m of due ?? []) {
    const r = m.rentals as { sms_consent_at: string | null; marketing_sms_consent_at: string | null; marketing_email_consent_at: string | null; status: string; junk_request_id: string | null } | null;
    const kind = (DEFAULT_TEMPLATES[m.template as RentalTemplateKey]?.kind ?? 'transactional');
    if (r?.status === 'cancelled' && !['abandoned', 'receipt'].includes(m.template)) { await db.from('rental_messages').update({ status: 'cancelled' }).eq('id', m.id); continue; }
    if (m.template === 'during_rental' && r?.junk_request_id) { await db.from('rental_messages').update({ status: 'cancelled', error: 'junk quote already requested' }).eq('id', m.id); continue; }
    if (m.channel === 'sms') {
      if (inQuiet) continue; // stays queued until the window opens
      if (kind === 'promotional' && !r?.marketing_sms_consent_at) { await db.from('rental_messages').update({ status: 'skipped', error: 'no marketing consent' }).eq('id', m.id); skipped++; continue; }
      if (m.rental_id) { const { count } = await db.from('rental_messages').select('id', { count: 'exact', head: true }).eq('rental_id', m.rental_id).eq('channel', 'sms').eq('status', 'sent'); if ((count ?? 0) >= 6 && kind === 'promotional') { await db.from('rental_messages').update({ status: 'skipped', error: 'six text cap' }).eq('id', m.id); skipped++; continue; } }
      const { data: opt } = await db.from('sms_opt_outs').select('phone').eq('phone', m.to_phone).maybeSingle();
      if (opt) { await db.from('rental_messages').update({ status: 'skipped', error: 'opted out (STOP)' }).eq('id', m.id); skipped++; continue; }
      const res = await sendText({ to: m.to_phone, content: m.body, event: `sms:rental_${m.template}`, entityKind: 'rental', entityId: m.rental_id ?? undefined, markInboxDone: true });
      if (res.ok) { sent++; await db.from('rental_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', m.id); await logEvent(m.rental_id, `sms:${m.template}`, { to: m.to_phone }, db); }
      else { failed++; await db.from('rental_messages').update({ status: res.skipped ? 'skipped' : 'failed', error: res.error ?? res.skipped ?? null }).eq('id', m.id); }
    } else {
      if (kind === 'promotional' && !r?.marketing_email_consent_at) { await db.from('rental_messages').update({ status: 'skipped', error: 'no email marketing consent' }).eq('id', m.id); skipped++; continue; }
      const res = await sendNotification({ event: `rental_${m.template}`, to: m.to_email, subject: m.subject ?? 'Your tote rental', text: m.body, entityKind: 'estimate', entityId: undefined });
      if (res.ok) { sent++; await db.from('rental_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', m.id); await logEvent(m.rental_id, `email:${m.template}`, { to: m.to_email }, db); }
      else { failed++; await db.from('rental_messages').update({ status: res.skipped ? 'skipped' : 'failed', error: res.error ?? res.skipped ?? null }).eq('id', m.id); }
    }
  }
  return { sent, skipped, failed, quiet_hours: inQuiet };
}

/* ---------------- charges ---------------- */
async function ensureCard(r: Rental): Promise<{ customer: string; pm: string }> {
  if (!r.stripe_customer_id || !r.stripe_payment_method_id) throw new Error('No card on file for this rental.');
  return { customer: r.stripe_customer_id, pm: r.stripe_payment_method_id };
}
/** Create a charge row of any type and try the saved card. Handles requires_action → hosted link + text, soft declines → retry schedule. */
export async function chargeRental(rentalId: string, a: { type: typeof FEE_TYPES[number] | 'balance' | 'rental_payment'; amount: number; description: string; photo_urls?: string[]; created_by?: string | null; charge_id?: string }, db = admin()) {
  const r = await getRental(rentalId, db);
  const amt = Math.round(Number(a.amount) * 100) / 100;
  if (amt <= 0) throw new Error('Amount must be more than $0.');
  let chargeId = a.charge_id;
  if (!chargeId) {
    const { data, error } = await db.from('rental_charges').insert({ rental_id: r.id, type: a.type, amount: amt, description: a.description, status: 'pending', photo_urls: a.photo_urls ?? [], created_by: a.created_by ?? null }).select('id').single();
    if (error) throw new Error(error.message);
    chargeId = data.id as string;
  }
  return attemptCharge(r, chargeId, db);
}
export async function attemptCharge(r: Rental, chargeId: string, db = admin()) {
  const { data: ch } = await db.from('rental_charges').select('*').eq('id', chargeId).single();
  if (!ch) throw new Error('Charge not found');
  if (ch.status === 'succeeded') return { ok: true, charge: ch as Charge, already: true };
  const { customer, pm } = await ensureCard(r);
  const res = await chargeOffSession({ cents: cents(ch.amount), customer, payment_method: pm, description: `${r.rental_number}: ${ch.description ?? ch.type}`, rental_id: r.id, rental_number: r.rental_number, charge_id: ch.id, charge_type: ch.type, attempt: Number(ch.retry_count ?? 0) });
  if (res.ok) {
    await db.from('rental_charges').update({ status: 'succeeded', stripe_payment_intent_id: res.payment_intent_id, failure_reason: null, next_retry_at: null }).eq('id', ch.id);
    await logEvent(r.id, 'charge:succeeded', { charge_id: ch.id, type: ch.type, amount: ch.amount, pi: res.payment_intent_id }, db);
    await queueMessage(r, 'receipt', { receipt_link: `${rentalLink(r)}/receipt` }, { dedupe: `${r.id}:receipt:${ch.id}`, email: true }, db);
    return { ok: true, charge: { ...ch, status: 'succeeded' } as Charge };
  }
  if (res.requires_action) {
    const link = await createHostedPaymentLink({ cents: cents(ch.amount), description: `Tote rental ${r.rental_number}: ${ch.description ?? ch.type}`, rental_id: r.id, charge_id: ch.id, customer });
    await db.from('rental_charges').update({ status: 'requires_action', stripe_payment_intent_id: res.payment_intent_id || null, failure_reason: 'Bank asked for authentication', payment_link_url: link }).eq('id', ch.id);
    await logEvent(r.id, 'charge:requires_action', { charge_id: ch.id, amount: ch.amount, link }, db);
    await queueMessage(r, 'payment_failed', { pay_link: link }, { dedupe: `${r.id}:payment_failed:${ch.id}` }, db);
    return { ok: false, requires_action: true, link, charge: ch as Charge };
  }
  const soft = SOFT_DECLINES.has(res.decline_code ?? '');
  const retry = ch.retry_count === 0 ? 24 : ch.retry_count === 1 ? 72 : null;
  const next = soft && retry ? new Date(Date.now() + retry * 3600_000).toISOString() : null;
  await db.from('rental_charges').update({ status: 'failed', stripe_payment_intent_id: res.payment_intent_id || null, failure_reason: res.error ?? res.decline_code ?? 'declined', retry_count: ch.retry_count + 1, next_retry_at: next }).eq('id', ch.id);
  await logEvent(r.id, 'charge:failed', { charge_id: ch.id, amount: ch.amount, reason: res.error, decline_code: res.decline_code, next_retry_at: next }, db);
  if (!next) {
    const link = await createHostedPaymentLink({ cents: cents(ch.amount), description: `Tote rental ${r.rental_number}: ${ch.description ?? ch.type}`, rental_id: r.id, charge_id: ch.id, customer });
    await db.from('rental_charges').update({ payment_link_url: link }).eq('id', ch.id);
    await queueMessage(r, 'payment_failed', { pay_link: link }, { dedupe: `${r.id}:payment_failed:${ch.id}` }, db);
    await sendNotification({ event: 'rental_charge_failed', to: process.env.NOTIFY_EMAIL ?? '', subject: `Rental ${r.rental_number}: card declined ${money(ch.amount)}`, text: `${r.customers?.name}: ${res.error}\n${APP_URL}/rentals/${r.id}` }).catch(() => {});
  }
  return { ok: false, charge: ch as Charge, error: res.error, next_retry_at: next };
}
/** Charge the remaining base balance (delivery day, pickup, or booking per settings). */
export async function chargeBalance(rentalId: string, db = admin()) {
  const r = await getRental(rentalId, db);
  const { data: open } = await db.from('rental_charges').select('id').eq('rental_id', r.id).eq('type', 'balance').in('status', ['pending', 'failed', 'requires_action']).limit(1);
  if (open?.[0]) return attemptCharge(r, open[0].id, db);
  const base = Math.max(Number(r.total) - Number(r.deposit_applied) - Number(await paidBase(r.id, db)), 0);
  if (base <= 0) return { ok: true, nothing_due: true };
  return chargeRental(r.id, { type: 'balance', amount: base, description: 'Rental balance' }, db);
}
async function paidBase(rentalId: string, db: SupabaseClient) {
  const { data } = await db.from('rental_charges').select('amount').eq('rental_id', rentalId).eq('status', 'succeeded').in('type', ['balance', 'rental_payment']);
  return (data ?? []).reduce((s, c) => s + Number(c.amount), 0);
}
/** Check-in settlement: apply the held deposit first, charge the remainder in ONE tap, refund any deposit left over. */
export async function settle(rentalId: string, db = admin()) {
  const r = await getRental(rentalId, db);
  const { data: pend } = await db.from('rental_charges').select('*').eq('rental_id', r.id).in('status', ['pending', 'failed', 'requires_action']).in('type', [...FEE_TYPES, 'balance']);
  const owed = Math.round(Number(r.balance_due) * 100) / 100;
  const result: Record<string, unknown> = { owed };
  let remaining = owed;
  if (r.deposit_status === 'held' && Number(r.deposit_amount) > 0) {
    const apply = Math.min(Number(r.deposit_amount), owed);
    const leftover = Math.round((Number(r.deposit_amount) - apply) * 100) / 100;
    await db.from('rentals').update({ deposit_applied: apply, deposit_status: 'applied' }).eq('id', r.id);
    await logEvent(r.id, 'deposit:applied', { applied: apply, leftover }, db);
    result.deposit_applied = apply;
    remaining = Math.round((owed - apply) * 100) / 100;
    if (leftover > 0) {
      const { data: dep } = await db.from('rental_charges').select('stripe_payment_intent_id').eq('rental_id', r.id).eq('type', 'deposit').eq('status', 'succeeded').maybeSingle();
      if (dep?.stripe_payment_intent_id) {
        const rf = await refundIntent({ payment_intent: dep.stripe_payment_intent_id, cents: cents(leftover), reason: 'deposit leftover', idempotencyKey: `deprefund:${r.id}` });
        await db.from('rental_charges').insert({ rental_id: r.id, type: 'refund', amount: -leftover, description: 'Deposit returned (leftover after settlement)', stripe_refund_id: rf.id, status: 'succeeded' });
        await db.from('rentals').update({ deposit_status: 'refunded' }).eq('id', r.id);
        result.deposit_refunded = leftover;
      }
    }
  }
  // pending fee rows are covered by the settlement; mark them so they stop counting as collected elsewhere
  const feeIds = (pend ?? []).filter((c) => c.type !== 'balance').map((c) => c.id);
  if (remaining > 0) {
    const c = r.customers;
    const lines = [`rental ${money(Number(r.total))}`, ...(pend ?? []).filter((x) => x.type !== 'balance').map((x) => `${x.description ?? x.type} ${money(Number(x.amount))}`), ...(Number(r.deposit_applied ?? 0) > 0 ? [`deposit applied -${money(Number(r.deposit_applied))}`] : [])];
    if (c?.phone) {
      const notice = await sendText({ to: c.phone, content: `Hi ${first(c.name)}, Sanchez Junk & Haul Co. here. Your totes are picked up. Total for rental ${r.rental_number}: ${money(remaining)} (${lines.join(', ')}). We're charging your ${r.card_brand ?? 'card'} ending ${r.card_last4 ?? ''} now; a receipt follows.`, event: 'sms:rental_pickup_total', entityKind: 'rental', entityId: r.id });
      await logEvent(r.id, 'sms:pickup_total', { ok: notice.ok, amount: remaining, error: notice.error ?? null }, db);
    }
    const { data: row, error } = await db.from('rental_charges').insert({ rental_id: r.id, type: 'balance', amount: remaining, description: `Settlement after check-in${feeIds.length ? ` (${feeIds.length} line${feeIds.length === 1 ? '' : 's'})` : ''}` , status: 'pending' }).select('id').single();
    if (error) throw new Error(error.message);
    for (const c of pend ?? []) await db.from('rental_charges').update({ status: c.type === 'balance' ? 'void' : 'succeeded', description: `${c.description ?? c.type} (in settlement)` }).eq('id', c.id);
    const res = await attemptCharge(await getRental(r.id, db), row.id, db);
    result.charge = res;
  } else {
    for (const c of pend ?? []) await db.from('rental_charges').update({ status: c.type === 'balance' ? 'void' : 'succeeded', description: `${c.description ?? c.type} (covered by deposit)` }).eq('id', c.id);
    result.charge = { ok: true, covered_by_deposit: true };
    if (owed > 0) await queueMessage(r, 'receipt', {}, { dedupe: `${r.id}:receipt:settle:${Date.now()}`, email: true }, db);
  }
  await db.rpc('rental_recompute_balance', { p_rental: r.id });
  await maybeClose(r.id, db);
  return result;
}
export async function refundCharge(chargeId: string, amount: number | null, reason: string, db = admin()) {
  const { data: ch } = await db.from('rental_charges').select('*').eq('id', chargeId).single();
  if (!ch) throw new Error('Charge not found');
  const r = await getRental(ch.rental_id, db);
  const full = amount == null || Number(amount) >= Number(ch.amount);
  const amt = full ? Number(ch.amount) : Number(amount);
  let pi = ch.stripe_payment_intent_id as string | null;
  if (!pi) { // fee covered by a settlement or the deposit → refund from that payment intent
    const { data: src } = await db.from('rental_charges').select('stripe_payment_intent_id').eq('rental_id', r.id).eq('status', 'succeeded').not('stripe_payment_intent_id', 'is', null).in('type', ['balance', 'deposit']).order('created_at', { ascending: false }).limit(1);
    pi = src?.[0]?.stripe_payment_intent_id ?? null;
  }
  if (!pi) throw new Error('No Stripe payment to refund against.');
  const rf = await refundIntent({ payment_intent: pi, cents: cents(amt), reason, idempotencyKey: `refund:${ch.id}:${cents(amt)}` });
  if (ch.type === 'deposit') {
    await db.from('rentals').update({ deposit_status: 'refunded' }).eq('id', r.id);
    await db.from('rental_charges').update({ status: full ? 'refunded' : ch.status, stripe_refund_id: rf.id }).eq('id', ch.id);
  } else if ((FEE_TYPES as readonly string[]).includes(ch.type)) {
    await db.from('rental_charges').update({ status: full ? 'refunded' : 'succeeded', amount: full ? ch.amount : Number(ch.amount) - amt, stripe_refund_id: rf.id }).eq('id', ch.id);
  } else {
    await db.from('rental_charges').update({ amount: Number(ch.amount) - amt, status: full ? 'refunded' : 'succeeded', stripe_refund_id: rf.id }).eq('id', ch.id);
  }
  await db.from('rental_charges').insert({ rental_id: r.id, type: 'refund', amount: -amt, description: `Refund: ${reason}`, stripe_refund_id: rf.id, status: 'succeeded' });
  await logEvent(r.id, 'refund', { charge_id: ch.id, amount: amt, reason, refund: rf.id }, db);
  await queueMessage(r, 'receipt', {}, { dedupe: `${r.id}:receipt:refund:${rf.id}`, email: true }, db);
  return { ok: true, refund_id: rf.id, amount: amt };
}

/* ---------------- lifecycle ---------------- */
export async function recordDelivery(rentalId: string, a: { tags: string[]; photo_urls?: string[]; created_by?: string | null }, db = admin()) {
  const r = await getRental(rentalId, db);
  if (!['booked', 'delivered'].includes(r.status)) throw new Error(`Rental is ${r.status}; only a booked rental can be delivered.`);
  const { data: assets } = await db.from('rental_assets').select('id, asset_tag, asset_type, status').in('asset_tag', a.tags);
  const missing = a.tags.filter((t) => !assets?.some((x) => x.asset_tag === t));
  if (missing.length) throw new Error(`Unknown tags: ${missing.join(', ')}`);
  const busy = (assets ?? []).filter((x) => !['available', 'reserved'].includes(x.status));
  if (busy.length) throw new Error(`Not available: ${busy.map((x) => `${x.asset_tag} (${x.status})`).join(', ')}`);
  const now = new Date().toISOString();
  for (const x of assets ?? []) {
    await db.from('rental_items').upsert({ rental_id: r.id, asset_id: x.id, checked_out_at: now, photo_urls: a.photo_urls ?? [] }, { onConflict: 'rental_id,asset_id' });
    await db.from('rental_assets').update({ status: 'out' }).eq('id', x.id);
  }
  await db.from('rentals').update({ status: 'delivered', actual_delivered_at: now }).eq('id', r.id);
  await logEvent(r.id, 'delivered', { tags: a.tags, photos: a.photo_urls?.length ?? 0, by: a.created_by ?? null }, db);
  const fresh = await getRental(r.id, db);
  await queueMessage(fresh, 'delivered', {}, {}, db);
  const s = await getSettings(db);
  let charge: unknown = null;
  if (s.balance_charge_mode === 'delivery') charge = await chargeBalance(r.id, db).catch((e: Error) => ({ ok: false, error: e.message }));
  return { ok: true, rental: await getRental(r.id, db), balance_charge: charge };
}
export async function recordPickup(rentalId: string, a: { items: { tag: string; condition: 'good' | 'dirty' | 'damaged' | 'missing'; photo_urls?: string[] }[]; missing_lids?: number; created_by?: string | null }, db = admin()) {
  const r = await getRental(rentalId, db);
  const s = await getSettings(db);
  const { data: items } = await db.from('rental_items').select('id, asset_id, rental_assets(asset_tag, asset_type)').eq('rental_id', r.id);
  const now = new Date().toISOString();
  const counts = { missing_tote: 0, damaged: 0, dirty: 0 };
  const gearOut: { tag: string; type: string; condition: string }[] = [];
  for (const it of a.items) {
    const row = (items ?? []).find((x) => (x.rental_assets as unknown as { asset_tag: string })?.asset_tag === it.tag);
    if (!row) throw new Error(`${it.tag} is not on this rental.`);
    if (it.condition !== 'good' && !(it.photo_urls?.length)) throw new Error(`${it.tag}: a photo is required for ${it.condition}.`);
    const type = (row.rental_assets as unknown as { asset_type: string }).asset_type;
    await db.from('rental_items').update({ checked_in_at: now, return_condition: it.condition, photo_urls: it.photo_urls ?? [] }).eq('id', row.id);
    const assetStatus = it.condition === 'good' ? 'available' : it.condition === 'dirty' ? 'returned_dirty' : it.condition === 'damaged' ? 'damaged' : 'lost';
    await db.from('rental_assets').update({ status: assetStatus }).eq('id', row.asset_id);
    if (type !== 'tote') { if (it.condition === 'missing' || it.condition === 'damaged') gearOut.push({ tag: it.tag, type, condition: it.condition }); continue; }
    if (it.condition === 'missing') counts.missing_tote++;
    if (it.condition === 'damaged') counts.damaged++;
    if (it.condition === 'dirty') counts.dirty++;
  }
  const photos = a.items.flatMap((i) => i.photo_urls ?? []);
  const lines: { type: string; amount: number; description: string }[] = [];
  const add = (n: number, fee: number | null, type: string, label: string) => { if (n > 0 && fee) lines.push({ type, amount: Math.round(n * fee * 100) / 100, description: `${n} × ${label} at ${money(fee)}` }); };
  add(counts.missing_tote, s.replacement_fee_per_tote, 'missing_item', 'missing tote');
  add(Math.max(0, Math.floor(Number(a.missing_lids ?? 0))), (s.lid_fee as number | null) ?? null, 'missing_item', 'missing lid');
  // equipment: a missing piece is billed at its listed replacement fee; damage to equipment is reviewed by hand (no automatic fee)
  if (gearOut.some((g) => g.condition === 'missing')) {
    const { data: fees } = await db.from('rental_addons').select('asset_type, name, replacement_fee').eq('kind', 'rent');
    for (const g of gearOut.filter((x) => x.condition === 'missing')) {
      const f = (fees ?? []).find((x) => x.asset_type === g.type && x.replacement_fee != null) ?? (g.type === 'dolly' ? { name: 'tote dolly', replacement_fee: s.replacement_fee_per_dolly } : null);
      if (f?.replacement_fee) lines.push({ type: 'missing_item', amount: Number(f.replacement_fee), description: `Missing ${f.name ?? g.type} ${g.tag} at ${money(Number(f.replacement_fee))}` });
    }
  }
  add(counts.damaged, s.damage_fee_per_tote, 'damage', 'damaged tote');
  add(counts.dirty, s.cleaning_fee_per_tote, 'cleaning', 'cleaning');
  for (const l of lines) await db.from('rental_charges').insert({ rental_id: r.id, ...l, status: 'pending', photo_urls: photos, created_by: a.created_by ?? null });
  await db.rpc('rental_accrue_late_fees');
  await db.from('rentals').update({ status: 'returned', actual_picked_up_at: now }).eq('id', r.id);
  await logEvent(r.id, 'picked_up', { ...counts, gear: gearOut, lines: lines.length, by: a.created_by ?? null }, db);
  await cancelQueued(r.id, ['pickup_reminder', 'during_rental', 'overdue_1', 'overdue_3'], db);
  const plus = (n: number) => { const d = new Date(`${todayDetroit()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  await queueMessage(r, 'after_pickup', {}, { at: detroitAt(plus(1), 10), dedupe: `${r.id}:after_pickup` }, db);
  await queueMessage(r, 'referral', {}, { at: detroitAt(plus(7), 18), dedupe: `${r.id}:referral` }, db);
  return { ok: true, counts, review: await chargesReview(r.id, db) };
}
export async function chargesReview(rentalId: string, db = admin()) {
  const r = await getRental(rentalId, db);
  const { data: pending } = await db.from('rental_charges').select('*').eq('rental_id', r.id).in('status', ['pending', 'failed', 'requires_action']).order('created_at');
  const base = Math.max(Number(r.total) - Number(r.deposit_applied) - Number(await paidBase(r.id, db)), 0);
  return { rental_number: r.rental_number, unpaid_balance: Math.round(base * 100) / 100, lines: pending ?? [], deposit_held: r.deposit_status === 'held' ? Number(r.deposit_amount) : 0, balance_due: Number(r.balance_due) };
}
export async function maybeClose(rentalId: string, db = admin()) {
  const r = await getRental(rentalId, db);
  if (!['returned', 'inspected'].includes(r.status)) return false;
  const { data: items } = await db.from('rental_items').select('checked_in_at').eq('rental_id', r.id);
  const allIn = (items ?? []).every((i) => i.checked_in_at);
  if (Number(r.balance_due) > 0 || !allIn) { if (r.status === 'returned') await db.from('rentals').update({ status: 'inspected' }).eq('id', r.id); return false; }
  await db.from('rentals').update({ status: 'closed' }).eq('id', r.id);
  await logEvent(r.id, 'closed', {}, db);
  return true;
}
export async function foundItem(rentalId: string, tag: string, db = admin()) {
  const r = await getRental(rentalId, db);
  const { data: item } = await db.from('rental_items').select('id, asset_id, rental_assets(asset_tag, asset_type)').eq('rental_id', r.id).eq('rental_assets.asset_tag', tag).limit(1).maybeSingle();
  const row = item ?? (await db.from('rental_items').select('id, asset_id, rental_assets(asset_tag, asset_type)').eq('rental_id', r.id)).data?.find((x) => (x.rental_assets as unknown as { asset_tag: string })?.asset_tag === tag);
  if (!row) throw new Error(`${tag} is not on this rental.`);
  const type = (row.rental_assets as unknown as { asset_type: string }).asset_type;
  const s = await getSettings(db);
  const fee = type === 'dolly' ? s.replacement_fee_per_dolly : s.replacement_fee_per_tote;
  await db.from('rental_items').update({ return_condition: 'good', checked_in_at: new Date().toISOString() }).eq('id', row.id);
  await db.from('rental_assets').update({ status: 'available' }).eq('id', row.asset_id);
  const { data: line } = await db.from('rental_charges').select('*').eq('rental_id', r.id).eq('type', 'missing_item').in('status', ['succeeded', 'pending']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let refund: unknown = null;
  if (line) {
    if (line.status === 'pending') await db.from('rental_charges').update({ status: 'void', description: `${line.description} (item found)` }).eq('id', line.id);
    else if (fee) refund = await refundCharge(line.id, Math.min(Number(fee), Number(line.amount)), `${tag} returned`, db);
  }
  await logEvent(r.id, 'item_found', { tag }, db);
  return { ok: true, refund };
}
export async function extendRental(rentalId: string, weeks: number, db = admin()) {
  const r = await getRental(rentalId, db);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new Error('Extend by 1 to 12 whole weeks. Need longer? Call or text us.');
  const { data: pkg } = await db.from('rental_packages').select('extra_week_price').eq('id', r.package_id).single();
  const price = Number(pkg?.extra_week_price ?? 0);
  if (!price) throw new Error('No extra week price on this package.');
  const s = await getSettings(db);
  const newPickup = new Date(`${r.pickup_date}T12:00:00Z`); newPickup.setUTCDate(newPickup.getUTCDate() + 7 * weeks);
  const np = newPickup.toISOString().slice(0, 10);
  const from = new Date(`${r.pickup_date}T12:00:00Z`); from.setUTCDate(from.getUTCDate() + s.turnaround_days + 1);
  const end = new Date(`${np}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + s.turnaround_days);
  const { data: fit } = await db.rpc('rental_can_fit', { p_start: from.toISOString().slice(0, 10), p_end: end.toISOString().slice(0, 10), p_totes: r.tote_count, p_dollies: r.dolly_count });
  if (!fit) return { ok: false, error: 'Those extra days are not available. Call or text us and we will work something out.' };
  const amount = Math.round(price * weeks * 100) / 100;
  await db.from('rental_charges').insert({ rental_id: r.id, type: 'extension', amount, description: `Extension: ${weeks} week${weeks === 1 ? '' : 's'}`, status: 'pending' });   // billed with the pickup charge
  await db.rpc('rental_recompute_balance', { p_rental: r.id });
  await db.from('rentals').update({ pickup_date: np, extra_weeks: r.extra_weeks + weeks, total: Number(r.total) }).eq('id', r.id);
  const { data: lateRows } = await db.from('rental_charges').select('id, description').eq('rental_id', r.id).eq('type', 'late_fee').eq('status', 'pending').order('created_at').limit(weeks);
  for (const l of lateRows ?? []) await db.from('rental_charges').update({ status: 'void', description: `${l.description ?? 'Late week'} (covered by extension)` }).eq('id', l.id);
  await logEvent(r.id, 'extended', { weeks, new_pickup_date: np, amount, late_weeks_replaced: lateRows?.length ?? 0 }, db);
  const fresh = await getRental(r.id, db);
  await scheduleLifecycle(fresh, db);
  await queueMessage(fresh, 'reschedule', { window: `pickup now ${fmtDate(np)}` }, { dedupe: `${r.id}:reschedule:${Date.now()}` }, db);
  return { ok: true, pickup_date: np, amount };
}
/**
 * Move dates. customer_requested decides who pays: a customer's delivery change inside the notice window costs the
 * reschedule fee, an expedited early pickup costs the expedited fee, and a later pickup is an extension (billed by the
 * week through extendRental). A company-side move is free and voids any late weeks already accrued.
 */
export function rescheduleFees(r: Rental, s: Settings, a: { delivery_date?: string; delivery_window?: string; pickup_date?: string; customer_requested?: boolean; expedited?: boolean }) {
  const nd = a.delivery_date ?? r.delivery_date, np = a.pickup_date ?? r.pickup_date;
  const delivered = !!r.actual_delivered_at || ['delivered', 'out', 'pickup_scheduled'].includes(r.status);
  const deliveryMoved = !delivered && (nd !== r.delivery_date || (a.delivery_window != null && a.delivery_window !== r.delivery_window));
  const lines: { type: 'reschedule_fee' | 'expedited_pickup'; amount: number; description: string }[] = [];
  if (!a.customer_requested) return { lines, deliveryMoved, laterPickup: np > r.pickup_date, earlierPickup: np < r.pickup_date };
  if (np > r.pickup_date) throw new Error('A later pickup is an extension. Use Extend, billed by the week at the package extra week rate.');
  const hours = hoursBeforeDelivery(r);
  const feeInside = Number(s.reschedule_fee_inside_window ?? 0);
  if (deliveryMoved && hours < Number(s.cancel_full_refund_hours ?? 48) && feeInside > 0) lines.push({ type: 'reschedule_fee', amount: feeInside, description: `Delivery date change with ${Math.max(Math.floor(hours), 0)} hours' notice (under ${s.cancel_full_refund_hours})` });
  if (np < r.pickup_date && a.expedited && Number(s.expedited_pickup_fee ?? 0) > 0) lines.push({ type: 'expedited_pickup', amount: Number(s.expedited_pickup_fee), description: `Expedited early pickup ${fmtDate(np)}` });
  return { lines, deliveryMoved, laterPickup: false, earlierPickup: np < r.pickup_date };
}
export async function reschedule(rentalId: string, a: { delivery_date?: string; delivery_window?: string; pickup_date?: string; pickup_window?: string; by?: string; customer_requested?: boolean; expedited?: boolean; preview?: boolean }, db = admin()) {
  const r = await getRental(rentalId, db);
  const s = await getSettings(db);
  const nd = a.delivery_date ?? r.delivery_date, np = a.pickup_date ?? r.pickup_date;
  if (np < nd) throw new Error('Pickup must be after delivery.');
  const fees = rescheduleFees(r, s, a);
  if (a.preview) return { ok: true, preview: { fees: fees.lines, total_fee: fees.lines.reduce((t, l) => t + l.amount, 0), hours_before_delivery: Math.round(hoursBeforeDelivery(r)) }, rental: r };
  if (nd !== r.delivery_date || np !== r.pickup_date) {
    // this rental's own counts are already in the availability picture; only check days it did not already occupy
    const end = new Date(`${np}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + s.turnaround_days);
    const { data: avail } = await db.rpc('get_tote_availability', { start_date: nd, end_date: end.toISOString().slice(0, 10) });
    const oldEnd = new Date(`${r.pickup_date}T12:00:00Z`); oldEnd.setUTCDate(oldEnd.getUTCDate() + s.turnaround_days);
    const oe = oldEnd.toISOString().slice(0, 10);
    const bad = (avail as { day: string; totes_free: number; dollies_free: number }[] | null)?.find((d) => !(d.day >= r.delivery_date && d.day <= oe && ['booked', 'delivered', 'out', 'pickup_scheduled'].includes(r.status)) && (d.totes_free < r.tote_count || d.dollies_free < r.dolly_count));
    if (bad) throw new Error(`Not enough totes free on ${fmtDate(bad.day)}.`);
  }
  await db.from('rentals').update({ delivery_date: nd, delivery_window: a.delivery_window ?? r.delivery_window, pickup_date: np, pickup_window: a.pickup_window ?? r.pickup_window, status: r.status === 'delivered' || r.status === 'out' ? 'pickup_scheduled' : r.status }).eq('id', r.id);
  await logEvent(r.id, 'rescheduled', { ...a, who: a.customer_requested ? 'customer' : 'company', fees: fees.lines }, db);
  if (!a.customer_requested && fees.laterPickup) {
    // company-caused delay: the customer is never billed late weeks for a pickup we moved
    const { data: late } = await db.from('rental_charges').select('id, description').eq('rental_id', r.id).eq('type', 'late_fee').eq('status', 'pending');
    for (const l of late ?? []) await db.from('rental_charges').update({ status: 'void', description: `${l.description ?? 'Late week'} (pickup moved by us)` }).eq('id', l.id);
    if (late?.length) await logEvent(r.id, 'late_fees_voided', { count: late.length, reason: 'company delay' }, db);
  }
  const charges = [];
  for (const l of fees.lines) charges.push(await chargeRental(r.id, { ...l, created_by: a.by ?? null }, db).catch((e: Error) => ({ ok: false, error: e.message })));
  const fresh = await getRental(r.id, db);
  await scheduleLifecycle(fresh, db);
  await queueMessage(fresh, 'reschedule', { window: `delivery ${fmtDate(nd)} ${fresh.delivery_window}, pickup ${fmtDate(np)} ${fresh.pickup_window ?? ''}` }, { dedupe: `${r.id}:reschedule:${Date.now()}` }, db);
  return { ok: true, rental: fresh, charges };
}
export async function cancelRental(rentalId: string, a: { reason?: string; by?: string; preview?: boolean }, db = admin()) {
  const r = await getRental(rentalId, db);
  const s = await getSettings(db);
  const hoursOut = r.delivery_date ? hoursBeforeDelivery(r) : Infinity;   // a request has no delivery date yet
  const delivered = !!r.actual_delivered_at || ['delivered', 'out', 'pickup_scheduled'].includes(r.status);
  const { data: paid } = await db.from('rental_charges').select('*').eq('rental_id', r.id).eq('status', 'succeeded').in('type', ['deposit', 'balance', 'rental_payment']);
  const paidTotal = (paid ?? []).reduce((sum, c) => sum + Number(c.amount), 0);
  const pkgPrice = Number(r.subtotal); // package price including any extra weeks
  const request = ['pending_payment', 'awaiting_confirmation'].includes(r.status);   // no date confirmed yet: free
  const fullRefund = request || (!delivered && hoursOut >= s.cancel_full_refund_hours);
  const kept = delivered ? Math.round(pkgPrice * (Number(s.cancel_after_delivery_pct ?? 50) / 100) * 100) / 100 : fullRefund ? 0 : Number(s.cancel_fee_inside_window ?? 0);
  const refundable = Math.max(Math.round((paidTotal - kept) * 100) / 100, 0);
  const policy = `Free with ${s.cancel_full_refund_hours}+ hours' notice before the delivery window; ${money(s.cancel_fee_inside_window ?? 0)} fee with less notice; after delivery ${Number(s.cancel_after_delivery_pct ?? 50)}% of the package price is kept.`;
  const preview = { rental_number: r.rental_number, hours_before_delivery: Math.round(hoursOut), full_refund: fullRefund, delivered, kept, refund_amount: refundable, policy };
  if (a.preview) return { ok: true, preview };
  if (['closed', 'cancelled'].includes(r.status)) throw new Error(`Rental is already ${r.status}.`);
  let left = refundable;
  for (const c of paid ?? []) {
    if (left <= 0) break;
    if (!c.stripe_payment_intent_id) continue;
    const amt = Math.min(Number(c.amount), left);
    await refundCharge(c.id, amt, `Cancellation (${fullRefund ? 'full refund' : `${money(kept)} kept per policy`})`, db).catch((e: Error) => logEvent(r.id, 'refund:failed', { charge_id: c.id, error: e.message }, db));
    left = Math.round((left - amt) * 100) / 100;
  }
  // pay at pickup: little or nothing is paid up front, so the fee kept per policy is charged to the saved card
  const owe = Math.round((kept - paidTotal) * 100) / 100;
  if (owe > 0 && r.stripe_payment_method_id) await chargeRental(r.id, { type: 'adjustment', amount: owe, description: `Cancellation fee per policy (${delivered ? 'after delivery' : `under ${s.cancel_full_refund_hours} hours' notice`})` }, db).catch((e: Error) => logEvent(r.id, 'cancel_fee:failed', { error: e.message }, db));
  const { data: items } = await db.from('rental_items').select('asset_id').eq('rental_id', r.id).is('checked_in_at', null);
  for (const it of items ?? []) await db.from('rental_assets').update({ status: 'available' }).eq('id', it.asset_id);
  await db.from('rentals').update({ status: 'cancelled', notes_internal: [r.notes_internal, `Cancelled ${todayDetroit()}: ${a.reason ?? ''} (kept ${money(kept)}, refunded ${money(refundable)})`].filter(Boolean).join('\n') }).eq('id', r.id);
  await cancelQueued(r.id, undefined, db);
  await logEvent(r.id, 'cancelled', { ...preview, by: a.by ?? null }, db);
  return { ok: true, preview };
}
export async function failedTrip(rentalId: string, a: { kind: 'delivery' | 'pickup'; photo_urls?: string[]; note?: string; by?: string }, db = admin()) {
  const r = await getRental(rentalId, db);
  // terms: every missed delivery adds a second trip at the zone delivery rate to the pickup charge; a missed pickup is rescheduled with no fee
  const fee = a.kind === 'delivery' ? Number(r.delivery_fee) : 0;
  await logEvent(r.id, 'failed_trip', { ...a, fee }, db);
  if (fee > 0) await db.from('rental_charges').insert({ rental_id: r.id, type: 'failed_trip', amount: fee, description: `Second delivery trip (${r.zone ?? 'zone'} rate): ${a.note ?? 'no one home'}`, status: 'pending', photo_urls: a.photo_urls ?? [], created_by: a.by ?? null });
  await db.rpc('rental_recompute_balance', { p_rental: r.id });
  await queueMessage(r, fee > 0 ? 'failed_trip' : 'failed_trip_free', { fee: money(fee) }, { dedupe: `${r.id}:failed_trip:${Date.now()}` }, db);
  return { ok: true, fee, free: fee === 0 };
}

export async function evidencePacket(rentalId: string, db = admin()) {
  const r = await getRental(rentalId, db);
  const [{ data: agreement }, { data: items }, { data: charges }, { data: events }, { data: msgs }] = await Promise.all([
    db.from('rental_agreements').select('*').eq('rental_id', r.id).order('signed_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('rental_items').select('*, rental_assets(asset_tag, asset_type)').eq('rental_id', r.id),
    db.from('rental_charges').select('*').eq('rental_id', r.id).order('created_at'),
    db.from('rental_events').select('*').eq('rental_id', r.id).order('created_at'),
    db.from('rental_messages').select('template, channel, body, status, sent_at').eq('rental_id', r.id).order('created_at'),
  ]);
  return { rental: r, agreement, items, charges, events, messages: msgs, generated_at: new Date().toISOString() };
}

/* ---------------- cron ---------------- */
export async function runRentalCron(db = admin()) {
  const out: Record<string, unknown> = {};
  // 1. expire holds; one abandoned text per opted-in customer
  const { data: expired } = await db.rpc('rental_expire_holds');
  const list = (expired ?? []) as { rental_id: string; public_token: string; phone: string | null; name: string | null; opted_in: boolean }[];
  for (const h of list.filter((x) => x.opted_in && x.phone)) {
    const r = await getRental(h.rental_id, db);
    await queueMessage(r, 'abandoned', { link: `${APP_URL}/rent?resume=${r.public_token}` }, { at: new Date(Date.now() + 3600_000).toISOString(), dedupe: `${r.id}:abandoned`, force: false }, db);
    await db.from('rentals').update({ abandoned_text_sent_at: new Date().toISOString() }).eq('id', r.id);
  }
  // owner heads-up for every checkout that expired unpaid, so the lead can be called back
  for (const h of list) {
    const r = await getRental(h.rental_id, db).catch(() => null);
    if (!r) continue;
    const c = r.customers;
    await sendNotification({ event: 'rental_abandoned', to: process.env.NOTIFY_EMAIL ?? '', dedupeKey: `rental_abandoned:${r.id}`,
      subject: `Unfinished tote booking: ${c?.name ?? 'someone'} ${c?.phone ?? ''}`.trim(),
      text: `${c?.name ?? 'A customer'} started booking ${r.tote_count} totes for delivery ${fmtDate(r.delivery_date)} ${r.delivery_window} (${money(Number(r.total))}, ${r.zone ?? ''}) but did not pay within 30 minutes, so the hold was released.\n\nPhone: ${c?.phone ?? '-'}\nEmail: ${c?.email ?? '-'}\nAddress: ${r.delivery_address}\n${h.opted_in && h.phone ? 'They will get one automatic text with a link to finish.' : 'No automatic text was sent.'}\n\nTheir link to finish booking: ${APP_URL}/rent?resume=${r.public_token}\nIn the CRM: ${APP_URL}/rentals/${r.id}` }).catch(() => {});
  }
  out.holds_expired = list.length;
  // 2. late fees + overdue texts
  const { data: fees } = await db.rpc('rental_accrue_late_fees');
  out.late_fee_lines = fees ?? 0;
  const today = todayDetroit();
  const { data: overdue } = await db.from('rentals').select('*, customers(id,name,phone,email)').in('status', ['delivered', 'out', 'pickup_scheduled']).lt('pickup_date', today);
  for (const r of (overdue ?? []) as Rental[]) {
    const days = Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${r.pickup_date}T12:00:00Z`).getTime()) / 86400_000);
    if (days >= 1) await queueMessage(r, 'overdue_1', {}, { dedupe: `${r.id}:overdue_1:${r.pickup_date}` }, db);
    if (days >= 3) await queueMessage(r, 'overdue_3', {}, { dedupe: `${r.id}:overdue_3:${r.pickup_date}` }, db);
  }
  out.overdue = overdue?.length ?? 0;
  // 3. card expiring before pickup
  const { data: active } = await db.from('rentals').select('*, customers(id,name,phone,email)').in('status', ['booked', 'delivered', 'out', 'pickup_scheduled']).not('card_exp', 'is', null);
  let expiring = 0;
  for (const r of (active ?? []) as Rental[]) {
    const [mm, yy] = (r.card_exp ?? '').split('/');
    if (!mm || !yy) continue;
    const expEnd = new Date(Date.UTC(2000 + Number(yy), Number(mm), 0));
    if (expEnd < new Date(`${r.pickup_date}T00:00:00Z`)) { expiring++; await queueMessage(r, 'card_expiring', {}, { dedupe: `${r.id}:card_expiring:${r.card_exp}` }, db); }
  }
  out.card_expiring = expiring;
  // 4. retry soft declines
  const { data: retries } = await db.from('rental_charges').select('id, rental_id').eq('status', 'failed').lte('next_retry_at', new Date().toISOString()).limit(20);
  let retried = 0;
  for (const c of retries ?? []) { try { await attemptCharge(await getRental(c.rental_id, db), c.id, db); retried++; } catch { /* keep going */ } }
  out.retried = retried;
  // 5. requests nobody confirmed in 7 days expire; nothing was ever charged on them
  const { data: stale } = await db.from('rentals').update({ status: 'expired' }).eq('status', 'awaiting_confirmation').lt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()).select('id');
  for (const x of stale ?? []) await logEvent(x.id, 'expired', { reason: 'no date confirmed within 7 days' }, db);
  out.requests_expired = stale?.length ?? 0;
  const s = await getSettings(db);
  // 6. waitlist: text the first person whose dates now fit
  const { data: wl } = await db.from('rental_waitlist').select('*').is('notified_at', null).gte('start_date', today).order('created_at').limit(20);
  let notified = 0;
  for (const w of wl ?? []) {
    const end = new Date(`${w.end_date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + s.turnaround_days);
    const { data: fit } = await db.rpc('rental_can_fit', { p_start: w.start_date, p_end: end.toISOString().slice(0, 10), p_totes: w.tote_count, p_dollies: 0 });
    if (!fit) continue;
    const body = renderRental(DEFAULT_TEMPLATES.waitlist_open.sms, { first_name: first(w.name), link: `${APP_URL}/rent?date=${w.start_date}` });
    await db.from('rental_messages').insert({ template: 'waitlist_open', channel: 'sms', to_phone: w.phone, body, dedupe_key: `waitlist:${w.id}` });
    await db.from('rental_waitlist').update({ notified_at: new Date().toISOString() }).eq('id', w.id);
    notified++;
    break; // first person only; the next one gets a text on the next run if totes are still free
  }
  out.waitlist_notified = notified;
  // 7. retention: addresses and move dates reveal empty homes; drop them two years after pickup unless they became a junk customer
  const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 24);
  const { data: old } = await db.from('rentals').select('id').in('status', ['closed', 'cancelled']).lt('pickup_date', cutoff.toISOString().slice(0, 10)).is('junk_request_id', null).neq('delivery_address', '[removed]').limit(50);
  for (const o of old ?? []) await db.from('rentals').update({ delivery_address: '[removed]', pickup_address: null, move_date: null, notes_customer: null }).eq('id', o.id);
  out.retention_scrubbed = old?.length ?? 0;
  // 8. send what is due
  out.messages = await sendDueMessages(db);
  return out;
}

/* ---------------- booking request + date confirmation ---------------- */
/**
 * Card saved at checkout: the checkout becomes a REQUEST ('awaiting_confirmation'). Nothing is charged and no totes are reserved;
 * Mico texts delivery windows and sets the date with confirmDate(). Both the browser (confirm route) and the Stripe webhook call this;
 * the status guard makes exactly one of them do the work. A checkout auto-cancelled after 30 minutes without a card is revived.
 */
export async function confirmBooking(rentalId: string, intent: { id: string; kind: 'payment' | 'setup'; payment_method: string; customer?: string | null }, ctx: { ip?: string | null; user_agent?: string | null } = {}, db = admin()): Promise<{ ok: boolean; already?: boolean; error?: string; rental: Rental }> {
  const r = await getRental(rentalId, db);
  if (r.status !== 'pending_payment' && !(r.status === 'cancelled' && /Hold expired/.test(r.notes_internal ?? ''))) return { ok: r.status !== 'cancelled', already: true, rental: r };
  const ci = await cardInfo(intent.payment_method);
  const { data: won } = await db.from('rentals').update({ status: 'awaiting_confirmation', deposit_status: 'none', stripe_payment_method_id: ci.payment_method_id, card_brand: ci.brand, card_last4: ci.last4, card_exp: ci.exp, stripe_customer_id: intent.customer ?? r.stripe_customer_id }).eq('id', r.id).eq('status', r.status).select('id');
  if (!won?.length) return { ok: true, already: true, rental: await getRental(r.id, db) };
  if (intent.kind === 'payment') await db.from('rental_charges').update({ status: 'succeeded' }).eq('stripe_payment_intent_id', intent.id);   // checkouts started before the redesign
  await logEvent(r.id, 'requested', { intent: intent.id, card: `${ci.brand} ${ci.last4}` }, db);
  // Meta CAPI Purchase: the request is the conversion. Same event_id as the pixel on sanchezhaulco.com/tote-rental (the rental number).
  { const c = r.customers!; const [fn = '', ...ln] = (c.name ?? '').trim().split(/\s+/); const tag = (k: string) => (r.notes_internal ?? '').match(new RegExp(`\\b${k}:(\\S+)`))?.[1] ?? null;
    await sendMetaEvent({ name: 'Purchase', event_id: r.rental_number, source_url: 'https://sanchezhaulco.com/tote-rental', custom: { value: Number(r.total), currency: 'USD', content_name: 'tote_rental', content_type: 'product', order_id: r.rental_number },
      user: { email: c.email, phone: c.phone, first_name: fn, last_name: ln.join(' '), state: 'MI', zip: (r.delivery_address.match(/\b\d{5}\b/g) ?? []).pop(), ip: ctx.ip ?? tag('ip'), user_agent: ctx.user_agent ?? null, fbp: tag('fbp'), fbc: tag('fbc'), fbclid: tag('fbclid') } }); }
  if (r.partner_id) await db.rpc('rental_partner_use', { p_partner: r.partner_id }).then(() => {}, () => {});
  // "Will you have anything to get rid of?" Yes becomes a junk request in the pipeline right away (plan section 11).
  if (r.junk_interest === 'yes' && !r.junk_request_id) {
    const c = r.customers!; const [fname = '', ...rest] = (c.name ?? '').trim().split(/\s+/);
    const { data: er } = await db.from('estimate_requests').insert({ status: 'new', first_name: fname, last_name: rest.join(' ') || '-', email: c.email ?? '', phone: c.phone ?? '', address: r.delivery_address, state: 'MI', description: `Tote renter said YES to junk removal at checkout (rental ${r.rental_number}). ${r.notes_customer ?? ''} Offer Tote renter: $25 off $250+, no code, during the rental or 7 days after pickup.`, lead_source: 'tote_rental_crosssell', rental_id: r.id, turnstile_verified: true }).select('id').single();
    if (er) { await db.from('rentals').update({ junk_request_id: er.id }).eq('id', r.id); await db.from('lead_events').insert({ type: 'quote_form', rental_id: r.id, customer_id: c.id, detail: { source: 'checkout_yes', estimate_request_id: er.id } }); }
  }
  const fresh = await getRental(r.id, db);
  await queueMessage(fresh, 'request_received', { total: money(Number(fresh.total)) }, { email: true }, db);
  const { data: lines } = await db.from('rental_addon_lines').select('qty, rental_addons(name)').eq('rental_id', r.id);
  const gear = (lines ?? []).map((l) => `${l.qty} × ${(l.rental_addons as unknown as { name: string }).name}`);
  await sendNotification({ event: 'rental_requested', to: process.env.NOTIFY_EMAIL ?? '', subject: `Tote request ${fresh.rental_number}: ${fresh.customers?.name} (text delivery windows)`,
    text: `${fresh.customers?.name} ${fresh.customers?.phone ?? ''}\n${fresh.tote_count} totes${gear.length ? ` + ${gear.join(', ')}` : ''} · ${fresh.zone ?? ''} · due at pickup ${money(Number(fresh.total))}\nMoving day: ${fresh.move_date ?? '?'}\n${fresh.notes_customer ?? ''}\n${fresh.delivery_address}\n\nText them two delivery windows, then set the date: ${APP_URL}/rentals/${fresh.id}` });
  return { ok: true, rental: fresh };
}

/** Mico sets the delivery date the customer picked: totes are reserved now, pickup is delivery + the rental days, the customer gets the confirmation. */
export async function confirmDate(rentalId: string, a: { delivery_date: string; delivery_window: string; pickup_window?: string | null; by?: string | null }, db = admin()) {
  const r = await getRental(rentalId, db);
  if (r.status !== 'awaiting_confirmation') throw new Error(`Rental is ${r.status}; only a request awaiting a date can be confirmed.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.delivery_date ?? '') || !a.delivery_window) throw new Error('Pick a delivery date and window.');
  const s = await getSettings(db);
  const days = Number(r.rental_days ?? 14);
  const plus = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const pickup = plus(a.delivery_date, days);
  const { data: fit } = await db.rpc('rental_can_fit', { p_start: a.delivery_date, p_end: plus(pickup, Number(s.turnaround_days ?? 0)), p_totes: r.tote_count, p_dollies: r.dolly_count });
  if (!fit) throw new Error(`Not enough free totes from ${fmtDate(a.delivery_date)} to ${fmtDate(pickup)}. Offer other dates.`);
  const { data: won } = await db.from('rentals').update({ status: 'booked', delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_date: pickup, pickup_window: a.pickup_window || a.delivery_window }).eq('id', r.id).eq('status', 'awaiting_confirmation').select('id');
  if (!won?.length) throw new Error('This request was already confirmed.');
  await logEvent(r.id, 'date_confirmed', { delivery_date: a.delivery_date, window: a.delivery_window, pickup_date: pickup, by: a.by ?? null }, db);
  const fresh = await getRental(r.id, db);
  const { data: pkg } = await db.from('rental_packages').select('name').eq('id', r.package_id).maybeSingle();
  await queueMessage(fresh, 'booking_confirmed', { package: pkg?.name ?? `${fresh.tote_count} totes`, total: money(Number(fresh.total)) }, { email: true }, db);
  await scheduleLifecycle(fresh, db);
  return { ok: true, rental: fresh };
}

/* ---------------- Stripe webhook handling for rentals ---------------- */
export async function handleRentalWebhook(type: string, obj: Record<string, unknown>, db = admin()): Promise<string> {
  const md = (obj.metadata ?? {}) as Record<string, string>;
  const piMd = ((obj as { payment_intent?: { metadata?: Record<string, string> } }).payment_intent?.metadata) ?? {};
  const rentalId = md.rental_id ?? piMd.rental_id;
  const chargeId = md.charge_id ?? piMd.charge_id;
  if (!rentalId && !['charge.dispute.created', 'payment_method.detached', 'customer.updated'].includes(type)) return 'not a rental event';
  switch (type) {
    case 'payment_intent.succeeded': {
      const pi = obj as { id: string; amount: number };
      if (chargeId) {
        const { data: ch } = await db.from('rental_charges').select('status').eq('id', chargeId).single();
        if (ch && ch.status !== 'succeeded') {
          await db.from('rental_charges').update({ status: 'succeeded', stripe_payment_intent_id: pi.id, failure_reason: null, next_retry_at: null }).eq('id', chargeId);
          await logEvent(rentalId!, 'webhook:payment_intent.succeeded', { charge_id: chargeId, pi: pi.id }, db);
          const r = await getRental(rentalId!, db);
          if (md.charge_type === 'payment_link' && pi.id) { // card may have changed; refresh the saved card from this intent
            const full = await stripe<{ payment_method?: string }>(`/payment_intents/${pi.id}`).catch(() => null);
            if (full?.payment_method) { const ci = await cardInfo(full.payment_method); await db.from('rentals').update({ stripe_payment_method_id: ci.payment_method_id, card_brand: ci.brand, card_last4: ci.last4, card_exp: ci.exp }).eq('id', r.id); }
          }
          await queueMessage(r, 'receipt', {}, { dedupe: `${r.id}:receipt:${chargeId}`, email: true }, db);
          await maybeClose(r.id, db);
        }
        return 'charge recorded';
      }
      if (md.charge_type === 'booking' || md.charge_type === 'deposit') {   // 'deposit' = intents created before 2026-10-14
        await db.from('rental_charges').update({ status: 'succeeded' }).eq('stripe_payment_intent_id', pi.id);
        const pm = (obj as { payment_method?: string | null }).payment_method;
        if (rentalId && pm) await confirmBooking(rentalId, { id: pi.id, kind: 'payment', payment_method: pm, customer: (obj as { customer?: string | null }).customer ?? null }, {}, db);   // books it even if the customer closed the tab
        return 'booking payment recorded';
      }
      return 'ignored';
    }
    case 'payment_intent.payment_failed': {
      const pi = obj as { id: string; last_payment_error?: { message?: string; decline_code?: string } };
      if (chargeId) { await db.from('rental_charges').update({ status: 'failed', failure_reason: pi.last_payment_error?.message ?? 'failed' }).eq('id', chargeId).neq('status', 'succeeded'); await logEvent(rentalId!, 'webhook:payment_failed', { charge_id: chargeId, reason: pi.last_payment_error?.message }, db); }
      return 'failure recorded';
    }
    case 'payment_intent.requires_action': {
      if (chargeId) await db.from('rental_charges').update({ status: 'requires_action' }).eq('id', chargeId).neq('status', 'succeeded');
      return 'requires_action recorded';
    }
    case 'setup_intent.succeeded': {
      const si = obj as { payment_method?: string };
      if (rentalId && si.payment_method) {
        const cur = await getRental(rentalId, db);
        // a $0-due checkout saves the card with a SetupIntent: that is the booking
        if (cur.status === 'pending_payment' || cur.status === 'cancelled') { await confirmBooking(rentalId, { id: (obj as { id: string }).id, kind: 'setup', payment_method: si.payment_method, customer: (obj as { customer?: string | null }).customer ?? null }, {}, db); return 'booking confirmed'; }
        const ci = await cardInfo(si.payment_method); await db.from('rentals').update({ stripe_payment_method_id: ci.payment_method_id, card_brand: ci.brand, card_last4: ci.last4, card_exp: ci.exp }).eq('id', rentalId); await logEvent(rentalId, 'card:updated', { brand: ci.brand, last4: ci.last4 }, db);
      }
      return 'card saved';
    }
    case 'charge.refunded': {
      const ch = obj as { payment_intent?: string; amount_refunded: number; refunds?: { data?: { id: string }[] } };
      if (ch.payment_intent) { await logEvent(rentalId ?? null as unknown as string, 'webhook:charge.refunded', { pi: ch.payment_intent, amount_refunded: ch.amount_refunded / 100 }, db); }
      return 'refund noted';
    }
    case 'charge.dispute.created': {
      const d = obj as { id: string; payment_intent?: string; amount: number; reason?: string };
      const { data: ch } = await db.from('rental_charges').select('rental_id').eq('stripe_payment_intent_id', d.payment_intent ?? '').maybeSingle();
      const rid = rentalId ?? ch?.rental_id;
      if (rid) {
        await db.from('rentals').update({ disputed_at: new Date().toISOString() }).eq('id', rid);
        await logEvent(rid, 'dispute:created', { dispute: d.id, amount: d.amount / 100, reason: d.reason }, db);
        const r = await getRental(rid, db);
        await sendNotification({ event: 'rental_dispute', to: process.env.NOTIFY_EMAIL ?? '', subject: `DISPUTE on rental ${r.rental_number} (${money(d.amount / 100)})`, text: `Evidence packet: ${APP_URL}/rentals/${rid}/evidence\nStripe dispute ${d.id}` }).catch(() => {});
      }
      return 'dispute flagged';
    }
    case 'payment_method.detached': {
      const pm = obj as { id: string };
      const { data } = await db.from('rentals').update({ stripe_payment_method_id: null }).eq('stripe_payment_method_id', pm.id).select('id');
      for (const r of data ?? []) await logEvent(r.id, 'card:detached', { pm: pm.id }, db);
      return 'detached';
    }
    case 'customer.updated': return 'noted';
    default: return 'ignored';
  }
}
export { StripeError };
