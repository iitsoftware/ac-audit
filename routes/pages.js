const express = require('express');
const path = require('path');
const ejs = require('ejs');

const router = express.Router();

// Helper: render a page inside layout
function renderPage(res, view, opts = {}) {
  const viewPath = path.join(__dirname, '..', 'views', `${view}.ejs`);
  ejs.renderFile(viewPath, opts, (err, body) => {
    if (err) return res.status(500).send(err.message);
    res.render('layout', { body, ...opts });
  });
}

router.get('/', (req, res) => res.redirect('/home'));

router.get('/home', (req, res) => {
  renderPage(res, 'home', { activePage: 'home', pageScript: 'home.js' });
});

router.get('/organization', (req, res) => {
  renderPage(res, 'organization', { activePage: 'organization', pageScript: 'organization.js' });
});

router.get('/companies', (req, res) => {
  renderPage(res, 'companies', { activePage: 'companies', pageScript: 'companies.js' });
});

router.get('/change', (req, res) => {
  renderPage(res, 'change', { activePage: 'change', pageScript: 'change.js' });
});

router.get('/settings', (req, res) => {
  renderPage(res, 'settings', { activePage: 'settings', pageScript: 'settings.js' });
});

router.get('/logs', (req, res) => {
  renderPage(res, 'logs', { activePage: 'logs', pageScript: 'logs.js' });
});

router.get('/trash', (req, res) => {
  renderPage(res, 'trash', { activePage: 'trash', pageScript: 'trash.js' });
});

module.exports = router;
