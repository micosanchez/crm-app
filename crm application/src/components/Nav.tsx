'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  { href: '/money', label: 'Money', icon: '💰', mobile: true },
  { href: '/field', label: 'Field', icon: '🧰', mobile: true },
  { href: '/team', label: 'Team', icon: '🛡️', mobile: false },
];

export default function Nav() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname?.includes('/print')) return null;

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
        </div>
      </nav>
      {/* Mobile bottom tab bar — one-handed reach */}
      <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex border-t border-[#4a1430] bg-[#2a0a1c] md:hidden">
        {LINKS.filter((l) => l.mobile).map((l) => (
          <Link key={l.href} href={l.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${pathname === l.href ? 'text-white' : 'text-gray-400'}`}>
            <span className="text-xl leading-none">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
