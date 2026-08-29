import { createClient } from '@/lib/supabase/server';
import { getRole } from '@/lib/auth';
import FieldJobList from './FieldJobList';
import ClockWidget from './ClockWidget';
import type { Job, TimeEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Redacted job shape returned by the technician RPCs (no money fields). */
interface TechJob {
  id: string; title: string; description: string | null; status: Job['status'];
  service: Job['service']; scheduled_start: string | null; scheduled_end: string | null;
  address: string | null; photos: Job['photos'];
  customer_id: string | null; customer_name: string | null; customer_phone: string | null;
}

function techToJob(t: TechJob): Job {
  return {
    id: t.id, customer_id: t.customer_id ?? '', title: t.title, description: t.description,
    service: t.service, status: t.status, scheduled_start: t.scheduled_start,
    scheduled_end: t.scheduled_end, address: t.address, estimated_value: null,
    photos: t.photos ?? [], created_at: '', updated_at: '',
    customers: t.customer_id ? { id: t.customer_id, name: t.customer_name ?? '', phone: t.customer_phone, address: t.address } : undefined,
  } as Job;
}

/** Mobile-first field view: today's jobs, time clock, big buttons, offline-capable.
 *  Staff see every job booked today; technicians see the jobs ASSIGNED to them
 *  (via a redacted RPC — the technician session can't read money fields at all). */
export default async function FieldPage() {
  const supabase = createClient();
  const role = await getRole();
  const isStaff = role === 'admin' || role === 'dispatcher';
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
  const { data: { user } } = await supabase.auth.getUser();

  let todayJobs: Job[] = [];
  if (isStaff) {
    const { data: jobs } = await supabase.from('jobs').select('*, customers(id,name,phone,address)')
      .gte('scheduled_start', dayStart).lte('scheduled_start', dayEnd)
      .in('status', ['scheduled', 'in_progress']).order('scheduled_start');
    todayJobs = (jobs ?? []) as Job[];
  } else {
    const { data: jobs } = await supabase.rpc('tech_my_jobs', { p_from: dayStart, p_to: dayEnd });
    todayJobs = ((jobs ?? []) as TechJob[])
      .filter((j) => j.status === 'scheduled' || j.status === 'in_progress')
      .map(techToJob);
  }

  const { data: openEntries } = user
    ? await supabase.from('time_entries').select('*, jobs(id,title)').eq('user_id', user.id).is('ended_at', null).order('started_at', { ascending: false }).limit(1)
    : { data: [] as TimeEntry[] };
  const openEntry = ((openEntries ?? []) as unknown as TimeEntry[])[0] ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Field — Today</h1>
      {user && <ClockWidget userId={user.id} openEntry={openEntry} jobs={todayJobs.map((j) => ({ id: j.id, title: j.title }))} />}
      <FieldJobList jobs={todayJobs} />
      {!isStaff && todayJobs.length === 0 && (
        <p className="text-xs text-gray-400">Jobs show up here once you&apos;re assigned to them for today.</p>
      )}
    </div>
  );
}
