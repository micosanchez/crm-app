'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import BrandMark from '@/components/BrandMark';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    router.push('/');
    router.refresh();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#2a0a1c] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <p className="mt-3 text-sm font-semibold uppercase tracking-[0.25em]">
            <span className="text-[#c43a64]">Remove</span>
            <span className="text-gray-500"> · </span>
            <span className="text-[#a8527f]">Refresh</span>
            <span className="text-gray-500"> · </span>
            <span className="text-[#8a63b8]">Reclaim</span>
          </p>
          <p className="mt-2 text-xs uppercase tracking-widest text-gray-400">Command Center</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[#4a1430] bg-[#1f0715] p-6 shadow-2xl">
          <input className="w-full rounded-lg border border-[#4a1430] bg-[#2a0a1c] px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-[#a32650] focus:outline-none"
            type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded-lg border border-[#4a1430] bg-[#2a0a1c] px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-[#a32650] focus:outline-none"
            type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="w-full rounded-lg bg-gradient-to-r from-[#a32650] to-[#6d3fa4] py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button type="button" className="w-full text-center text-sm text-gray-400 hover:text-white"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
