# Script tự động tạo chứng chỉ Root CA chuẩn Apple x509v3 trên Windows
$ErrorActionPreference = "Stop"

Write-Host "==> 1. Đang kiểm tra OpenSSL..." -ForegroundColor Cyan
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Host "Lỗi: Không tìm thấy lệnh 'openssl' trong PATH. Hãy cài OpenSSL hoặc Git for Windows." -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cnfPath = Join-Path $scriptDir "ca.cnf"
$keyPath = Join-Path $scriptDir "ca.key"
$crtPath = Join-Path $scriptDir "ca.crt"
$p12Path = Join-Path $scriptDir "ca.p12"

Write-Host "==> 2. Đang tạo Private Key (RSA 2048-bit)..." -ForegroundColor Cyan
& openssl genrsa -out $keyPath 2048

Write-Host "==> 3. Đang tạo chứng chỉ Root CA (thời hạn 825 ngày)..." -ForegroundColor Cyan
& openssl req -x509 -new -nodes -key $keyPath -sha256 -days 825 -out $crtPath -config $cnfPath

Write-Host "==> 4. Đang đóng gói file PKCS#12 (ca.p12) cho Shadowrocket..." -ForegroundColor Cyan
& openssl pkcs12 -export -out $p12Path -inkey $keyPath -in $crtPath -passout pass:

Write-Host "`n[THÀNH CÔNG] Đã tạo xong bộ chứng chỉ CA:" -ForegroundColor Green
Write-Host "- ca.crt : Cài vào iPhone (qua AirDrop / Safari) -> Bật Full Trust trong Cài đặt" -ForegroundColor Yellow
Write-Host "- ca.p12 : Nạp vào Shadowrocket -> HTTPS Decryption" -ForegroundColor Yellow
Write-Host "- ca.key : Khóa bảo mật riêng`n" -ForegroundColor Yellow
