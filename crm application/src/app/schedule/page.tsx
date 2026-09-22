import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScheduleWeek, { type ScheduleDay } from './ScheduleWeek';
import { getRole } from '@/lib/auth';
import { detroitDateTime, detroitParts, ymd } from '@/lib/dates';
import type { Customer, Job } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Monday 00:00 Detroit of the week containing `d`. */
function startOfWeek(d: Date) {
  const p = detroitParts(d);
  const noon = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  const back = (noon.getUTCDay() + 6) % 7; // days since Monday
  return detroitDateTime(p.y, p.m, p.d - back);
}

export default async function SchedulePage({ searchParams }: { searchParams: { week?: string } }) {
  const supabase = createClient();
  const role = await getRole();
  const isTech = role === 'technician';
  // The chosen week is a Detroit date; pick its noon so no zone can shift the day.
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? '') ? searchParams.week!.split('-').map(Number) : null;
  const base = picked ? detroitDateTime(picked[0]!, picked[1]!, picked[2]!, 12) : new Date();
  const weekStart = startOfWeek(base);
  const ws = detroitParts(weekStart);
  const weekEnd = detroitDateTime(ws.y, ws.m, ws.d + 7);

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

  const prev = ymd(detroitDateTime(ws.y, ws.m, ws.d - 7));
  const next = ymd(weekEnd);

  // Bucket jobs into Detroit calendar days server-side so the day never shifts
  // with the server's or the browser's zone.
  const todayStr = ymd();
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = detroitDateTime(ws.y, ws.m, ws.d + i);
    const dayKey = ymd(day);
    return {
      key: day.toISOString(),
      addDate: dayKey,
      label: day.toLocaleDateString('en-US', { timeZone: 'America/Detroit', weekday: 'short', day: 'numeric' }),
      isToday: dayKey === todayStr,
      jobs: (jobs as (Job & { customers?: { name?: string } | null })[] | null)?.filter((j) =>
        ymd(new Date(j.scheduled_start!)) === dayKey) ?? [],
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
            <input type="date" name="week" defaultValue={ymd(weekStart)} className="input w-auto py-1" />
            <button className="btn-ghost" type="submit">Go</button>
          </form>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Week of {weekStart.toLocaleDateString('en-US', { timeZone: 'America/Detroit', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      <ScheduleWeek days={days} customers={(customers ?? []) as Pick<Customer, 'id' | 'name'>[]} />

      <p className="text-xs text-gray-400">Tap <span className="font-medium">+ Add</span> on any day to schedule a job for that date.</p>
    </div>
  );
}
