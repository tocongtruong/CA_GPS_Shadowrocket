const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;
const cnfPath = path.join(scriptDir, 'ca.cnf');
const keyPath = path.join(scriptDir, 'ca.key');
const crtPath = path.join(scriptDir, 'ca.crt');
const p12Path = path.join(scriptDir, 'ca.p12');

// Tìm đường dẫn openssl
let opensslBin = 'openssl';
const candidatePaths = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  'C:\\OpenSSL-Win64\\bin\\openssl.exe'
];

for (const p of candidatePaths) {
  try {
    execSync(`"${p}" version`, { stdio: 'ignore' });
    opensslBin = `"${p}"`;
    break;
  } catch (e) {}
}

console.log('==> 1. Dang kiem tra OpenSSL...');
try {
  const ver = execSync(`${opensslBin} version`, { encoding: 'utf-8' });
  console.log(`    OpenSSL tim thay: ${ver.trim()} tai ${opensslBin}`);
} catch (e) {
  console.error('Loi: Khong the thuc thi OpenSSL. Vui long kiem tra lai.');
  process.exit(1);
}

console.log('==> 2. Dang tao Private Key (RSA 2048-bit)...');
execSync(`${opensslBin} genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' });

console.log('==> 3. Dang tao chung chi Root CA (x509v3, 825 ngay)...');
execSync(`${opensslBin} req -x509 -new -nodes -key "${keyPath}" -sha256 -days 825 -out "${crtPath}" -config "${cnfPath}"`, { stdio: 'inherit' });

console.log('==> 4. Dang dong goi file PKCS#12 (ca.p12) cho Shadowrocket...');
execSync(`${opensslBin} pkcs12 -export -out "${p12Path}" -inkey "${keyPath}" -in "${crtPath}" -passout pass:`, { stdio: 'inherit' });

console.log('\n======================================================');
console.log(' [THANH CONG] DA TAO XONG BO CHUNG CHI CA:');
console.log(` 1. File cai vao iPhone       : ${crtPath}`);
console.log(` 2. File nap vao Shadowrocket : ${p12Path}`);
console.log(` 3. Private Key rieng         : ${keyPath}`);
console.log('======================================================\n');
