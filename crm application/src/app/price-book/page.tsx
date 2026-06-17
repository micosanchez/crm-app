import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import PriceBookManager from './PriceBookManager';
import type { ServiceItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PriceBookPage() {
  await requireStaff();
  const supabase = createClient();
  const { data } = await supabase.from('service_items').select('*').eq('active', true).order('name');

  return (
    <div className="space-y-4">
      <div>
        <p className="panel-label">Price book</p>
        <h1 className="text-2xl">Saved service items</h1>
        <p className="mt-1 text-sm text-gray-500">Reusable line items so quoting is two taps instead of typing.</p>
      </div>
      <PriceBookManager items={(data ?? []) as ServiceItem[]} />
    </div>
  );
}
