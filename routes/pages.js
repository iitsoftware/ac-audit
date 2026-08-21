const express = require('express');
const path = require('path');
const ejs = require('ejs');
const { stmts } = require('../db');
const { getSrbDefaultTopics } = require('../services/safety-defaults');

const router = express.Router();

// Helper: render a page inside layout
function renderPage(res, view, opts = {}) {
  const viewPath = path.join(__dirname, '..', 'views', `${view}.ejs`);
  ejs.renderFile(viewPath, opts, (err, body) => {
    if (err) return res.status(500).send(err.message);
    res.render('layout', { body, ...opts });
  });
}

// Die Navigation ist organisationsgeführt: Firma → Abteilung → Modul, und die
// Ebene steht in der URL statt in einer Tab-Leiste mit localStorage-State.
// Jede Route reicht die IDs ihrer Ebene als EJS-Local durch; die Seite schreibt
// sie in ein Hidden-Field und liest sie von dort — dasselbe Muster wie
// `srbDefaultTopics` → `#srb-default-topics` weiter unten.

// Der Einstieg sind die Firmenkacheln; ein globales Dashboard gibt es nicht mehr.
router.get('/', (req, res) => res.redirect('/companies'));

router.get('/companies', (req, res) => {
  renderPage(res, 'companies-list', {
    activePage: 'companies-list',
    pageScript: 'companies-list.js',
  });
});

router.get('/companies/:companyId', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).send('Firma nicht gefunden');
  // Aufgelöst statt roh durchgereicht: das Hidden-Field trägt damit die ID aus
  // der Datenbank und nie den ungeprüften Rohtext der URL.
  renderPage(res, 'departments-list', {
    activePage: 'departments-list',
    pageScript: 'departments-list.js',
    companyId: company.id,
  });
});

// Das Dashboard und die drei Moduldeeplinks hängen an einer Abteilung. Deren
// `companyId` steht **nicht** in der URL — die Abteilung ist eindeutig, und die
// Firma daraus ein Lookup: einmal hier statt einmal je Seite. Eine unbekannte
// Abteilung ist 404 und keine Seite, die eine erfundene ID in ihr Hidden-Field
// schreibt und danach leer nachlädt.
function renderDepartmentPage(res, view, departmentId, opts = {}) {
  const dept = stmts.getDepartment.get(departmentId);
  if (!dept) return res.status(404).send('Abteilung nicht gefunden');
  renderPage(res, view, {
    departmentId: dept.id,
    companyId: dept.company_id,
    ...opts,
  });
}

router.get('/departments/:departmentId', (req, res) => {
  renderDepartmentPage(res, 'dashboard', req.params.departmentId, {
    activePage: 'dashboard',
    pageScript: 'dashboard.js',
  });
});

router.get('/departments/:departmentId/audit', (req, res) => {
  renderDepartmentPage(res, 'companies', req.params.departmentId, {
    activePage: 'audit',
    pageScript: 'companies.js',
  });
});

router.get('/departments/:departmentId/change', (req, res) => {
  renderDepartmentPage(res, 'change', req.params.departmentId, {
    activePage: 'change',
    pageScript: 'change.js',
  });
});

// Die SRB-Standard-Themen kommen bewusst als EJS-Local und nicht über
// `GET /api/settings`: dieser Endpunkt liefert sämtliche Settings inklusive
// `smtp_pass` aus, was auf der Safety-Seite nichts zu suchen hat.
// Folge des serverseitigen Renderns: eine Änderung in den Einstellungen wird
// erst nach einem Reload der Safety-Seite sichtbar — so gewollt.
router.get('/departments/:departmentId/safety', (req, res) => {
  renderDepartmentPage(res, 'safety', req.params.departmentId, {
    activePage: 'safety',
    pageScript: 'safety.js',
    srbDefaultTopics: getSrbDefaultTopics(),
  });
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
