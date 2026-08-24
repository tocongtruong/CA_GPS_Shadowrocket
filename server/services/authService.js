const crypto = require('crypto');

function timingSafeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;

  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthorization(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(headerValue.slice(6), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch (error) {
    return null;
  }
}

function createDashboardAuth({ username, password, realm = 'iOS Location Lab' }) {
  return function dashboardAuth(req, res, next) {
    if (!username || !password) {
      return res.status(503).json({
        success: false,
        error: 'Dashboard authentication is not configured.'
      });
    }

    const credentials = parseBasicAuthorization(req.headers.authorization);
    const authorized = credentials
      && timingSafeStringEqual(credentials.username, username)
      && timingSafeStringEqual(credentials.password, password);

    if (authorized) return next();

    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    return res.status(401).send('Authentication required.');
  };
}

function createWebhookAuth(secret) {
  return function webhookAuth(req, res, next) {
    if (!secret) {
      return res.status(503).json({
        success: false,
        error: 'Collector authentication is not configured.'
      });
    }

    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    const apiKey = req.headers['x-api-key'];

    if (timingSafeStringEqual(bearerToken, secret) || timingSafeStringEqual(apiKey, secret)) {
      return next();
    }

    const signature = req.headers['x-signature'];
    const deviceId = req.headers['x-device-id'] || req.body?.device_id || '';
    const timestamp = req.headers['x-timestamp'];
    const nonce = req.headers['x-nonce'];

    if (signature && timestamp && nonce && /^[a-f0-9]{64}$/i.test(signature)) {
      const requestTime = Number(timestamp);
      if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 300000) {
        return res.status(401).json({ success: false, error: 'Request timestamp expired.' });
      }

      const payloadString = JSON.stringify(req.body || {});
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${deviceId}:${timestamp}:${nonce}:${payloadString}`)
        .digest('hex');

      if (timingSafeStringEqual(signature.toLowerCase(), expectedSignature)) return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Unauthorized collector request.'
    });
  };
}

module.exports = {
  timingSafeStringEqual,
  parseBasicAuthorization,
  createDashboardAuth,
  createWebhookAuth
};
