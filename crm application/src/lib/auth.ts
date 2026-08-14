import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from './types';

/** Current user's role (server-side). */
export async function getRole(): Promise<UserRole | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return (data?.role as UserRole) ?? null;
}

/** Gate finance/sales pages to admin + dispatcher; technicians go to the field view. */
export async function requireStaff(): Promise<UserRole> {
  const role = await getRole();
  if (role !== 'admin' && role !== 'dispatcher') redirect('/field');
  return role;
}

/** Gate admin-only pages (Settings, Team). Non-admins bounce to the dashboard,
 *  which itself sends technicians on to /field. */
export async function requireAdmin(): Promise<UserRole> {
  const role = await getRole();
  if (role !== 'admin') redirect('/');
  return role;
}
