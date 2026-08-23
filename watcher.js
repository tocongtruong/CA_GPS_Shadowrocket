/**
 * iOS Location Watcher Script (Ultra-lightweight Collector)
 * Tương thích: Shadowrocket, Surge, Loon, Quantumult X, Stash
 * - Gửi raw Base64 payload và metadata về Server riêng
 * - Đính kèm X-Device-ID rõ ràng từ cấu hình module
 * - Bất đồng bộ với timeout 3s để không bao giờ làm chậm kết nối iOS
 */

(function () {
  "use strict";

  var CONFIG = {
    server: "http://127.0.0.1:3000/api/location-event",
    token: "",
    deviceId: "iphone_01",
    debug: false
  };

  // Đọc cấu hình từ tham số module
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
  var headers = req.headers || {};
  var url = req.url || "";
  var host = headers["Host"] || headers["host"] || "apple-location";

  function toBase64(body) {
    if (!body) return "";
    if (typeof body === "string") return body;
    try {
      var bytes = new Uint8Array(body);
      var binary = "";
      var len = bytes.byteLength;
      for (var j = 0; j < len; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      return typeof btoa !== "undefined" ? btoa(binary) : "";
    } catch (e) {
      return "base64_error";
    }
  }

  var bodyBase64 = "";
  if (isRequest && req.body) {
    bodyBase64 = toBase64(req.body);
  } else if (!isRequest && $response && $response.body) {
    bodyBase64 = toBase64($response.body);
  }

  var nowUtc = Date.now();
  var nonce = Math.random().toString(36).substring(2, 10);

  var payload = {
    device_id: CONFIG.deviceId,
    event_type: isRequest ? "apple_wloc_request" : "apple_wloc_response",
    timestamp: nowUtc,
    target_host: host,
    url: url,
    body_base64: bodyBase64,
    body_length: bodyBase64 ? bodyBase64.length : 0
  };

  // Gửi Webhook bất đồng bộ
  $httpClient.post(
    {
      url: CONFIG.server,
      headers: {
        "Content-Type": "application/json",
        "Authorization": CONFIG.token ? "Bearer " + CONFIG.token : "",
        "X-Device-ID": CONFIG.deviceId,
        "X-Timestamp": String(nowUtc),
        "X-Nonce": nonce,
        "User-Agent": "iOS-Location-Watcher/2.0"
      },
      body: JSON.stringify(payload),
      timeout: 3
    },
    function (error, response, data) {
      if (CONFIG.debug) {
        if (error) console.log("[Watcher] Webhook error: " + error);
        else console.log("[Watcher] Webhook sent OK: HTTP " + (response ? response.status : 200));
      }
    }
  );

  // Lập tức cho request/response tiếp tục di chuyển
  $done({});
})();
