import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** A scanned label lands here: jump to the rental the asset is on, or to inventory. */
export default async function ScanPage({ params }: { params: { tag: string } }) {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase.from('rental_items').select('rental_id, rental_assets!inner(asset_tag)').eq('rental_assets.asset_tag', params.tag.toUpperCase()).is('checked_in_at', null).limit(1).maybeSingle();
  redirect(data?.rental_id ? `/rentals/${data.rental_id}` : `/rentals/inventory`);
}
