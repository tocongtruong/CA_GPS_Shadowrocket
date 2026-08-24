const test = require('node:test');
const assert = require('node:assert/strict');
const { getVietnamDayBounds } = require('../services/locationService');

test('builds Vietnam day boundaries independently of the server timezone', () => {
  const bounds = getVietnamDayBounds('2026-08-23');
  assert.equal(new Date(bounds.startOfDay).toISOString(), '2026-08-22T17:00:00.000Z');
  assert.equal(new Date(bounds.endOfDay).toISOString(), '2026-08-23T16:59:59.999Z');
});

test('rejects impossible calendar dates', () => {
  assert.throws(() => getVietnamDayBounds('2026-02-31'));
  assert.throws(() => getVietnamDayBounds('23-08-2026'));
});
