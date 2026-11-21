/**
 * Acceptance checks for 0064 (pickup address fee, charge edit/remove, connector uuid fix, record_pickup all_good).
 * Runs against a LOCAL Supabase-like database only (PostgREST behind /rest/v1), never production:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54330 SUPABASE_SERVICE_ROLE_KEY=<local jwt> npx tsx scripts/check-rental-charge-edits.ts
 * Seed: three rentals T-1021..T-1023 like R-1023 (total 185.20, two pending $35 one-week extensions, pickup 2026-11-28).
 * Stripe is faked in-process (every PaymentIntent succeeds); QUO/RESEND keys are unset so nothing is texted or emailed.
 */
import assert from 'node:assert/strict';

if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('Refusing to run: point NEXT_PUBLIC_SUPABASE_URL at a local database.');
delete process.env.QUO_API_KEY; delete process.env.RESEND_API_KEY;
process.env.STRIPE_SECRET_KEY = 'sk_test_local_fake';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith('https://api.stripe.com')) return new Response(JSON.stringify({ id: `pi_local_${Date.now()}`, status: 'succeeded' }), { status: 200 });
  return realFetch(input, init);
}) as typeof fetch;

const STAFF = { by: '00000000-0000-0000-0000-00000000beef', source: 'staff' };
const CONNECTOR = { by: null, source: 'connector' };
const A = '00000000-0000-0000-0000-000000000101', B = '00000000-0000-0000-0000-000000000102', C = '00000000-0000-0000-0000-000000000103';
const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try { const note = await fn(); results.push([name, true, note ?? '']); } catch (e) { results.push([name, false, (e as Error).message]); }
}

async function main() {
  const { runAction } = await import('../src/lib/rentals/actions');
  const { admin } = await import('../src/lib/rentals/ops');
  const db = admin();
  const rental = async (id: string) => (await db.from('rentals').select('*').eq('id', id).single()).data!;
  const charges = async (id: string) => (await db.from('rental_charges').select('*').eq('rental_id', id).order('created_at')).data!;
  const events = async (id: string, ev: string) => (await db.from('rental_events').select('*').eq('rental_id', id).eq('event', ev)).data!;
  const bal = async (id: string) => Number((await rental(id)).balance_due);

  await check('Pickup change, Customer requested checked: 1 new $25 pending charge, balance +25, 1 event', async () => {
    const b0 = await bal(A), c0 = (await charges(A)).length;
    const res: any = await runAction('change_pickup_address', { rental_id: A, pickup_address: '200 New Pickup Ave, Wyandotte, MI 48192', customer_requested: true }, STAFF);
    const fees = (await charges(A)).filter((c) => c.type === 'reschedule_fee');
    assert.equal((await charges(A)).length, c0 + 1); assert.equal(fees.length, 1);
    assert.equal(Number(fees[0].amount), 25); assert.equal(fees[0].status, 'pending'); assert.equal(fees[0].description, 'Pickup location change');
    assert.equal(await bal(A), Math.round((b0 + 25) * 100) / 100);
    const ev = await events(A, 'pickup_address_changed'); assert.equal(ev.length, 1);
    assert.deepEqual(Object.keys(ev[0].detail).sort(), ['by', 'customer_requested', 'from', 'to']);
    assert.equal(res.charge.id, fees[0].id);
    return `balance ${b0} → ${await bal(A)}`;
  });
  await check('Pickup change, box unchecked: no fee (event logged)', async () => {
    const b0 = await bal(A), n0 = (await charges(A)).length;
    await runAction('change_pickup_address', { rental_id: A, pickup_address: '300 Other Rd, Wyandotte, MI 48192', customer_requested: false }, STAFF);
    assert.equal((await charges(A)).length, n0); assert.equal(await bal(A), b0);
    assert.equal((await events(A, 'pickup_address_changed')).length, 2);
  });
  await check('Same address saved again: no fee and no event', async () => {
    const b0 = await bal(A), n0 = (await charges(A)).length;
    await runAction('change_pickup_address', { rental_id: A, pickup_address: '  300 other rd,  Wyandotte, MI 48192 ', customer_requested: true }, STAFF);
    assert.equal((await charges(A)).length, n0); assert.equal(await bal(A), b0);
    assert.equal((await events(A, 'pickup_address_changed')).length, 2);
  });
  await check('Schedule source row carries the new pickup address (views use pickup_address ?? delivery_address)', async () => {
    const r = await rental(A); assert.equal(r.pickup_address ?? r.delivery_address, '300 Other Rd, Wyandotte, MI 48192');
  });
  await check('Remove one of two pending $35 extensions: 1 left, pickup 2026-11-21, balance −35, no reschedule text', async () => {
    const b0 = await bal(A);
    const ext = (await charges(A)).filter((c) => c.type === 'extension' && c.status === 'pending');
    assert.equal(ext.length, 2);
    const res: any = await runAction('remove_charge', { charge_id: ext[0].id, reason: 'test: customer returned early' }, STAFF);
    const left = (await charges(A)).filter((c) => c.type === 'extension' && c.status === 'pending');
    const r = await rental(A);
    assert.equal(left.length, 1); assert.equal(r.pickup_date, '2026-11-21'); assert.equal(r.extra_weeks, 1);
    assert.equal((await charges(A)).find((c) => c.id === ext[0].id).status, 'voided');
    assert.equal(await bal(A), Math.round((b0 - 35) * 100) / 100); assert.equal(res.balance_due, await bal(A));
    assert.equal((await events(A, 'charge_removed')).length, 1); assert.equal((await events(A, 'extension_reversed')).length, 1);
    const { data: msgs } = await db.from('rental_messages').select('template').eq('rental_id', A).eq('template', 'reschedule');
    assert.equal(msgs?.length ?? 0, 0);
    return `balance ${b0} → ${await bal(A)}`;
  });
  await check('End state before settle: $185.20 + $35 extension + $25 location fee = $245.20 due', async () => {
    assert.equal(await bal(A), 245.2); return `balance_due ${await bal(A)}`;
  });
  await check('Edit a pending charge $35 → $20: balance −15 (preview first changes nothing)', async () => {
    const b0 = await bal(B);
    const ext = (await charges(B)).find((c) => c.type === 'extension' && c.status === 'pending');
    const pv: any = await runAction('edit_charge', { charge_id: ext.id, amount: 20, confirm: false }, CONNECTOR);
    assert.equal(pv.preview.to.amount, 20); assert.equal(await bal(B), b0);
    const res: any = await runAction('edit_charge', { charge_id: ext.id, amount: 20, description: 'Extension: 1 week (discounted)', confirm: true }, CONNECTOR);
    assert.equal(await bal(B), Math.round((b0 - 15) * 100) / 100); assert.equal(res.balance_due, await bal(B));
    const ev = await events(B, 'charge_edited'); assert.equal(ev.length, 1); assert.equal(ev[0].detail.from.amount, 35); assert.equal(ev[0].detail.to.amount, 20);
    return `balance ${b0} → ${await bal(B)}`;
  });
  await check('Root cause reproduced: the string "connector" in rental_charges.created_by is rejected', async () => {
    const { error } = await db.from('rental_charges').insert({ rental_id: B, type: 'adjustment', amount: 1, status: 'pending', created_by: 'connector' });
    assert.match(error?.message ?? '', /invalid input syntax for type uuid: "connector"/);
  });
  await db.from('rentals').update({ stripe_customer_id: 'cus_local', stripe_payment_method_id: 'pm_local' }).eq('id', B);
  await check('charge_rental on the connector path for $25 succeeds and returns the charge row', async () => {
    const res: any = await runAction('charge', { rental_id: B, type: 'reschedule_fee', amount: 25, description: 'Pickup location change' }, CONNECTOR);
    assert.equal(res.ok, true); assert.equal(res.charge.status, 'succeeded'); assert.equal(Number(res.charge.amount), 25);
    const row = (await charges(B)).find((c) => c.id === res.charge.id); assert.equal(row.created_by, null); assert.equal(row.source, 'connector');
    return `charge ${res.charge.id} succeeded`;
  });
  await check('A succeeded charge cannot be edited or removed (Refund only)', async () => {
    const ok = (await charges(B)).find((c) => c.status === 'succeeded');
    await assert.rejects(() => runAction('edit_charge', { charge_id: ok.id, amount: 1, confirm: true }, STAFF), /Refund it instead/);
    await assert.rejects(() => runAction('remove_charge', { charge_id: ok.id, reason: 'x', confirm: true }, STAFF), /Refund it instead/);
  });
  await check('add_pending_charge on the connector path for $25 succeeds and returns the charge row, charges and balance_due', async () => {
    const b0 = await bal(B);
    const res: any = await runAction('add_pending_charge', { rental_id: B, type: 'reschedule_fee', amount: 25, description: 'Pickup location change' }, CONNECTOR);
    assert.equal(res.charge.status, 'pending'); assert.equal(res.charge.source, 'connector'); assert.equal(res.charge.created_by, null);
    assert.ok(res.charges.some((c: any) => c.id === res.charge.id)); assert.equal(res.balance_due, Math.round((b0 + 25) * 100) / 100);
  });
  await check('update_rental (connector) with pickup_address + customer_requested adds the fee and returns new_charge', async () => {
    const res: any = await runAction('update', { rental_id: B, pickup_address: '400 Moved Ln, Trenton, MI 48183', customer_requested: true }, CONNECTOR);
    assert.equal(res.pickup_address_changed, true); assert.equal(Number(res.new_charge.amount), 25); assert.equal(res.new_charge.source, 'connector');
  });
  await check('update_rental (connector) field update no longer hits the uuid error', async () => {
    const res: any = await runAction('update', { rental_id: B, pickup_window: '1-3pm', notes_internal: 'local test' }, CONNECTOR);
    assert.equal(res.pickup_window, '1-3pm');
  });
  await check('record_pickup(all_good=true) with no items and no tags succeeds (connector path)', async () => {
    const res: any = await runAction('record_pickup', { rental_id: C, items: [], all_good: true }, CONNECTOR);
    assert.equal(res.ok, true); assert.equal((await rental(C)).status, 'returned');
    const ev = await events(C, 'picked_up'); assert.equal(ev[0].detail.good, 20);
  });

  for (const [n, ok, note] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`);
  if (results.some((r) => !r[1])) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
