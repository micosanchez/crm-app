import { createClient } from '@/lib/supabase/server';
import FieldJobList from './FieldJobList';
import type { Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Mobile-first field technician view: today's jobs, big buttons, offline-capable. */
export default async function FieldPage() {
  const supabase = createClient();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const { data: jobs } = await supabase
    .from('jobs')
    .select('*, customers(id,name,phone,address)')
    .or(`scheduled_start.gte.${dayStart},status.eq.in_progress`)
    .in('status', ['scheduled', 'in_progress'])
    .order('scheduled_start');

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Field — today</h1>
      <FieldJobList jobs={(jobs ?? []) as Job[]} />
    </div>
  );
}
