import { createAdminClient } from '@/lib/supabase/admin';
import { toE164, formatPhone } from '@/lib/requests';

/**
 * Quo — the business line. SERVER ONLY.
 *
 * Every text the system sends goes through here so it is LOGGED in the same
 * notifications outbox as email (migration 0017): sent, failed with Quo's own
 * error, or skipped with the reason. Nothing fails silently.
 *
 * Quo's API is text only (no MMS), so photos still have to go from the app.
 * Content is capped at 1600 characters.
 */

const QUO_ENDPOINT = 'https://api.quo.com/v1/messages';
export const QUO_FROM = process.env.QUO_FROM ?? '+17345378061';
export const MAX_CONTENT = 1600;

/* Guardrails for anything the system sends on its own. A person tapping a
   button is never held back by these; a scheduled task always is. */
export const QUIET_START_HOUR = 8;   // no automated sends before 8am Eastern
export const QUIET_END_HOUR = 20;    // or after 8pm Eastern
export const COOLDOWN_HOURS = 48;    // one automated text per number per 2 days
export const DAILY_AUTOMATED_CAP = 50; // stay well under the A2P daily limit

export type QuoSkip =
  | 'not_configured' | 'bad_number' | 'opted_out'
  | 'quiet_hours' | 'cooldown' | 'daily_cap';

export interface SendTextArgs {
  to: string;
  content: string;
  /** Outbox event name, e.g. 'sms:quote' or 'sms:intake_link'. */
  event?: string;
  /** True for anything the system decided to send. Subject to every guardrail. */
  automated?: boolean;
  entityKind?: string;
  entityId?: string;
  /** Automated sends are marked done so they don't sit open in the Operations inbox. */
  markInboxDone?: boolean;
}

export interface SendTextResult {
  ok: boolean;
  skipped?: QuoSkip;
  error?: string;
  status?: number;
  messageId?: string;
  conversationId?: string;
  deliveryStatus?: string;
}

/** Quo's own error codes, in words Mico can act on. */
function explain(status: number, body: string): string {
  switch (status) {
    case 400: return `Quo rejected the message. Usually A2P registration isn't approved yet. ${body}`.trim();
    case 401: return 'Quo rejected the API key. Check QUO_API_KEY.';
    case 402: return 'The Quo subscription is inactive or past due.';
    case 403: return "Quo's daily message cap has been reached. Sends resume tomorrow.";
    case 404: return `Quo could not find that number or conversation. ${body}`.trim();
    default: return `Quo returned ${status}. ${body}`.trim();
  }
}

/** Detroit hour-of-day, whatever the server's own clock is set to. */
function detroitHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit', hour: 'numeric', hour12: false,
  }).format(now);
  return Number(h) % 24;
}

export async function sendText(args: SendTextArgs): Promise<SendTextResult> {
  const key = process.env.QUO_API_KEY;
  if (!key) return { ok: false, skipped: 'not_configured' };

  const to = toE164(args.to);
  if (!to) return { ok: false, skipped: 'bad_number' };

  const content = (args.content || '').trim().slice(0, MAX_CONTENT);
  const event = args.event ?? 'sms';
  const admin = createAdminClient(); // null → still send, just can't log

  /* ---------- Guardrails (automated sends only) ---------- */
  if (args.automated) {
    const hour = detroitHour();
    if (hour < QUIET_START_HOUR || hour >= QUIET_END_HOUR) {
      return { ok: false, skipped: 'quiet_hours' };
    }
    if (admin) {
      const { data: optOut } = await admin
        .from('sms_opt_outs').select('phone').eq('phone', to).maybeSingle();
      if (optOut) return { ok: false, skipped: 'opted_out' };

      const since = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString();
      const { count: recent } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient', to)
        .like('event', 'sms:%')
        .eq('status', 'sent')
        .gte('created_at', since);
      if ((recent ?? 0) > 0) return { ok: false, skipped: 'cooldown' };

      const dayStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: today } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .like('event', 'sms:%')
        .eq('status', 'sent')
        .gte('created_at', dayStart);
      if ((today ?? 0) >= DAILY_AUTOMATED_CAP) return { ok: false, skipped: 'daily_cap' };
    }
  }

  /* ---------- Reserve the outbox row ---------- */
  let logId: string | null = null;
  if (admin) {
    const { data, error } = await admin
      .from('notifications')
      .insert({
        event,
        recipient: to,
        subject: content.slice(0, 120),
        entity_kind: args.entityKind ?? null,
        entity_id: args.entityId ?? null,
      })
      .select('id')
      .single();
    if (!error && data) logId = data.id;
    // A broken log must not block the text itself — continue unlogged.
  }

  /* ---------- Send ---------- */
  let ok = false;
  let errText: string | undefined;
  let status = 0;
  let messageId: string | undefined;
  let conversationId: string | undefined;
  let deliveryStatus: string | undefined;

  try {
    const body: Record<string, unknown> = { content, from: QUO_FROM, to: [to] };
    if (args.markInboxDone ?? args.automated) body.setInboxStatus = 'done';

    const res = await fetch(QUO_ENDPOINT, {
      method: 'POST',
      // Quo takes the raw key — no "Bearer" prefix.
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify(body),
    });
    status = res.status;
    const text = await res.text();
    ok = res.ok;
    if (ok) {
      try {
        const json = JSON.parse(text) as { data?: { id?: string; conversationId?: string; status?: string } };
        messageId = json.data?.id;
        conversationId = json.data?.conversationId;
        deliveryStatus = json.data?.status;
      } catch { /* accepted but unparseable — still a send */ }
    } else {
      errText = explain(status, text.slice(0, 300));
    }
  } catch (e) {
    errText = e instanceof Error ? e.message : 'network error';
  }

  if (admin && logId) {
    await admin
      .from('notifications')
      .update({
        status: ok ? 'sent' : 'failed',
        error: errText ?? null,
        attempts: 1,
        sent_at: ok ? new Date().toISOString() : null,
      })
      .eq('id', logId);
  }

  return ok
    ? { ok: true, status, messageId, conversationId, deliveryStatus }
    : { ok: false, status, error: errText };
}

/** Plain-language reason for a skip, for the screen that asked for the send. */
export function explainSkip(skip: QuoSkip): string {
  switch (skip) {
    case 'not_configured': return 'Texting is not switched on yet (QUO_API_KEY is missing).';
    case 'bad_number': return "That number isn't a 10-digit US number.";
    case 'opted_out': return 'That customer replied STOP, so we do not text them.';
    case 'quiet_hours': return `Automated texts only go out between ${QUIET_START_HOUR}am and 8pm Eastern.`;
    case 'cooldown': return `They already got an automated text in the last ${COOLDOWN_HOURS} hours.`;
    case 'daily_cap': return "Today's automated send limit is used up.";
  }
}

/* ---------------- Templates ---------------- */

export type TemplateKey =
  | 'intake_link' | 'request_received' | 'quote_link'
  | 'quote_followup' | 'on_my_way' | 'job_complete';

export interface TemplateVars {
  first_name?: string;
  link?: string;
  quote_number?: string | number;
  total?: string;
  business?: string;
}

const BUSINESS = 'Sanchez Junk & Haul';

/**
 * Defaults. Every one of these signs off with the business name, because the
 * number is new and nobody has it saved yet.
 */
export const TEMPLATES: Record<TemplateKey, (v: TemplateVars) => string> = {
  intake_link: (v) =>
    `Hi${v.first_name ? ` ${v.first_name}` : ''}, it's ${v.business ?? BUSINESS}. Send us a few photos and we'll get you a price: ${v.link}`,

  request_received: (v) =>
    `Hi${v.first_name ? ` ${v.first_name}` : ''}, this is ${v.business ?? BUSINESS}. Got your request. We'll have a price back to you shortly. Reply here with any questions.`,

  quote_link: (v) =>
    `Hi${v.first_name ? ` ${v.first_name}` : ''}, your estimate${v.quote_number ? ` #${v.quote_number}` : ''} from ${v.business ?? BUSINESS} is ready${v.total ? ` at ${v.total}` : ''}. View and approve it here: ${v.link}`,

  quote_followup: (v) =>
    `Hi${v.first_name ? ` ${v.first_name}` : ''}, checking in on your estimate${v.quote_number ? ` #${v.quote_number}` : ''} from ${v.business ?? BUSINESS}. Still want it done? ${v.link}`,

  on_my_way: (v) =>
    `Hi${v.first_name ? ` ${v.first_name}` : ''}, ${v.business ?? BUSINESS} here. We're on our way and should be there shortly.`,

  job_complete: (v) =>
    `All done${v.first_name ? `, ${v.first_name}` : ''}. Thanks for having ${v.business ?? BUSINESS} out. Your invoice is here: ${v.link}`,
};

export function renderTemplate(key: TemplateKey, vars: TemplateVars): string {
  const fn = TEMPLATES[key];
  return fn ? fn(vars) : '';
}

export { formatPhone };
