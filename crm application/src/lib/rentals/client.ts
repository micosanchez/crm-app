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

// Formatters live in ./format so server pages can import them; re-exported here for client components.
export { money, prettyDate, STATUS_LABEL } from './format';
