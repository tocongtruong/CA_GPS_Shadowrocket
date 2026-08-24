require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDatabase, purgeOldData, checkpointWAL } = require('./database');
const { startRetentionCleaner } = require('./services/cleanerService');
const locationService = require('./services/locationService');
const { initTelegramBot } = require('./services/telegramService');
const { createDashboardAuth, createWebhookAuth } = require('./services/authService');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || '';
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const dashboardAuth = createDashboardAuth({ username: DASHBOARD_USER, password: DASHBOARD_PASSWORD });
const verifyWebhookAuth = createWebhookAuth(SECRET_TOKEN);

app.set('trust proxy', true);

// 1. Khởi tạo Database SQLite WAL
initDatabase();

// 2. Khởi động Data Retention Cleaner (30 ngày)
startRetentionCleaner();

// 3. Khởi động Telegram Bot Engine
initTelegramBot();

// 4. Middleware
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, status: 'ok', server_time: Date.now() });
});

app.get('/api/module-probe', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    status: 'probe-page-reached',
    message: 'Nếu module Shadowrocket v3.1 đang bật, dashboard sẽ xuất hiện thiết bị với nguồn module_probe.',
    server_time: Date.now()
  });
});

// -------------------------------------------------------------
// 1. CỔNG TẢI TRỰC TIẾP CERT & MODULE CHO IPHONE & SHADOWROCKET
// -------------------------------------------------------------
const certsDir = path.join(__dirname, '..', 'certs');
const projectRoot = path.join(__dirname, '..');

app.get('/download/ca.crt', (req, res) => {
  const file = path.join(certsDir, 'ca.crt');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.crt"');
    return res.sendFile(file);
  }
  res.status(404).send('Chưa sinh file ca.crt. Vui lòng chạy node generate-cert.js');
});

app.get('/download/ca.p12', dashboardAuth, (req, res) => {
  const file = path.join(certsDir, 'ca.p12');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/x-pkcs12');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.p12"');
    return res.sendFile(file);
  }
  res.status(404).send('Chưa sinh file ca.p12. Vui lòng chạy node generate-cert.js');
});

app.get('/download/watcher.js', (req, res) => {
  const file = path.join(projectRoot, 'watcher.js');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.sendFile(file);
  }
  res.status(404).send('Không tìm thấy file watcher.js');
});

app.get('/download/location-watcher.sgmodule', dashboardAuth, (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.protocol;
  const serverUrl = `${protocol}://${host}/api/location-event`;
  const scriptUrl = `${protocol}://${host}/download/watcher.js?v=3.1.0`;
  const collectorToken = encodeURIComponent(SECRET_TOKEN);
  const requestedHostname = String(req.hostname || host.split(':')[0]).toLowerCase();
  const moduleHostname = /^[a-z0-9.-]+$/.test(requestedHostname) ? requestedHostname : 'localhost';
  const moduleHost = moduleHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sgmoduleContent = `#!name=iOS Location Watcher PRIVATE v3.1
#!desc=Module riêng tư đã nhúng token collector. Không chia sẻ file này.
#!author=Custom Location Lab
#!system=ios
#!private=true

[Script]
ModuleConnectivityProbe = type=http-request,pattern=^https?:\\/\\/${moduleHost}\\/api\\/module-probe(?:\\?.*)?$,requires-body=0,max-size=0,timeout=10,script-path=${scriptUrl},argument=server=${serverUrl}&token=${collectorToken}&deviceId=iphone_01&eventType=module_probe&debug=true

LocationRequestWatcher = type=http-request,pattern=^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc(?:\\?.*)?$,requires-body=1,binary-body-mode=1,max-size=1048576,timeout=10,script-path=${scriptUrl},argument=server=${serverUrl}&token=${collectorToken}&deviceId=iphone_01&debug=true

LocationResponseWatcher = type=http-response,pattern=^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc(?:\\?.*)?$,requires-body=1,binary-body-mode=1,max-size=1048576,timeout=30,script-path=${scriptUrl},argument=server=${serverUrl}&token=${collectorToken}&deviceId=iphone_01&debug=true

[MITM]
hostname = %APPEND% ${moduleHostname}, gs-loc.apple.com, gs-loc-cn.apple.com, gsp-ssl.ls.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="location-watcher.sgmodule"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(sgmoduleContent);
});

// -------------------------------------------------------------
// 2. API NHẬN WEBHOOK TỪ SHADOWROCKET / COLLECTOR
// -------------------------------------------------------------
app.post('/api/location-event', verifyWebhookAuth, (req, res) => {
  try {
    const deviceId = req.headers['x-device-id'] || req.body.device_id || 'iphone_01';
    const {
      event_type = 'apple_wloc',
      latitude = null,
      longitude = null,
      accuracy = 0,
      timestamp = Date.now(),
      target_host = 'apple-location',
      body_base64 = '',
      body_length = 0,
      source,
      content_encoding = '',
      content_type = '',
      diagnostics = null
    } = req.body;

    const result = locationService.recordLocationEvent({
      device_id: deviceId,
      latitude,
      longitude,
      accuracy,
      source: source || event_type,
      raw_payload: {
        target_host,
        body_length,
        has_binary_body: !!body_base64,
        content_encoding,
        content_type,
        diagnostics
      },
      body_base64,
      content_encoding,
      event_time: typeof timestamp === 'number' ? timestamp : Date.now()
    });

    console.log(
      `[Collector] device=${deviceId} event=${event_type} body=${Number(body_length) || 0}`
      + ` parse=${result.data?.parse_status || (result.is_duplicate ? 'duplicate' : 'unknown')}`
    );

    if (result.is_duplicate) {
      return res.status(200).json({
        success: true,
        message: 'Duplicate event skipped (Deduplicated)',
        id: result.id
      });
    }

    return res.status(200).json({
      success: true,
      id: result.id,
      device_id: deviceId,
      parse_status: result.data?.parse_status || null,
      received_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Error /api/location-event]:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// 3. API GHI NHẬN TỌA ĐỘ CHỦ ĐỘNG (iOS Shortcut / App GPS / OwnTracks)
// -------------------------------------------------------------
app.post('/api/manual-ping', verifyWebhookAuth, (req, res) => {
  try {
    const deviceId = req.headers['x-device-id'] || req.body.device_id || 'iphone_01';
    const {
      latitude,
      longitude,
      accuracy = 10,
      source = 'shortcut_gps',
      timestamp = Date.now()
    } = req.body;

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    const parsedAccuracy = Number(accuracy);

    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
      || parsedLatitude < -90 || parsedLatitude > 90
      || parsedLongitude < -180 || parsedLongitude > 180) {
      return res.status(400).json({
        success: false,
        error: 'Latitude hoặc longitude không hợp lệ.'
      });
    }

    const result = locationService.recordLocationEvent({
      device_id: deviceId,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      accuracy: Number.isFinite(parsedAccuracy) && parsedAccuracy > 0 ? parsedAccuracy : 10,
      source,
      raw_payload: null,
      event_time: timestamp
    });

    return res.status(200).json({
      success: true,
      id: result.id,
      device_id: deviceId,
      coords: { latitude, longitude, accuracy }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// 4. API TRUY VẤN VỊ TRÍ & LỘ TRÌNH
// -------------------------------------------------------------
app.use(dashboardAuth);

app.get('/api/location/latest', (req, res) => {
  try {
    const deviceId = req.query.device_id;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tham số device_id' });
    }

    const latest = locationService.getLatestLocation(deviceId);
    return res.json({ success: true, device_id: deviceId, data: latest });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/location/history', (req, res) => {
  try {
    const deviceId = req.query.device_id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tham số device_id' });
    }
    const history = locationService.getHistory(deviceId, limit);
    return res.json({ success: true, device_id: deviceId, count: history.length, data: history });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/location/route', (req, res) => {
  try {
    const deviceId = req.query.device_id;
    const date = req.query.date;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp tham số device_id' });
    }
    const routeData = locationService.getRouteByDate(deviceId, date);
    return res.json({ success: true, data: routeData });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/devices', (req, res) => {
  try {
    const devices = locationService.getAllDevices();
    return res.json({ success: true, data: devices });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = locationService.getSystemStats();
    return res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// 5. API QUẢN TRỊ DATABASE (CRUD THÊM - XÓA - SỬA BẢN GHI)
// -------------------------------------------------------------
// Lấy danh sách phân trang bản ghi
app.get('/api/admin/locations', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const deviceId = req.query.device_id || null;

    const data = locationService.getAllLocationsAdmin(limit, offset, deviceId);
    return res.json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Thêm vị trí mới thủ công
app.post('/api/admin/locations', (req, res) => {
  try {
    const { device_id, latitude, longitude, accuracy, source, event_time } = req.body;
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    if (!device_id || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
      || parsedLatitude < -90 || parsedLatitude > 90
      || parsedLongitude < -180 || parsedLongitude > 180) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập device_id, latitude và longitude' });
    }

    const id = locationService.addManualLocation({
      device_id,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      accuracy: accuracy || 10,
      source: source || 'manual_admin',
      event_time: event_time ? new Date(event_time).getTime() : Date.now()
    });

    return res.json({ success: true, id, message: 'Đã thêm bản ghi mới thành công' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Sửa vị trí
app.put('/api/admin/locations/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = locationService.updateLocation(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy bản ghi cần sửa' });
    }
    return res.json({ success: true, message: 'Đã cập nhật bản ghi thành công' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Xóa 1 vị trí
app.delete('/api/admin/locations/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = locationService.deleteLocation(id);
    return res.json({ success: true, deleted, message: 'Đã xóa bản ghi thành công' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Xóa tất cả hoặc theo thiết bị
app.post('/api/admin/locations/clear', (req, res) => {
  try {
    const { device_id } = req.body;
    locationService.clearLocations(device_id);
    return res.json({ success: true, message: `Đã xóa toàn bộ dữ liệu ${device_id ? 'của ' + device_id : ''}` });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// 6. GIAO DIỆN WEB FRONTEND TĨNH (DASHBOARD BẢN ĐỒ)
// -------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi động lắng nghe Server
const server = app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 iOS Location Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📥 Tải Cert công khai: http://localhost:${PORT}/download/ca.crt`);
  console.log(`🔐 Dashboard và module riêng tư yêu cầu tài khoản: ${DASHBOARD_USER}`);
  console.log('====================================================');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Server] Cổng ${PORT} đang được sử dụng. Hãy dừng tiến trình cũ hoặc đổi PORT.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
