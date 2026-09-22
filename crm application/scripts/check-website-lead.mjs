// Self-check for src/lib/websiteLead.ts.
// Run: node --experimental-strip-types scripts/check-website-lead.mjs
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { verifyNetlifySignature, mapWebsiteSubmission } from '../src/lib/websiteLead.ts';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(body, secret, claims = {}) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ iss: 'netlify', sha256: createHash('sha256').update(body).digest('hex'), ...claims });
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

const body = JSON.stringify({ id: 'abc123', form_name: 'quote-request' });
assert.equal(verifyNetlifySignature(body, sign(body, 's3cret'), 's3cret'), true, 'valid signature');
assert.equal(verifyNetlifySignature(body, sign(body, 'wrong'), 's3cret'), false, 'wrong secret');
assert.equal(verifyNetlifySignature(body + ' ', sign(body, 's3cret'), 's3cret'), false, 'tampered body');
assert.equal(verifyNetlifySignature(body, sign(body, 's3cret', { iss: 'evil' }), 's3cret'), false, 'wrong issuer');
assert.equal(verifyNetlifySignature(body, null, 's3cret'), false, 'missing header');
assert.equal(verifyNetlifySignature(body, 'a.b', 's3cret'), false, 'malformed');

const lead = mapWebsiteSubmission({
  id: 'sub1', form_name: 'quote-request',
  data: {
    name: '  Maria  de la Cruz ', phone: '(734) 555-1234', email: 'Maria@Example.com ',
    address: 'Taylor', details: 'Old hot tub on the deck',
    fbclid: 'IwAR123', utm_campaign: 'fall-cleanouts', landing_page: '/services/hot-tub-removal.html',
    photos: [{ url: 'https://files.netlify.com/a.jpg' }, { url: 'http://insecure/b.jpg' }, 'https://files.netlify.com/c.png'],
  },
});
assert.equal(lead.first_name, 'Maria');
assert.equal(lead.last_name, 'de la Cruz');
assert.equal(lead.email, 'maria@example.com');
assert.equal(lead.lead_source, 'facebook');
assert.deepEqual(lead.photoUrls, ['https://files.netlify.com/a.jpg', 'https://files.netlify.com/c.png']);
assert.match(lead.internal_notes, /Netlify submission sub1/);
assert.match(lead.internal_notes, /utm_campaign: fall-cleanouts/);

const bare = mapWebsiteSubmission({ id: 'sub2', data: { phone: '7345551234', details: 'couch', photos: { url: 'https://x/y.jpg' } } });
assert.equal(bare.first_name, '');
assert.equal(bare.lead_source, 'website');
assert.deepEqual(bare.photoUrls, ['https://x/y.jpg']);
assert.equal(mapWebsiteSubmission({ data: {} }), null, 'no submission id');

const split = mapWebsiteSubmission({ id: 'sub3', data: {
  first_name: 'Ana', last_name: 'Lopez', name: 'ignored', address: '123 Main St', city: 'Taylor', state: 'mi', postal_code: '48180',
} });
assert.equal(split.first_name, 'Ana');
assert.equal(split.last_name, 'Lopez');
assert.equal(split.city, 'Taylor');
assert.equal(split.state, 'MI');
assert.equal(split.postal_code, '48180');
assert.equal(bare.state, 'MI', 'state defaults to MI');

console.log('website lead checks passed');
