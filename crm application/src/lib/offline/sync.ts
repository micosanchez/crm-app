'use client';
import {
  enqueue, pending, remove, save, recordFailure, getFailed, clearAllFailed,
} from './queue';
import type { QueuedAction, MutateResult } from '@/lib/types';

/** After this many failed attempts an action is dead-lettered and surfaced. */
export const MAX_ATTEMPTS = 5;

export interface SyncSummary { pending: number; failed: number; online: boolean }
export const SYNC_EVENT = 'fieldtrack:sync';

type ServerResult = { idempotency_key: string; status: string; error?: string };

function emit(summary: SyncSummary) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SyncSummary>(SYNC_EVENT, { detail: summary }));
  }
}

async function snapshot(online = true): Promise<SyncSummary> {
  const [p, f] = await Promise.all([pending(), getFailed()]);
  const summary = { pending: p.length, failed: f.length, online };
  emit(summary);
  return summary;
}

/** Flush queued actions to the server. Safe to call repeatedly. */
export async function flushQueue(): Promise<SyncSummary> {
  const actions = await pending();
  if (actions.length === 0) return snapshot();

  let results: ServerResult[];
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    });
    if (!res.ok) throw new Error(`sync failed: ${res.status}`);
    results = (await res.json()).results as ServerResult[];
  } catch {
    // still offline or server unreachable — leave queue intact, try again later
    return snapshot(typeof navigator !== 'undefined' ? navigator.onLine : true);
  }

  const byKey = new Map(results.map((r) => [r.idempotency_key, r]));
  const removeKeys: string[] = [];

  for (const a of actions) {
    const r = byKey.get(a.idempotency_key);
    if (!r) continue; // server didn't process it — keep for next flush

    if (r.status === 'applied' || r.status === 'duplicate_skipped') {
      removeKeys.push(a.idempotency_key);
      continue;
    }

    // 'error' (transient/validation), 'rejected' (permanent), or
    // 'conflict_server_newer' (permanent — retrying can never succeed;
    // surface it so the user re-applies their edit on fresh data).
    const attempts = (a.attempts ?? 0) + 1;
    const last_error = r.error || r.status;
    if (r.status === 'rejected' || r.status === 'conflict_server_newer' || attempts >= MAX_ATTEMPTS) {
      removeKeys.push(a.idempotency_key);
      await recordFailure({ ...a, attempts, last_error }); // dead-letter, surfaced to user
    } else {
      await save({ ...a, attempts, last_error }); // keep retrying
    }
  }

  await remove(removeKeys);
  return snapshot();
}

/**
 * Perform a mutation "offline-first": queue it, try to flush immediately, and
 * report what happened so the caller can show an error instead of a false
 * "saved" when the server rejects it.
 */
export async function mutate(action: Omit<QueuedAction, 'idempotency_key' | 'client_ts'>): Promise<MutateResult> {
  const full = await enqueue(action);
  await flushQueue();

  const stillPending = (await pending()).some((a) => a.idempotency_key === full.idempotency_key);
  if (stillPending) return { status: 'queued' }; // offline, or will retry

  const failed = (await getFailed()).find((a) => a.idempotency_key === full.idempotency_key);
  if (failed) return { status: 'failed', error: failed.last_error ?? 'Server rejected the change' };

  return { status: 'applied' };
}

/** Move dead-lettered actions back into the active queue and retry. */
export async function retryFailed(): Promise<SyncSummary> {
  const failed = await getFailed();
  for (const a of failed) await save({ ...a, attempts: 0, last_error: undefined });
  await clearAllFailed();
  return flushQueue();
}

/** Discard dead-lettered actions the user has acknowledged. */
export async function dismissFailed(): Promise<SyncSummary> {
  await clearAllFailed();
  return snapshot();
}

/** Wire up auto-sync listeners. Call once on app mount. */
export function initSync(onChange?: (summary: SyncSummary) => void): () => void {
  const run = async () => onChange?.(await flushQueue());
  const onOnline = () => { emit({ pending: 0, failed: 0, online: true }); run(); };
  const onOffline = () => snapshot(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'FLUSH_QUEUE') run();
  });
  const interval = setInterval(run, 30_000);
  run();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    clearInterval(interval);
  };
}
