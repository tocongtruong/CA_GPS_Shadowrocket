/**
 * iOS Location Watcher v3.1
 * Shadowrocket collector for Apple /clls/wloc request and response bodies.
 */
(function () {
  "use strict";

  var SCRIPT_VERSION = "3.1.0";
  var CONFIG = {
    server: "https://ca.gettoken.io.vn/api/location-event",
    token: "",
    deviceId: "iphone_01",
    eventType: "",
    debug: false
  };

  function parseArguments(argument) {
    var result = {};
    if (!argument || typeof argument !== "string") return result;

    var pairs = argument.split(/[&;]/);
    for (var index = 0; index < pairs.length; index += 1) {
      var pair = pairs[index];
      if (!pair) continue;
      var separator = pair.indexOf("=");
      var rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
      var rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
      try {
        result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
      } catch (error) {
        result[rawKey] = rawValue;
      }
    }
    return result;
  }

  var args = parseArguments(typeof $argument === "string" ? $argument : "");
  if (args.server) CONFIG.server = args.server;
  if (args.token) CONFIG.token = args.token;
  if (args.deviceId) CONFIG.deviceId = args.deviceId;
  if (args.eventType) CONFIG.eventType = args.eventType;
  if (args.debug) CONFIG.debug = args.debug === "true" || args.debug === "1";

  function objectKeys(value) {
    var keys = [];
    if (!value || typeof value !== "object") return keys;
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key);
    }
    return keys;
  }

  function valueType(value) {
    if (value == null) return String(value);
    if (value instanceof Uint8Array) return "Uint8Array";
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return "ArrayBuffer";
    return typeof value;
  }

  function valueLength(value) {
    if (value == null) return 0;
    if (typeof value === "string" || typeof value.length === "number") return value.length;
    if (typeof value.byteLength === "number") return value.byteLength;
    return 0;
  }

  function binaryStringToBytes(value) {
    var bytes = new Uint8Array(value.length);
    for (var index = 0; index < value.length; index += 1) {
      bytes[index] = value.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function looksLikeBase64(value) {
    return value.length >= 16
      && value.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function stringToBytes(value) {
    if (looksLikeBase64(value) && typeof atob === "function") {
      try {
        var decoded = atob(value);
        var decodedBytes = binaryStringToBytes(decoded);
        var likelyBinary = decodedBytes.length > 2
          && (decodedBytes[0] === 0 || decodedBytes[0] === 0x1f);
        if (likelyBinary) return { bytes: decodedBytes, representation: "base64-string" };
      } catch (error) {
        // Fall back to an 8-bit binary string.
      }
    }
    return { bytes: binaryStringToBytes(value), representation: "binary-string" };
  }

  function bodyToBytes(body) {
    if (body == null) return null;
    if (body instanceof Uint8Array) return { bytes: body, representation: "Uint8Array" };
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return { bytes: new Uint8Array(body), representation: "ArrayBuffer" };
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
      return {
        bytes: new Uint8Array(body.buffer, body.byteOffset || 0, body.byteLength),
        representation: "ArrayBufferView"
      };
    }
    if (typeof body === "string") return stringToBytes(body);
    if (typeof body === "object" && typeof body.length === "number") {
      return { bytes: new Uint8Array(body), representation: "array-like" };
    }
    if (typeof body === "object" && body.bytes) return bodyToBytes(body.bytes);
    if (typeof body === "object" && body.data) return bodyToBytes(body.data);
    return null;
  }

  function selectMessageBody(message) {
    var slots = ["bodyBytes", "body", "rawBody", "binaryBody"];
    for (var index = 0; index < slots.length; index += 1) {
      var slot = slots[index];
      var converted = bodyToBytes(message && message[slot]);
      if (converted && converted.bytes && converted.bytes.length > 0) {
        converted.slot = slot;
        return converted;
      }
    }
    return { bytes: null, slot: "none", representation: "none" };
  }

  function base64Encode(bytes) {
    if (!bytes || bytes.length === 0) return "";
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    for (var index = 0; index < bytes.length; index += 3) {
      var first = bytes[index];
      var second = index + 1 < bytes.length ? bytes[index + 1] : 0;
      var third = index + 2 < bytes.length ? bytes[index + 2] : 0;
      var triplet = (first << 16) | (second << 8) | third;
      output += alphabet[(triplet >> 18) & 0x3f];
      output += alphabet[(triplet >> 12) & 0x3f];
      output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 0x3f] : "=";
      output += index + 2 < bytes.length ? alphabet[triplet & 0x3f] : "=";
    }
    return output;
  }

  function getHeader(headers, name) {
    if (!headers) return "";
    var lowerName = name.toLowerCase();
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lowerName) {
        return String(headers[key]);
      }
    }
    return "";
  }

  function prepareRequestHeaders(headers) {
    var prepared = {};
    var foundEncodingHeader = false;
    headers = headers || {};
    for (var key in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
      if (key.toLowerCase() === "accept-encoding") {
        prepared[key] = "identity";
        foundEncodingHeader = true;
      } else {
        prepared[key] = headers[key];
      }
    }
    if (!foundEncodingHeader) prepared["Accept-Encoding"] = "identity";
    return prepared;
  }

  var hasResponse = typeof $response !== "undefined" && $response;
  var isRequest = !hasResponse;
  var request = typeof $request !== "undefined" && $request ? $request : {};
  var response = hasResponse ? $response : {};
  var message = isRequest ? request : response;
  var messageHeaders = message.headers || request.headers || {};
  var selectedBody = selectMessageBody(message);
  var rawBytes = selectedBody.bytes;
  var now = Date.now();
  var passThroughResult = isRequest
    ? { headers: prepareRequestHeaders(request.headers || {}) }
    : {};

  var bodySlots = {};
  var diagnosticSlots = ["bodyBytes", "body", "rawBody", "binaryBody"];
  for (var slotIndex = 0; slotIndex < diagnosticSlots.length; slotIndex += 1) {
    var diagnosticSlot = diagnosticSlots[slotIndex];
    bodySlots[diagnosticSlot] = {
      type: valueType(message[diagnosticSlot]),
      length: valueLength(message[diagnosticSlot])
    };
  }

  var payload = {
    device_id: CONFIG.deviceId,
    event_type: CONFIG.eventType || (isRequest ? "apple_wloc_request" : "apple_wloc_response"),
    timestamp: now,
    target_host: getHeader(request.headers || messageHeaders, "host") || "gs-loc.apple.com",
    url: request.url || "",
    body_base64: rawBytes ? base64Encode(rawBytes) : "",
    body_length: rawBytes ? rawBytes.length : 0,
    content_encoding: getHeader(messageHeaders, "content-encoding"),
    content_type: getHeader(messageHeaders, "content-type"),
    diagnostics: {
      script_version: SCRIPT_VERSION,
      selected_slot: selectedBody.slot,
      representation: selectedBody.representation,
      message_keys: objectKeys(message),
      body_slots: bodySlots,
      content_length: getHeader(messageHeaders, "content-length"),
      status: response.status || response.statusCode || null,
      method: request.method || "POST"
    }
  };

  if (CONFIG.debug) {
    console.log("[LocationWatcher] " + payload.event_type
      + " body=" + payload.body_length
      + " slot=" + selectedBody.slot
      + " encoding=" + (payload.content_encoding || "identity"));
  }

  var completed = false;
  var fallbackTimer = null;
  function finish() {
    if (completed) return;
    completed = true;
    if (fallbackTimer && typeof clearTimeout === "function") clearTimeout(fallbackTimer);
    $done(passThroughResult);
  }

  if (!CONFIG.server || !CONFIG.token || typeof $httpClient === "undefined") {
    if (CONFIG.debug) console.log("[LocationWatcher] Missing server, token or HTTP client");
    finish();
    return;
  }

  if (typeof setTimeout === "function") fallbackTimer = setTimeout(finish, 900);

  $httpClient.post({
    url: CONFIG.server,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + CONFIG.token,
      "X-Device-ID": CONFIG.deviceId,
      "X-Timestamp": String(now),
      "X-Nonce": Math.random().toString(36).slice(2, 12),
      "User-Agent": "iOS-Location-Watcher/" + SCRIPT_VERSION
    },
    body: JSON.stringify(payload),
    timeout: 2
  }, function (error, collectorResponse, data) {
    if (CONFIG.debug) {
      if (error) {
        console.log("[LocationWatcher] Collector error: " + error);
      } else {
        var status = collectorResponse && (collectorResponse.status || collectorResponse.statusCode) || 200;
        console.log("[LocationWatcher] Collector HTTP " + status + (data ? " " + data : ""));
      }
    }
    finish();
  });
}());
