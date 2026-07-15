'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Short labels so all 8 wrap onto one screen without horizontal scrolling.
const TABS = [
  { href: '/accounting/reconciliation', label: 'Reconcile' },
  { href: '/accounting/accounts', label: 'Accounts' },
  { href: '/accounting/ledger', label: 'Ledger' },
  { href: '/accounting/income-statement', label: 'Income' },
  { href: '/accounting/balance-sheet', label: 'Balance' },
  { href: '/accounting/reports', label: 'Reports' },
  { href: '/accounting/close', label: 'Close' },
  { href: '/accounting/setup', label: 'Setup' },
];

export default function AccountingTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Accounting sections">
      {TABS.map((t) => {
        const active = pathname === t.href || (pathname === '/accounting' && t.href.endsWith('reconciliation'));
        return (
          <Link
            key={t.href}
            href={t.href}
            className="font-display rounded-md px-3 py-2 text-[13px] font-semibold tracking-wide transition-colors duration-200"
            style={{
              background: active ? 'var(--brand-primary)' : 'var(--surface-primary)',
              color: active ? '#fff' : 'var(--text-tertiary)',
              border: `1px solid ${active ? 'var(--brand-accent)' : 'var(--border-subtle)'}`,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
