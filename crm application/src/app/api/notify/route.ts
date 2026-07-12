import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendNotification, APP_URL } from '@/lib/notify';

/**
 * Instant email notifications (Resend). Every send is logged to the
 * notifications outbox via src/lib/notify — nothing fails silently.
 *
 * SECURITY: this route does not trust the request body for content or
 * recipients (/api/* is exempt from the auth middleware).
 *  - 'assigned'          → requires an authenticated admin/dispatcher session;
 *                          recipient + job details are looked up server-side.
 *  - 'viewed' / 'signed' → caller must present a valid sign-link token; doc
 *                          details come from the notify_doc_by_token RPC
 *                          (migration 0015) and mail only goes to NOTIFY_EMAIL.
 */
export async function POST(req: NextRequest) {
  const owner = process.env.NOTIFY_EMAIL;
  if (!process.env.RESEND_API_KEY || !owner) {
    return NextResponse.json({ skipped: 'notifications not configured' });
  }

  let body: { event?: string; kind?: string; token?: string; job_id?: string; user_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }

  const supabase = createClient();

  // ---- Crew assignment: authenticated staff only; everything derived server-side ----
  if (body.event === 'assigned') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin' && me?.role !== 'dispatcher') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (!body.job_id || !body.user_id) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

    const [{ data: member }, { data: job }] = await Promise.all([
      supabase.from('users').select('full_name, email').eq('id', body.user_id).single(),
      supabase.from('jobs').select('title, scheduled_start, address, customers(name)').eq('id', body.job_id).single(),
    ]);
    if (!member?.email || !job) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const when = job.scheduled_start
      ? new Date(job.scheduled_start).toLocaleString('en-US', {
          timeZone: 'America/Detroit', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
      : null;
    const customerName = (job.customers as { name?: string } | null)?.name;
    const result = await sendNotification({
      event: 'assigned',
      to: member.email,
      entityKind: 'job',
      entityId: body.job_id,
      subject: `You're on a job: ${job.title}${when ? ` — ${when}` : ''}`,
      text: `${member.full_name ?? 'Hey'}, you've been assigned to a job.\n\nJob: ${job.title}\n${when ? `When: ${when}\n` : ''}${job.address ? `Where: ${job.address}\n` : ''}${customerName ? `Customer: ${customerName}\n` : ''}\nDetails, photos, and directions are in the app: ${APP_URL}/field\n\n— Sanchez Junk & Haul Co.`,
    });
    return result.ok
      ? NextResponse.json({ sent: true })
      : NextResponse.json({ error: result.error ?? 'send failed' }, { status: 502 });
  }

  // ---- Sign-page events: a valid token is the proof of legitimacy ----
  const { event, kind, token } = body;
  if ((event !== 'viewed' && event !== 'signed') || (kind !== 'estimate' && kind !== 'invoice') || !token) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  // Read-only lookup (does NOT bump view_count) — migration 0015.
  const { data: doc, error: rpcErr } = await supabase.rpc('notify_doc_by_token', { p_kind: kind, p_token: token });
  if (rpcErr || !doc) return NextResponse.json({ error: 'invalid token' }, { status: 404 });

  const d = doc as { number: number; customer_name: string | null; total: number | null; signed_name: string | null };
  const docName = `${kind === 'invoice' ? 'Invoice' : 'Estimate'} #${d.number}`;
  const amount = d.total != null ? ` — $${Number(d.total).toFixed(2)}` : '';
  const who = d.customer_name ? ` (${d.customer_name})` : '';

  const result = await sendNotification({
    event,
    to: owner,
    entityKind: kind,
    subject: event === 'signed'
      ? `✍️ ${d.signed_name ?? 'Customer'} signed ${docName}${amount}`
      : `👁 ${docName}${who} was just opened`,
    text: event === 'signed'
      ? `${d.signed_name ?? 'Your customer'} signed ${docName}${who}${amount}.\n\n${kind === 'estimate' ? 'A job was created automatically — schedule it in the app.' : 'Waiting on payment — mark it paid when the money lands.'}\n\n${APP_URL}`
      : `${docName}${who}${amount} was just viewed by the customer.\n\n${APP_URL}`,
  });
  return result.ok
    ? NextResponse.json({ sent: true })
    : NextResponse.json({ error: result.error ?? 'send failed' }, { status: 502 });
}
