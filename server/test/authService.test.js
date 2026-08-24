const test = require('node:test');
const assert = require('node:assert/strict');
const {
  timingSafeStringEqual,
  parseBasicAuthorization,
  createWebhookAuth
} = require('../services/authService');

test('compares credentials without throwing on different lengths', () => {
  assert.equal(timingSafeStringEqual('secret', 'secret'), true);
  assert.equal(timingSafeStringEqual('secret', 'short'), false);
  assert.equal(timingSafeStringEqual(null, 'secret'), false);
});

test('parses a basic authorization header containing a colon in the password', () => {
  const encoded = Buffer.from('admin:part:two').toString('base64');
  assert.deepEqual(parseBasicAuthorization(`Basic ${encoded}`), {
    username: 'admin',
    password: 'part:two'
  });
});

test('webhook middleware accepts a bearer token and rejects a public query token', () => {
  const middleware = createWebhookAuth('private-secret');
  let accepted = false;
  middleware({
    headers: { authorization: 'Bearer private-secret' },
    body: {},
    query: {}
  }, {}, () => { accepted = true; });
  assert.equal(accepted, true);

  let responseStatus = null;
  middleware({ headers: {}, body: {}, query: { token: 'private-secret' } }, {
    status(code) {
      responseStatus = code;
      return this;
    },
    json() { return this; }
  }, () => {});
  assert.equal(responseStatus, 401);
});
