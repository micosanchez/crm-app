import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/auth';
import { sendText, renderTemplate, explainSkip, formatPhone, type TemplateKey } from '@/lib/quo';

export const dynamic = 'force-dynamic';

const TEMPLATE_KEYS: TemplateKey[] = [
  'intake_link', 'request_received', 'quote_link', 'quote_followup', 'on_my_way', 'job_complete',
];

/**
 * Staff-only: send a text over the business line. Takes either raw `content` or
 * a `template` plus its variables, so screens don't hand-assemble copy.
 *
 * Anything sent from here is a person pressing a button, so it isn't held back
 * by quiet hours or the cooldown — those apply to automated sends (pass
 * `automated: true`).
 */
export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== 'admin' && role !== 'dispatcher') {
    return NextResponse.json({ error: 'Staff only.' }, { status: 403 });
  }

  let body: {
    to?: string;
    content?: string;
    template?: string;
    automated?: boolean;
    first_name?: string;
    link?: string;
    quote_number?: string | number;
    total?: string;
    entity_kind?: string;
    entity_id?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }

  const to = (body.to ?? '').trim();
  if (!to) return NextResponse.json({ error: 'No number to text.' }, { status: 400 });

  let content = (body.content ?? '').trim();
  let event = 'sms:manual';
  if (!content && body.template) {
    const key = body.template as TemplateKey;
    if (!TEMPLATE_KEYS.includes(key)) {
      return NextResponse.json({ error: `Unknown message template "${body.template}".` }, { status: 400 });
    }
    content = renderTemplate(key, {
      first_name: body.first_name,
      link: body.link,
      quote_number: body.quote_number,
      total: body.total,
    });
    event = `sms:${key}`;
  }
  if (!content) return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 });

  const result = await sendText({
    to,
    content,
    event,
    automated: !!body.automated,
    entityKind: body.entity_kind,
    entityId: body.entity_id,
  });

  if (result.skipped) {
    return NextResponse.json({ error: explainSkip(result.skipped), skipped: result.skipped }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'The text did not send.' }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    to: formatPhone(to),
    messageId: result.messageId ?? null,
    status: result.deliveryStatus ?? 'queued',
  });
}
