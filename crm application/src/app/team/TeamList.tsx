'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { UserProfile, UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['admin', 'dispatcher', 'technician'];
const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-[#7b2153] text-white',
  dispatcher: 'bg-purple-100 text-purple-700',
  technician: 'bg-gray-100 text-gray-700',
};

export default function TeamList({ members: initial, isAdmin, myId }: {
  members: UserProfile[]; isAdmin: boolean; myId: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function update(id: string, patch: Partial<UserProfile>) {
    setBusy(id);
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    const supabase = createClient();
    const { error } = await supabase.from('users').update(patch).eq('id', id);
    if (error) {
      alert(`Could not update: ${error.message}`);
      setMembers(initial);
    }
    setBusy(null);
    router.refresh();
  }

  if (!members.length) return <p className="text-sm text-gray-500">No team members yet.</p>;

  return (
    <div className="card divide-y divide-gray-100 p-0">
      {members.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-medium">
              {m.full_name} {m.id === myId && <span className="text-xs text-gray-400">(you)</span>}
              {!m.is_active && <span className="badge ml-2 bg-red-100 text-red-700">deactivated</span>}
            </p>
            <p className="text-xs text-gray-500">{m.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <>
                <select
                  className="input w-auto py-1 text-xs"
                  value={m.role}
                  disabled={busy === m.id || m.id === myId}
                  onChange={(e) => update(m.id, { role: e.target.value as UserRole })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {m.id !== myId && (
                  <button
                    className="btn-ghost py-1 text-xs"
                    disabled={busy === m.id}
                    onClick={() => update(m.id, { is_active: !m.is_active })}>
                    {m.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </>
            ) : (
              <span className={`badge ${ROLE_COLORS[m.role]}`}>{m.role}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
