import assert from 'node:assert';
const m = await import('../src/lib/rentals/templates.ts');
const v = { first_name: 'Ana', rental_number: 'R-1013', pickup_date: 'Tue, Nov 3', pickup_window: '6-10pm', link: 'L', junk_link: 'J', review_link: 'RV', unsubscribe_link: 'U', mailing_address_line: ' · PO Box 1, Lincoln Park MI', junk_offer: '' };
for (const k of ['during_rental', 'pickup_reminder', 'after_pickup']) {
  const t = m.DEFAULT_TEMPLATES[k];
  const body = m.renderRental(t.email, v);
  assert.ok(body.includes('\n\n'), k + ' keeps paragraphs');
  assert.ok(!/\{\w+\}/.test(body), k + ' has no unfilled vars: ' + body.match(/\{\w+\}/));
  assert.ok(body.includes('J'), k + ' has junk link');
  if (t.kind === 'promotional') assert.ok(body.includes('Unsubscribe: U') && body.includes('PO Box 1'), k + ' footer');
  assert.ok(!/\{\w+\}/.test(m.renderRental(t.email_subject, v)), k + ' subject');
}
// texts still collapse the double space an empty var leaves
assert.equal(m.renderRental('Hi {first_name},  see {junk_offer} you', v), 'Hi Ana, see you');
const f = await import('../src/lib/rentals/format.ts');
assert.equal(f.csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
assert.equal(f.csvCell('@SUM(A1)'), "'@SUM(A1)");
assert.equal(f.csvCell('+13135551234'), '+13135551234');   // phone numbers stay importable
assert.equal(f.csvCell('Smith, Ana'), '"Smith, Ana"');
console.log('rental templates + csv: ok');
