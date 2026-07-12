import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS.
 * Used exclusively by the notification system (outbox logging + the daily
 * reminder cron, which has no user session). Never import from client code;
 * the key lives only in Netlify env vars (SUPABASE_SERVICE_ROLE_KEY).
 *
 * Returns null when the key isn't configured so callers can degrade
 * gracefully (send the email, skip the log) instead of crashing.
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
