const { db, dbPath } = require('../database');
const crypto = require('crypto');
const fs = require('fs');
const EventEmitter = require('events');
const { parseWlocPayloadDetailed } = require('./wlocParser');

class LocationEventEmitter extends EventEmitter {}
const locationEvents = new LocationEventEmitter();

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Ghi nhận sự kiện vị trí với Deduplication, Parser Fail-safe và Event Emitter
 */
function recordLocationEvent({
  device_id = 'iphone_unknown',
  latitude = null,
  longitude = null,
  accuracy = 0,
  source = 'apple_wloc',
  raw_payload = null,
  body_base64 = null,
  content_encoding = '',
  event_time = Date.now()
}) {
  const now = Date.now();
  const parsedTime = Number(event_time);
  const time = Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : now;

  let finalLat = latitude !== null && latitude !== undefined ? parseFloat(latitude) : null;
  let finalLng = longitude !== null && longitude !== undefined ? parseFloat(longitude) : null;
  let finalAcc = accuracy ? parseFloat(accuracy) : 0;
  let finalSource = source;
  let parserDiagnostics = null;

  if (!Number.isFinite(finalLat) || finalLat < -90 || finalLat > 90) finalLat = null;
  if (!Number.isFinite(finalLng) || finalLng < -180 || finalLng > 180) finalLng = null;
  if (!Number.isFinite(finalAcc) || finalAcc < 0) finalAcc = 0;

  // 1. Nếu có body Base64 từ Apple response, tiến hành giải mã Protobuf
  const isResponsePayload = String(source).includes('response') || source === 'apple_wloc';
  if ((finalLat === null || finalLng === null) && body_base64 && isResponsePayload) {
    parserDiagnostics = parseWlocPayloadDetailed(body_base64, { contentEncoding: content_encoding });
    if (parserDiagnostics.location) {
      finalLat = parserDiagnostics.location.latitude;
      finalLng = parserDiagnostics.location.longitude;
      finalAcc = parserDiagnostics.location.accuracy;
      finalSource = 'apple_wloc_resolved';
    }
  }

  // 2. Tính toán SHA-256 Hash phục vụ Deduplication
  const hash = crypto.createHash('sha256').update(`${device_id}:`);
  if (body_base64) hash.update(body_base64);
  else hash.update(`${finalLat}:${finalLng}:${finalSource}`);
  const payloadHash = hash.digest('hex');

  const storedPayload = body_base64
    ? JSON.stringify({
        metadata: raw_payload,
        content_encoding,
        parser: parserDiagnostics
          ? {
              error: parserDiagnostics.error,
              envelope_kind: parserDiagnostics.envelope_kind,
              candidate_count: parserDiagnostics.candidate_count,
              encoded_body_length: parserDiagnostics.encoded_body_length,
              decoded_body_length: parserDiagnostics.decoded_body_length
            }
          : null,
        body_base64
      })
    : (typeof raw_payload === 'object' ? JSON.stringify(raw_payload) : raw_payload);

  // 3. Kiểm tra trùng lặp (Deduplication trong vòng 60 giây)
  const duplicateCheck = db.prepare(`
    SELECT id, event_time FROM locations 
    WHERE device_id = ? AND payload_hash = ? AND event_time >= ?
    ORDER BY event_time DESC LIMIT 1
  `).get(device_id, payloadHash, time - 60000);

  if (duplicateCheck) {
    return { id: duplicateCheck.id, is_duplicate: true };
  }

  // 4. Thực hiện Transaction ghi vào SQLite
  const insertLocation = db.prepare(`
    INSERT INTO locations 
    (device_id, latitude, longitude, accuracy, source, payload_hash, raw_payload, event_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertDevice = db.prepare(`
    INSERT INTO devices (device_id, name, last_seen, total_pings, created_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      total_pings = total_pings + 1
  `);

  let recordId;
  db.exec('BEGIN');
  try {
    const result = insertLocation.run(
      device_id,
      finalLat,
      finalLng,
      finalAcc,
      finalSource,
      payloadHash,
      storedPayload,
      time,
      now
    );
    recordId = Number(result.lastInsertRowid);

    upsertDevice.run(device_id, device_id, time, now);

    if (finalLat !== null && finalLng !== null) {
      db.prepare(`
        UPDATE locate_requests 
        SET status = 'completed', completed_at = ?, location_id = ?
        WHERE device_id = ? AND status = 'waiting' AND expires_at >= ?
      `).run(now, recordId, device_id, now);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // 5. Phát tín hiệu Event Emitter
  const eventPayload = {
    id: recordId,
    device_id,
    latitude: finalLat,
    longitude: finalLng,
    accuracy: finalAcc,
    source: finalSource,
    event_time: time,
    parse_status: parserDiagnostics
      ? (parserDiagnostics.location ? 'resolved' : parserDiagnostics.error)
      : (body_base64 ? 'not_applicable' : 'missing_body')
  };

  locationEvents.emit('location_recorded', eventPayload);

  return { id: recordId, is_duplicate: false, data: eventPayload };
}

/**
 * Lấy vị trí mới nhất có tọa độ hợp lệ của thiết bị
 */
function getLatestLocation(deviceId) {
  const selectedColumns = 'id, device_id, latitude, longitude, accuracy, source, event_time, created_at';
  const latestSignal = db.prepare(`
    SELECT ${selectedColumns} FROM locations
    WHERE device_id = ?
    ORDER BY event_time DESC
    LIMIT 1
  `).get(deviceId);

  if (!latestSignal) return null;

  const latestCoordinates = db.prepare(`
    SELECT ${selectedColumns} FROM locations
    WHERE device_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY event_time DESC
    LIMIT 1
  `).get(deviceId);

  return {
    ...(latestCoordinates || latestSignal),
    latest_signal: latestSignal
  };
}

/**
 * Lấy lịch sử N vị trí gần nhất
 */
function getHistory(deviceId, limit = 100) {
  const stmt = db.prepare(`
    SELECT id, device_id, latitude, longitude, accuracy, source, event_time, created_at 
    FROM locations 
    WHERE device_id = ? 
    ORDER BY event_time DESC 
    LIMIT ?
  `);
  return stmt.all(deviceId, Math.min(limit, 1000));
}

/**
 * Lấy danh sách toàn bộ bản ghi cho trang quản trị CRUD
 */
function getAllLocationsAdmin(limit = 100, offset = 0, deviceId = null) {
  let sql = `SELECT id, device_id, latitude, longitude, accuracy, source, payload_hash, event_time, created_at FROM locations`;
  const params = [];

  if (deviceId && deviceId !== 'all') {
    sql += ` WHERE device_id = ?`;
    params.push(deviceId);
  }

  sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  let countSql = `SELECT COUNT(*) as total FROM locations`;
  if (deviceId && deviceId !== 'all') {
    countSql += ` WHERE device_id = ?`;
    const total = db.prepare(countSql).get(deviceId).total;
    return { rows, total };
  }
  const total = db.prepare(countSql).get().total;
  return { rows, total };
}

/**
 * Thêm một vị trí thủ công (CRUD)
 */
function addManualLocation({ device_id, latitude, longitude, accuracy = 10, source = 'manual_admin', event_time = Date.now() }) {
  const now = Date.now();
  const time = event_time || now;
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const acc = parseFloat(accuracy) || 10;

  if (!device_id || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Dữ liệu tọa độ không hợp lệ');
  }

  const payloadHash = crypto.createHash('sha256').update(`manual:${device_id}:${lat}:${lng}:${time}`).digest('hex');

  const stmt = db.prepare(`
    INSERT INTO locations 
    (device_id, latitude, longitude, accuracy, source, payload_hash, raw_payload, event_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(device_id, lat, lng, acc, source, payloadHash, null, time, now);
  const id = Number(result.lastInsertRowid);

  // Cập nhật devices
  db.prepare(`
    INSERT INTO devices (device_id, name, last_seen, total_pings, created_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      total_pings = total_pings + 1
  `).run(device_id, device_id, time, now);

  const eventPayload = { id, device_id, latitude: lat, longitude: lng, accuracy: acc, source, event_time: time };
  locationEvents.emit('location_recorded', eventPayload);

  return id;
}

/**
 * Cập nhật một bản ghi vị trí (CRUD)
 */
function updateLocation(id, { device_id, latitude, longitude, accuracy, source, event_time }) {
  const parsedLatitude = latitude !== undefined ? Number(latitude) : null;
  const parsedLongitude = longitude !== undefined ? Number(longitude) : null;
  const parsedAccuracy = accuracy !== undefined ? Number(accuracy) : null;

  if ((parsedLatitude !== null && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90))
    || (parsedLongitude !== null && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180))
    || (parsedAccuracy !== null && (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0))) {
    throw new Error('Dữ liệu cập nhật không hợp lệ');
  }

  const stmt = db.prepare(`
    UPDATE locations 
    SET device_id = COALESCE(?, device_id),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        accuracy = COALESCE(?, accuracy),
        source = COALESCE(?, source),
        event_time = COALESCE(?, event_time)
    WHERE id = ?
  `);

  const result = stmt.run(
    device_id || null,
    parsedLatitude,
    parsedLongitude,
    parsedAccuracy,
    source || null,
    event_time ? parseInt(event_time, 10) : null,
    id
  );

  return Number(result.changes) > 0;
}

/**
 * Xóa một bản ghi vị trí (CRUD)
 */
function deleteLocation(id) {
  const stmt = db.prepare('DELETE FROM locations WHERE id = ?');
  const result = stmt.run(id);
  return Number(result.changes) > 0;
}

/**
 * Xóa toàn bộ dữ liệu của một thiết bị hoặc tất cả
 */
function clearLocations(deviceId = null) {
  if (deviceId && deviceId !== 'all') {
    db.prepare('DELETE FROM locations WHERE device_id = ?').run(deviceId);
    db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
  } else {
    db.prepare('DELETE FROM locations').run();
    db.prepare('DELETE FROM devices').run();
    db.prepare('DELETE FROM locate_requests').run();
  }
  return true;
}

function getVietnamDateString(timestamp = Date.now()) {
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getVietnamDayBounds(dateString) {
  const normalizedDate = dateString || getVietnamDateString();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizedDate);
  if (!match) throw new Error('Định dạng ngày không hợp lệ. Vui lòng dùng YYYY-MM-DD');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcCheck = new Date(Date.UTC(year, month - 1, day));
  if (utcCheck.getUTCFullYear() !== year
    || utcCheck.getUTCMonth() !== month - 1
    || utcCheck.getUTCDate() !== day) {
    throw new Error('Ngày không tồn tại');
  }

  const startOfDay = Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000;
  return {
    date: normalizedDate,
    startOfDay,
    endOfDay: startOfDay + 24 * 60 * 60 * 1000 - 1
  };
}

/**
 * Lấy lộ trình di chuyển trong ngày theo múi giờ Việt Nam, kèm lọc GPS jump.
 */
function getRouteByDate(deviceId, dateString) {
  const { date, startOfDay, endOfDay } = getVietnamDayBounds(dateString);

  const rawPoints = db.prepare(`
    SELECT id, device_id, latitude, longitude, accuracy, source, event_time 
    FROM locations 
    WHERE device_id = ? AND event_time >= ? AND event_time <= ?
    ORDER BY event_time ASC
  `).all(deviceId, startOfDay, endOfDay);

  const validPoints = rawPoints.filter(p => p.latitude !== null && p.longitude !== null);

  const filteredPoints = [];
  let totalDistanceKm = 0;

  for (let i = 0; i < validPoints.length; i++) {
    const pt = validPoints[i];
    if (filteredPoints.length === 0) {
      filteredPoints.push(pt);
      continue;
    }

    const prevPt = filteredPoints[filteredPoints.length - 1];
    const distKm = calculateDistanceKm(prevPt.latitude, prevPt.longitude, pt.latitude, pt.longitude);
    const timeDiffHours = (pt.event_time - prevPt.event_time) / (1000 * 60 * 60);

    const speedKmH = timeDiffHours > 0 ? (distKm / timeDiffHours) : 0;

    if (speedKmH > 200 && (pt.event_time - prevPt.event_time) < 120000) {
      continue;
    }

    if (distKm >= 0.035) {
      totalDistanceKm += distKm;
    }

    filteredPoints.push(pt);
  }

  const stopPoints = [];
  let clusterStart = 0;

  for (let i = 1; i < filteredPoints.length; i++) {
    const dist = calculateDistanceKm(
      filteredPoints[clusterStart].latitude, filteredPoints[clusterStart].longitude,
      filteredPoints[i].latitude, filteredPoints[i].longitude
    );

    const durationMin = (filteredPoints[i].event_time - filteredPoints[clusterStart].event_time) / (1000 * 60);

    if (dist <= 0.06) {
      if (durationMin >= 15 && i === filteredPoints.length - 1) {
        stopPoints.push({
          latitude: filteredPoints[clusterStart].latitude,
          longitude: filteredPoints[clusterStart].longitude,
          start_time: filteredPoints[clusterStart].event_time,
          end_time: filteredPoints[i].event_time,
          duration_minutes: Math.round(durationMin)
        });
      }
    } else {
      if (durationMin >= 15) {
        stopPoints.push({
          latitude: filteredPoints[clusterStart].latitude,
          longitude: filteredPoints[clusterStart].longitude,
          start_time: filteredPoints[clusterStart].event_time,
          end_time: filteredPoints[i - 1].event_time,
          duration_minutes: Math.round(durationMin)
        });
      }
      clusterStart = i;
    }
  }

  return {
    device_id: deviceId,
    date,
    total_raw_points: rawPoints.length,
    total_valid_points: filteredPoints.length,
    total_distance_km: Number(totalDistanceKm.toFixed(2)),
    stop_points: stopPoints,
    start_time: startOfDay,
    end_time: endOfDay,
    points: filteredPoints
  };
}

function getAllDevices() {
  return db.prepare(`
    SELECT d.*, 
           l.latitude as latest_lat, 
           l.longitude as latest_lng, 
           l.accuracy as latest_accuracy,
           l.source as latest_source
    FROM devices d
    LEFT JOIN locations l ON l.id = (
      SELECT id FROM locations 
      WHERE device_id = d.device_id AND latitude IS NOT NULL
      ORDER BY event_time DESC 
      LIMIT 1
    )
    ORDER BY d.last_seen DESC
  `).all();
}

function getSystemStats() {
  const totalLocations = db.prepare('SELECT COUNT(*) as count FROM locations').get().count;
  const totalDevices = db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
  const oldestRecord = db.prepare('SELECT MIN(created_at) as min_time FROM locations').get().min_time;
  const latestRecord = db.prepare('SELECT MAX(created_at) as max_time FROM locations').get().max_time;

  let dbSizeMB = 0;
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    dbSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  }

  return {
    total_locations: totalLocations,
    total_devices: totalDevices,
    db_size_mb: Number(dbSizeMB),
    retention_days: Number(process.env.RETENTION_DAYS || 30),
    oldest_record: oldestRecord ? new Date(oldestRecord).toISOString() : null,
    latest_record: latestRecord ? new Date(latestRecord).toISOString() : null
  };
}

module.exports = {
  locationEvents,
  recordLocationEvent,
  getLatestLocation,
  getHistory,
  getRouteByDate,
  getAllDevices,
  getSystemStats,
  calculateDistanceKm,
  getAllLocationsAdmin,
  addManualLocation,
  updateLocation,
  deleteLocation,
  clearLocations,
  getVietnamDateString,
  getVietnamDayBounds
};
