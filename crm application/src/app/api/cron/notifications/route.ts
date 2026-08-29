import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendNotification, APP_URL } from '@/lib/notify';
import { serverFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';
export const maxDuration = 26; // Netlify function limit headroom

/**
 * Daily reminder sweep — triggered by the Netlify scheduled function
 * (netlify/functions/notify-cron.mjs) every morning, or manually:
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" $APP_URL/api/cron/notifications
 *
 * Sends (each exactly once per day, enforced by the outbox dedupe_key):
 *  1. CREW — each crew member with jobs scheduled today gets their run sheet.
 *  2. OWNER DIGEST — overdue invoices, estimates expiring within 3 days,
 *     lead follow-ups due. Only sends when there's something to say.
 *
 * Requires env: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 * NOTIFY_EMAIL. Missing config → reports what's missing, never half-runs.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ skipped: 'CRON_SECRET not set' });
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ skipped: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  // ---------- 0) Materialize due recurring jobs (independent of email config) ----------
  // The generator advances each plan's next_run, so this is idempotent per day.
  let recurring_generated: number | string = 'off';
  if (serverFlags.recurring) {
    const { data, error } = await admin.rpc('generate_due_recurring_jobs');
    recurring_generated = error ? `failed: ${error.message}` : (data ?? 0);
  }

  const owner = process.env.NOTIFY_EMAIL;
  if (!owner || !process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: 'Resend not configured', recurring_generated });
  }

  // "Today" in Michigan, regardless of server timezone.
  const now = new Date();
  const detroit = new Date(now.toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const y = detroit.getFullYear(), m = detroit.getMonth(), day = detroit.getDate();
  const offsetMs = now.getTime() - detroit.getTime();
  const dayStart = new Date(new Date(y, m, day, 0, 0, 0).getTime() + offsetMs).toISOString();
  const dayEnd = new Date(new Date(y, m, day, 23, 59, 59).getTime() + offsetMs).toISOString();
  const today = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const summary = { crew_sent: 0, crew_failed: 0, digest: 'skipped' as string, recurring_generated };

  // ---------- 1) Crew run sheets ----------
  const { data: todaysJobs } = await admin
    .from('jobs')
    .select('id, title, address, scheduled_start, customers(name), job_assignments(user_id, users(full_name, email))')
    .gte('scheduled_start', dayStart)
    .lte('scheduled_start', dayEnd)
    .not('status', 'in', '("invoiced","paid","cancelled")')
    .order('scheduled_start');

  type CrewJob = { title: string; address: string | null; scheduled_start: string; customer?: string };
  const byMember = new Map<string, { name: string | null; email: string; jobs: CrewJob[] }>();
  for (const j of todaysJobs ?? []) {
    const assignments = (j.job_assignments ?? []) as unknown as { user_id: string; users: { full_name: string | null; email: string | null } | null }[];
    for (const a of assignments) {
      if (!a.users?.email) continue;
      const entry = byMember.get(a.user_id) ?? { name: a.users.full_name, email: a.users.email, jobs: [] };
      entry.jobs.push({
        title: j.title,
        address: j.address,
        scheduled_start: j.scheduled_start as string,
        customer: (j.customers as { name?: string } | null)?.name,
      });
      byMember.set(a.user_id, entry);
    }
  }

  for (const [userId, member] of Array.from(byMember.entries())) {
    const lines = member.jobs.map((jb) => {
      const t = new Date(jb.scheduled_start).toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' });
      return `• ${t} — ${jb.title}${jb.customer ? ` (${jb.customer})` : ''}${jb.address ? `\n   ${jb.address}` : ''}`;
    }).join('\n');
    const result = await sendNotification({
      event: 'crew_daily',
      to: member.email,
      dedupeKey: `crew_daily:${userId}:${today}`,
      subject: `Today's jobs (${member.jobs.length}) — ${detroit.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
      text: `${member.name ?? 'Morning'}, here's your day:\n\n${lines}\n\nDetails and photos: ${APP_URL}/field\n\n— Sanchez Junk & Haul Co.`,
    });
    if (result.ok && !result.skipped) summary.crew_sent++;
    else if (!result.ok) summary.crew_failed++;
  }

  // ---------- 2) Owner digest ----------
  const in3days = new Date(now.getTime() + 3 * 86400_000).toISOString();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const [{ data: overdue }, { data: expiring }, { data: followUps }, { data: forgotten }] = await Promise.all([
    admin.from('invoices')
      .select('invoice_number, total, due_at, customers(name)')
      .not('status', 'eq', 'paid').not('due_at', 'is', null).lt('due_at', now.toISOString())
      .order('due_at').limit(20),
    admin.from('estimates')
      .select('estimate_number, total, valid_until, customers(name)')
      .eq('status', 'sent').not('valid_until', 'is', null)
      .gte('valid_until', now.toISOString()).lte('valid_until', in3days)
      .order('valid_until').limit(20),
    admin.from('leads')
      .select('name, follow_up_on')
      .not('follow_up_on', 'is', null).lte('follow_up_on', today)
      .not('status', 'in', '("won","lost")')
      .order('follow_up_on').limit(20),
    // Forgotten clock-outs: still running after 12h — silently accruing hours.
    admin.from('time_entries')
      .select('id, started_at, users(full_name), jobs(title)')
      .is('ended_at', null).is('deleted_at', null)
      .lt('started_at', twelveHoursAgo)
      .order('started_at').limit(20),
  ]);

  const sections: string[] = [];
  if (overdue?.length) {
    sections.push(`OVERDUE INVOICES (${overdue.length})\n` + overdue.map((i) =>
      `• #${i.invoice_number} — ${(i.customers as { name?: string } | null)?.name ?? '—'} — $${Number(i.total).toFixed(2)} (due ${new Date(i.due_at as string).toLocaleDateString('en-US', { timeZone: 'America/Detroit' })})`).join('\n'));
  }
  if (expiring?.length) {
    sections.push(`ESTIMATES EXPIRING SOON (${expiring.length})\n` + expiring.map((e) =>
      `• #EST${e.estimate_number} — ${(e.customers as { name?: string } | null)?.name ?? '—'} — $${Number(e.total).toFixed(2)} (expires ${new Date(e.valid_until as string).toLocaleDateString('en-US', { timeZone: 'America/Detroit' })})`).join('\n'));
  }
  if (followUps?.length) {
    sections.push(`FOLLOW-UPS DUE (${followUps.length})\n` + followUps.map((l) => `• ${l.name}`).join('\n'));
  }
  if (forgotten?.length) {
    sections.push(`⚠️ STILL ON THE CLOCK 12h+ — LIKELY FORGOT TO CLOCK OUT (${forgotten.length})\n` + forgotten.map((t) =>
      `• ${(t.users as { full_name?: string } | null)?.full_name ?? 'Unknown'} — in since ${new Date(t.started_at as string).toLocaleString('en-US', { timeZone: 'America/Detroit' })}${(t.jobs as { title?: string } | null)?.title ? ` on ${(t.jobs as { title?: string }).title}` : ''}\n   Fix it: ${APP_URL}/time`).join('\n'));
  }

  if (sections.length) {
    const result = await sendNotification({
      event: 'owner_digest',
      to: owner,
      dedupeKey: `owner_digest:${today}`,
      subject: `☀️ SJHC morning digest — ${overdue?.length ?? 0} overdue, ${expiring?.length ?? 0} expiring, ${followUps?.length ?? 0} follow-ups${forgotten?.length ? `, ${forgotten.length} forgot to clock out` : ''}`,
      text: `${sections.join('\n\n')}\n\n${APP_URL}\n\n— SJHC Command Center`,
    });
    summary.digest = result.ok ? (result.skipped ?? 'sent') : `failed: ${result.error}`;
  } else {
    summary.digest = 'nothing to report';
  }

  return NextResponse.json(summary);
}
