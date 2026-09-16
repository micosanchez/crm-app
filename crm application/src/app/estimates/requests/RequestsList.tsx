'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fullName, type EstimateRequest, type RequestStatus } from '@/lib/requests';

/* The queue. The status filter lives in the URL, so browser back from a request
   detail lands on the same filtered list (and Next restores the scroll position)
   instead of dumping you at the top of "new". */

const TABS: { value: RequestStatus | 'all'; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'spam', label: 'Spam' },
  { value: 'all', label: 'All' },
];

const TONE: Record<RequestStatus, string> = {
  new: 'text-brand-700',
  accepted: 'text-brand-700',
  declined: 'text-gray-500',
  spam: 'text-gray-400',
};
const LABEL: Record<RequestStatus, string> = {
  new: 'New', accepted: 'Accepted', declined: 'Declined', spam: 'Spam',
};

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RequestsList({ requests, initialStatus }: {
  requests: EstimateRequest[];
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(
    TABS.some((t) => t.value === initialStatus) ? initialStatus : 'new',
  );

  function pick(value: string) {
    setStatus(value);
    // replace, not push: filters shouldn't stack up in history, but the URL still
    // carries the filter so back from a detail screen restores it.
    router.replace(`/estimates/requests?status=${value}`, { scroll: false });
  }

  const shown = status === 'all' ? requests : requests.filter((r) => r.status === status);
  const counts = (v: string) => (v === 'all' ? requests.length : requests.filter((r) => r.status === v).length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = status === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => pick(t.value)}
              aria-pressed={active}
              className={`badge border px-3 py-1.5 transition ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line-subtle text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label} <span className="ml-1 opacity-60">{counts(t.value)}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="card text-sm text-gray-500">
          {status === 'new'
            ? 'Nothing waiting. New requests from the form land here.'
            : `No ${status} requests.`}
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle bg-white">
          {shown.map((r) => {
            const photos = Array.isArray(r.photos) ? r.photos.length : 0;
            return (
              <li key={r.id}>
                <Link
                  // Carry the filter through, so "← Requests" on the detail
                  // screen comes back to the same list the user left.
                  href={`/estimates/requests/${r.id}?status=${status}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{fullName(r)}</p>
                    <p className="truncate text-sm text-gray-500">
                      {[r.city, r.description].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-0.5 text-right">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${TONE[r.status]}`}>
                      {LABEL[r.status]}
                    </span>
                    <span className="text-xs text-gray-400">
                      {relativeTime(r.created_at)}
                      {photos > 0 && ` · ${photos} photo${photos === 1 ? '' : 's'}`}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
