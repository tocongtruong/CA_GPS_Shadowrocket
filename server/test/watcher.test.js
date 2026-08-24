const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const watcherSource = fs.readFileSync(path.join(__dirname, '..', '..', 'watcher.js'), 'utf8');

function runWatcher({ phase, bytes = [], headers = {}, argument = '' }) {
  let collectorRequest = null;
  const doneValues = [];
  const context = vm.createContext({
    console: { log() {} },
    $argument: argument || 'server=https%3A%2F%2Fcollector.test%2Fapi%2Flocation-event&token=private-token&deviceId=test-phone&debug=true',
    $request: {
      method: 'POST',
      url: 'https://gs-loc.apple.com/clls/wloc',
      headers: { Host: 'gs-loc.apple.com', 'Accept-Encoding': 'gzip' }
    },
    $httpClient: {
      post(options, callback) {
        collectorRequest = options;
        callback(null, { status: 200 }, '{"success":true}');
      }
    },
    $done(value) {
      doneValues.push(value);
    },
    setTimeout() { return 1; },
    clearTimeout() {}
  });

  if (phase === 'response') {
    context.responseHeaders = headers;
    context.responseBytes = bytes;
    vm.runInContext(`
      $response = {
        status: 200,
        headers: responseHeaders,
        bodyBytes: new Uint8Array(responseBytes)
      };
    `, context);
  }

  vm.runInContext(watcherSource, context, { filename: 'watcher.js' });
  return { collectorRequest, doneValues };
}

test('captures a binary WLOC response and authenticates the collector request', () => {
  const bytes = [0, 1, 255, 17, 32, 64];
  const result = runWatcher({
    phase: 'response',
    bytes,
    headers: { 'Content-Type': 'application/x-protobuf', 'Content-Encoding': 'identity' }
  });

  assert.equal(result.doneValues.length, 1);
  assert.equal(result.collectorRequest.url, 'https://collector.test/api/location-event');
  assert.equal(result.collectorRequest.headers.Authorization, 'Bearer private-token');
  assert.equal(result.collectorRequest.headers['X-Device-ID'], 'test-phone');

  const payload = JSON.parse(result.collectorRequest.body);
  assert.equal(payload.event_type, 'apple_wloc_response');
  assert.equal(payload.body_length, bytes.length);
  assert.equal(payload.body_base64, Buffer.from(bytes).toString('base64'));
  assert.equal(payload.diagnostics.selected_slot, 'bodyBytes');
  assert.equal(payload.diagnostics.representation, 'Uint8Array');
});

test('keeps the Apple request flowing and asks for an identity encoded response', () => {
  const result = runWatcher({ phase: 'request' });

  assert.equal(result.doneValues.length, 1);
  assert.equal(result.doneValues[0].headers['Accept-Encoding'], 'identity');
  const payload = JSON.parse(result.collectorRequest.body);
  assert.equal(payload.event_type, 'apple_wloc_request');
  assert.equal(payload.body_length, 0);
});

test('sends a deterministic module connectivity probe without requiring a WLOC body', () => {
  const result = runWatcher({
    phase: 'request',
    argument: 'server=https%3A%2F%2Fcollector.test%2Fapi%2Flocation-event&token=private-token&deviceId=test-phone&eventType=module_probe&debug=true'
  });

  assert.equal(result.doneValues.length, 1);
  const payload = JSON.parse(result.collectorRequest.body);
  assert.equal(payload.event_type, 'module_probe');
  assert.equal(payload.device_id, 'test-phone');
  assert.equal(payload.body_length, 0);
});
