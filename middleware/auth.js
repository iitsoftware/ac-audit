const crypto = require('crypto');

const LOGIN_USER = 'Dani';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'audit2024';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSessionToken() {
  const expires = Date.now() + SESSION_MAX_AGE;
  const data = `${LOGIN_USER}:${expires}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return `${data}:${hmac}`;
}

function verifySessionToken(token) {
  if (!token) return false;
  const parts = token.split(':');
  if (parts.length !== 3) return false;
  const [user, expires, hmac] = parts;
  if (Date.now() > parseInt(expires, 10)) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${user}:${expires}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function authMiddleware(req, res, next) {
  // Allow static assets through
  if (req.path.startsWith('/style.css') || req.path.startsWith('/app.js')) return next();
  const cookies = parseCookies(req);
  if (verifySessionToken(cookies.session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.redirect('/login');
}

module.exports = {
  LOGIN_USER,
  LOGIN_PASSWORD,
  SESSION_MAX_AGE,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  authMiddleware,
};
