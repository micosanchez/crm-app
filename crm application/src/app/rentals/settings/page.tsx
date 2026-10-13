import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import RentalsNav from '../RentalsNav';
import SettingsForm from './SettingsForm';
import { DEFAULT_TERMS } from '@/lib/rentals/terms';

export const dynamic = 'force-dynamic';

export default async function RentalSettingsPage() {
  await requireAdmin();
  const supabase = createClient();
  const { data } = await supabase.from('rental_settings').select('*').eq('id', true).single();
  return (
    <div className="space-y-4">
      <div><p className="panel-label">Rentals</p><h1 className="text-2xl">Settings</h1><p className="text-sm text-gray-500">Fees, deposits, scheduling, delivery, terms and message templates. Editing the terms bumps the version automatically.</p></div>
      <RentalsNav active="/rentals/settings" />
      <SettingsForm settings={data} defaultTerms={DEFAULT_TERMS} />
    </div>
  );
}
