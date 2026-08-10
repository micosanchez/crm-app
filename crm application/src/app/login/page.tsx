'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import BrandMark from '@/components/BrandMark';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Sign-in only. Self-serve account creation is disabled — new team members
    // are added by an admin from the Team page (and Supabase signups are off).
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push('/');
    router.refresh();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.3em] text-[var(--metal-titanium)]">
            Remove · Refresh · Reclaim
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--text-muted)]">Command Center</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-[var(--border-standard)] bg-[var(--surface-primary)] p-6 shadow-lg">
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          {error && <p className="text-sm text-[var(--status-danger)]">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Working…' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            Need access? Ask an admin to add you from the Team page.
          </p>
        </form>
      </div>
    </div>
  );
}
