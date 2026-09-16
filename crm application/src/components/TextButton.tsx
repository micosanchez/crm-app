'use client';
import { useState } from 'react';
import { formatPhone } from '@/lib/requests';

/**
 * One button, one text, over the business line. Everything it sends is logged in
 * the notifications outbox by /api/text, so a send that fails says why on screen
 * AND leaves a row Mico can look at later.
 */
export default function TextButton({
  to, template, vars, label = 'Text', className = 'btn-ghost', entityKind, entityId,
}: {
  to: string | null | undefined;
  template: string;
  vars?: Record<string, string | number | undefined>;
  label?: string;
  className?: string;
  entityKind?: string;
  entityId?: string;
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!to) return null;

  async function send() {
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, template, ...vars, entity_kind: entityKind, entity_id: entityId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'The text did not send.'); setState('idle'); return; }
      setState('sent');
    } catch {
      setError('The text did not send. Check the connection and try again.');
      setState('idle');
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={className} onClick={send} disabled={state !== 'idle'}>
        {state === 'sending' ? 'Sending…' : state === 'sent' ? `Sent to ${formatPhone(to)}` : label}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
