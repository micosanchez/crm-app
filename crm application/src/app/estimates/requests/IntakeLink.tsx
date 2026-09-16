'use client';
import { useState } from 'react';
import { LEAD_SOURCES, formatPhone, formatPhoneInput, toE164 } from '@/lib/requests';

/* The shareable link, with the ?ref= already on it so attribution happens
   without anyone remembering to ask "how did you hear about us". */
export default function IntakeLink() {
  const [ref, setRef] = useState<string>(LEAD_SOURCES[0].ref);
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState('');
  const [first, setFirst] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const url = `${origin}/request?ref=${ref}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function textLink() {
    setSending(true); setError(null); setSent(null);
    try {
      const res = await fetch('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, template: 'intake_link', first_name: first.trim() || undefined, link: `${origin}/request?ref=text` }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'The text did not send.');
      else setSent(`Sent to ${formatPhone(phone)}`);
    } catch {
      setError('The text did not send. Check the connection and try again.');
    }
    setSending(false);
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="panel-label">Request link</p>
        <p className="text-sm text-gray-500">
          Send this to a customer, or put it in a post. The source below is tagged automatically.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id="intake-ref"
          className="input w-auto"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          aria-label="Link source"
        >
          {LEAD_SOURCES.map((s) => (
            <option key={s.ref} value={s.ref}>{s.label}</option>
          ))}
        </select>
        <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {url || '/request'}
        </code>
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <div className="border-t border-line-subtle pt-3">
        <p className="panel-label">Or text it to them</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id="intake-first"
            className="input w-32"
            placeholder="First name"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            aria-label="Their first name"
          />
          <input
            id="intake-phone"
            className="input w-40"
            inputMode="tel"
            placeholder="(734) 555-0142"
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            aria-label="Their phone number"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={textLink}
            disabled={sending || !toE164(phone)}
          >
            {sending ? 'Sending…' : 'Text this link'}
          </button>
          {sent && <span className="text-sm text-brand-700">{sent}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  );
}
