import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';

export const dynamic = 'force-dynamic';

/**
 * Printable tote stickers (business plan section 10): 4 x 4 in laminated vinyl, one per tote, both long sides about
 * 2 in below the rim, never on the lid. The QR carries the asset tag, so a scan is attributed to whoever holds the
 * tote; sanchezhaulco.com/q forwards to the CRM quote page which logs the scan. Error correction level H, dark on white.
 */
const QR_URL = (tag: string) => `https://sanchezhaulco.com/q?t=${tag}&utm_source=tote&utm_medium=qr&utm_campaign=tote_sticker`;

export default async function LabelsPage({ searchParams }: { searchParams: { type?: string; size?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const { data: assets } = await supabase.from('rental_assets').select('asset_tag, asset_type').neq('status', 'retired').order('asset_tag');
  const list = (assets ?? []).filter((a) => (searchParams.type ?? 'tote') === 'all' || a.asset_type === (searchParams.type ?? 'tote'));
  const small = searchParams.size === 'small';
  const svgs = await Promise.all(list.map((a) => QRCode.toString(QR_URL(a.asset_tag), { type: 'svg', margin: 1, errorCorrectionLevel: 'H', width: small ? 72 : 160 })));
  return (
    <div className="space-y-4">
      <div className="print:hidden"><p className="panel-label">Rentals</p><h1 className="text-2xl">Tote stickers</h1>
        <p className="text-sm text-gray-500">{list.length} stickers. Print on 4 × 4 in laminated vinyl (⌘P, paper 4×4 in, no margins) or send this page as a PDF to the sticker printer. Test the code with three phones at arm&apos;s length before the full run. <a className="underline" href="/rentals/labels?type=tote">totes</a> · <a className="underline" href="/rentals/labels?type=dolly">dollies</a> · <a className="underline" href="/rentals/labels?type=all">all gear</a> · <a className="underline" href="/rentals/labels?size=small">small 2×1 tags</a></p>
        <RentalsNav active="/rentals/labels" /></div>
      <style>{small ? `@media print { @page { size: 2in 1in; margin: 0 } .lbl { page-break-after: always; border: 0 !important } }` : `@media print { @page { size: 4in 4in; margin: 0 } .lbl { page-break-after: always; border: 0 !important } }`}</style>
      <div className="flex flex-wrap gap-3 print:block">
        {list.map((a, i) => small ? (
          <div key={a.asset_tag} className="lbl flex items-center gap-2 border bg-white p-1 text-black" style={{ width: '2in', height: '1in', boxSizing: 'border-box' }}>
            <div style={{ width: 72, height: 72 }} dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <div><p style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{a.asset_tag}</p><p style={{ fontSize: 9, lineHeight: 1.1 }}>Sanchez Junk &amp; Haul Co.<br />734-537-8061 · Rental tote, please return</p></div>
          </div>
        ) : (
          <div key={a.asset_tag} className="lbl border bg-white text-black" style={{ width: '4in', height: '4in', boxSizing: 'border-box', padding: '0.22in', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Barlow Condensed, Inter, system-ui, sans-serif' }}>
            <p style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.05, margin: 0 }}>Moving? Don&apos;t take the junk with you.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.18in' }}>
              <div style={{ width: 160, height: 160, flex: '0 0 auto' }} dangerouslySetInnerHTML={{ __html: svgs[i] }} />
              <div style={{ fontSize: 15, lineHeight: 1.2 }}><p style={{ margin: 0, fontWeight: 700 }}>Scan for a free junk removal quote.</p><p style={{ margin: '6px 0 0' }}>Tote renters get <b>$25 off</b>.</p><p style={{ margin: '10px 0 0', fontSize: 13 }}>Rental tote {a.asset_tag}. Please return with the lid.</p></div>
            </div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Sanchez Junk &amp; Haul Co. · 734-537-8061</p>
          </div>
        ))}
      </div>
    </div>
  );
}
