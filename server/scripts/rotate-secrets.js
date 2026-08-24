const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

function setEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, 'm');
  if (expression.test(content)) return content.replace(expression, line);
  return `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`;
}

let updated = existing;
updated = setEnvValue(updated, 'SECRET_TOKEN', crypto.randomBytes(32).toString('hex'));
updated = setEnvValue(updated, 'DASHBOARD_USER', process.env.DASHBOARD_USER || 'admin');
updated = setEnvValue(updated, 'DASHBOARD_PASSWORD', crypto.randomBytes(24).toString('base64url'));

const temporaryPath = `${envPath}.tmp`;
fs.writeFileSync(temporaryPath, updated, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporaryPath, envPath);

console.log('[Security] Đã xoay collector token và dashboard password trong server/.env.');
console.log('[Security] Không in secret ra terminal. Mở server/.env cục bộ khi cần đăng nhập.');
