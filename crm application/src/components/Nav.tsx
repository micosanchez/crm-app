'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/customers', label: 'Customers', icon: '👤' },
  { href: '/jobs', label: 'Jobs', icon: '🛻' },
  { href: '/schedule', label: 'Schedule', icon: '📅' },
  { href: '/invoices', label: 'Invoices', icon: '🧾' },
  { href: '/field', label: 'Field', icon: '🧰' },
];

export default function Nav() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname?.includes('/print')) return null;

  return (
    <>
      {/* Desktop top nav */}
      <nav className="no-print hidden border-b border-gray-200 bg-white md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
          <span className="mr-4 font-bold text-brand-700">Fieldtrack</span>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${pathname === l.href ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
      {/* Mobile bottom tab bar — one-handed reach */}
      <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex border-t border-gray-200 bg-white md:hidden">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${pathname === l.href ? 'text-brand-700' : 'text-gray-500'}`}>
            <span className="text-xl leading-none">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
