'use client';
import { createClient } from '@/lib/supabase/client';

/** Browser-side helpers for the Rentals admin screens. */
export async function act<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/rentals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...args }) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.result as T;
}

/** Upload photos to the private documents bucket; returns storage paths. */
export async function uploadPhotos(rentalId: string, files: FileList | File[], label: string): Promise<string[]> {
  const supabase = createClient();
  const out: string[] = [];
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop() || 'jpg';
    const path = `rentals/${rentalId}/${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from('documents').upload(path, f, { contentType: f.type || 'image/jpeg' });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    out.push(path);
  }
  return out;
}

export const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
export const prettyDate = (ymd: string | null | undefined) => ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
export const STATUS_LABEL: Record<string, string> = { pending_payment: 'Pending payment', booked: 'Booked', delivered: 'Delivered', out: 'Out', pickup_scheduled: 'Pickup scheduled', returned: 'Returned', inspected: 'Inspected', closed: 'Closed', cancelled: 'Cancelled' };
