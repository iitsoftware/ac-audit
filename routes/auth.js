const express = require('express');
const {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  SESSION_MAX_AGE,
  LOGIN_PASSWORD,
} = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  const cookies = parseCookies(req);
  if (verifySessionToken(cookies.session)) return res.redirect('/home');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === LOGIN_PASSWORD) {
    const token = createSessionToken();
    res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}`);
    return res.redirect('/home');
  }
  res.render('login', { error: 'Falsches Passwort' });
});

router.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.redirect('/login');
});

module.exports = router;
