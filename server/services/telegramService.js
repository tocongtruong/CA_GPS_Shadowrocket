const { Telegraf } = require('telegraf');
const { db } = require('../database');
const { locationEvents, getLatestLocation, getRouteByDate, getSystemStats, getAllDevices, calculateDistanceKm } = require('./locationService');

let bot = null;
let isBotActive = false;

function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ ${minutes % 60} phút trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function formatVietnamTime(timestamp) {
  return new Date(timestamp).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getSourceLabel(source) {
  switch (source) {
    case 'apple_wloc_resolved':
    case 'apple_wloc':
      return '📡 Apple WLOC (Wi-Fi/Cell xấp xỉ)';
    case 'shortcut_gps':
    case 'manual_ping':
      return '🎯 GPS Thiết Bị (Độ chính xác cao)';
    default:
      return `📍 ${source}`;
  }
}

/**
 * Khởi động Telegram Bot Engine
 */
function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[TelegramBot] ⚠️ TELEGRAM_BOT_TOKEN chưa được cấu hình. Hệ thống chạy ở chế độ Web/API Only.');
    return;
  }

  try {
    bot = new Telegraf(token);

    // Middleware kiểm tra quyền truy cập trên TOÀN BỘ commands & messages
    bot.use(async (ctx, next) => {
      const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS;
      if (allowedUsers) {
        const userList = allowedUsers.split(',').map(u => u.trim());
        const senderId = String(ctx.from?.id);
        const username = ctx.from?.username;

        const isAllowed = userList.includes(senderId) || (username && userList.includes(username));
        if (!isAllowed) {
          console.warn(`[TelegramBot] Từ chối truy cập từ user: ${senderId} (@${username || 'no_user'})`);
          return ctx.reply('⛔ Bạn không có quyền truy cập hệ thống định vị này.');
        }
      }
      return next();
    });

    // Lệnh /start & /help
    bot.command(['start', 'help'], (ctx) => {
      const msg = 
`🛰️ *HỆ THỐNG ĐỊNH VỊ iOS (STANDALONE ENGINE)*
────────────────────────
Các lệnh hỗ trợ:
📍 \`/locate [device_id]\` : Kích hoạt chờ vị trí mới trong 30 phút (trả ngay nếu có điểm <30s).
🕒 \`/latest [device_id]\` : Lấy vị trí gần nhất đã lưu trong DB.
🗺️ \`/today [device_id]\`  : Lộ trình & tổng quãng đường hôm nay.
📊 \`/status\`            : Thống kê dung lượng DB và thiết bị.
────────────────────────
_Lưu trữ tự động trong 30 ngày (SQLite WAL)._`;
      ctx.replyWithMarkdown(msg);
    });

    // Lệnh /locate
    bot.command('locate', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const deviceId = args[0] || 'iphone_01';
      const chatId = String(ctx.chat.id);
      const userId = String(ctx.from.id);
      const now = Date.now();

      const latest = getLatestLocation(deviceId);

      // Nếu có vị trí rất mới (dưới 30 giây)
      if (latest && (now - latest.event_time) <= 30000 && latest.latitude && latest.longitude) {
        const gmaps = `https://maps.google.com/?q=${latest.latitude},${latest.longitude}`;
        const replyText = 
`📍 *VỊ TRÍ RẤT MỚI (<30s)*
────────────────────────
📱 Thiết bị: \`${deviceId}\`
🌐 Tọa độ: \`${latest.latitude}, ${latest.longitude}\`
🎯 Độ chính xác: ~${Math.round(latest.accuracy || 30)} m
🕒 Ghi nhận: ${formatVietnamTime(latest.event_time)} (${timeAgo(latest.event_time)})
📡 Nguồn: ${getSourceLabel(latest.source)}

🔗 [Mở trên Google Maps](${gmaps})`;

        return ctx.replyWithMarkdown(replyText);
      }

      // Tạo trạng thái chờ 30 phút trong SQLite
      const expiresAt = now + (30 * 60 * 1000);
      const stmt = db.prepare(`
        INSERT INTO locate_requests (device_id, chat_id, user_id, requested_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, 'waiting')
      `);
      stmt.run(deviceId, chatId, userId, now, expiresAt);

      const waitingMsg = 
`⏳ *ĐANG CHỜ TÍN HIỆU ĐỊNH VỊ*
────────────────────────
📱 Thiết bị: \`${deviceId}\`
⏱️ Hạn chờ: *30 phút*
💡 _Bot sẽ gửi tọa độ tức thì khi iPhone phát sinh lưu lượng vị trí._`;

      ctx.replyWithMarkdown(waitingMsg);
    });

    // Lệnh /latest
    bot.command('latest', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const deviceId = args[0] || 'iphone_01';
      const latest = getLatestLocation(deviceId);

      if (!latest) {
        return ctx.reply(`⚠️ Chưa có dữ liệu vị trí cho thiết bị: ${deviceId}`);
      }

      const gmaps = latest.latitude && latest.longitude ? `https://maps.google.com/?q=${latest.latitude},${latest.longitude}` : '';
      const replyText = 
`📍 *VỊ TRÍ GẦN NHẤT ĐÃ LƯU*
────────────────────────
📱 Thiết bị: \`${deviceId}\`
${latest.latitude && latest.longitude ? `🌐 Tọa độ: \`${latest.latitude}, ${latest.longitude}\`\n🎯 Độ chính xác: ~${Math.round(latest.accuracy || 30)} m\n` : '📡 Bắt được trigger mạng\n'}🕒 Ghi nhận lúc: ${formatVietnamTime(latest.event_time)}
⏳ Cách đây: *${timeAgo(latest.event_time)}*
📡 Nguồn: ${getSourceLabel(latest.source)}
${gmaps ? `\n🔗 [Mở trên Google Maps](${gmaps})` : ''}`;

      ctx.replyWithMarkdown(replyText);
    });

    // Lệnh /today hoặc /route
    bot.command(['today', 'route'], async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const deviceId = args[0] || 'iphone_01';
      const todayStr = new Date().toISOString().split('T')[0];

      const routeData = getRouteByDate(deviceId, todayStr);

      if (!routeData.points || routeData.points.length === 0) {
        return ctx.reply(`📅 Hôm nay (${todayStr}) chưa có điểm di chuyển nào cho: ${deviceId}`);
      }

      const firstPoint = routeData.points[0];
      const lastPoint = routeData.points[routeData.points.length - 1];

      const msg = 
`🗺️ *LỘ TRÌNH HÔM NAY (${todayStr})*
────────────────────────
📱 Thiết bị: \`${deviceId}\`
📊 Điểm hợp lệ: *${routeData.total_valid_points} điểm* (Lọc từ ${routeData.total_raw_points})
📏 Quãng đường ước tính: *${routeData.total_distance_km} km*
🛑 Điểm dừng (>15p): *${routeData.stop_points ? routeData.stop_points.length : 0} điểm*
⏱️ Bắt đầu: ${formatVietnamTime(firstPoint.event_time)}
⏱️ Điểm cuối: ${formatVietnamTime(lastPoint.event_time)}

🔗 Mở Web Dashboard trên trình duyệt để xem bản đồ chi tiết.`;

      ctx.replyWithMarkdown(msg);
    });

    // Lệnh /status
    bot.command('status', async (ctx) => {
      const stats = getSystemStats();
      const devices = getAllDevices();

      let deviceText = '';
      devices.forEach(d => {
        deviceText += `\n• \`${d.device_id}\`: ${d.total_pings} pings (${timeAgo(d.last_seen)})`;
      });

      const msg = 
`📊 *THỐNG KÊ HỆ THỐNG*
────────────────────────
🗄️ Tổng số bản ghi vị trí: *${stats.total_locations.toLocaleString()}*
💾 Dung lượng SQLite: *${stats.db_size_mb} MB*
🗓️ Thời gian lưu trữ: *${stats.retention_days} ngày*
📱 Thiết bị (${devices.length}):${deviceText || ' Không có'}`;

      ctx.replyWithMarkdown(msg);
    });

    // Khởi chạy polling
    bot.launch().then(() => {
      isBotActive = true;
      console.log('[TelegramBot] 🚀 Telegram Bot đã kết nối thành công và đang lắng nghe!');
    }).catch(err => {
      console.error('[TelegramBot] Lỗi khởi động bot:', err.message);
    });

    // Đăng ký Event Listener lắng nghe khi có vị trí mới (Decoupled)
    locationEvents.on('location_recorded', (record) => {
      handleLocationRecordedEvent(record);
    });

    // Khởi động Timeout Worker
    startTimeoutWorker();

  } catch (e) {
    console.error('[TelegramBot] Lỗi cấu hình bot:', e.message);
  }
}

/**
 * Xử lý khi nhận sự kiện vị trí mới từ EventEmitter
 */
function handleLocationRecordedEvent(record) {
  if (!bot || !isBotActive) return;

  const { id, device_id, latitude, longitude, accuracy, source, event_time } = record;
  const now = Date.now();

  const waitingRequests = db.prepare(`
    SELECT id, chat_id 
    FROM locate_requests 
    WHERE device_id = ? AND status = 'waiting' AND expires_at >= ?
  `).all(device_id, now);

  if (waitingRequests.length === 0) return;

  console.log(`[TelegramBot] Phát hiện ${waitingRequests.length} yêu cầu đang chờ cho ${device_id}. Gửi thông báo ngay...`);

  const gmaps = latitude && longitude ? `https://maps.google.com/?q=${latitude},${longitude}` : '';
  const msg = 
`📍 *BẮT ĐƯỢC VỊ TRÍ MỚI!*
────────────────────────
📱 Thiết bị: \`${device_id}\`
${latitude && longitude ? `🌐 Tọa độ: \`${latitude}, ${longitude}\`\n🎯 Độ chính xác: ~${Math.round(accuracy || 30)} m\n` : ''}🕒 Ghi nhận: ${formatVietnamTime(event_time)}
📡 Nguồn: ${getSourceLabel(source)}
${gmaps ? `\n🔗 [Xem trên Google Maps](${gmaps})` : ''}`;

  for (const req of waitingRequests) {
    bot.telegram.sendMessage(req.chat_id, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    }).catch(err => console.error(`[TelegramBot] Lỗi gửi tin tới ${req.chat_id}:`, err.message));

    db.prepare("UPDATE locate_requests SET status = 'completed', completed_at = ?, location_id = ? WHERE id = ?")
      .run(now, id, req.id);
  }
}

/**
 * Worker kiểm tra timeout 30 phút
 */
function startTimeoutWorker() {
  setInterval(() => {
    if (!bot || !isBotActive) return;

    try {
      const now = Date.now();
      const expiredRequests = db.prepare(`
        SELECT id, device_id, chat_id, requested_at 
        FROM locate_requests 
        WHERE status = 'waiting' AND expires_at < ?
      `).all(now);

      for (const req of expiredRequests) {
        console.log(`[TelegramBot] Yêu cầu #${req.id} (${req.device_id}) đã hết hạn 30 phút. Gửi fallback...`);

        const latest = getLatestLocation(req.device_id);

        let fallbackMsg = '';
        if (latest && latest.latitude && latest.longitude) {
          const gmaps = `https://maps.google.com/?q=${latest.latitude},${latest.longitude}`;
          fallbackMsg = 
`⚠️ *HẾT THỜI GIAN CHỜ 30 PHÚT*
────────────────────────
Không bắt được tín hiệu vị trí mới từ \`${req.device_id}\` trong 30 phút qua.

📍 *Vị trí gần nhất đã lưu trong hệ thống:*
🌐 Tọa độ: \`${latest.latitude}, ${latest.longitude}\`
🎯 Độ chính xác: ~${Math.round(latest.accuracy || 30)} m
🕒 Ghi nhận lúc: ${formatVietnamTime(latest.event_time)}
⏳ Cách đây: *${timeAgo(latest.event_time)}*
📡 Nguồn: ${getSourceLabel(latest.source)}

🔗 [Mở trên Google Maps](${gmaps})`;
        } else {
          fallbackMsg = 
`⚠️ *HẾT THỜI GIAN CHỜ 30 PHÚT*
────────────────────────
Không bắt được tín hiệu vị trí mới nào từ \`${req.device_id}\` trong 30 phút qua và chưa có lịch sử vị trí.`;
        }

        bot.telegram.sendMessage(req.chat_id, fallbackMsg, {
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        }).catch(err => console.error(`[TelegramBot] Lỗi gửi fallback tới ${req.chat_id}:`, err.message));

        db.prepare("UPDATE locate_requests SET status = 'timeout' WHERE id = ?").run(req.id);
      }
    } catch (err) {
      console.error('[TelegramBot] Lỗi trong startTimeoutWorker:', err.message);
    }
  }, 15000);
}

module.exports = {
  initTelegramBot
};
