'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { UserProfile } from '@/lib/types';

/** Assign team members to a job (drives who sees it as theirs in Field). */
export default function CrewAssign({ jobId, team, assigned }: {
  jobId: string; team: Pick<UserProfile, 'id' | 'full_name'>[]; assigned: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState<string[]>(assigned);

  async function toggle(userId: string) {
    setBusy(true);
    const supabase = createClient();
    if (ids.includes(userId)) {
      await supabase.from('job_assignments').delete().eq('job_id', jobId).eq('user_id', userId);
      setIds(ids.filter((i) => i !== userId));
    } else {
      await supabase.from('job_assignments').insert({ job_id: jobId, user_id: userId });
      setIds([...ids, userId]);
    }
    setBusy(false);
    router.refresh();
  }

  if (!team.length) return null;

  return (
    <div className="card">
      <p className="panel-label mb-2">Crew</p>
      <div className="flex flex-wrap gap-2">
        {team.map((m) => (
          <button key={m.id} disabled={busy} onClick={() => toggle(m.id)}
            className={`badge border px-3 py-1.5 transition-colors ${ids.includes(m.id) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
            {m.full_name}
          </button>
        ))}
      </div>
    </div>
  );
}
