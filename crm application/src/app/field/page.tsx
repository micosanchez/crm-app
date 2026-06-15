import { createClient } from '@/lib/supabase/server';
import FieldJobList from './FieldJobList';
import type { Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Mobile-first field technician view: today's jobs, big buttons, offline-capable. */
export default async function FieldPage() {
  const supabase = createClient();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  // Cash/ops basis: the field crew only sees jobs scheduled for TODAY.
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*, customers(id,name,phone,address)')
    .gte('scheduled_start', dayStart)
    .lte('scheduled_start', dayEnd)
    .in('status', ['scheduled', 'in_progress'])
    .order('scheduled_start');

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Field — Today</h1>
      <FieldJobList jobs={(jobs ?? []) as Job[]} />
    </div>
  );
}
