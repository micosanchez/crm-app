'use client';
import { enqueue, pending, remove } from './queue';
import type { QueuedAction } from '@/lib/types';

/** Flush queued actions to the server. Safe to call repeatedly. */
export async function flushQueue(): Promise<{ applied: number; remaining: number }> {
  const actions = await pending();
  if (actions.length === 0) return { applied: 0, remaining: 0 };

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    });
    if (!res.ok) throw new Error(`sync failed: ${res.status}`);
    const { results } = await res.json();
    const done: string[] = results
      .filter((r: { status: string }) =>
        ['applied', 'duplicate_skipped', 'conflict_server_newer', 'rejected'].includes(r.status))
      .map((r: { idempotency_key: string }) => r.idempotency_key);
    await remove(done);
    const left = await pending();
    return { applied: done.length, remaining: left.length };
  } catch {
    // still offline or server unreachable — try again later
    return { applied: 0, remaining: actions.length };
  }
}

/**
 * Perform a mutation "offline-first": queue it, then try to flush
 * immediately. If online, it lands in the DB right away; if not, it
 * waits in IndexedDB until connectivity returns.
 */
export async function mutate(action: Omit<QueuedAction, 'idempotency_key' | 'client_ts'>) {
  await enqueue(action);
  return flushQueue();
}

/** Wire up auto-sync listeners. Call once on app mount. */
export function initSync(onChange?: (remaining: number) => void) {
  const run = async () => {
    const { remaining } = await flushQueue();
    onChange?.(remaining);
  };
  window.addEventListener('online', run);
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'FLUSH_QUEUE') run();
  });
  const interval = setInterval(run, 30_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    clearInterval(interval);
  };
}
