// Self-check for src/lib/money.ts and src/lib/dates.ts.
// Run: node --experimental-strip-types scripts/check-money.mjs
import assert from 'node:assert/strict';
import { balanceDue, collectedOn, sumCollected, sumOutstanding, classifyQuote, quoteConversion, money2 } from '../src/lib/money.ts';
import { ymd, dayRange, monthRange, monthKey, detroitDateTime, fmtTime } from '../src/lib/dates.ts';

// ---- invoices ----
const paid = { status: 'paid', total: '500.00', amount_paid: 500 };
const sent = { status: 'sent', total: 300, amount_paid: 100 };
const draft = { status: 'draft', total: 999, amount_paid: 0 };
const voidPaid = { status: 'paid', total: 400, amount_paid: 400, voided_at: '2026-09-01T00:00:00Z' };
const overpaid = { status: 'sent', total: 100, amount_paid: 150 };

assert.equal(balanceDue(paid), 0, 'paid owes nothing');
assert.equal(balanceDue(sent), 200, 'sent owes total minus paid');
assert.equal(balanceDue(draft), 999, 'a draft has a nominal balance');
assert.equal(balanceDue(voidPaid), 0, 'void owes nothing');
assert.equal(balanceDue(overpaid), 0, 'overpayment never shows as negative balance');
assert.equal(collectedOn(paid), 500);
assert.equal(collectedOn(sent), 100, 'partial payment counts as collected');
assert.equal(collectedOn(voidPaid), 0, 'void collected nothing');
assert.equal(sumCollected([paid, sent, draft, voidPaid]), 500, 'only paid + live');
assert.equal(sumOutstanding([paid, sent, draft, voidPaid]), 200, 'only sent balances — drafts excluded');
assert.equal(money2('12.5'), '$12.50');

// ---- quotes ----
assert.equal(classifyQuote('cancelled').label, 'Cancelled');
assert.equal(classifyQuote('cancelled').decided, false);
assert.equal(classifyQuote('sent').label, 'Pending');
assert.equal(quoteConversion([]), null, 'nothing offered yet');
assert.equal(quoteConversion([{ status: 'draft' }, { status: 'cancelled' }]), null, 'drafts and cancelled are not offers');
assert.equal(quoteConversion([{ status: 'accepted' }, { status: 'sent' }, { status: 'declined' }, { status: 'cancelled' }]), 1 / 3, 'cancelled never counts against close rate');

// ---- dates (Detroit) ----
// 2026-03-08 02:30 local does not exist (DST jump); 01:59 EST → 03:00 EDT.
assert.equal(ymd(new Date('2026-09-22T03:30:00Z')), '2026-09-21', '11:30pm EDT is still the 21st in Detroit');
assert.equal(ymd(new Date('2026-09-22T04:30:00Z')), '2026-09-22');
assert.equal(detroitDateTime(2026, 9, 22).toISOString(), '2026-09-22T04:00:00.000Z', 'EDT midnight');
assert.equal(detroitDateTime(2026, 1, 15).toISOString(), '2026-01-15T05:00:00.000Z', 'EST midnight');
const day = dayRange(new Date('2026-09-22T03:30:00Z'));
assert.equal(day.start.toISOString(), '2026-09-21T04:00:00.000Z');
assert.equal(day.end.toISOString(), '2026-09-22T04:00:00.000Z');
const nov = monthRange(2026, 11);
assert.equal(nov.start.toISOString(), '2026-11-01T04:00:00.000Z', 'EDT month start');
assert.equal(nov.end.toISOString(), '2026-12-01T05:00:00.000Z', 'EST month end after fall-back');
assert.equal(monthRange(2026, 12).end.toISOString(), '2027-01-01T05:00:00.000Z', 'month 13 rolls the year');
assert.equal(monthKey('2026-10-01T02:00:00Z'), '2026-09', 'late-night UTC is still September in Detroit');
assert.equal(fmtTime('2026-09-22T13:05:00Z'), '9:05 AM');

console.log('money + date checks passed');
