import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import { APP_URL } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** Printable QR labels, 2" x 1" each (label printer) — the check-out/check-in scanner reads the tag from the QR. */
export default async function LabelsPage({ searchParams }: { searchParams: { type?: string } }) {
  await requireStaff();
  const supabase = createClient();
  const { data: assets } = await supabase.from('rental_assets').select('asset_tag, asset_type').neq('status', 'retired').order('asset_tag');
  const list = (assets ?? []).filter((a) => !searchParams.type || a.asset_type === searchParams.type);
  const svgs = await Promise.all(list.map((a) => QRCode.toString(`${APP_URL}/rentals/scan/${a.asset_tag}`, { type: 'svg', margin: 0, width: 72 })));
  return (
    <div className="space-y-4">
      <div className="print:hidden"><p className="panel-label">Rentals</p><h1 className="text-2xl">Asset labels</h1><p className="text-sm text-gray-500">{list.length} labels at 2 × 1 in. Print with ⌘P on label stock (set paper to 2×1 in, no margins). <a className="underline" href="/rentals/labels?type=tote">totes</a> · <a className="underline" href="/rentals/labels?type=dolly">dollies</a> · <a className="underline" href="/rentals/labels">all</a></p><RentalsNav active="/rentals/labels" /></div>
      <style>{`@media print { @page { size: 2in 1in; margin: 0 } .lbl { page-break-after: always; border: 0 !important } }`}</style>
      <div className="flex flex-wrap gap-2 print:block">
        {list.map((a, i) => (
          <div key={a.asset_tag} className="lbl flex items-center gap-2 border p-1" style={{ width: '2in', height: '1in', boxSizing: 'border-box' }}>
            <div style={{ width: 72, height: 72 }} dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <div><p style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{a.asset_tag}</p><p style={{ fontSize: 9, lineHeight: 1.1 }}>Sanchez Junk &amp; Haul Co.<br />734-537-8061 · Rental tote, please return</p></div>
          </div>))}
      </div>
    </div>
  );
}
