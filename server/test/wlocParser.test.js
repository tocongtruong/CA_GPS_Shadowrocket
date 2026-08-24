const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  parseWlocPayload,
  parseWlocPayloadDetailed
} = require('../services/wlocParser');

function concat(parts) {
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

function encodeVarint(value) {
  let unsigned = typeof value === 'bigint' ? value : BigInt(value);
  if (unsigned < 0n) unsigned = BigInt.asUintN(64, unsigned);
  const bytes = [];
  while (unsigned >= 0x80n) {
    bytes.push(Number((unsigned & 0x7fn) | 0x80n));
    unsigned >>= 7n;
  }
  bytes.push(Number(unsigned));
  return Buffer.from(bytes);
}

function makeField(fieldNumber, wireType, value) {
  const key = encodeVarint(BigInt(fieldNumber * 8 + wireType));
  if (wireType === 0) return concat([key, encodeVarint(value)]);
  const body = Buffer.from(value);
  return concat([key, encodeVarint(body.length), body]);
}

function makeLocation(latitude, longitude, accuracy = 25) {
  return concat([
    makeField(1, 0, BigInt(Math.round(latitude * 1e8))),
    makeField(2, 0, BigInt(Math.round(longitude * 1e8))),
    makeField(3, 0, BigInt(accuracy))
  ]);
}

function makeWifi(latitude, longitude, accuracy) {
  return concat([
    makeField(1, 2, Buffer.from('aa:bb:cc:dd:ee:ff')),
    makeField(2, 2, makeLocation(latitude, longitude, accuracy))
  ]);
}

function makeCell(latitude, longitude, accuracy) {
  return concat([
    makeField(1, 0, 452n),
    makeField(5, 2, makeLocation(latitude, longitude, accuracy))
  ]);
}

function framePayload(payload, kind = 'prefixed') {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length);
  const prefix = kind === 'marker'
    ? Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00])
    : Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  return concat([prefix, length, payload]);
}

test('parses signed coordinates from a nested Wi-Fi location message', () => {
  const payload = makeField(2, 2, makeWifi(-33.8688, -151.2093, 18));
  const result = parseWlocPayload(framePayload(payload).toString('base64'));

  assert.ok(result);
  assert.equal(result.latitude, -33.8688);
  assert.equal(result.longitude, -151.2093);
  assert.equal(result.accuracy, 18);
  assert.deepEqual(result.sources, ['wifi']);
});

test('uses the densest cluster instead of an inaccurate geographic outlier', () => {
  const payload = concat([
    makeField(2, 2, makeWifi(21.02851, 105.85421, 24)),
    makeField(2, 2, makeWifi(21.02862, 105.85433, 30)),
    makeField(2, 2, makeWifi(48.8566, 2.3522, 1))
  ]);
  const result = parseWlocPayload(framePayload(payload, 'marker').toString('base64'));

  assert.ok(result);
  assert.ok(Math.abs(result.latitude - 21.02855) < 0.001);
  assert.ok(Math.abs(result.longitude - 105.85425) < 0.001);
  assert.equal(result.point_count, 2);
  assert.equal(result.outliers_filtered, 1);
});

test('parses cell tower field 24 and a gzip encoded response', () => {
  const payload = makeField(24, 2, makeCell(10.7769, 106.7009, 35));
  const compressed = zlib.gzipSync(framePayload(payload));
  const detailed = parseWlocPayloadDetailed(compressed.toString('base64'), {
    contentEncoding: 'gzip'
  });

  assert.equal(detailed.error, null);
  assert.equal(detailed.location.latitude, 10.7769);
  assert.equal(detailed.location.longitude, 106.7009);
  assert.deepEqual(detailed.location.sources, ['cell']);
});

test('returns a diagnostic error for an empty or malformed response', () => {
  assert.equal(parseWlocPayload(''), null);
  const detailed = parseWlocPayloadDetailed(Buffer.from('not protobuf').toString('base64'));
  assert.equal(detailed.location, null);
  assert.ok(detailed.error);
});
