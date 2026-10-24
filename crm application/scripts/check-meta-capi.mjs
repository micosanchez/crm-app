// Self-check for src/lib/metaCapi.ts (no network).
// Run: node --experimental-strip-types scripts/check-meta-capi.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildUserData, sendMetaEvent } from '../src/lib/metaCapi.ts';

const sha = (s) => createHash('sha256').update(s).digest('hex');

const u = buildUserData({
  email: ' Maria@Example.com ', phone: '(734) 555-1234', first_name: 'Maria ', last_name: "O'Brien",
  city: 'Allen Park', state: 'mi', zip: '48101-1234', ip: '1.2.3.4', user_agent: 'UA', fbclid: 'IwAR1',
});
assert.equal(u.em, sha('maria@example.com'), 'email lowercased + trimmed');
assert.equal(u.ph, sha('17345551234'), 'phone digits with country code');
assert.equal(u.fn, sha('maria'));
assert.equal(u.ln, sha('obrien'), 'punctuation stripped from names');
assert.equal(u.ct, sha('allenpark'));
assert.equal(u.st, sha('mi'));
assert.equal(u.zp, sha('48101'), 'zip is the first 5 digits');
assert.match(u.fbc, /^fb\.1\.\d+\.IwAR1$/, 'fbc built from fbclid');
assert.equal(u.client_ip_address, '1.2.3.4');
assert.equal(u.client_user_agent, 'UA');

assert.equal(buildUserData({ phone: '+1 (734) 555-1234' }).ph, sha('17345551234'), '11-digit phone kept');
assert.deepEqual(buildUserData({ email: ' ', phone: '123', zip: '4810', state: '' }), {}, 'unusable values dropped, not hashed');
assert.equal(buildUserData({ fbc: 'fb.1.1.abc', fbclid: 'zzz' }).fbc, 'fb.1.1.abc', 'real _fbc cookie wins over fbclid');
assert.equal(buildUserData({ fbp: 'fb.1.2.3' }).fbp, 'fb.1.2.3');

delete process.env.META_CAPI_ACCESS_TOKEN;
assert.equal(await sendMetaEvent({ name: 'Lead', event_id: 'x', user: {} }), false, 'no token = silent no-op');

console.log('meta capi checks passed');
