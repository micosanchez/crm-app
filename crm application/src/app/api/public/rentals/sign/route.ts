import { NextRequest, NextResponse } from 'next/server';
import { admin, getRentalByToken, getSettings, logEvent, rentalLink, first } from '@/lib/rentals/ops';
import { renderTerms } from '@/lib/rentals/terms';
import { agreementPdf } from '@/lib/rentals/pdf';
import { sendNotification } from '@/lib/notify';
import { clientIp } from '@/lib/requests';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;
const CORS = { 'Access-Control-Allow-Origin': '*' };
const BUCKET = 'documents';

/** GET ?token= → the terms as they will be signed (filled in with this rental's details). */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(token, db);
    const s = await getSettings(db);
    const { data: lines } = await db.from('rental_addon_lines').select('qty, rental_addons(name)').eq('rental_id', r.id);
    const label = (lines ?? []).map((l) => `${l.qty} ${(l.rental_addons as unknown as { name: string })?.name}`).join(', ');
    return NextResponse.json(renderTerms(s, r, label), { headers: CORS });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 404, headers: CORS }); }
}

/** POST {token, name, signature(dataURL png), agreed:true} → agreement row + PNG + PDF in storage + email. */
export async function POST(req: NextRequest) {
  let b: { token?: string; name?: string; signature?: string; agreed?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400, headers: CORS }); }
  if (!b.token || !b.name?.trim() || !b.signature?.startsWith('data:image/png;base64,') || !b.agreed) return NextResponse.json({ error: 'Type your full name, draw your signature and tick the box.' }, { status: 400, headers: CORS });
  try {
    const db = admin();
    const r = await getRentalByToken(b.token, db);
    if (r.status === 'cancelled') return NextResponse.json({ error: 'This booking expired. Start again from the booking page.' }, { status: 410, headers: CORS });
    const s = await getSettings(db);
    const { data: lines } = await db.from('rental_addon_lines').select('qty, rental_addons(name)').eq('rental_id', r.id);
    const label = (lines ?? []).map((l) => `${l.qty} ${(l.rental_addons as unknown as { name: string })?.name}`).join(', ');
    const terms = renderTerms(s, r, label);
    const png = Buffer.from(b.signature.split(',')[1], 'base64');
    const ip = clientIp(req.headers), ua = (req.headers.get('user-agent') ?? '').slice(0, 300);
    const signedAt = new Date().toISOString();
    const sigPath = `rentals/${r.id}/signature-${Date.now()}.png`;
    await db.storage.from(BUCKET).upload(sigPath, png, { contentType: 'image/png', upsert: true });
    const pdf = await agreementPdf({ rental_number: r.rental_number, signer_name: b.name.trim(), signed_at: signedAt, ip, user_agent: ua, terms_snapshot: terms.text, signature_png: png, terms_version: terms.version });
    const pdfPath = `rentals/${r.id}/agreement-${Date.now()}.pdf`;
    await db.storage.from(BUCKET).upload(pdfPath, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
    const { error } = await db.from('rental_agreements').insert({ rental_id: r.id, terms_version: terms.version, terms_snapshot: terms.text, signer_name: b.name.trim(), signature_image_url: sigPath, pdf_url: pdfPath, signed_at: signedAt, ip_address: ip, user_agent: ua });
    if (error) throw new Error(error.message);
    await logEvent(r.id, 'agreement:signed', { name: b.name.trim(), terms_version: terms.version, ip }, db);
    if (r.customers?.email) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(pdfPath, 60 * 60 * 24 * 30);
      await sendNotification({ event: 'rental_agreement', to: r.customers.email, subject: `Your signed tote rental agreement (${r.rental_number})`, text: `Hi ${first(r.customers.name)},\n\nThanks for signing. Your copy of the rental agreement (PDF, link good for 30 days): ${signed?.signedUrl ?? rentalLink(r)}\n\nYour rental page: ${rentalLink(r)}\n\nSanchez Junk & Haul Co.` });
    }
    return NextResponse.json({ ok: true, signed_at: signedAt }, { headers: CORS });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500, headers: CORS }); }
}
export async function OPTIONS() { return new NextResponse(null, { headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }); }
