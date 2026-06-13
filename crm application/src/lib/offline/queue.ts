'use client';
import type { QueuedAction } from '@/lib/types';

/**
 * Offline action queue backed by IndexedDB.
 * Every mutation made while offline (or that fails due to network) is
 * queued with a client-generated idempotency key, then flushed to
 * POST /api/sync when connectivity returns.
 *
 * Two stores:
 *   - action-queue: actions still pending / being retried
 *   - failed-queue: actions the server permanently rejected (dead letter),
 *     surfaced to the user instead of being silently dropped or retried forever.
 */
const DB_NAME = 'fieldtrack-offline';
const STORE = 'action-queue';
const FAILED = 'failed-queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'idempotency_key' });
      }
      if (!db.objectStoreNames.contains(FAILED)) {
        db.createObjectStore(FAILED, { keyPath: 'idempotency_key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(action: Omit<QueuedAction, 'idempotency_key' | 'client_ts'>): Promise<QueuedAction> {
  const full: QueuedAction = {
    ...action,
    idempotency_key: crypto.randomUUID(),
    client_ts: new Date().toISOString(),
    attempts: 0,
  };
  await put(STORE, full);
  return full;
}

/** Overwrite an existing action (used to record an incremented attempt count). */
export async function save(action: QueuedAction): Promise<void> {
  await put(STORE, action);
}

export async function pending(): Promise<QueuedAction[]> {
  return getAll(STORE);
}

export async function remove(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await del(STORE, keys);
}

/** Move an action into the dead-letter store (permanent failure). */
export async function recordFailure(action: QueuedAction): Promise<void> {
  await put(FAILED, action);
}

export async function getFailed(): Promise<QueuedAction[]> {
  return getAll(FAILED);
}

export async function clearFailed(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await del(FAILED, keys);
}

export async function clearAllFailed(): Promise<void> {
  const all = await getFailed();
  await del(FAILED, all.map((a) => a.idempotency_key));
}

// ---------- low-level helpers ----------
function put(store: string, value: QueuedAction): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function getAll(store: string): Promise<QueuedAction[]> {
  return openDb().then(
    (db) =>
      new Promise<QueuedAction[]>((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as QueuedAction[]);
        req.onerror = () => reject(req.error);
      })
  );
}

function del(store: string, keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        keys.forEach((k) => tx.objectStore(store).delete(k));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
