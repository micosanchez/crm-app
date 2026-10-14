// Self-check for the tote rental policy helpers in src/lib/rentals/ops.ts (no test runner in this repo).
// Run: node scripts/check-rental-policy.mjs
process.env.TZ = 'UTC';   // production (Netlify) runs in UTC; detroitAt assumes it
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/lib/rentals/ops.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stub = new Proxy({}, { get: () => () => ({}) });  // imports (supabase, stripe, notify) are never touched by these helpers
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)(() => stub, mod, mod.exports);
const { windowStartHour, hoursBeforeDelivery, rescheduleFees, detroitAt } = mod.exports;

// delivery window start, 24h clock
assert.equal(windowStartHour('6-10pm'), 18);
assert.equal(windowStartHour('8am-12pm'), 8);
assert.equal(windowStartHour('12-4pm'), 12);
assert.equal(windowStartHour('11-1pm'), 11);
assert.equal(windowStartHour('9-11am'), 9);
assert.equal(windowStartHour(null), 0);

const plusDays = (n) => new Date(Date.now() + n * 86400_000).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
const s = { cancel_full_refund_hours: 48, reschedule_fee_inside_window: 25, expedited_pickup_fee: 25 };
const base = { status: 'booked', actual_delivered_at: null, delivery_date: plusDays(10), delivery_window: '6-10pm', pickup_date: plusDays(24) };

// 48+ hours: free; under 48: $25; company move: free
assert.equal(rescheduleFees(base, s, { delivery_date: plusDays(12), customer_requested: true }).lines.length, 0);
const soon = { ...base, delivery_date: plusDays(1) };
const f = rescheduleFees(soon, s, { delivery_date: plusDays(5), customer_requested: true }).lines;
assert.equal(f.length, 1); assert.equal(f[0].type, 'reschedule_fee'); assert.equal(f[0].amount, 25);
assert.equal(rescheduleFees(soon, s, { delivery_date: plusDays(5), customer_requested: false }).lines.length, 0);

// exactly 48 hours counts as 48 hours' notice
const h = hoursBeforeDelivery({ delivery_date: plusDays(3), delivery_window: '6-10pm' });
assert.ok(h > 48, 'three days out is more than 48 hours');
assert.ok(Math.abs(new Date(detroitAt('2026-11-02', 18)).getTime() - Date.parse('2026-11-02T23:00:00Z')) < 1000, 'Detroit 6 pm in EST');

// pickup: earlier + expedited = $25; earlier on the normal route = free; later = refused (extension instead)
const out = { ...base, status: 'delivered', actual_delivered_at: '2026-10-01', pickup_date: plusDays(6) };
assert.equal(rescheduleFees(out, s, { pickup_date: plusDays(3), customer_requested: true, expedited: true }).lines[0].type, 'expedited_pickup');
assert.equal(rescheduleFees(out, s, { pickup_date: plusDays(3), customer_requested: true }).lines.length, 0);
assert.throws(() => rescheduleFees(out, s, { pickup_date: plusDays(9), customer_requested: true }), /extension/);
assert.equal(rescheduleFees(out, s, { pickup_date: plusDays(9) }).laterPickup, true);
console.log('rental policy checks passed');
