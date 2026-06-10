import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { QueuedAction } from '@/lib/types';

const ALLOWED_TABLES = new Set(['customers', 'jobs', 'notes', 'schedule_events', 'job_assignments']);

/**
 * Offline sync endpoint.
 * Accepts a batch of queued actions; each carries a client-generated
 * idempotency key (uuid). Replays are detected via the idempotency_keys
 * table and skipped. Conflicts on updates resolve by timestamp priority:
 * the action is rejected if the row's updated_at is newer than client_ts.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let actions: QueuedAction[];
  try {
    actions = (await req.json()).actions;
    if (!Array.isArray(actions)) throw new Error();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const results: { idempotency_key: string; status: string; error?: string }[] = [];

  for (const action of actions) {
    const { idempotency_key, table, op, id, payload, client_ts } = action;

    if (!idempotency_key || !ALLOWED_TABLES.has(table)) {
      results.push({ idempotency_key, status: 'rejected', error: 'invalid action' });
      continue;
    }

    // Dedupe: has this key already been processed?
    const { data: existing } = await supabase
      .from('idempotency_keys')
      .select('key')
      .eq('key', idempotency_key)
      .maybeSingle();
    if (existing) {
      results.push({ idempotency_key, status: 'duplicate_skipped' });
      continue;
    }

    let error: string | null = null;

    if (op === 'insert') {
      const { error: e } = await supabase.from(table).insert(payload);
      error = e?.message ?? null;
    } else if (op === 'update' && id) {
      // Conflict resolution: last-write-wins by timestamp.
      const { data: row } = await supabase.from(table).select('updated_at').eq('id', id).maybeSingle();
      const serverTs = (row as { updated_at?: string } | null)?.updated_at;
      if (serverTs && client_ts && new Date(serverTs) > new Date(client_ts)) {
        results.push({ idempotency_key, status: 'conflict_server_newer' });
        continue;
      }
      const { error: e } = await supabase.from(table).update(payload).eq('id', id);
      error = e?.message ?? null;
    } else {
      error = 'unsupported op';
    }

    if (error) {
      results.push({ idempotency_key, status: 'error', error });
      continue;
    }

    await supabase.from('idempotency_keys').insert({
      key: idempotency_key,
      user_id: user.id,
      response: { table, op, id: id ?? null },
    });
    results.push({ idempotency_key, status: 'applied' });
  }

  return NextResponse.json({ results });
}
