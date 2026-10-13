import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import PackagesManager from './PackagesManager';

export const dynamic = 'force-dynamic';

export default async function PackagesPage() {
  await requireStaff();
  const supabase = createClient();
  const [{ data: packages }, { data: addons }] = await Promise.all([
    supabase.from('rental_packages').select('*').order('sort_order').order('name'),
    supabase.from('rental_addons').select('*').order('sort_order').order('name'),
  ]);
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Packages &amp; add-ons</h1><p className="text-sm text-gray-500">Prices are blank until you fill them in; a package with no price does not show on the booking page.</p></div>
      <RentalsNav active="/rentals/packages" />
      <PackagesManager packages={packages ?? []} addons={addons ?? []} />
    </div>
  );
}
