import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScheduleWeek, { type ScheduleDay } from './ScheduleWeek';
import { getRole } from '@/lib/auth';
import type { Customer, Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function SchedulePage({ searchParams }: { searchParams: { week?: string } }) {
  const supabase = createClient();
  const role = await getRole();
  const isTech = role === 'technician';
  // Parse the chosen week at local noon so it never lands on the wrong day across time zones.
  const base = searchParams.week ? new Date(searchParams.week + 'T12:00:00') : new Date();
  const weekStart = startOfWeek(base);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000);

  // Technicians see only their assigned jobs (redacted RPC — no money fields);
  // staff see the whole board.
  const [{ data: jobs }, { data: customers }] = isTech
    ? await Promise.all([
        supabase.rpc('tech_my_jobs', { p_from: weekStart.toISOString(), p_to: weekEnd.toISOString() })
          .then((r) => ({ data: ((r.data ?? []) as { id: string; title: string; status: string; scheduled_start: string | null; scheduled_end: string | null; address: string | null; customer_name: string | null }[]).map((t) => ({ ...t, customers: { name: t.customer_name } })) })),
        Promise.resolve({ data: [] }),
      ])
    : await Promise.all([
        supabase
          .from('jobs')
          .select('*, customers(id,name,phone,address)')
          .gte('scheduled_start', weekStart.toISOString())
          .lt('scheduled_start', weekEnd.toISOString())
          .order('scheduled_start'),
        supabase.from('customers').select('id,name').order('name'),
      ]);

  const prev = new Date(weekStart.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  const next = new Date(weekStart.getTime() + 7 * 86400_000).toISOString().slice(0, 10);

  // Bucket jobs into days server-side so day assignment doesn't shift by browser timezone.
  const todayStr = new Date().toDateString();
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart.getTime() + i * 86400_000);
    return {
      key: day.toISOString(),
      addDate: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
      isToday: day.toDateString() === todayStr,
      jobs: (jobs as (Job & { customers?: { name?: string } | null })[] | null)?.filter((j) =>
        new Date(j.scheduled_start!).toDateString() === day.toDateString()) ?? [],
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/schedule?week=${prev}`} className="btn-ghost">← Prev</Link>
          <Link href="/schedule" className="btn-ghost">Today</Link>
          <Link href={`/schedule?week=${next}`} className="btn-ghost">Next →</Link>
          {/* Jump to any week — native GET form, works without client JS */}
          <form action="/schedule" className="flex items-center gap-1">
            <input type="date" name="week" defaultValue={weekStart.toISOString().slice(0, 10)} className="input w-auto py-1" />
            <button className="btn-ghost" type="submit">Go</button>
          </form>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Week of {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      <ScheduleWeek days={days} customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]} />

      <p className="text-xs text-gray-400">Tap <span className="font-medium">+ Add</span> on any day to schedule a job for that date.</p>
    </div>
  );
}
