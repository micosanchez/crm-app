'use client';
import { usePathname, useRouter } from 'next/navigation';

// Top-level destinations reached straight from the nav — no back button needed.
const ROOTS = new Set(['/', '/login', '/field']);

/** One global "Back" affordance so every deeper page has a way out. Hidden on the
 *  dashboard, login, the technician field home, and the public signing pages.
 *  ponytail: a few detail pages also render their own "← Parent" link, so this can
 *  double up there; dedupe later if it reads noisy. */
export default function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  if (!pathname || ROOTS.has(pathname) || pathname.startsWith('/sign/') || pathname.includes('/print')) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push('/');
      }}
      className="no-print mb-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--brand-accent)]"
    >
      <span aria-hidden>←</span> Back
    </button>
  );
}
