import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import type { Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function SchedulePage({ searchParams }: { searchParams: { week?: string } }) {
  const supabase = createClient();
  const base = searchParams.week ? new Date(searchParams.week) : new Date();
  const weekStart = startOfWeek(base);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400_000);

  const { data: jobs } = await supabase
    .from('jobs')
    .select('*, customers(id,name,phone,address)')
    .gte('scheduled_start', weekStart.toISOString())
    .lt('scheduled_start', weekEnd.toISOString())
    .order('scheduled_start');

  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400_000));
  const prev = new Date(weekStart.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  const next = new Date(weekStart.getTime() + 7 * 86400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Schedule</h1>
        <div className="flex gap-2">
          <Link href={`/schedule?week=${prev}`} className="btn-ghost">← Prev</Link>
          <Link href="/schedule" className="btn-ghost">Today</Link>
          <Link href={`/schedule?week=${next}`} className="btn-ghost">Next →</Link>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Week of {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day) => {
          const dayJobs = (jobs as Job[] | null)?.filter((j) => {
            const d = new Date(j.scheduled_start!);
            return d.toDateString() === day.toDateString();
          }) ?? [];
          const isToday = day.toDateString() === new Date().toDateString();
          return (
            <div key={day.toISOString()} className={`rounded-xl p-2 ${isToday ? 'bg-brand-50 ring-1 ring-brand-500' : 'bg-gray-100'}`}>
              <p className="mb-2 px-1 text-sm font-semibold text-gray-600">
                {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
              </p>
              <div className="space-y-2">
                {dayJobs.map((j) => (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-sm hover:border-brand-500">
                    <p className="text-xs font-semibold text-gray-500">{new Date(j.scheduled_start!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                    <p className="font-medium leading-tight">{j.title}</p>
                    <p className="text-xs text-gray-500">{j.customers?.name}</p>
                    <div className="mt-1"><StatusBadge status={j.status} /></div>
                  </Link>
                ))}
                {!dayJobs.length && <p className="px-1 text-xs text-gray-400">—</p>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400">To schedule a job, set its date/time when creating it on the Jobs page, or open the job and update it.</p>
    </div>
  );
}
