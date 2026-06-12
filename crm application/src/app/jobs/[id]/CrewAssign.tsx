'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Job, UserProfile } from '@/lib/types';

/** Assign team members to a job. Assigning emails the crew member. */
export default function CrewAssign({ job, team, assigned }: {
  job: Job; team: Pick<UserProfile, 'id' | 'full_name' | 'email'>[]; assigned: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState<string[]>(assigned);

  async function toggle(member: Pick<UserProfile, 'id' | 'full_name' | 'email'>) {
    setBusy(true);
    const supabase = createClient();
    if (ids.includes(member.id)) {
      await supabase.from('job_assignments').delete().eq('job_id', job.id).eq('user_id', member.id);
      setIds(ids.filter((i) => i !== member.id));
    } else {
      await supabase.from('job_assignments').insert({ job_id: job.id, user_id: member.id });
      setIds([...ids, member.id]);
      // Notify the crew member by email (fire-and-forget)
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'assigned',
          to: member.email,
          crewName: member.full_name,
          jobTitle: job.title,
          when: job.scheduled_start ? new Date(job.scheduled_start).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined,
          address: job.address ?? undefined,
          customer: job.customers?.name,
        }),
      }).catch(() => {});
    }
    setBusy(false);
    router.refresh();
  }

  if (!team.length) return null;

  return (
    <div className="card">
      <p className="panel-label mb-2">Crew — assigning sends them an email</p>
      <div className="flex flex-wrap gap-2">
        {team.map((m) => (
          <button key={m.id} disabled={busy} onClick={() => toggle(m)}
            className={`badge border px-3 py-1.5 transition-colors ${ids.includes(m.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
            {m.full_name}
          </button>
        ))}
      </div>
    </div>
  );
}
