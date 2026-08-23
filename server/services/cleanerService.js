const cron = require('node-cron');
const { purgeOldData, checkpointWAL } = require('../database');

/**
 * Khởi động tiến trình dọn dẹp dữ liệu tự động
 */
function startRetentionCleaner() {
  const retentionDays = parseInt(process.env.RETENTION_DAYS, 10) || 30;

  console.log(`[CleanerService] Đã kích hoạt cơ chế Data Retention (${retentionDays} ngày, tỉa raw_payload sau 2 ngày).`);

  // Chạy ngay một lần khi server khởi động
  try {
    purgeOldData(retentionDays);
  } catch (err) {
    console.error('[CleanerService] Lỗi dọn dẹp lúc khởi động:', err.message);
  }

  // Lên lịch chạy mỗi ngày lúc 00:00:00 (nửa đêm)
  cron.schedule('0 0 * * *', () => {
    console.log(`[CleanerService] Đang thực hiện tác vụ dọn dẹp định kỳ (${retentionDays} ngày)...`);
    try {
      const deletedCount = purgeOldData(retentionDays);
      console.log(`[CleanerService] Dọn dẹp hoàn tất. Đã xóa ${deletedCount} bản ghi cũ.`);
    } catch (err) {
      console.error('[CleanerService] Lỗi trong quá trình dọn dẹp:', err.message);
    }
  });

  // Chạy WAL Checkpoint nhẹ nhàng mỗi 6 tiếng để giữ file WAL nhỏ gọn mà không khóa DB
  cron.schedule('0 */6 * * *', () => {
    checkpointWAL();
  });
}

module.exports = {
  startRetentionCleaner
};
