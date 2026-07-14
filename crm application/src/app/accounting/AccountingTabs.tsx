'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/accounting/reconciliation', label: 'Bank Reconciliation' },
  { href: '/accounting/accounts', label: 'Chart of Accounts' },
  { href: '/accounting/ledger', label: 'General Ledger' },
  { href: '/accounting/income-statement', label: 'Income Statement' },
  { href: '/accounting/balance-sheet', label: 'Balance Sheet' },
  { href: '/accounting/close', label: 'Close Books' },
];

export default function AccountingTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Accounting sections">
      {TABS.map((t) => {
        const active = pathname === t.href || (pathname === '/accounting' && t.href.endsWith('reconciliation'));
        return (
          <Link
            key={t.href}
            href={t.href}
            className="font-display shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium tracking-wide transition-colors duration-200"
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
