# iOS Location Lab

Dashboard riêng tư để nhận Apple WLOC từ Shadowrocket, giải mã tọa độ, lưu SQLite trong 30 ngày và xem vị trí/lộ trình trên bản đồ. Telegram Bot là tùy chọn.

## Yêu cầu

- Node.js 22.5 trở lên; khuyến nghị Node.js 24.
- Shadowrocket trên iPhone, HTTPS Decryption và chứng chỉ CA đã được tin cậy hoàn toàn.
- HTTPS nếu server được mở ra Internet. Không gửi Basic Auth hoặc collector token qua HTTP công khai.

## Cấu trúc chính

```text
CA gps/
├── certs/                         # CA dùng cho HTTPS Decryption
├── location-watcher.sgmodule      # Bản mẫu công khai, không chứa token
├── watcher.js                     # Script Shadowrocket bắt binary WLOC
├── server/
│   ├── public/                    # Dashboard responsive
│   ├── services/                  # Auth, parser, lưu trữ, Telegram
│   ├── test/                      # Test parser/auth/timezone/watcher
│   ├── .env.example
│   └── server.js
└── shadowrocket/
    └── location-watcher.sgmodule  # Bản mẫu dự phòng, không chứa token
```

## 1. Cài và chạy server

Từ thư mục gốc `CA gps`, cài dependency lần đầu và khởi động bằng:

```powershell
npm run setup
Copy-Item server/.env.example server/.env
npm run rotate-secrets
npm start
```

Các lệnh `npm start`, `npm test`, `npm run setup` và `npm run rotate-secrets` ở thư mục gốc sẽ tự chuyển vào thư mục `server`. Nếu `server/.env` đã tồn tại thì không cần sao chép hoặc xoay secret lại.

`rotate-secrets` tạo collector token và mật khẩu dashboard mạnh, nhưng không in chúng ra terminal. Mở cục bộ `server/.env` để xem tài khoản:

```ini
PORT=3000
SECRET_TOKEN=<token 64 ký tự do script tạo>
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=<mật khẩu riêng do script tạo>
RETENTION_DAYS=30
DB_PATH=./data/locations.db
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
```

Dashboard và toàn bộ API đọc/quản trị dùng Basic Auth. `/api/health`, chứng chỉ công khai `ca.crt` và script `watcher.js` không chứa dữ liệu riêng tư; `ca.p12` và module có token đều yêu cầu đăng nhập.

## 2. Tạo và cài chứng chỉ CA

Trên Windows:

```powershell
cd certs
powershell -ExecutionPolicy Bypass -File .\generate-cert.ps1
```

Trên Linux/macOS:

```bash
cd certs
chmod +x generate-cert.sh
./generate-cert.sh
```

Sau đó:

1. Cài `ca.crt` lên iPhone.
2. Vào **Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng nhận** và bật tin cậy hoàn toàn cho CA.
3. Nhập `ca.p12` vào Shadowrocket và bật **HTTPS Decryption**.

## 3. Cài module Shadowrocket riêng tư

Không nhập trực tiếp file `location-watcher.sgmodule` trong repository: đó chỉ là bản mẫu và cố ý không có secret.

1. Mở dashboard bằng địa chỉ mà iPhone truy cập được, ví dụ `https://gps.example.com` hoặc IP LAN khi đang thử nội bộ.
2. Đăng nhập bằng `DASHBOARD_USER` và `DASHBOARD_PASSWORD` trong `server/.env`.
3. Bấm **Tải module riêng tư**, hoặc mở `/download/location-watcher.sgmodule`.
4. Nhập file vừa tải vào Shadowrocket và bật module.
5. Nếu vừa chạy `npm run rotate-secrets`, hãy xóa/thay module cũ vì token cũ lập tức hết hiệu lực.

Module theo dõi cả request và response `/clls/wloc`, yêu cầu binary body, chuyển response về `identity` khi có thể và gửi body về server bằng Bearer token. Request Apple luôn được cho đi tiếp kể cả collector chậm hoặc lỗi.

## 4. Kiểm tra nhận vị trí

1. Bật VPN/On-Demand và HTTPS Decryption trong Shadowrocket.
2. Trên Safari của iPhone, mở `https://ca.gettoken.io.vn/api/module-probe`. Nếu module v3.1 đang bật, dashboard sẽ xuất hiện thiết bị với trạng thái **Module đã kết nối**.
3. Mở Apple Maps hoặc ứng dụng dùng Location Services để phát sinh WLOC.
4. Mở dashboard và bấm **Làm mới**.

Ý nghĩa trạng thái:

- **Vị trí mới**: server vừa nhận được tọa độ hợp lệ.
- **Module đã kết nối**: script và token hoạt động, nhưng chưa thấy WLOC chứa tọa độ.
- **WLOC thiếu tọa độ**: hook đã chạy nhưng response binary còn rỗng/không đúng định dạng. Hãy nhập lại module riêng tư, kiểm tra Full Trust, HTTPS Decryption và log `[LocationWatcher]` trong Shadowrocket.
- **Chưa có tín hiệu**: module chưa gọi được server; kiểm tra URL, VPN, DNS/HTTPS và token.
- **Dữ liệu cũ**: đang hiển thị tọa độ hợp lệ gần nhất, chưa có cập nhật mới.

Các bản ghi request WLOC có thể không có tọa độ; tọa độ thường nằm trong response. Dashboard phân biệt tín hiệu mới nhất với tọa độ hợp lệ gần nhất để không hiển thị trạng thái giả.

## Dashboard và dữ liệu

- Bản đồ và lộ trình theo ngày dùng múi giờ `Asia/Ho_Chi_Minh`.
- Giao diện responsive cho desktop/mobile, có trạng thái rỗng/lỗi và điều hướng bàn phím.
- Raw binary phục vụ chẩn đoán được tỉa sau 2 ngày; bản ghi vị trí bị xóa sau `RETENTION_DAYS`, mặc định 30 ngày.
- API quản trị không trả `raw_payload` ra dashboard.
- Chạy test bằng `npm test`; kiểm tra dependency bằng `npm audit`.

## Telegram Bot tùy chọn

Điền `TELEGRAM_BOT_TOKEN` và giới hạn `TELEGRAM_ALLOWED_USERS` trước khi dùng trên Internet.

| Lệnh | Chức năng |
| --- | --- |
| `/locate [device_id]` | Chờ tín hiệu vị trí mới cho thiết bị. |
| `/latest [device_id]` | Trả vị trí hợp lệ gần nhất. |
| `/today [device_id]` | Tóm tắt lộ trình trong ngày theo giờ Việt Nam. |
| `/status` | Thống kê database và thiết bị. |

## Bảo trì secret

Chạy lại lệnh sau khi nghi ngờ token/mật khẩu bị lộ:

```powershell
cd server
npm run rotate-secrets
```

Khởi động lại server, đăng nhập bằng mật khẩu mới và nhập lại module riêng tư trên iPhone. Không commit `.env`, `*.key`, `*.p12` hoặc database.
