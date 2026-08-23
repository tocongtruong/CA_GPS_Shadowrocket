# 🛰️ iOS Location Lab - Hệ Thống Định Vị Thụ Động & Lịch Trình Di Chuyển (30 Ngày)

Hệ thống bắt gói định vị Apple WLOC (`/clls/wloc`) từ iPhone thông qua **Shadowrocket + Custom Root CA**, lưu trữ dữ liệu vào **SQLite với cơ chế tự động dọn dẹp sau 30 ngày**, tích hợp **Telegram Bot (quản lý lệnh `/locate` chờ 30 phút)** và **Giao diện Bản đồ Web tua lại lịch trình di chuyển**.

> 💡 **Khép kín 100%**: Hoàn toàn không cần n8n hay dịch vụ trung gian phức tạp. Toàn bộ logic chạy trên 1 ứng dụng Node.js duy nhất.

---

## 📁 Cấu Trúc Dự Án

```
CA gps/
├── certs/
│   ├── ca.cnf                    # File cấu hình X509v3 chuẩn Apple
│   ├── generate-cert.ps1         # Script 1-click tạo CA trên Windows
│   └── generate-cert.sh          # Script 1-click tạo CA trên Linux/macOS
├── shadowrocket/
│   ├── location-watcher.sgmodule # Module nạp vào Shadowrocket
│   └── watcher.js                # Core JS bắt WLOC & bắn webhook async
├── server/
│   ├── package.json              # Express, better-sqlite3, telegraf, node-cron
│   ├── .env                      # File cấu hình PORT, Telegram Bot, Secret Token
│   ├── server.js                 # Entrypoint REST API & Webhook receiver
│   ├── database.js               # SQLite Database (WAL mode) & 30-Day Retention
│   ├── services/
│   │   ├── locationService.js    # Logic ghi nhận, truy vấn latest & lộ trình
│   │   ├── cleanerService.js     # Cron job tự động xóa dữ liệu > 30 ngày & VACUUM
│   │   ├── telegramService.js    # Telegram Bot Engine (/locate, /latest, /today)
│   │   └── wlocParser.js         # Giải mã Protobuf Apple WLOC bóc tách tọa độ
│   └── public/
│       ├── index.html            # Web Dashboard Bản đồ Leaflet
│       ├── style.css             # Giao diện Dark theme Glassmorphism
│       └── app.js                # Logic vẽ lộ trình & thanh tua Timeline
└── README.md                     # Tài liệu hướng dẫn thiết lập từ A-Z
```

---

## 🚀 Hướng Dẫn Cài Đặt Từng Bước

### BƯỚC 1: Sinh Bộ Chứng Chỉ CA Chuẩn iOS
Mở Terminal / PowerShell tại thư mục `certs/` và chạy:

- **Trên Windows (PowerShell):**
  ```powershell
  cd certs
  powershell -ExecutionPolicy Bypass -File .\generate-cert.ps1
  ```
- **Trên Linux / macOS (Bash):**
  ```bash
  cd certs
  chmod +x generate-cert.sh
  ./generate-cert.sh
  ```

Sau khi chạy xong, bạn sẽ có:
- `ca.crt`: Dùng cài đặt vào iPhone.
- `ca.p12`: Dùng nạp vào Shadowrocket (mật khẩu rỗng).
- `ca.key`: Khóa bí mật riêng của CA.

---

### BƯỚC 2: Cài Đặt Cert & Bật "Full Trust" Trên iPhone
1. Gửi file `ca.crt` qua **AirDrop** hoặc tải về bằng trình duyệt **Safari** trên iPhone.
2. Vào **Cài đặt (Settings)** $\rightarrow$ **Đã tải về hồ sơ (Profile Downloaded)** $\rightarrow$ Bấm **Cài đặt (Install)**.
3. ⚠️ **BẮT BUỘC (Rất quan trọng):** 
   - Vào **Cài đặt** $\rightarrow$ **Cài đặt chung (General)** $\rightarrow$ **Giới thiệu (About)**.
   - Cuộn xuống dưới cùng chọn **Cài đặt tin cậy chứng nhận (Certificate Trust Settings)**.
   - Tìm mục **Location Monitor Root CA** và gạt bật **Bật hoàn toàn tin cậy (Enable Full Trust)**.

---

### BƯỚC 3: Cấu Hình Shadowrocket
1. **Nạp chứng chỉ CA (`ca.p12`):**
   - Chuyển file `ca.p12` sang iPhone $\rightarrow$ Mở bằng Shadowrocket (hoặc vào mục *Cài đặt* $\rightarrow$ *Chứng chỉ* $\rightarrow$ *Nhập CA*).
   - Trong Shadowrocket, bật **Giải mã HTTPS (HTTPS Decryption)**.
2. **Cấu hình On-Demand (Tự động kết nối 24/7):**
   - Vào mục **Theo yêu cầu (On-Demand)** trong Shadowrocket.
   - Cấu hình:
     - **Hành động (Action)**: `Kết nối (Connect)`
     - **Mạng lưới (Network)**: `Any (Tất cả)`
     - **SSID / Domains / DNS**: `Để trống`
     - Bấm **Lưu**.
   - *Tác dụng: Shadowrocket sẽ tự động giữ kết nối VPN cả trên Wi-Fi và 4G/5G.*
3. **Nạp Module:**
   - Vào mục **Cấu hình (Config)** $\rightarrow$ **Mô-đun (Modules)** $\rightarrow$ Chọn file `shadowrocket/location-watcher.sgmodule` hoặc dán link online.
   - Sửa tham số `server=http://IP_SERVER_CỦA_BẠN:3000/api/location-event` trong file module.

---

### BƯỚC 4: Khởi Động Server Node.js
1. Cài đặt các thư viện cần thiết:
   ```bash
   cd server
   npm install
   ```
2. Cấu hình biến môi trường trong file `server/.env`:
   ```ini
   PORT=3000
   SECRET_TOKEN=my_secret_token_123
   RETENTION_DAYS=30
   DB_PATH=./data/locations.db

   # (Tùy chọn) Điền token bot lấy từ @BotFather trên Telegram
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
   TELEGRAM_ALLOWED_USERS=
   ```
3. Khởi chạy Server:
   ```bash
   npm start
   ```
   Server sẽ lắng nghe tại: `http://localhost:3000`.

---

## 🤖 Tính Năng Telegram Bot Tích Hợp

Khi cấu hình `TELEGRAM_BOT_TOKEN`, bạn có thể chat trực tiếp với Bot trên Telegram:

| Lệnh | Chức năng chi tiết |
| :--- | :--- |
| `/locate [device_id]` | **Yêu cầu vị trí**: Trả về ngay nếu có vị trí $<30$ giây. Nếu không, chuyển sang trạng thái chờ 30 phút. Ngay khi iPhone phát sinh request mạng, bot bắn thông báo vị trí tức thì! |
| `/latest [device_id]` | Lấy vị trí gần nhất trong database kèm thời gian đã trôi qua và link Google Maps. |
| `/today [device_id]` | Thống kê lịch trình hôm nay: Tổng số điểm, quãng đường ước tính (km), thời gian di chuyển. |
| `/status` | Thống kê số lượng bản ghi trong database, dung lượng file SQLite, danh sách thiết bị. |

---

## 🗺️ Giao Diện Web Dashboard

Truy cập `http://localhost:3000` trên trình duyệt:
- **📍 Live Tracking**: Marker phát sáng hiển thị tọa độ thời gian thực của thiết bị.
- **🛣️ Lộ Trình Di Chuyển**: Chọn ngày bất kỳ trong vòng 30 ngày để xem đường nối các điểm di chuyển.
- **🛑 Phát Hiện Điểm Dừng**: Tự động đánh dấu các vị trí dừng chân $>10$ phút kèm thời gian bắt đầu/kết thúc.
- **⏯️ Timeline Playback Slider**: Kéo thanh trượt thời gian hoặc bấm **Phát** để xem mô phỏng hành trình di chuyển trong ngày.

---

## 🛡️ Cơ Chế Tự Động Xóa Dữ Liệu 30 Ngày (Retention Policy)
- Chạy tự động vào **00:00:00 mỗi ngày**: Xóa tất cả các bản ghi cũ hơn `RETENTION_DAYS` (mặc định 30 ngày).
- Chạy `VACUUM` vào **03:00 sáng Chủ Nhật**: Nén và giải phóng dung lượng đĩa của SQLite.
- Đảm bảo database luôn mượt mà, dung lượng cực nhẹ và không bao giờ bị phình to.
