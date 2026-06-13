import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { QueuedAction } from '@/lib/types';

/**
 * Offline sync endpoint.
 * Accepts a batch of queued actions; each carries a client-generated
 * idempotency key (uuid). Replays are detected via the idempotency_keys
 * table and skipped.
 *
 * Inserts get the acting user stamped into their audit column server-side
 * (offline forms can't know the user id). Updates apply the partial column
 * set the user changed — last-write-wins per column. We do NOT silently drop
 * an update just because the row's updated_at moved; doing so was discarding
 * legitimate offline edits.
 */
const ALLOWED_TABLES = new Set([
  'customers', 'jobs', 'notes', 'schedule_events', 'job_assignments',
  'invoices', 'invoice_items', 'estimates', 'estimate_items', 'expenses', 'leads',
]);

/** Column that should be stamped with the acting user on insert, per table. */
const AUDIT_COLUMN: Record<string, string> = {
  customers: 'created_by',
  jobs: 'created_by',
  invoices: 'created_by',
  estimates: 'created_by',
  expenses: 'created_by',
  leads: 'created_by',
  schedule_events: 'created_by',
  notes: 'author_id',
};

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
    const { idempotency_key, table, op, id, payload } = action;

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
      if (!payload || typeof payload !== 'object') {
        results.push({ idempotency_key, status: 'rejected', error: 'missing payload' });
        continue;
      }
      const body: Record<string, unknown> = { ...payload };
      const auditCol = AUDIT_COLUMN[table];
      if (auditCol && body[auditCol] == null) body[auditCol] = user.id;
      const { error: e } = await supabase.from(table).insert(body);
      error = e?.message ?? null;
    } else if (op === 'update' && id) {
      if (!payload || typeof payload !== 'object') {
        results.push({ idempotency_key, status: 'rejected', error: 'missing payload' });
        continue;
      }
      const { error: e } = await supabase.from(table).update(payload).eq('id', id);
      error = e?.message ?? null;
    } else if (op === 'delete' && id) {
      const { error: e } = await supabase.from(table).delete().eq('id', id);
      error = e?.message ?? null;
    } else {
      results.push({ idempotency_key, status: 'rejected', error: 'unsupported op' });
      continue;
    }

    if (error) {
      // Transient/validation failure — client retries, then dead-letters.
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
