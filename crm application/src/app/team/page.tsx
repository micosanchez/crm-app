import { createClient } from '@/lib/supabase/server';
import TeamList from './TeamList';
import type { UserProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const supabase = createClient();
  const [{ data: { user } }, { data: members }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('users').select('*').order('created_at'),
  ]);

  const me = (members as UserProfile[] | null)?.find((m) => m.id === user?.id);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Team</h1>
      <p className="text-sm text-gray-500">
        New signups start as <b>technician</b>. Admins can change roles and deactivate accounts here.
        Dispatchers handle scheduling + invoicing; technicians work jobs in the field.
      </p>
      <TeamList members={(members ?? []) as UserProfile[]} isAdmin={me?.role === 'admin'} myId={user?.id ?? ''} />
    </div>
  );
}
