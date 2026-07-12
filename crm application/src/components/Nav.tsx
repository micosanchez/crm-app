'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import BrandMark from './BrandMark';
import { flags } from '@/lib/flags';
import type { UserRole } from '@/lib/types';

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
    reports: <><path d="M4 20V11M9.5 20V4M15 20v-6M20.5 20V8" /><path d="M3 20h18" /></>,
    pricebook: <><path d="M3 11l8.5-8 8.5 8.5-8 8z" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></>,
    recurring: <><path d="M4 11a8 8 0 0 1 13.5-4.5L20 9" /><path d="M20 13a8 8 0 0 1-13.5 4.5L4 15" /><path d="M20 4v5h-5M4 20v-5h5" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}

const STAFF: UserRole[] = ['admin', 'dispatcher'];
const LINKS: { href: string; label: string; icon: string; mobile: boolean; roles?: UserRole[]; flag?: keyof typeof flags }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard', mobile: true, roles: STAFF },
  { href: '/estimates', label: 'Estimates', icon: 'estimates', mobile: true, roles: STAFF },
  { href: '/customers', label: 'Customers', icon: 'customers', mobile: false },
  { href: '/jobs', label: 'Jobs', icon: 'jobs', mobile: true },
  { href: '/schedule', label: 'Schedule', icon: 'schedule', mobile: true },
  { href: '/invoices', label: 'Invoices', icon: 'invoices', mobile: false, roles: STAFF },
  { href: '/expenses', label: 'Expenses', icon: 'expenses', mobile: false, roles: STAFF },
  { href: '/money', label: 'Money', icon: 'money', mobile: false, roles: STAFF },
  { href: '/reports', label: 'Reports', icon: 'reports', mobile: false, roles: STAFF },
  { href: '/price-book', label: 'Price book', icon: 'pricebook', mobile: false, roles: STAFF, flag: 'priceBook' },
  { href: '/recurring', label: 'Recurring', icon: 'recurring', mobile: false, roles: STAFF, flag: 'recurring' },
  { href: '/field', label: 'Field', icon: 'field', mobile: true },
  { href: '/documents', label: 'Documents', icon: 'documents', mobile: false },
  { href: '/signatures', label: 'Signatures', icon: 'estimates', mobile: false, roles: STAFF },
  { href: '/team', label: 'Team', icon: 'team', mobile: false, roles: ['admin'] },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('users').select('role').eq('id', user.id).single()
        .then(({ data }) => setRole((data?.role as UserRole) ?? null));
    });
  }, []);

  // Show a link if it has no role restriction, or while role is still loading
  // (keeps the admin nav instant), or the loaded role is permitted.
  const allowed = (l: { roles?: UserRole[]; flag?: keyof typeof flags }) =>
    (!l.flag || flags[l.flag]) && (!l.roles || !role || l.roles.includes(role));

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (pathname === '/login' || pathname?.startsWith('/sign') || pathname?.includes('/print')) return null;

  const moreLinks = LINKS.filter((l) => !l.mobile && allowed(l));
  const moreActive = moreLinks.some((l) => pathname === l.href);

  return (
    <>
      {/* Desktop command bar */}
      <nav className="no-print hidden border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
          <Link href="/" className="mr-6"><BrandMark /></Link>
          {LINKS.filter(allowed).map((l) => (
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
        <div className="no-print fixed inset-0 z-50 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="glass hud-rise absolute bottom-16 left-0 right-0 rounded-t-xl p-4 pb-6"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--border-strong)' }} aria-hidden />
            <div className="grid grid-cols-3 gap-2.5">
              {moreLinks.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
                    className="font-display flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs font-medium tracking-wide transition-colors duration-200"
                    style={{
                      background: active ? 'var(--brand-primary)' : 'var(--surface-primary)',
                      border: `1px solid ${active ? 'var(--brand-accent)' : 'var(--border-subtle)'}`,
                      color: active ? '#fff' : 'var(--text-secondary)',
                      boxShadow: active ? '0 2px 10px rgba(141, 29, 57, 0.25)' : undefined,
                    }}>
                    <Icon name={l.icon} />
                    {l.label}
                  </Link>
                );
              })}
              <button onClick={handleSignOut}
                className="font-display flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs font-medium tracking-wide text-[var(--text-secondary)]"
                style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-subtle)' }}>
                <Icon name="signout" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile instrument bar — HUD glass, active-tab burgundy glow + indicator hairline */}
      <nav
        className="no-print fixed bottom-0 left-0 right-0 z-40 flex md:hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid var(--border-standard)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {LINKS.filter((l) => l.mobile && allowed(l)).map((l) => {
          const active = pathname === l.href;
          return (
            <Link key={l.href} href={l.href} onClick={() => setMoreOpen(false)}
              className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium tracking-wide transition-colors duration-200"
              style={{ color: active ? 'var(--brand-accent)' : 'var(--text-muted)' }}>
              {active && <span aria-hidden className="absolute inset-x-4 top-0 h-px" style={{ background: 'var(--brand-accent)' }} />}
              <span>
                <Icon name={l.icon} />
              </span>
              <span className="font-display">{l.label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(!moreOpen)}
          className="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium tracking-wide transition-colors duration-200"
          style={{ color: moreOpen || moreActive ? 'var(--brand-accent)' : 'var(--text-muted)' }}>
          {(moreOpen || moreActive) && <span aria-hidden className="absolute inset-x-4 top-0 h-px" style={{ background: 'var(--brand-accent)' }} />}
          <span>
            <Icon name="more" />
          </span>
          <span className="font-display">More</span>
        </button>
      </nav>
    </>
  );
}
