'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { initSync, retryFailed, dismissFailed, SYNC_EVENT, type SyncSummary } from '@/lib/offline/sync';
import { createClient } from '@/lib/supabase/client';

const PUBLIC_PATHS = ['/login', '/offline', '/sign'];

export default function SwRegister() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(true);
  const prevPending = useRef(0);

  // Auth guard: bounce logged-out visitors to /login (data is RLS-protected regardless)
  useEffect(() => {
    if (PUBLIC_PATHS.some((p) => pathname?.startsWith(p))) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/login');
    });
  }, [pathname, router]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    const apply = (s: SyncSummary) => {
      setPending(s.pending);
      setFailed(s.failed);
      // Only refresh when queued changes actually drained (>0 → 0), so the
      // newly-synced data appears — not on every idle heartbeat.
      if (prevPending.current > 0 && s.pending === 0) router.refresh();
      prevPending.current = s.pending;
    };
    const onSync = (e: Event) => apply((e as CustomEvent<SyncSummary>).detail);
    window.addEventListener(SYNC_EVENT, onSync);

    // initSync wires the online/interval/service-worker triggers; every flush
    // it runs dispatches SYNC_EVENT, which onSync above applies.
    const cleanup = initSync();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener(SYNC_EVENT, onSync);
      cleanup();
    };
  }, [router]);

  async function onRetry() { await retryFailed(); }
  async function onDismiss() { await dismissFailed(); }

  return (
    <>
      {failed > 0 && (
        <div className="no-print fixed bottom-28 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg md:bottom-16">
          <span>{failed} change{failed === 1 ? '' : 's'} didn&apos;t save</span>
          <button onClick={onRetry} className="rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30">Retry</button>
          <button onClick={onDismiss} className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">Dismiss</button>
        </div>
      )}
      {(!online || pending > 0) && (
        <div className="no-print fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-medium text-white shadow-lg md:bottom-4">
          {!online ? 'Offline — changes will sync when reconnected' : `Syncing ${pending} pending change${pending === 1 ? '' : 's'}…`}
        </div>
      )}
    </>
  );
}
