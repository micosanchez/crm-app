'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { initSync } from '@/lib/offline/sync';
import { createClient } from '@/lib/supabase/client';

const PUBLIC_PATHS = ['/login', '/offline'];

export default function SwRegister() {
  const router = useRouter();
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);

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
    const cleanup = initSync(setPendingCount);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      cleanup();
    };
  }, []);

  if (online && pendingCount === 0) return null;
  return (
    <div className="no-print fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-medium text-white shadow-lg md:bottom-4">
      {!online ? 'Offline — changes will sync when reconnected' : `Syncing ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}…`}
    </div>
  );
}
