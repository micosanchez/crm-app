import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { evidencePacket } from '@/lib/rentals/ops';

export const dynamic = 'force-dynamic';

/** Dispute evidence packet: signed agreement, check-out/check-in photos, timestamps, texts. Print to PDF and upload to Stripe. */
export default async function EvidencePage({ params }: { params: { id: string } }) {
  await requireStaff();
  const admin = createAdminClient()!;
  const p = await evidencePacket(params.id, admin);
  const sign = async (path: string | null | undefined) => path ? (await admin.storage.from('documents').createSignedUrl(path, 3600)).data?.signedUrl ?? null : null;
  const pdf = await sign(p.agreement?.pdf_url);
  const sig = await sign(p.agreement?.signature_image_url);
  const photos: { label: string; url: string | null }[] = [];
  for (const i of p.items ?? []) for (const u of (i.photo_urls ?? []) as string[]) photos.push({ label: `${(i.rental_assets as { asset_tag?: string })?.asset_tag} ${i.return_condition ?? 'check-out'}`, url: await sign(u) });
  for (const c of p.charges ?? []) for (const u of (c.photo_urls ?? []) as string[]) photos.push({ label: `${c.type} ${c.description ?? ''}`, url: await sign(u) });
  const r = p.rental;
  return (
    <div className="mx-auto max-w-3xl space-y-4 bg-white p-4 text-sm print:p-0">
      <div className="flex justify-between"><h1 className="text-xl font-bold">Evidence packet: rental {r.rental_number}</h1><span className="text-xs text-gray-500 print:hidden">Print / Save as PDF (⌘P) and upload to Stripe</span></div>
      <p>Customer {r.customers?.name} · {r.customers?.phone} · {r.customers?.email}<br />Delivery {r.delivery_date} {r.delivery_window} to {r.delivery_address}<br />Pickup {r.pickup_date} from {r.pickup_address ?? r.delivery_address}<br />Generated {new Date(p.generated_at).toLocaleString()}</p>
      <section><h2 className="font-semibold">1. Signed agreement</h2>{p.agreement ? <><p>Signed by {p.agreement.signer_name} on {new Date(p.agreement.signed_at).toLocaleString()} · IP {p.agreement.ip_address} · {p.agreement.user_agent}</p>{pdf && <a className="underline" href={pdf}>Signed PDF</a>}{sig && <img src={sig} alt="signature" className="mt-2 h-20" />}<pre className="mt-2 whitespace-pre-wrap border p-2 text-xs">{p.agreement.terms_snapshot}</pre></> : <p>No agreement on file.</p>}</section>
      <section><h2 className="font-semibold">2. Charges</h2><table className="w-full"><tbody>{(p.charges ?? []).map((c) => <tr key={c.id} className="border-t"><td>{new Date(c.created_at).toLocaleString()}</td><td>{c.type} · {c.description}</td><td>{c.status}</td><td className="text-right">${Number(c.amount).toFixed(2)}</td><td className="text-xs">{c.stripe_payment_intent_id}</td></tr>)}</tbody></table></section>
      <section><h2 className="font-semibold">3. Photos</h2><div className="grid grid-cols-2 gap-2 md:grid-cols-3">{photos.map((ph, i) => ph.url ? <figure key={i}><img src={ph.url} alt={ph.label} className="w-full rounded border" /><figcaption className="text-xs">{ph.label}</figcaption></figure> : null)}{!photos.length && <p>No photos.</p>}</div></section>
      <section><h2 className="font-semibold">4. Messages sent</h2>{(p.messages ?? []).map((m, i) => <p key={i} className="border-t py-1 text-xs">{m.sent_at ? new Date(m.sent_at).toLocaleString() : 'queued'} · {m.channel} · {m.template} · {m.status}<br />{m.body}</p>)}</section>
      <section><h2 className="font-semibold">5. Timeline</h2>{(p.events ?? []).map((e) => <p key={e.id} className="text-xs">{new Date(e.created_at).toLocaleString()} · {e.event} {JSON.stringify(e.detail)}</p>)}</section>
    </div>
  );
}
