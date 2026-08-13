import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['technician', 'dispatcher', 'admin'];

/**
 * Admin-only: create a login-capable team member. Self-serve signup is off, so
 * this is the "add from the Team page" path the login screen points people to.
 * Creates the auth account (handle_new_user() makes the public.users row), then
 * sets the chosen role. The admin shares the email + temporary password + the
 * app link so the new member can sign in.
 */
export async function POST(req: NextRequest) {
  const role = await getRole();
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'User creation is not configured on the server (SUPABASE_SERVICE_ROLE_KEY missing).' },
      { status: 503 },
    );
  }

  let body: { full_name?: string; email?: string; password?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }

  const full_name = (body.full_name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const newRole = (ROLES.includes(body.role as UserRole) ? body.role : 'technician') as UserRole;

  if (!email || password.length < 6) {
    return NextResponse.json({ error: 'Email and a 6+ character password are required.' }, { status: 400 });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: full_name || email },
  });
  if (error || !data?.user) {
    return NextResponse.json({ error: error?.message ?? 'Could not create the user.' }, { status: 400 });
  }

  // Trigger defaults the row to technician; set the chosen role + name.
  await admin.from('users').update({ role: newRole, full_name: full_name || email }).eq('id', data.user.id);

  return NextResponse.json({ ok: true, email, role: newRole });
}
