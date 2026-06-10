import { createClient } from '@/lib/supabase/server';
import LeadBoard from './LeadBoard';
import type { Lead } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const supabase = createClient();
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .order('updated_at', { ascending: false });

  const all = (leads ?? []) as Lead[];
  const won = all.filter((l) => l.status === 'won').length;
  const closed = won + all.filter((l) => l.status === 'lost').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Leads</h1>
        {closed > 0 && (
          <span className="badge bg-brand-50 text-brand-700">
            Conversion: {Math.round((won / closed) * 100)}% ({won}/{closed} closed)
          </span>
        )}
      </div>
      <LeadBoard leads={all} />
    </div>
  );
}
