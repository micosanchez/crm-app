import { createClient } from '@/lib/supabase/server';
import FieldJobList from './FieldJobList';
import ClockWidget from './ClockWidget';
import type { Job, TimeEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Mobile-first field technician view: today's jobs, time clock, big buttons, offline-capable. */
export default async function FieldPage() {
  const supabase = createClient();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
  const { data: { user } } = await supabase.auth.getUser();

  // Cash/ops basis: the field crew only sees jobs scheduled for TODAY.
  const [{ data: jobs }, { data: openEntries }] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)')
      .gte('scheduled_start', dayStart).lte('scheduled_start', dayEnd)
      .in('status', ['scheduled', 'in_progress']).order('scheduled_start'),
    user
      ? supabase.from('time_entries').select('*, jobs(id,title)').eq('user_id', user.id).is('ended_at', null).order('started_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as TimeEntry[] }),
  ]);

  const todayJobs = (jobs ?? []) as Job[];
  const openEntry = ((openEntries ?? []) as unknown as TimeEntry[])[0] ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Field — Today</h1>
      {user && <ClockWidget userId={user.id} openEntry={openEntry} jobs={todayJobs.map((j) => ({ id: j.id, title: j.title }))} />}
      <FieldJobList jobs={todayJobs} />
    </div>
  );
}
