require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { initDatabase, purgeOldData, checkpointWAL } = require('./database');
const { startRetentionCleaner } = require('./services/cleanerService');
const locationService = require('./services/locationService');
const { initTelegramBot } = require('./services/telegramService');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || '';

// 1. Khởi tạo Database SQLite WAL
initDatabase();

// 2. Khởi động Data Retention Cleaner (30 ngày)
startRetentionCleaner();

// 3. Khởi động Telegram Bot Engine
initTelegramBot();

// 4. Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

/**
 * Middleware xác thực Webhook
 */
function verifyWebhookAuth(req, res, next) {
  if (!SECRET_TOKEN) return next();

  const signature = req.headers['x-signature'];
  const deviceId = req.headers['x-device-id'] || req.body.device_id;
  const timestamp = req.headers['x-timestamp'];
  const nonce = req.headers['x-nonce'];

  if (signature && timestamp && nonce) {
    const now = Date.now();
    const reqTime = parseInt(timestamp, 10);
    if (Math.abs(now - reqTime) > 300000) {
      return res.status(401).json({ success: false, error: 'Timestamp expired (Replay attack protection).' });
    }

    const payloadString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedSig = crypto
      .createHmac('sha256', SECRET_TOKEN)
      .update(`${deviceId}:${timestamp}:${nonce}:${payloadString}`)
      .digest('hex');

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return next();
    }
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : req.query.token;

  if (token && token === SECRET_TOKEN) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Sai hoặc thiếu Secret Token / Chữ ký HMAC.'
  });
}

// -------------------------------------------------------------
// 1. CỔNG TẢI TRỰC TIẾP CERT & MODULE CHO IPHONE & SHADOWROCKET
// -------------------------------------------------------------
const certsDir = path.join(__dirname, '..', 'certs');
const shadowDir = path.join(__dirname, '..', 'shadowrocket');

app.get('/download/ca.crt', (req, res) => {
  const file = path.join(certsDir, 'ca.crt');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.crt"');
    return res.sendFile(file);
  }
  res.status(404).send('Chưa sinh file ca.crt. Vui lòng chạy node generate-cert.js');
});

app.get('/download/ca.p12', (req, res) => {
  const file = path.join(certsDir, 'ca.p12');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/x-pkcs12');
    res.setHeader('Content-Disposition', 'attachment; filename="ca.p12"');
    return res.sendFile(file);
  }
  res.status(404).send('Chưa sinh file ca.p12. Vui lòng chạy node generate-cert.js');
});

app.get('/download/watcher.js', (req, res) => {
  const file = path.join(shadowDir, 'watcher.js');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.sendFile(file);
  }
  res.status(404).send('Không tìm thấy file watcher.js');
});

app.get('/download/location-watcher.sgmodule', (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.protocol || 'http';
  const serverUrl = `${protocol}://${host}/api/location-event`;
  const scriptUrl = `${protocol}://${host}/download/watcher.js`;

  const sgmoduleContent = `#!name=iOS Location Watcher
#!desc=Module bắt request định vị /clls/wloc và ghi nhận lịch sử về Server riêng qua Webhook.
#!author=Custom Location Lab
#!system=ios

[Script]
LocationRequestWatcher = type=http-request,pattern=^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=10,script-path=${scriptUrl},argument=server=${serverUrl}&token=${SECRET_TOKEN}&deviceId=iphone_01&debug=false

LocationResponseWatcher = type=http-response,pattern=^https?:\\/\\/(?:gs-loc(?:-cn)?\\.apple\\.com|gsp-ssl\\.ls\\.apple\\.com|bluedot\\.is\\.autonavi\\.com(?:\\.gds\\.alibabadns\\.com)?)\\/clls\\/wloc,requires-body=1,binary-body-mode=1,max-size=0,timeout=10,script-path=${scriptUrl},argument=server=${serverUrl}&token=${SECRET_TOKEN}&deviceId=iphone_01&debug=false

[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com, gsp-ssl.ls.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
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
      source
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
        has_binary_body: !!body_base64
      },
      body_base64,
      event_time: typeof timestamp === 'number' ? timestamp : Date.now()
    });

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

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Vui lòng cung cấp đầy đủ latitude và longitude.'
      });
    }

    const result = locationService.recordLocationEvent({
      device_id: deviceId,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: parseFloat(accuracy) || 10,
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
    const limit = parseInt(req.query.limit, 10) || 100;
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
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
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
    if (!device_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập device_id, latitude và longitude' });
    }

    const id = locationService.addManualLocation({
      device_id,
      latitude,
      longitude,
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
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 iOS Location Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📥 Tải Cert cho iPhone: http://localhost:${PORT}/download/ca.crt`);
  console.log(`📦 Tải Module Shadowrocket: http://localhost:${PORT}/download/location-watcher.sgmodule`);
  console.log(`🗺️  Xem Dashboard & Lộ Trình: http://localhost:${PORT}`);
  console.log('====================================================');
});
