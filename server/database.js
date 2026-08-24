const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'locations.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Khởi tạo SQLite bằng built-in node:sqlite (Native, không cần C++ node-gyp)
const db = new DatabaseSync(dbPath);

// Cấu hình tối ưu SQLite WAL
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA cache_size = -32000;');
} catch (e) {
  console.warn('[Database] Cảnh báo cấu hình pragma:', e.message);
}

function initDatabase() {
  db.exec(`
    -- Bảng lưu trữ tọa độ và sự kiện định vị
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      accuracy REAL DEFAULT 0,
      source TEXT NOT NULL,          -- 'apple_wloc', 'shortcut_gps', 'manual_ping', 'app_reported'
      payload_hash TEXT,             -- SHA256 hash phục vụ Deduplication
      raw_payload TEXT,              -- Lưu Base64 nhị phân (tự động xóa sau 2 ngày để tiết kiệm dung lượng)
      event_time INTEGER NOT NULL,   -- UTC Unix Epoch Milliseconds
      created_at INTEGER NOT NULL    -- UTC Unix Epoch Milliseconds
    );

    CREATE INDEX IF NOT EXISTS idx_locations_device_time 
    ON locations(device_id, event_time DESC);

    CREATE INDEX IF NOT EXISTS idx_locations_created_at 
    ON locations(created_at);

    CREATE INDEX IF NOT EXISTS idx_locations_hash 
    ON locations(device_id, payload_hash, event_time DESC);

    -- Bảng quản lý thiết bị và khóa xác thực HMAC
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      name TEXT,
      secret TEXT,                   -- Secret key riêng cho từng thiết bị để ký HMAC-SHA256
      last_seen INTEGER NOT NULL,
      total_pings INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- Bảng yêu cầu định vị với liên kết location_id cụ thể
    CREATE TABLE IF NOT EXISTS locate_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT,
      requested_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      completed_at INTEGER,
      location_id INTEGER,           -- ID vị trí chính xác đã hoàn tất yêu cầu này
      status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting', 'completed', 'timeout'
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_locate_requests_status 
    ON locate_requests(device_id, status, expires_at);
  `);

  console.log(`[Database] Đã khởi tạo schema SQLite hoàn chỉnh (Built-in node:sqlite) tại: ${dbPath}`);
}

/**
 * Dọn dẹp dữ liệu:
 * 1. Xóa toàn bộ bản ghi vị trí cũ hơn retentionDays (mặc định 30 ngày).
 * 2. Tỉa bỏ trường raw_payload của các bản ghi cũ hơn 2 ngày (giữ lại tọa độ parsed) để tránh phình dung lượng.
 */
function purgeOldData(retentionDays = 30) {
  const now = Date.now();
  const cutoffRetention = now - (retentionDays * 24 * 60 * 60 * 1000);
  const cutoffRawPayload = now - (2 * 24 * 60 * 60 * 1000);

  // 1. Xóa các vị trí quá hạn 30 ngày
  const stmtDelete = db.prepare('DELETE FROM locations WHERE created_at < ?');
  const deleteInfo = stmtDelete.run(cutoffRetention);

  // 2. Dọn bỏ raw_payload của bản ghi > 2 ngày để tiết kiệm dung lượng đĩa
  const stmtPrune = db.prepare('UPDATE locations SET raw_payload = NULL WHERE created_at < ? AND raw_payload IS NOT NULL');
  const pruneInfo = stmtPrune.run(cutoffRawPayload);

  // 3. Dọn các locate_requests cũ
  db.prepare("DELETE FROM locate_requests WHERE expires_at < ? AND status != 'waiting'").run(now - (7 * 86400000));

  const deletedCount = Number(deleteInfo.changes || 0);
  const prunedCount = Number(pruneInfo.changes || 0);

  if (deletedCount > 0 || prunedCount > 0) {
    console.log(`[Retention] Đã xóa ${deletedCount} bản ghi > ${retentionDays} ngày | Đã giải phóng raw_payload của ${prunedCount} bản ghi cũ.`);
  }

  checkpointWAL();

  return deletedCount;
}

/**
 * Thực hiện WAL Checkpoint định kỳ
 */
function checkpointWAL() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.warn('[Database] WAL checkpoint warning:', err.message);
  }
}

module.exports = {
  db,
  dbPath,
  initDatabase,
  purgeOldData,
  checkpointWAL
};
