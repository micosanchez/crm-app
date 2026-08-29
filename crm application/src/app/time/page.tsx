import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import TimeLogTable, { type TimeRow } from './TimeLogTable';

export const dynamic = 'force-dynamic';

/** Admin Time Log — every clock event, filterable and editable (people forget
 *  to clock out). Entries tied to a job auto-create labor entries at the
 *  worker's stamped rate, so this feeds job costing without double entry. */
export default async function TimeLogPage({ searchParams }: {
  searchParams: { worker?: string; job?: string; from?: string; to?: string };
}) {
  await requireStaff();
  const supabase = createClient();

  let q = supabase.from('time_entries')
    .select('id,user_id,job_id,started_at,ended_at,note,users(id,full_name),jobs(id,title)')
    .order('started_at', { ascending: false })
    .limit(200);
  if (searchParams.worker) q = q.eq('user_id', searchParams.worker);
  if (searchParams.job) q = q.eq('job_id', searchParams.job);
  if (searchParams.from) q = q.gte('started_at', new Date(searchParams.from + 'T00:00:00').toISOString());
  if (searchParams.to) q = q.lte('started_at', new Date(searchParams.to + 'T23:59:59').toISOString());

  const [{ data: entries }, { data: team }] = await Promise.all([
    q,
    supabase.from('users').select('id,full_name').eq('is_active', true).order('full_name'),
  ]);

  const rows = ((entries ?? []) as unknown as TimeRow[]);

  return (
    <div className="space-y-4">
      <div>
        <p className="panel-label">Crew</p>
        <h1 className="text-2xl font-bold">Time Log</h1>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div>
          <label className="panel-label mb-1 block">Worker</label>
          <select className="input w-auto" name="worker" defaultValue={searchParams.worker ?? ''}>
            <option value="">Everyone</option>
            {(team ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="panel-label mb-1 block">From</label>
          <input className="input w-auto" type="date" name="from" defaultValue={searchParams.from ?? ''} />
        </div>
        <div>
          <label className="panel-label mb-1 block">To</label>
          <input className="input w-auto" type="date" name="to" defaultValue={searchParams.to ?? ''} />
        </div>
        <button className="btn-primary">Filter</button>
      </form>

      <TimeLogTable rows={rows} />
      <p className="text-xs text-gray-400">
        Clock-ins and clock-outs email you the moment they happen. Entries still running after 12 hours
        are flagged as likely forgotten — set the clock-out here and the labor cost re-syncs automatically.
      </p>
    </div>
  );
}
