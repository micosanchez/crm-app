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
 * (offline forms can't know the user id).
 *
 * CONFLICT DETECTION (updates): if the server row's updated_at is newer than
 * the action's client_ts, someone else changed the record after this offline
 * edit was made. Applying it blindly would silently erase their changes, so
 * the action is rejected with status 'conflict_server_newer' and surfaced to
 * the user instead. Updates from the SAME batch are exempt (a batch is one
 * device's ordered edits — applying the first bumps updated_at, which must
 * not fail the second). Tables without an updated_at column skip the check.
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
  // Rows already written by THIS batch — exempt from the conflict check.
  const touchedInBatch = new Set<string>();

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
      if (!error && typeof body.id === 'string') touchedInBatch.add(`${table}:${body.id}`);
    } else if (op === 'update' && id) {
      if (!payload || typeof payload !== 'object') {
        results.push({ idempotency_key, status: 'rejected', error: 'missing payload' });
        continue;
      }
      // Conflict guard: don't overwrite a row someone else changed after this
      // offline edit was made. Skipped for rows this batch already wrote, and
      // for tables without updated_at (the select errors → check is skipped).
      if (action.client_ts && !touchedInBatch.has(`${table}:${id}`)) {
        const { data: row, error: selErr } = await supabase
          .from(table).select('updated_at').eq('id', id).maybeSingle();
        const serverTs = !selErr && row && (row as { updated_at?: string }).updated_at;
        if (serverTs && new Date(serverTs).getTime() > new Date(action.client_ts).getTime()) {
          // Record the key so retries of this exact action are skipped as duplicates.
          await supabase.from('idempotency_keys').insert({
            key: idempotency_key,
            user_id: user.id,
            response: { table, op, id, conflict: true },
          });
          results.push({
            idempotency_key,
            status: 'conflict_server_newer',
            error: 'This record was changed by someone else after your offline edit — your change was NOT applied. Re-open the record and make the edit again.',
          });
          continue;
        }
      }
      const { error: e } = await supabase.from(table).update(payload).eq('id', id);
      error = e?.message ?? null;
      if (!error) touchedInBatch.add(`${table}:${id}`);
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
