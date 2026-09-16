'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatPhone, fullName, oneLineAddress, type EstimateRequest,
} from '@/lib/requests';
import {
  acceptRequest, declineRequest, markRequestSpam, reopenRequest, saveRequestNotes,
  type DupeCandidate,
} from '../actions';

const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const longStamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function RequestDetail({ request, photoUrls, quote }: {
  request: EstimateRequest;
  photoUrls: string[];
  quote: { id: string; estimate_number: number; total: number; status: string } | null;
}) {
  const router = useRouter();
  const r = request;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DupeCandidate[] | null>(null);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [notes, setNotes] = useState(r.internal_notes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [texted, setTexted] = useState<string | null>(null);

  const address = oneLineAddress(r);
  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(address)}`;

  /* ---------- Actions ---------- */

  async function doAccept(opts: { customerId?: string; createNew?: boolean } = {}) {
    setBusy('accept'); setError(null);
    const res = await acceptRequest(r.id, opts);
    setBusy(null);
    if (res.ok) {
      setDuplicates(null);
      router.push(`/estimates/new?request=${r.id}`);
      return;
    }
    if ('duplicates' in res) { setDuplicates(res.duplicates); return; }
    setError(res.error);
  }

  async function doDecline() {
    setBusy('decline'); setError(null);
    const res = await declineRequest(r.id, declineReason);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'Could not decline.'); return; }
    setDecliningOpen(false);
    router.refresh();
  }

  async function doSpam() {
    setBusy('spam'); setError(null);
    const res = await markRequestSpam(r.id);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'Could not mark spam.'); return; }
    router.refresh();
  }

  async function doReopen() {
    setBusy('reopen'); setError(null);
    const res = await reopenRequest(r.id);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'Could not reopen.'); return; }
    router.refresh();
  }

  async function doSaveNotes() {
    setBusy('notes'); setError(null);
    const res = await saveRequestNotes(r.id, notes);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'Could not save the note.'); return; }
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  async function sendText() {
    setBusy('text'); setError(null); setTexted(null);
    try {
      const res = await fetch('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: r.phone,
          template: 'request_received',
          first_name: r.first_name,
          entity_kind: 'estimate_request',
          entity_id: r.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'The text did not send.'); }
      else setTexted(`Sent to ${formatPhone(r.phone)}`);
    } catch {
      setError('The text did not send. Check the connection and try again.');
    }
    setBusy(null);
  }

  /* ---------- Lightbox keyboard ---------- */
  const move = useCallback((delta: number) => {
    setLightbox((i) => (i === null ? null : (i + delta + photoUrls.length) % photoUrls.length));
  }, [photoUrls.length]);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, move]);

  const touchX = useRef<number | null>(null);

  /* ---------- Render ---------- */

  const worked = r.status !== 'new';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{fullName(r)}</h1>
            <p className="text-sm text-gray-500">
              {longStamp(r.created_at)}
              {r.lead_source && ` · via ${r.lead_source}`}
              {!r.turnstile_verified && ' · unverified'}
            </p>
          </div>
          <span className={`badge ${
            r.status === 'new' ? 'bg-brand-50 text-brand-700'
            : r.status === 'accepted' ? 'bg-brand-50 text-brand-700'
            : 'bg-gray-100 text-gray-500'
          }`}>
            {r.status}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a href={`tel:${r.phone}`} className="rounded-lg bg-gray-50 px-3 py-2 hover:bg-gray-100">
            <span className="panel-label block">Phone</span>
            <span className="font-semibold text-gray-900">{formatPhone(r.phone)}</span>
          </a>
          <a href={`mailto:${r.email}`} className="rounded-lg bg-gray-50 px-3 py-2 hover:bg-gray-100">
            <span className="panel-label block">Email</span>
            <span className="truncate font-semibold text-gray-900">{r.email}</span>
          </a>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-gray-50 px-3 py-2 hover:bg-gray-100 sm:col-span-2"
          >
            <span className="panel-label block">Address</span>
            <span className="font-semibold text-gray-900">{address || '—'}</span>
          </a>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={sendText} disabled={busy === 'text'}>
            {busy === 'text' ? 'Sending…' : 'Text customer'}
          </button>
          {texted && <span className="self-center text-sm text-brand-700">{texted}</span>}
        </div>
      </div>

      {/* What they wrote */}
      <div className="card">
        <p className="panel-label">What needs to go</p>
        <p className="mt-1 whitespace-pre-wrap text-gray-900">{r.description}</p>
      </div>

      {/* Photos */}
      {photoUrls.length > 0 && (
        <div className="card">
          <p className="panel-label">Photos ({photoUrls.length})</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photoUrls.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setLightbox(i)}
                className="aspect-square overflow-hidden rounded-lg border border-line-subtle bg-gray-100"
                aria-label={`Open photo ${i + 1}`}
              >
                {/* Signed Supabase URLs — next/image would need remote config, so a plain img. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Request photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Linked records */}
      {(r.customer_id || quote) && (
        <div className="card flex flex-wrap gap-4 text-sm">
          {r.customer_id && (
            <Link href={`/customers/${r.customer_id}`} className="text-brand-600 hover:underline">
              Customer profile →
            </Link>
          )}
          {quote && (
            <Link href={`/estimates/${quote.id}`} className="text-brand-600 hover:underline">
              Estimate #{quote.estimate_number} · {money(quote.total)} · {quote.status} →
            </Link>
          )}
        </div>
      )}

      {/* Dedupe prompt */}
      {duplicates && duplicates.length > 0 && (
        <div className="card border-brand-500">
          <p className="font-semibold text-gray-900">
            {duplicates.length === 1
              ? `Looks like ${duplicates[0].name} is already on file.`
              : 'A few customers already match this one.'}
          </p>
          <p className="text-sm text-gray-500">Use one of them, or create a new customer anyway.</p>
          <div className="mt-3 space-y-2">
            {duplicates.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{d.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    matched on {d.reason} · {[formatPhone(d.phone), d.address].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!!busy}
                  onClick={() => doAccept({ customerId: d.id })}
                >
                  Use {d.name.split(' ')[0]}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => doAccept({ createNew: true })}>
              Create new anyway
            </button>
            <button type="button" className="btn-ghost" onClick={() => setDuplicates(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Internal notes — never customer-facing */}
      <div className="card">
        <label htmlFor="request-notes" className="panel-label">Internal notes</label>
        <textarea
          id="request-notes"
          className="input mt-1 w-full"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Only you see this. Never shown to the customer."
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className="btn-ghost" onClick={doSaveNotes} disabled={busy === 'notes'}>
            {busy === 'notes' ? 'Saving…' : 'Save note'}
          </button>
          {notesSaved && <span className="text-sm text-brand-700">Saved</span>}
        </div>
      </div>

      {/* Decisions */}
      <div className="card space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {r.status === 'declined' && r.decline_reason && (
          <p className="text-sm text-gray-500">Declined: {r.decline_reason}</p>
        )}

        {!worked ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={!!busy}
                onClick={() => doAccept()}
              >
                {busy === 'accept' ? 'Working…' : 'Accept and build the estimate'}
              </button>
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => setDecliningOpen((v) => !v)}>
                Decline
              </button>
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={doSpam}>
                {busy === 'spam' ? 'Marking…' : 'Mark spam'}
              </button>
            </div>

            {decliningOpen && (
              <div className="rounded-lg bg-gray-50 p-3">
                <label htmlFor="decline-reason" className="panel-label">Why?</label>
                <input
                  id="decline-reason"
                  className="input mt-1 w-full"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Out of area, wrong service, no answer…"
                />
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy === 'decline'} onClick={doDecline}>
                    {busy === 'decline' ? 'Saving…' : 'Confirm decline'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setDecliningOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-500">
              {r.status === 'accepted' ? 'Accepted.' : r.status === 'declined' ? 'Declined.' : 'Marked as spam.'}
            </p>
            {r.status === 'accepted' && !quote && (
              <Link href={`/estimates/new?request=${r.id}`} className="btn-primary">Build the estimate</Link>
            )}
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={doReopen}>
              {busy === 'reopen' ? 'Reopening…' : 'Put back in the queue'}
            </button>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox !== null && photoUrls[lightbox] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${lightbox + 1} of ${photoUrls.length}`}
          onClick={() => setLightbox(null)}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
            touchX.current = null;
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrls[lightbox]}
            alt={`Request photo ${lightbox + 1}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-gray-900"
            onClick={() => setLightbox(null)}
          >
            Close
          </button>
          {photoUrls.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                className="absolute left-3 rounded-full bg-white/90 px-3 py-2 text-gray-900"
                onClick={(e) => { e.stopPropagation(); move(-1); }}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next photo"
                className="absolute right-3 rounded-full bg-white/90 px-3 py-2 text-gray-900"
                onClick={(e) => { e.stopPropagation(); move(1); }}
              >
                ›
              </button>
              <span className="absolute bottom-5 text-sm text-white/80">{lightbox + 1} / {photoUrls.length}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
