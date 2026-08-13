'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@/lib/types';

const ROLES: UserRole[] = ['technician', 'dispatcher', 'admin'];

/** Admin form to create a login-capable team member (calls /api/team/create). */
export default function AddMemberForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'technician' as UserRole });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const res = await fetch('/api/team/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error ?? 'Could not create the user.'); return; }
    setDone(`${form.email} created as ${form.role}. Send them the sign-in link below plus this email + password.`);
    setForm({ full_name: '', email: '', password: '', role: 'technician' });
    router.refresh();
  }

  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>+ Add team member</button>;

  return (
    <form onSubmit={submit} className="card grid gap-3 ring-2 ring-brand-500 md:grid-cols-2">
      <input className="input" placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      <input className="input" type="email" placeholder="Email *" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input className="input" type="text" placeholder="Temporary password (6+) *" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
      {done && <p className="text-sm text-green-700 md:col-span-2">{done}</p>}
      <div className="flex gap-2 md:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
        <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setError(null); setDone(null); }}>Close</button>
      </div>
      <p className="text-xs text-gray-400 md:col-span-2">They sign in at the team link below with this email + password — they can’t self-register.</p>
    </form>
  );
}
