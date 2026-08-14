import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth';
import TeamList from './TeamList';
import AddMemberForm from './AddMemberForm';
import TeamAccessLink from './TeamAccessLink';
import type { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  await requireAdmin();
  const supabase = createClient();
  const [{ data: { user } }, { data: members }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('users').select('*').order('created_at'),
  ]);

  const me = (members as UserProfile[] | null)?.find((m) => m.id === user?.id);
  const isAdmin = me?.role === 'admin';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Team</h1>
      <p className="text-sm text-gray-500">
        Admins add members here (no self-signup). Dispatchers handle scheduling + invoicing;
        technicians work jobs in the field. New members get a technician role by default.
      </p>
      <TeamAccessLink />
      {isAdmin && <AddMemberForm />}
      <TeamList members={(members ?? []) as UserProfile[]} isAdmin={isAdmin} myId={user?.id ?? ''} />
    </div>
  );
}
