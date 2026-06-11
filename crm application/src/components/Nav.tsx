'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import BrandMark from './BrandMark';

const LINKS = [
  { href: '/', label: 'Dashboard', icon: '📊', mobile: true },
  { href: '/leads', label: 'Leads', icon: '🎯', mobile: true },
  { href: '/customers', label: 'Customers', icon: '👤', mobile: false },
  { href: '/estimates', label: 'Estimates', icon: '📝', mobile: false },
  { href: '/jobs', label: 'Jobs', icon: '🛻', mobile: true },
  { href: '/schedule', label: 'Schedule', icon: '📅', mobile: true },
  { href: '/invoices', label: 'Invoices', icon: '🧾', mobile: false },
  { href: '/expenses', label: 'Expenses', icon: '💸', mobile: false },
  { href: '/money', label: 'Money', icon: '💰', mobile: false },
  { href: '/field', label: 'Field', icon: '🧰', mobile: true },
  { href: '/documents', label: 'Documents', icon: '📁', mobile: false },
  { href: '/team', label: 'Team', icon: '🛡️', mobile: false },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (pathname === '/login' || pathname?.startsWith('/sign') || pathname?.includes('/print')) return null;

  const moreLinks = LINKS.filter((l) => !l.mobile);
  const moreActive = moreLinks.some((l) => pathname === l.href);

  return (
    <>
      {/* Desktop top nav — dark plum, matches the SJHC logo */}
      <nav className="no-print hidden border-b border-[#4a1430] bg-[#2a0a1c] md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
          <Link href="/" className="mr-4"><BrandMark /></Link>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${pathname === l.href ? 'bg-[#7b2153] text-white' : 'text-gray-300 hover:bg-[#42102b] hover:text-white'}`}>
              {l.label}
            </Link>
          ))}
          <div className="ml-auto">
            <button onClick={handleSignOut}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-400 transition-colors hover:bg-[#42102b] hover:text-white">
              🚪 Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/50 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute bottom-14 left-0 right-0 rounded-t-2xl border-t border-[#4a1430] bg-[#2a0a1c] p-4 pb-6"
            onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-3">
              {moreLinks.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-medium ${pathname === l.href ? 'bg-[#7b2153] text-white' : 'bg-[#3a0f28] text-gray-300'}`}>
                  <span className="text-2xl leading-none">{l.icon}</span>
                  {l.label}
                </Link>
              ))}
              <button onClick={handleSignOut}
                className="flex flex-col items-center gap-1 rounded-xl bg-[#3a0f28] py-3 text-xs font-medium text-gray-300">
                <span className="text-2xl leading-none">🚪</span>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar — one-handed reach */}
      <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex border-t border-[#4a1430] bg-[#2a0a1c] md:hidden">
        {LINKS.filter((l) => l.mobile).map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${pathname === l.href ? 'text-white' : 'text-gray-400'}`}>
            <span className="text-xl leading-none">{l.icon}</span>
            {l.label}
          </Link>
        ))}
        <button onClick={() => setMoreOpen(!moreOpen)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${moreOpen || moreActive ? 'text-white' : 'text-gray-400'}`}>
          <span className="text-xl leading-none">⋯</span>
          More
        </button>
      </nav>
    </>
  );
}
