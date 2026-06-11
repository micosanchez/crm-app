'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import BrandMark from './BrandMark';

/** Geometric monochrome iconography — 1.5px stroke, currentColor (DESIGN-SYSTEM.md §7) */
function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" /></>,
    leads: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" /></>,
    customers: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" /></>,
    estimates: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    jobs: <><rect x="2" y="8" width="13" height="8" rx="1" /><path d="M15 11h4l3 3v2h-7" /><circle cx="7" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></>,
    schedule: <><rect x="3" y="5" width="18" height="16" rx="1" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    invoices: <><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" /><path d="M9 8h6M9 12h6" /></>,
    expenses: <><path d="M3 7l6 6 4-4 8 8" /><path d="M21 12v5h-5" /></>,
    money: <><circle cx="12" cy="12" r="9" /><path d="M12 6v12M15.5 8.5c-.8-1-2-1.5-3.5-1.5-2 0-3.5 1-3.5 2.5s1.5 2.2 3.5 2.5 3.5 1 3.5 2.5-1.5 2.5-3.5 2.5c-1.5 0-2.7-.5-3.5-1.5" /></>,
    field: <><path d="M14.5 6.5a4 4 0 0 0-5.6 4.6L3 17l4 4 5.9-5.9a4 4 0 0 0 4.6-5.6l-2.8 2.8-2.8-2.8 2.6-3z" /></>,
    documents: <><path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" /></>,
    team: <><path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3z" /></>,
    signout: <><path d="M9 5H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4" /><path d="M14 16l4-4-4-4M18 12H9" /></>,
    more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}

const LINKS = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', mobile: true },
  { href: '/leads', label: 'Leads', icon: 'leads', mobile: true },
  { href: '/customers', label: 'Customers', icon: 'customers', mobile: false },
  { href: '/estimates', label: 'Estimates', icon: 'estimates', mobile: false },
  { href: '/jobs', label: 'Jobs', icon: 'jobs', mobile: true },
  { href: '/schedule', label: 'Schedule', icon: 'schedule', mobile: true },
  { href: '/invoices', label: 'Invoices', icon: 'invoices', mobile: false },
  { href: '/expenses', label: 'Expenses', icon: 'expenses', mobile: false },
  { href: '/money', label: 'Money', icon: 'money', mobile: false },
  { href: '/field', label: 'Field', icon: 'field', mobile: true },
  { href: '/documents', label: 'Documents', icon: 'documents', mobile: false },
  { href: '/team', label: 'Team', icon: 'team', mobile: false },
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
      {/* Desktop command bar */}
      <nav className="no-print hidden border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
          <Link href="/" className="mr-6"><BrandMark /></Link>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`font-display rounded-md px-3 py-1.5 text-[15px] font-medium tracking-wide transition-colors duration-200 ${pathname === l.href ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]'}`}>
              {l.label}
            </Link>
          ))}
          <div className="ml-auto">
            <button onClick={handleSignOut}
              className="font-display rounded-md px-3 py-1.5 text-[15px] font-medium tracking-wide text-[var(--text-muted)] transition-colors duration-200 hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
              Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile "More" sheet — glass overlay (DESIGN-SYSTEM.md §5) */}
      {moreOpen && (
        <div className="no-print fixed inset-0 z-50 bg-black/60 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="glass absolute bottom-14 left-0 right-0 rounded-t-xl p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-3">
              {moreLinks.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
                  className={`font-display flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs font-medium tracking-wide ${pathname === l.href ? 'bg-[var(--brand-primary)] text-white' : 'bg-[var(--surface-primary)] text-[var(--text-secondary)]'}`}>
                  <Icon name={l.icon} />
                  {l.label}
                </Link>
              ))}
              <button onClick={handleSignOut}
                className="font-display flex flex-col items-center gap-1.5 rounded-lg bg-[var(--surface-primary)] py-3 text-xs font-medium tracking-wide text-[var(--text-secondary)]">
                <Icon name="signout" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile instrument bar */}
      <nav className="no-print fixed bottom-0 left-0 right-0 z-40 flex border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] md:hidden">
        {LINKS.filter((l) => l.mobile).map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
            className={`font-display flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium tracking-wide ${pathname === l.href ? 'text-white' : 'text-[var(--text-muted)]'}`}>
            <Icon name={l.icon} />
            {l.label}
          </Link>
        ))}
        <button onClick={() => setMoreOpen(!moreOpen)}
          className={`font-display flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium tracking-wide ${moreOpen || moreActive ? 'text-white' : 'text-[var(--text-muted)]'}`}>
          <Icon name="more" />
          More
        </button>
      </nav>
    </>
  );
}
