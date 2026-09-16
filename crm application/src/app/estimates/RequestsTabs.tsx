import Link from 'next/link';

/* Estimates | Requests. Presentational and server-safe — the active tab and the
   unworked count come in as props, so this renders inside either page without a
   client bundle. Hidden entirely when the requests flag is off. */
export default function RequestsTabs({ active, newCount }: {
  active: 'estimates' | 'requests';
  newCount: number;
}) {
  const base = 'relative -mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition';
  const on = 'border-brand-500 text-brand-700';
  const off = 'border-transparent text-gray-500 hover:text-gray-900';

  return (
    <nav className="flex items-center gap-6 border-b border-line-subtle" aria-label="Estimates sections">
      <Link href="/estimates" className={`${base} ${active === 'estimates' ? on : off}`}
        aria-current={active === 'estimates' ? 'page' : undefined}>
        Estimates
      </Link>
      <Link href="/estimates/requests" className={`${base} ${active === 'requests' ? on : off}`}
        aria-current={active === 'requests' ? 'page' : undefined}>
        <span className="flex items-center gap-2">
          Requests
          {newCount > 0 && (
            <span className="badge bg-brand-500 px-1.5 text-white" aria-label={`${newCount} new`}>
              {newCount > 99 ? '99+' : newCount}
            </span>
          )}
        </span>
      </Link>
    </nav>
  );
}
