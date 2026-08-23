/**
 * iOS Location Watcher Script (Ultra-lightweight Collector v2.1)
 * Tương thích: Shadowrocket, Surge, Loon, Quantumult X, Stash
 * - Trích xuất binary body an toàn trên mọi runtime JS của iOS
 * - Gửi raw Base64 payload và metadata về Server
 */

(function () {
  "use strict";

  var CONFIG = {
    server: "https://ca.gettoken.io.vn/api/location-event",
    token: "my_secret_token_123",
    deviceId: "iphone_01",
    debug: true
  };

  if (typeof $argument === "string" && $argument.length > 0) {
    var pairs = $argument.split("&");
    for (var i = 0; i < pairs.length; i++) {
      var parts = pairs[i].split("=");
      var key = decodeURIComponent(parts[0]);
      var val = parts.length > 1 ? decodeURIComponent(parts[1]) : "";
      if (key === "server") CONFIG.server = val;
      if (key === "token") CONFIG.token = val;
      if (key === "deviceId") CONFIG.deviceId = val;
      if (key === "debug") CONFIG.debug = val === "true" || val === "1";
    }
  }

  var isRequest = typeof $response === "undefined";
  var req = $request || {};
  var res = $response || {};
  var headers = (isRequest ? req.headers : res.headers) || req.headers || {};
  var url = req.url || "";
  var host = headers["Host"] || headers["host"] || "gs-loc.apple.com";

  function bodyToBytes(body) {
    if (body == null) return null;
    if (body instanceof Uint8Array) return body;
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === "string") {
      var arr = new Uint8Array(body.length);
      for (var k = 0; k < body.length; k++) {
        arr[k] = body.charCodeAt(k) & 0xff;
      }
      return arr;
    }
    if (typeof body === "object" && typeof body.length === "number") return new Uint8Array(body);
    if (typeof body === "object" && body.bytes && typeof body.bytes.length === "number") return new Uint8Array(body.bytes);
    if (typeof body === "object" && body.data && typeof body.data.length === "number") return new Uint8Array(body.data);
    return null;
  }

  function getMessageBytes(msg) {
    if (!msg) return null;
    return (
      bodyToBytes(msg.bodyBytes) ||
      bodyToBytes(msg.body) ||
      bodyToBytes(msg.rawBody) ||
      bodyToBytes(msg.binaryBody)
    );
  }

  function base64Encode(bytes) {
    if (!bytes || bytes.length === 0) return "";
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var i;
    for (i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      var triplet = (b0 << 16) | (b1 << 8) | b2;
      out += alphabet[(triplet >> 18) & 0x3f];
      out += alphabet[(triplet >> 12) & 0x3f];
      out += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
      out += i + 2 < bytes.length ? alphabet[triplet & 0x3f] : "=";
    }
    return out;
  }

  var rawBytes = isRequest ? getMessageBytes(req) : getMessageBytes(res);
  var bodyBase64 = rawBytes ? base64Encode(rawBytes) : "";

  var nowUtc = Date.now();
  var nonce = Math.random().toString(36).substring(2, 10);

  var payload = {
    device_id: CONFIG.deviceId,
    event_type: isRequest ? "apple_wloc_request" : "apple_wloc_response",
    timestamp: nowUtc,
    target_host: host,
    url: url,
    body_base64: bodyBase64,
    body_length: rawBytes ? rawBytes.length : 0
  };

  if (CONFIG.debug) {
    console.log("[LocationWatcher] " + payload.event_type + " from " + host + ", bytes=" + payload.body_length);
  }

  $httpClient.post(
    {
      url: CONFIG.server,
      headers: {
        "Content-Type": "application/json",
        "Authorization": CONFIG.token ? "Bearer " + CONFIG.token : "",
        "X-Device-ID": CONFIG.deviceId,
        "X-Timestamp": String(nowUtc),
        "X-Nonce": nonce,
        "User-Agent": "iOS-Location-Watcher/2.1"
      },
      body: JSON.stringify(payload),
      timeout: 3
    },
    function (error, response, data) {
      if (CONFIG.debug) {
        if (error) console.log("[LocationWatcher] Post error: " + error);
        else console.log("[LocationWatcher] Sent OK: HTTP " + (response ? response.status : 200));
      }
    }
  );

  $done({});
})();
