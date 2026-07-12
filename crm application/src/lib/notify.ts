import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Shared email sender — every email the system sends goes through here so it
 * is LOGGED in the notifications outbox (migration 0017): sent, failed (with
 * the Resend error), or skipped. Nothing fails silently anymore.
 *
 * From-address: set NOTIFY_FROM once a domain is verified in Resend
 * (e.g. "SJHC <notify@sanchezhaul.com>"). Until then the resend.dev sender is
 * used, which only delivers to the Resend account owner's email — crew
 * emails will land in the outbox as 'failed' with Resend's rejection, so
 * you can SEE what's blocked instead of wondering.
 */

const FROM = process.env.NOTIFY_FROM ?? 'SJHC Command Center <onboarding@resend.dev>';
export const APP_URL = 'https://crmsjh.netlify.app';

export interface SendArgs {
  event: string;               // 'viewed' | 'signed' | 'assigned' | 'crew_daily' | 'owner_digest'
  to: string;
  subject: string;
  text: string;
  dedupeKey?: string;          // set for scheduled reminders — one send per key, ever
  entityKind?: 'job' | 'invoice' | 'estimate';
  entityId?: string;
}

export interface SendResult {
  ok: boolean;
  skipped?: 'not_configured' | 'duplicate';
  error?: string;
}

export async function sendNotification(args: SendArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: 'not_configured' };

  const admin = createAdminClient(); // null → still send, just can't log

  // Reserve the outbox row first. For deduped reminders the unique key makes
  // this atomic: a second run today hits the constraint and skips the send.
  let logId: string | null = null;
  if (admin) {
    const { data, error } = await admin
      .from('notifications')
      .insert({
        event: args.event,
        recipient: args.to,
        subject: args.subject,
        dedupe_key: args.dedupeKey ?? null,
        entity_kind: args.entityKind ?? null,
        entity_id: args.entityId ?? null,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return { ok: true, skipped: 'duplicate' }; // already sent today
      // Logging broken shouldn't block the email itself — continue unlogged.
    } else {
      logId = data.id;
    }
  }

  let ok = false;
  let errText: string | undefined;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: FROM, to: [args.to], subject: args.subject, text: args.text }),
    });
    ok = res.ok;
    if (!res.ok) errText = (await res.text()).slice(0, 500);
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

  return ok ? { ok: true } : { ok: false, error: errText };
}
