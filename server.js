const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ejs = require('ejs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { db, stmts, dataDir } = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;

// ── Auth config ──────────────────────────────────────────────
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
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
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

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Login routes (before auth middleware) ─────────────────────
app.get('/login', (req, res) => {
  const cookies = parseCookies(req);
  if (verifySessionToken(cookies.session)) return res.redirect('/home');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === LOGIN_PASSWORD) {
    const token = createSessionToken();
    res.setHeader('Set-Cookie', `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}`);
    return res.redirect('/home');
  }
  res.render('login', { error: 'Falsches Passwort' });
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.redirect('/login');
});

// ── Auth middleware ───────────────────────────────────────────
app.use((req, res, next) => {
  // Allow static assets through
  if (req.path.startsWith('/style.css') || req.path.startsWith('/app.js')) return next();
  const cookies = parseCookies(req);
  if (verifySessionToken(cookies.session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.redirect('/login');
});

// Helper: render a page inside layout
function renderPage(res, view, opts = {}) {
  const viewPath = path.join(__dirname, 'views', `${view}.ejs`);
  ejs.renderFile(viewPath, opts, (err, body) => {
    if (err) return res.status(500).send(err.message);
    res.render('layout', { body, ...opts });
  });
}

// ── Logging ─────────────────────────────────────────────────
function logAction(action, entityType, entityId, entityName, details = '', companyName = '', departmentName = '') {
  try { stmts.insertLog.run(action, entityType, entityId || '', entityName || '', companyName, departmentName, details); } catch {}
}

// Clean old log entries
stmts.deleteOldLogs.run();
setInterval(() => { try { stmts.deleteOldLogs.run(); } catch {} }, 24 * 60 * 60 * 1000);

// Clean expired trash items
try {
  const trashDays = (stmts.getSetting.get('trash_retention_days') || {}).value || '30';
  stmts.deleteExpiredTrashItems.run(trashDays);
} catch {}
setInterval(() => {
  try {
    const trashDays = (stmts.getSetting.get('trash_retention_days') || {}).value || '30';
    stmts.deleteExpiredTrashItems.run(trashDays);
  } catch {}
}, 24 * 60 * 60 * 1000);

// ── Trash: Snapshot & Restore helpers ───────────────────────

function snapshotCapItem(capId) {
  const cap = db.prepare('SELECT * FROM cap_item WHERE id = ?').get(capId);
  if (!cap) return null;
  const evidenceFiles = db.prepare('SELECT id, cap_item_id, filename, mime_type, data, created_at FROM cap_evidence_file WHERE cap_item_id = ?').all(capId);
  cap.evidence_files = evidenceFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
  const fiveWhy = db.prepare('SELECT * FROM five_why WHERE cap_item_id = ?').get(capId);
  cap.five_why = fiveWhy || null;
  return cap;
}

function snapshotAuditPlanLine(lineId) {
  const line = db.prepare(`SELECT * FROM audit_plan_line WHERE id = ?`).get(lineId);
  if (!line) return null;
  const items = db.prepare('SELECT * FROM audit_checklist_item WHERE audit_plan_line_id = ? ORDER BY section, sort_order').all(lineId);
  line.checklist_items = items.map(item => {
    const checkEvFiles = db.prepare('SELECT id, checklist_item_id, filename, mime_type, data, created_at FROM checklist_evidence_file WHERE checklist_item_id = ?').all(item.id);
    item.evidence_files = checkEvFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
    const capItem = db.prepare('SELECT * FROM cap_item WHERE checklist_item_id = ?').get(item.id);
    if (capItem) {
      const capEvFiles = db.prepare('SELECT id, cap_item_id, filename, mime_type, data, created_at FROM cap_evidence_file WHERE cap_item_id = ?').all(capItem.id);
      capItem.evidence_files = capEvFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
      capItem.five_why = db.prepare('SELECT * FROM five_why WHERE cap_item_id = ?').get(capItem.id) || null;
    }
    item.cap_item = capItem || null;
    return item;
  });
  return line;
}

function snapshotAuditPlan(planId) {
  const plan = db.prepare('SELECT * FROM audit_plan WHERE id = ?').get(planId);
  if (!plan) return null;
  const lines = db.prepare('SELECT id FROM audit_plan_line WHERE audit_plan_id = ?').all(planId);
  plan.lines = lines.map(l => snapshotAuditPlanLine(l.id));
  return plan;
}

function restoreCapItem(cap) {
  db.prepare(
    `INSERT INTO cap_item (id, checklist_item_id, deadline, responsible_person, root_cause, corrective_action, preventive_action, status, completion_date, evidence, notified_at, source, source_ref_id, department_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(cap.id, cap.checklist_item_id, cap.deadline, cap.responsible_person, cap.root_cause, cap.corrective_action, cap.preventive_action, cap.status, cap.completion_date, cap.evidence, cap.notified_at, cap.source || 'audit', cap.source_ref_id || null, cap.department_id || null, cap.created_at, cap.updated_at);
  if (cap.evidence_files) {
    for (const f of cap.evidence_files) {
      db.prepare('INSERT INTO cap_evidence_file (id, cap_item_id, filename, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.id, f.cap_item_id, f.filename, f.mime_type, f.data ? Buffer.from(f.data, 'base64') : null, f.created_at);
    }
  }
  if (cap.five_why) {
    const fw = cap.five_why;
    db.prepare('INSERT INTO five_why (id, cap_item_id, why1, why2, why3, why4, why5, root_cause, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(fw.id, fw.cap_item_id, fw.why1, fw.why2, fw.why3, fw.why4, fw.why5, fw.root_cause, fw.created_at, fw.updated_at);
  }
}

function restoreChecklistItem(item) {
  db.prepare(
    `INSERT INTO audit_checklist_item (id, audit_plan_line_id, section, sort_order, regulation_ref, compliance_check, evaluation, auditor_comment, document_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(item.id, item.audit_plan_line_id, item.section, item.sort_order, item.regulation_ref, item.compliance_check, item.evaluation, item.auditor_comment, item.document_ref, item.created_at, item.updated_at);
  if (item.evidence_files) {
    for (const f of item.evidence_files) {
      db.prepare('INSERT INTO checklist_evidence_file (id, checklist_item_id, filename, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(f.id, f.checklist_item_id, f.filename, f.mime_type, f.data ? Buffer.from(f.data, 'base64') : null, f.created_at);
    }
  }
  if (item.cap_item) {
    restoreCapItem(item.cap_item);
  }
}

function restoreAuditPlanLine(line) {
  db.prepare(
    `INSERT INTO audit_plan_line (id, audit_plan_id, sort_order, subject, regulations, location, planned_window, performed_date, signature, audit_no, audit_subject, audit_title, auditor_team, auditee, audit_start_date, audit_end_date, audit_location, document_ref, document_iss_rev, document_rev_date, recommendation, audit_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(line.id, line.audit_plan_id, line.sort_order, line.subject, line.regulations, line.location, line.planned_window, line.performed_date, line.signature, line.audit_no, line.audit_subject, line.audit_title, line.auditor_team, line.auditee, line.audit_start_date, line.audit_end_date, line.audit_location, line.document_ref, line.document_iss_rev, line.document_rev_date, line.recommendation, line.audit_status, line.created_at, line.updated_at);
  if (line.checklist_items) {
    for (const item of line.checklist_items) {
      restoreChecklistItem(item);
    }
  }
}

function restoreAuditPlan(plan) {
  db.prepare(
    `INSERT INTO audit_plan (id, department_id, name, year, status, revision, approved_by, approved_at, submitted_to, submitted_planned_at, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(plan.id, plan.department_id, plan.name || '', plan.year, plan.status, plan.revision, plan.approved_by, plan.approved_at, plan.submitted_to, plan.submitted_planned_at, plan.submitted_at, plan.created_at, plan.updated_at);
  if (plan.lines) {
    for (const line of plan.lines) {
      restoreAuditPlanLine(line);
    }
  }
}

// ── Pages ───────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/home'));

app.get('/home', (req, res) => {
  renderPage(res, 'home', { activePage: 'home', pageScript: 'home.js' });
});

app.get('/organization', (req, res) => {
  renderPage(res, 'organization', { activePage: 'organization', pageScript: 'organization.js' });
});

app.get('/companies', (req, res) => {
  renderPage(res, 'companies', { activePage: 'companies', pageScript: 'companies.js' });
});

app.get('/change', (req, res) => {
  renderPage(res, 'change', { activePage: 'change', pageScript: 'change.js' });
});

app.get('/settings', (req, res) => {
  renderPage(res, 'settings', { activePage: 'settings', pageScript: 'settings.js' });
});

// ── API: Home Stats ───────────────────────────────────────────
app.get('/api/home/stats', (req, res) => {
  try {
    const openCount = stmts.getCapStatsOpen.get().cnt;
    const overdueCount = stmts.getCapStatsOverdue.get().cnt;
    const totalAudits = stmts.getTotalAudits.get().cnt;
    const openChanges = stmts.getOpenChangeRequests.get().cnt;
    const totalChanges = stmts.getTotalChangeRequests.get().cnt;
    const openTasks = db.prepare(`SELECT COUNT(*) AS cnt FROM change_task WHERE (completion_date IS NULL OR completion_date = '')`).get().cnt;
    const totalTasks = db.prepare('SELECT COUNT(*) AS cnt FROM change_task').get().cnt;

    // Build enriched CAP items list via multi-query approach
    const openCaps = stmts.getOpenCapItems.all();
    const capItems = [];

    if (openCaps.length > 0) {
      // Step 2: Get checklist items
      const checklistItemIds = [...new Set(openCaps.map(c => c.checklist_item_id))];
      const checklistItems = db.prepare(
        `SELECT id, audit_plan_line_id, evaluation, compliance_check, regulation_ref
         FROM audit_checklist_item WHERE id IN (${checklistItemIds.map(() => '?').join(',')})`
      ).all(...checklistItemIds);
      const ciMap = Object.fromEntries(checklistItems.map(ci => [ci.id, ci]));

      // Step 3: Get plan lines
      const planLineIds = [...new Set(checklistItems.map(ci => ci.audit_plan_line_id))];
      const planLines = planLineIds.length > 0 ? db.prepare(
        `SELECT id, audit_plan_id, audit_no, subject
         FROM audit_plan_line WHERE id IN (${planLineIds.map(() => '?').join(',')})`
      ).all(...planLineIds) : [];
      const plMap = Object.fromEntries(planLines.map(pl => [pl.id, pl]));

      // Step 4: Get plans
      const planIds = [...new Set(planLines.map(pl => pl.audit_plan_id))];
      const plans = planIds.length > 0 ? db.prepare(
        `SELECT id, department_id, year
         FROM audit_plan WHERE id IN (${planIds.map(() => '?').join(',')})`
      ).all(...planIds) : [];
      const apMap = Object.fromEntries(plans.map(p => [p.id, p]));

      // Step 5: Get departments
      const deptIds = [...new Set(plans.map(p => p.department_id))];
      const depts = deptIds.length > 0 ? db.prepare(
        `SELECT id, company_id, name
         FROM department WHERE id IN (${deptIds.map(() => '?').join(',')})`
      ).all(...deptIds) : [];
      const dMap = Object.fromEntries(depts.map(d => [d.id, d]));

      // Step 6: Get companies
      const companyIds = [...new Set(depts.map(d => d.company_id))];
      const companies = companyIds.length > 0 ? db.prepare(
        `SELECT id, name
         FROM company WHERE id IN (${companyIds.map(() => '?').join(',')})`
      ).all(...companyIds) : [];
      const coMap = Object.fromEntries(companies.map(c => [c.id, c]));

      // Step 7: Merge
      const today = new Date().toISOString().slice(0, 10);
      for (const cap of openCaps) {
        const ci = ciMap[cap.checklist_item_id];
        if (!ci) continue;
        const pl = plMap[ci.audit_plan_line_id];
        if (!pl) continue;
        const ap = apMap[pl.audit_plan_id];
        if (!ap) continue;
        const dept = dMap[ap.department_id];
        if (!dept) continue;
        const co = coMap[dept.company_id];
        if (!co) continue;

        const isOverdue = cap.deadline && cap.deadline !== '' && cap.deadline < today;
        capItems.push({
          id: cap.id,
          companyId: co.id,
          companyName: co.name,
          departmentId: dept.id,
          departmentName: dept.name,
          auditPlanId: ap.id,
          auditPlanYear: ap.year,
          auditNo: pl.audit_no,
          auditSubject: pl.subject,
          evaluation: ci.evaluation,
          description: ci.compliance_check,
          deadline: cap.deadline,
          status: isOverdue ? 'OVERDUE' : 'OPEN',
          isOverdue,
          source: cap.source || 'audit',
        });
      }

      // Sort: overdue first, then by deadline ASC
      capItems.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return (a.deadline || '').localeCompare(b.deadline || '');
      });
    }

    res.json({
      modules: {
        audit: {
          openCaps: openCount,
          overdueCaps: overdueCount,
          totalAudits,
        },
        change: {
          openChanges,
          totalChanges,
          openTasks,
          totalTasks,
        },
      },
      capItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Settings ──────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const rows = stmts.getAllSettings.all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    stmts.upsertSetting.run(key, String(value || ''));
  }
  // Auto-create backup directory if path was set
  if (req.body.backup_path && req.body.backup_path.trim()) {
    try { fs.mkdirSync(req.body.backup_path.trim(), { recursive: true }); }
    catch (e) { return res.status(400).json({ error: `Verzeichnis konnte nicht erstellt werden: ${e.message}` }); }
  }
  res.json({ ok: true });
});

app.post('/api/settings/test-email', (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });

  const nodemailer = require('nodemailer');
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });

  const host = s.smtp_host;
  const port = parseInt(s.smtp_port) || 587;
  const user = s.smtp_user;
  const pass = s.smtp_pass;
  const auth = s.smtp_auth !== 'false';

  if (!host || !user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: auth ? { user, pass } : undefined,
  });

  transporter.sendMail({
    from: user,
    to,
    subject: 'AC Audit – Test E-Mail',
    text: 'Diese E-Mail wurde als Test aus AC Audit gesendet.',
  }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    logAction('Test-E-Mail gesendet', 'settings', '', '', to);
    res.json({ ok: true });
  });
});

app.post('/api/settings/notify-test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Test E-Mail-Adresse erforderlich' });

    const rows2 = stmts.getAllSettings.all();
    const s2 = {};
    rows2.forEach(r => { s2[r.key] = r.value; });
    if (!s2.smtp_host || !s2.smtp_user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

    const cfg = getNotifySettings();
    // For test: include ALL due items (also already notified)
    const items = db.prepare(
      `SELECT c.id, c.deadline, c.responsible_person,
              ci.regulation_ref, ci.evaluation,
              pl.subject AS audit_subject, pl.audit_no,
              ap.name AS plan_name, ap.year AS plan_year,
              d.id AS department_id, d.name AS department_name,
              co.id AS company_id, co.name AS company_name
       FROM cap_item c
       JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
       JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
       JOIN audit_plan ap ON ap.id = pl.audit_plan_id
       JOIN department d ON d.id = ap.department_id
       JOIN company co ON co.id = d.company_id
       WHERE (c.completion_date IS NULL OR c.completion_date = '')
         AND c.deadline IS NOT NULL AND c.deadline != ''
         AND c.deadline <= date('now', '+' || ? || ' days')
       ORDER BY c.deadline ASC`
    ).all(cfg.daysBefore);
    if (items.length === 0) return res.status(400).json({ error: 'Keine fälligen oder überfälligen CAPs gefunden' });

    const nodemailer = require('nodemailer');
    const host = s2.smtp_host;
    const port = parseInt(s2.smtp_port) || 587;
    const auth = s2.smtp_auth !== 'false';
    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: auth ? { user: s2.smtp_user, pass: s2.smtp_pass } : undefined,
    });

    const overdue = items.filter(i => i.deadline < new Date().toISOString().slice(0, 10));
    const upcoming = items.filter(i => i.deadline >= new Date().toISOString().slice(0, 10));
    const subject = `AC Audit [TEST] – ${overdue.length} überfällig, ${upcoming.length} bald fällig`;

    await transporter.sendMail({
      from: s2.smtp_user,
      to,
      subject,
      html: buildNotifyHtml(items),
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: Backup ─────────────────────────────────────────────

// ── CAP Deadline Defaults ────────────────────────────────────
function getCapDeadlineDays() {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    O: parseInt(s.cap_deadline_O) || 180,
    L1: parseInt(s.cap_deadline_L1) || 5,
    L2: parseInt(s.cap_deadline_L2) || 60,
    L3: parseInt(s.cap_deadline_L3) || 90,
  };
}

function calcCapDeadline(evaluation, performedDate) {
  if (!performedDate || !evaluation) return null;
  const days = getCapDeadlineDays();
  const d = days[evaluation];
  if (d === undefined) return null;
  const base = new Date(performedDate);
  if (isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + d);
  return base.toISOString().slice(0, 10);
}

const defaultBackupPath = process.env.BACKUP_PATH || path.join(dataDir, 'backups');

function getBackupSettings() {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    path: process.env.BACKUP_PATH || s.backup_path || defaultBackupPath,
    time: s.backup_time || '02:00',
    days: s.backup_days || 'mo,tu,we,th,fr',
    maxBackups: parseInt(s.backup_max) || 10,
  };
}

async function performBackup() {
  const cfg = getBackupSettings();
  if (!cfg.path) return { error: 'Kein Backup-Pfad konfiguriert' };

  const backupDir = cfg.path;
  if (!fs.existsSync(backupDir)) {
    try { fs.mkdirSync(backupDir, { recursive: true }); }
    catch (e) { return { error: `Verzeichnis konnte nicht erstellt werden: ${e.message}` }; }
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `acaudit_${ts}.db`;
  const dest = path.join(backupDir, filename);

  try {
    await db.backup(dest);
  } catch (e) {
    return { error: `Backup fehlgeschlagen: ${e.message}` };
  }

  // Rolling: delete oldest if over max
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('acaudit_') && f.endsWith('.db'))
      .sort();
    while (files.length > cfg.maxBackups) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(backupDir, oldest));
    }
  } catch { /* ignore cleanup errors */ }

  return { ok: true, filename };
}

app.post('/api/backup/now', async (req, res) => {
  try {
    const result = await performBackup();
    if (result.error) return res.status(500).json(result);
    logAction('Backup erstellt', 'backup', '', result.filename);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/backup/list', (req, res) => {
  const cfg = getBackupSettings();
  if (!cfg.path || !fs.existsSync(cfg.path)) return res.json([]);
  try {
    const files = fs.readdirSync(cfg.path)
      .filter(f => f.startsWith('acaudit_') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => {
        const stat = fs.statSync(path.join(cfg.path, f));
        return { filename: f, size: stat.size, created: stat.mtime.toISOString() };
      });
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Backup Scheduler ────────────────────────────────────────
let lastBackupDbMtime = null;

setInterval(async () => {
  try {
    const cfg = getBackupSettings();
    if (!cfg.path) return;

    const now = new Date();
    const dayMap = { 0: 'su', 1: 'mo', 2: 'tu', 3: 'we', 4: 'th', 5: 'fr', 6: 'sa' };
    const today = dayMap[now.getDay()];
    const activeDays = cfg.days.split(',').map(d => d.trim().toLowerCase());
    if (!activeDays.includes(today)) return;

    const [hh, mm] = cfg.time.split(':').map(Number);
    if (now.getHours() !== hh || now.getMinutes() !== mm) return;

    // Check if DB changed since last backup
    const dbPath = path.join(dataDir, 'acaudit.db');
    const dbMtime = fs.statSync(dbPath).mtimeMs;
    if (lastBackupDbMtime !== null && dbMtime <= lastBackupDbMtime) return;

    const result = await performBackup();
    if (result.ok) {
      lastBackupDbMtime = dbMtime;
      console.log(`[Backup] ${result.filename}`);
    } else {
      console.error(`[Backup] ${result.error}`);
    }
  } catch (e) {
    console.error('[Backup] Scheduler error:', e.message);
  }
}, 60000); // check every minute

// ── Notification Scheduler ──────────────────────────────────

function getNotifySettings() {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    enabled: s.notify_enabled === 'true',
    repeat: s.notify_repeat === 'true',
    daysBefore: parseInt(s.notify_days_before) || 7,
    time: s.notify_time || '08:00',
    days: s.notify_days || 'mo,tu,we,th,fr',
  };
}

function buildNotifyHtml(items) {
  const overdue = items.filter(i => i.deadline < new Date().toISOString().slice(0, 10));
  const upcoming = items.filter(i => i.deadline >= new Date().toISOString().slice(0, 10));

  let html = '<h2 style="font-family:sans-serif;color:#1a5276">AC Audit – CAP Benachrichtigung</h2>';

  if (overdue.length > 0) {
    html += '<h3 style="font-family:sans-serif;color:#c0392b">Überfällige Corrective Actions</h3>';
    html += buildNotifyTable(overdue, true);
  }
  if (upcoming.length > 0) {
    html += '<h3 style="font-family:sans-serif;color:#e67e22">Bald fällige Corrective Actions</h3>';
    html += buildNotifyTable(upcoming, false);
  }

  html += '<p style="font-family:sans-serif;font-size:12px;color:#888;margin-top:24px">Diese E-Mail wurde automatisch von AC Audit gesendet.</p>';
  return html;
}

function buildNotifyTable(items, isOverdue) {
  const color = isOverdue ? '#c0392b' : '#e67e22';
  let t = `<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;margin-bottom:16px">
    <tr style="background:${color};color:#fff">
      <th style="padding:6px 10px;text-align:left">Fälligkeit</th>
      <th style="padding:6px 10px;text-align:left">Firma</th>
      <th style="padding:6px 10px;text-align:left">Abteilung</th>
      <th style="padding:6px 10px;text-align:left">Auditplan</th>
      <th style="padding:6px 10px;text-align:left">Thema</th>
      <th style="padding:6px 10px;text-align:left">Bewertung</th>
      <th style="padding:6px 10px;text-align:left">Verantwortlich</th>
    </tr>`;
  items.forEach((r, i) => {
    const bg = i % 2 === 0 ? '#f9f9f9' : '#fff';
    t += `<tr style="background:${bg}">
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.deadline}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.company_name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.department_name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.plan_name} ${r.plan_year}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.audit_subject}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.evaluation}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #ddd">${r.responsible_person || '–'}</td>
    </tr>`;
  });
  t += '</table>';
  return t;
}

async function sendNotification() {
  const cfg = getNotifySettings();
  if (!cfg.enabled) return;

  // If repeat: include already notified items; otherwise only unnotified
  const query = cfg.repeat
    ? `SELECT c.id, c.deadline, c.responsible_person,
              ci.regulation_ref, ci.evaluation,
              pl.subject AS audit_subject, pl.audit_no,
              ap.name AS plan_name, ap.year AS plan_year,
              d.id AS department_id, d.name AS department_name,
              co.id AS company_id, co.name AS company_name
       FROM cap_item c
       JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
       JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
       JOIN audit_plan ap ON ap.id = pl.audit_plan_id
       JOIN department d ON d.id = ap.department_id
       JOIN company co ON co.id = d.company_id
       WHERE (c.completion_date IS NULL OR c.completion_date = '')
         AND c.deadline IS NOT NULL AND c.deadline != ''
         AND c.deadline <= date('now', '+' || ? || ' days')
       ORDER BY c.deadline ASC`
    : null;
  const items = cfg.repeat
    ? db.prepare(query).all(cfg.daysBefore)
    : stmts.getCapItemsDue.all(cfg.daysBefore);
  if (items.length === 0) return;

  const nodemailer = require('nodemailer');
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });

  const host = s.smtp_host;
  const port = parseInt(s.smtp_port) || 587;
  const user = s.smtp_user;
  const pass = s.smtp_pass;
  const auth = s.smtp_auth !== 'false';

  if (!host || !user) return;

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: auth ? { user, pass } : undefined,
  });

  // Group items by department and send to each QM
  const byDept = {};
  for (const item of items) {
    if (!byDept[item.department_id]) byDept[item.department_id] = [];
    byDept[item.department_id].push(item);
  }

  let sent = 0;
  for (const [deptId, deptItems] of Object.entries(byDept)) {
    const qm = db.prepare(
      `SELECT p.email, p.first_name, p.last_name FROM person p
       WHERE p.department_id = ? AND p.role = 'QM' AND p.email IS NOT NULL AND p.email != ''`
    ).get(deptId);
    if (!qm) continue;

    const overdue = deptItems.filter(i => i.deadline < new Date().toISOString().slice(0, 10));
    const upcoming = deptItems.filter(i => i.deadline >= new Date().toISOString().slice(0, 10));
    const subject = `AC Audit – ${overdue.length} überfällig, ${upcoming.length} bald fällig (${deptItems[0].department_name})`;

    await transporter.sendMail({
      from: user,
      to: qm.email,
      subject,
      html: buildNotifyHtml(deptItems),
    });

    // Mark CAPs as notified (only if not repeating)
    if (!cfg.repeat) {
      const markNotified = db.prepare(`UPDATE cap_item SET notified_at = datetime('now') WHERE id = ?`);
      for (const item of deptItems) markNotified.run(item.id);
    }

    sent++;
    console.log(`[Notify] E-Mail gesendet an ${qm.email} (${deptItems[0].department_name}): ${deptItems.length} CAP(s)`);
  }

  return sent;
}

setInterval(async () => {
  try {
    const cfg = getNotifySettings();
    if (!cfg.enabled) return;

    const now = new Date();
    const dayMap = { 0: 'su', 1: 'mo', 2: 'tu', 3: 'we', 4: 'th', 5: 'fr', 6: 'sa' };
    const today = dayMap[now.getDay()];
    const activeDays = cfg.days.split(',').map(d => d.trim().toLowerCase());
    if (!activeDays.includes(today)) return;

    const [hh, mm] = cfg.time.split(':').map(Number);
    if (now.getHours() !== hh || now.getMinutes() !== mm) return;

    await sendNotification();
  } catch (e) {
    console.error('[Notify] Scheduler error:', e.message);
  }
}, 60000); // check every minute

// ── API: Companies ──────────────────────────────────────────

app.get('/api/companies', (req, res) => {
  const rows = stmts.getAllCompanies.all();
  rows.forEach(r => {
    const logoRow = stmts.getCompanyLogo.get(r.id);
    r.has_logo = !!(logoRow && logoRow.logo);
  });
  res.json(rows);
});

app.get('/api/companies/:id', (req, res) => {
  const row = stmts.getCompany.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  const logoRow = stmts.getCompanyLogo.get(req.params.id);
  row.has_logo = !!(logoRow && logoRow.logo);
  res.json(row);
});

app.post('/api/companies', (req, res) => {
  const { name, street, postal_code, city, phone, fax, logo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  stmts.createCompany.run(id, name.trim(), street || '', postal_code || '', city || '', phone || '', fax || '', logoBuf);
  logAction('Firma erstellt', 'company', id, name.trim(), '', name.trim());
  const created = stmts.getCompany.get(id);
  created.has_logo = !!logoBuf;
  res.status(201).json(created);
});

app.put('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { name, street, postal_code, city, phone, fax } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateCompany.run(name.trim(), street || '', postal_code || '', city || '', phone || '', fax || '', req.params.id);
  logAction('Firma aktualisiert', 'company', req.params.id, name.trim(), '', name.trim());
  const updated = stmts.getCompany.get(req.params.id);
  const logoRow = stmts.getCompanyLogo.get(req.params.id);
  updated.has_logo = !!(logoRow && logoRow.logo);
  res.json(updated);
});

app.delete('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { cnt } = stmts.countAuditPlansByCompany.get(req.params.id);
  if (cnt > 0) return res.status(409).json({ error: 'Firma kann nicht gelöscht werden, da Auditpläne vorhanden sind' });
  stmts.deleteCompany.run(req.params.id);
  logAction('Firma gelöscht', 'company', req.params.id, existing.name, '', existing.name);
  res.status(204).end();
});

app.get('/api/companies/:id/logo', (req, res) => {
  const row = stmts.getCompanyLogo.get(req.params.id);
  if (!row || !row.logo) return res.status(404).json({ error: 'No logo' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.logo);
});

app.put('/api/companies/:id/logo', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { logo } = req.body;
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  stmts.updateCompanyLogo.run(logoBuf, req.params.id);
  res.json({ ok: true });
});

// ── API: Departments ────────────────────────────────────────

app.get('/api/companies/:companyId/departments', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(stmts.getDepartmentsByCompany.all(req.params.companyId));
});

app.post('/api/companies/:companyId/departments', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const { name, easa_permission_number, regulation, authority_salutation, authority_name, authority_email, initial_approval_email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  stmts.createDepartment.run(id, req.params.companyId, name.trim(), easa_permission_number || '', regulation || '', authority_salutation || '', authority_name || '', authority_email || '', initial_approval_email || '');
  logAction('Abteilung erstellt', 'department', id, name.trim(), '', company.name, name.trim());
  res.status(201).json(stmts.getDepartment.get(id));
});

app.put('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(existing.company_id);
  const { name, easa_permission_number, regulation, authority_salutation, authority_name, authority_email, initial_approval_email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateDepartment.run(name.trim(), easa_permission_number || '', regulation || '', authority_salutation || '', authority_name || '', authority_email || '', initial_approval_email || '', req.params.id);
  logAction('Abteilung aktualisiert', 'department', req.params.id, name.trim(), '', company ? company.name : '', name.trim());
  res.json(stmts.getDepartment.get(req.params.id));
});

app.delete('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(existing.company_id);
  stmts.deleteDepartment.run(req.params.id);
  logAction('Abteilung gelöscht', 'department', req.params.id, existing.name, '', company ? company.name : '', existing.name);
  res.status(204).end();
});

app.patch('/api/companies/:companyId/departments/reorder', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const { order } = req.body; // array of department IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
  order.forEach((id, idx) => {
    stmts.updateDepartmentSortOrder.run(idx, id);
  });
  res.json(stmts.getDepartmentsByCompany.all(req.params.companyId));
});

// ── API: Audit Plans ────────────────────────────────────────

app.get('/api/departments/:departmentId/audit-plans', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const plans = stmts.getAuditPlansByDepartment.all(req.params.departmentId);
  const progress = stmts.getAuditPlanProgress.all(req.params.departmentId);
  const progressMap = {};
  for (const p of progress) progressMap[p.audit_plan_id] = p;
  for (const plan of plans) {
    const p = progressMap[plan.id];
    plan.audit_total = p ? p.total : 0;
    plan.audit_done = p ? p.done : 0;
  }
  res.json(plans);
});

// Get all audit plans (for template selection)
app.get('/api/audit-plans/all', (req, res) => {
  res.json(stmts.getAllAuditPlans.all());
});

app.get('/api/audit-plans/:id', (req, res) => {
  const row = stmts.getAuditPlan.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Audit plan not found' });
  res.json(row);
});

app.post('/api/departments/:departmentId/audit-plans', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { year, plan_type } = req.body;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Year is required' });
  const id = uuidv4();
  const pType = plan_type === 'AUTHORITY' ? 'AUTHORITY' : 'AUDIT';
  stmts.createAuditPlan.run(id, req.params.departmentId, year, 'ENTWURF', 0, pType);
  res.status(201).json(stmts.getAuditPlan.get(id));
});

app.put('/api/audit-plans/:id', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { year } = req.body;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Year is required' });
  stmts.updateAuditPlan.run(year, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

const VALID_STATUSES = ['ARCHIV', 'ENTWURF', 'AKTIV'];

app.patch('/api/audit-plans/:id/status', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (existing.status === 'ARCHIV') {
    return res.status(400).json({ error: 'ARCHIV plans cannot be changed' });
  }
  if (status === 'AKTIV' && existing.status === 'ENTWURF') {
    // Archive any currently active plan in the same department
    stmts.archiveActiveByDepartment.run(existing.department_id);
  }
  stmts.updateAuditPlanStatus.run(status, existing.approved_by || '', existing.approved_at || null, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

app.patch('/api/audit-plans/:id/dates', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { approved_at, submitted_planned_at, submitted_at } = req.body;
  stmts.updateAuditPlanDates.run(approved_at || null, submitted_planned_at || null, submitted_at || null, existing.status, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

app.patch('/api/audit-plans/:id/approved-date', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { approved_at } = req.body;
  stmts.updateAuditPlanStatus.run(existing.status, existing.approved_by || '', approved_at || null, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

app.patch('/api/audit-plans/:id/submission', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { submitted_to, submitted_at } = req.body;
  stmts.updateAuditPlanSubmission.run(submitted_to || '', submitted_at || null, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

// Copy an audit plan (revision or template)
app.post('/api/audit-plans/:id/copy', (req, res) => {
  const source = stmts.getAuditPlan.get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source audit plan not found' });
  const { mode, department_id } = req.body;
  if (!mode || !['revision', 'template'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be revision or template' });
  }

  const newId = uuidv4();
  const targetDeptId = mode === 'revision' ? source.department_id : (department_id || source.department_id);
  const newYear = mode === 'revision' ? source.year : new Date().getFullYear();
  const newRevision = mode === 'revision' ? (source.revision || 0) + 1 : 0;

  stmts.createAuditPlan.run(newId, targetDeptId, newYear, 'ENTWURF', newRevision, source.plan_type || 'AUDIT');

  // Copy lines and their checklist items
  const isTemplate = mode === 'template';
  const sourceLines = stmts.getAuditPlanLinesByPlan.all(source.id);
  for (const line of sourceLines) {
    const newLineId = uuidv4();
    if (isTemplate) {
      // Template mode: copy only subjects/regulations/location, clear all audit data
      stmts.createAuditPlanLine.run(
        newLineId, newId, line.sort_order,
        line.subject || '', line.regulations || '', line.location || '', '',
        '', '', '', '', '',
        null, null, '',
        '', '', null,
        '', 'OPEN'
      );
    } else {
      // Revision mode: copy everything
      stmts.createAuditPlanLine.run(
        newLineId, newId, line.sort_order,
        line.subject || '', line.regulations || '', line.location || '', line.planned_window || '',
        line.audit_no || '', line.audit_subject || '', line.audit_title || '',
        line.auditor_team || '', line.auditee || '',
        line.audit_start_date || null, line.audit_end_date || null, line.audit_location || '',
        line.document_ref || '', line.document_iss_rev || '', line.document_rev_date || null,
        line.recommendation || '', line.audit_status || 'OPEN'
      );

      // Copy checklist items only for revision
      const sourceItems = stmts.getChecklistItemsByLine.all(line.id);
      for (const item of sourceItems) {
        const newItemId = uuidv4();
        stmts.createChecklistItem.run(
          newItemId, newLineId,
          item.section || 'THEORETICAL', item.sort_order || 0,
          item.regulation_ref || '', item.compliance_check || '',
          item.evaluation || '', item.auditor_comment || '', item.document_ref || ''
        );
        if (['O', 'L1', 'L2', 'L3'].includes(item.evaluation)) {
          const dl = calcCapDeadline(item.evaluation, line.performed_date);
          stmts.createCapItem.run(uuidv4(), newItemId, dl, '', '', '', '', 'OPEN', null, '', targetDeptId, 'audit', null);
        }
      }
    }
  }

  const targetDept = stmts.getDepartment.get(targetDeptId);
  const targetCompany = targetDept ? stmts.getCompany.get(targetDept.company_id) : null;
  logAction('Auditplan kopiert', 'audit_plan', newId, source.year + ' Rev.' + newRevision, mode === 'revision' ? 'Neue Revision' : 'Als Vorlage', targetCompany ? targetCompany.name : '', targetDept ? targetDept.name : '');
  res.status(201).json(stmts.getAuditPlan.get(newId));
});

app.delete('/api/audit-plans/:id', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const delDept = stmts.getDepartment.get(existing.department_id);
  const delCompany = delDept ? stmts.getCompany.get(delDept.company_id) : null;
  // Snapshot to trash before deleting
  try {
    const snapshot = snapshotAuditPlan(req.params.id);
    if (snapshot) {
      const entityName = existing.year + ' Rev.' + (existing.revision || 0);
      stmts.createTrashItem.run(uuidv4(), 'audit_plan', req.params.id, entityName, delCompany ? delCompany.name : '', delDept ? delDept.name : '', existing.department_id, 'department', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteAuditPlan.run(req.params.id);
  logAction('Auditplan gelöscht', 'audit_plan', req.params.id, existing.year + ' Rev.' + (existing.revision || 0), '', delCompany ? delCompany.name : '', delDept ? delDept.name : '');
  res.status(204).end();
});

// ── API: Import Audit Plan from .docx ─────────────────────
app.post('/api/departments/:departmentId/import-audit-plan',
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  (req, res) => {
    const dept = stmts.getDepartment.get(req.params.departmentId);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    try {
      const zip = new AdmZip(req.body);
      const docEntry = zip.getEntry('word/document.xml');
      if (!docEntry) return res.status(400).json({ error: 'Keine word/document.xml in der .docx Datei gefunden' });

      const xml = docEntry.getData().toString('utf8');

      // Extract first table
      const tblMatch = xml.match(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/);
      if (!tblMatch) return res.status(400).json({ error: 'Keine Tabelle in der .docx Datei gefunden' });

      const tblXml = tblMatch[0];

      // Extract rows
      const rows = [];
      const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
        rows.push(rowMatch[0]);
      }

      if (rows.length < 2) return res.status(400).json({ error: 'Tabelle hat keine Datenzeilen' });

      // Decode XML entities
      function decodeXml(str) {
        return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      }

      // Parse cells from a row: extract w:tc elements, then collect w:t text per cell
      function parseCells(rowXml) {
        const cells = [];
        const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const cellXml = cellMatch[1];
          // Collect all w:t text, but separate by w:p (paragraphs) with newlines
          const paragraphs = [];
          const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
          let pMatch;
          while ((pMatch = pRegex.exec(cellXml)) !== null) {
            const texts = [];
            const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
            let tMatch;
            while ((tMatch = tRegex.exec(pMatch[1])) !== null) {
              texts.push(decodeXml(tMatch[1]));
            }
            paragraphs.push(texts.join(''));
          }
          cells.push(paragraphs.join('\n').trim());
        }
        return cells;
      }

      // Parse date: DD.MM.YYYY → YYYY-MM-DD
      function parseDate(str) {
        if (!str || !str.trim()) return null;
        const m = str.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (!m) return null;
        return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }

      // Skip header row (index 0), parse data rows
      const lines = [];
      for (let i = 1; i < rows.length; i++) {
        const cells = parseCells(rows[i]);
        if (cells.length < 4) continue;

        const sortOrder = parseInt(cells[0], 10) || i;
        const subject = cells[1] || '';
        const regulations = cells[2] || '';
        const plannedWindow = cells[3] || '';
        const performedDate = cells.length > 4 ? parseDate(cells[4]) : null;
        // cells[5] = Findings → ignored
        const signature = cells.length > 6 ? (cells[6] || '') : '';

        if (!subject.trim()) continue;

        lines.push({ sortOrder, subject, regulations, plannedWindow, performedDate, signature });
      }

      if (lines.length === 0) return res.status(400).json({ error: 'Keine Themenbereiche in der Tabelle gefunden' });

      // Detect year from performed dates or use current year
      let year = new Date().getFullYear();
      for (const line of lines) {
        if (line.performedDate) {
          const y = parseInt(line.performedDate.substring(0, 4), 10);
          if (y >= 2000 && y <= 2099) { year = y; break; }
        }
      }
      // Also try to detect year from planned_window (might not contain year)

      // Create audit plan
      const planId = uuidv4();
      const insertPlan = db.transaction(() => {
        stmts.createAuditPlan.run(planId, req.params.departmentId, year, 'ENTWURF', 0, 'AUDIT');
        for (const line of lines) {
          const lineId = uuidv4();
          stmts.createAuditPlanLine.run(
            lineId, planId, line.sortOrder,
            line.subject, line.regulations, '', line.plannedWindow,
            String(line.sortOrder), '', '', '', '', null, null, '', '', '', null, '', 'OPEN'
          );
          // Set performed_date and signature if present
          if (line.performedDate) {
            stmts.updateAuditPlanLinePerformed.run(line.performedDate, lineId);
          }
          if (line.signature) {
            stmts.updateAuditPlanLine.run(
              line.sortOrder, line.subject, line.regulations, '', line.plannedWindow, line.signature,
              '', '', null, null, '', '', '', null, '',
              lineId
            );
          }
        }
      });
      insertPlan();

      const plan = stmts.getAuditPlan.get(planId);
      const impCompany = stmts.getCompany.get(dept.company_id);
      logAction('Auditplan importiert', 'audit_plan', planId, year + '', lines.length + ' Themenbereiche', impCompany ? impCompany.name : '', dept.name);
      res.status(201).json({ plan, lineCount: lines.length });
    } catch (err) {
      console.error('Import error:', err);
      res.status(500).json({ error: 'Fehler beim Import: ' + err.message });
    }
  }
);

// ── API: Audit Plan Lines ──────────────────────────────────

app.get('/api/audit-plans/:auditPlanId/lines', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.auditPlanId);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const lines = stmts.getAuditPlanLinesByPlan.all(req.params.auditPlanId);
  const counts = stmts.getChecklistCountsByPlan.all(req.params.auditPlanId);
  const countMap = {};
  for (const c of counts) countMap[c.audit_plan_line_id] = c;
  const evidenceCounts = stmts.getEvidenceCountsByPlan.all(req.params.auditPlanId);
  const evidenceMap = {};
  for (const e of evidenceCounts) evidenceMap[e.audit_plan_line_id] = e.evidence_count;
  for (const line of lines) {
    const c = countMap[line.id];
    line.checklist_count = c ? c.checklist_count : 0;
    line.finding_count = c ? c.finding_count : 0;
    line.observation_count = c ? c.observation_count : 0;
    line.evidence_count = evidenceMap[line.id] || 0;
  }
  res.json(lines);
});

app.post('/api/audit-plans/:auditPlanId/lines', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.auditPlanId);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const b = req.body;
  const id = uuidv4();
  const maxNo = stmts.getMaxAuditNo.get(req.params.auditPlanId);
  const auditNo = String((maxNo?.max_no || 0) + 1);

  // For authority audits, prefill auditor_team with authority name, auditee with QM name
  let auditorTeam = b.auditor_team || '';
  let auditee = b.auditee || '';
  if (plan.plan_type === 'AUTHORITY' && !auditorTeam && !auditee) {
    const dept = stmts.getDepartment.get(plan.department_id);
    if (dept && dept.authority_name) auditorTeam = dept.authority_name;
    if (dept) {
      const personsAll = stmts.getPersonsByCompany.all(dept.company_id);
      const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);
      if (qm) auditee = `${qm.first_name} ${qm.last_name}`.trim();
    }
  }

  stmts.createAuditPlanLine.run(
    id, req.params.auditPlanId,
    b.sort_order || 0, b.subject || '', b.regulations || '', b.location || '', b.planned_window || '',
    auditNo, b.audit_subject || '', b.audit_title || '',
    auditorTeam, auditee,
    b.audit_start_date || null, b.audit_end_date || null, b.audit_location || '',
    b.document_ref || '', b.document_iss_rev || '', b.document_rev_date || null,
    b.recommendation || '', b.audit_status || 'OPEN'
  );
  res.status(201).json(stmts.getAuditPlanLine.get(id));
});

// ── API: Multi-select Audit Checklist PDF (must be before :id routes) ──
app.get('/api/audit-plan-lines/pdf', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="Audit_Checklists.pdf"');
  doc.pipe(res);

  for (let idx = 0; idx < ids.length; idx++) {
    const line = stmts.getAuditPlanLine.get(ids[idx]);
    if (!line) continue;
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    if (!plan) continue;
    const dept = stmts.getDepartment.get(plan.department_id);
    if (!dept) continue;
    const company = stmts.getCompany.get(dept.company_id);
    if (!company) continue;
    const logoRow = stmts.getCompanyLogo.get(company.id);
    const checklistItems = stmts.getChecklistItemsByLine.all(line.id);
    const personsAll = stmts.getPersonsByCompany.all(company.id);

    if (idx > 0) doc.addPage();
    renderAuditLinePdf(doc, { line, plan, dept, company, logoRow, checklistItems, personsAll, startY: 50 });
  }

  addPdfFooter(doc);
  doc.end();
});

app.get('/api/audit-plan-lines/:id', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.id);
  if (!line) return res.status(404).json({ error: 'Not found' });
  res.json(line);
});

app.put('/api/audit-plan-lines/:id', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  const b = req.body;
  stmts.updateAuditPlanLine.run(
    b.sort_order || 0, b.subject || '', b.regulations || '', b.location || '', b.planned_window || '', b.signature || '',
    b.auditor_team || '', b.auditee || '',
    b.audit_start_date || null, b.audit_end_date || null, b.audit_location || '',
    b.document_ref || '', b.document_iss_rev || '', b.document_rev_date || null,
    b.recommendation || '',
    req.params.id
  );
  res.json(stmts.getAuditPlanLine.get(req.params.id));
});

app.patch('/api/audit-plan-lines/:id/performed', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  const { performed_date } = req.body;
  stmts.updateAuditPlanLinePerformed.run(performed_date || null, req.params.id);
  res.json(stmts.getAuditPlanLine.get(req.params.id));
});

app.delete('/api/audit-plan-lines/:id', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  // Snapshot to trash before deleting
  try {
    const snapshot = snapshotAuditPlanLine(req.params.id);
    if (snapshot) {
      const plan = stmts.getAuditPlan.get(existing.audit_plan_id);
      const dept = plan ? stmts.getDepartment.get(plan.department_id) : null;
      const comp = dept ? stmts.getCompany.get(dept.company_id) : null;
      stmts.createTrashItem.run(uuidv4(), 'audit_plan_line', req.params.id, existing.subject || existing.audit_no || '', comp ? comp.name : '', dept ? dept.name : '', existing.audit_plan_id, 'audit_plan', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteAuditPlanLine.run(req.params.id);
  res.status(204).end();
});

// ── API: Audit Checklist Items (now under audit-plan-lines) ──

app.get('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  const items = stmts.getChecklistItemsByLine.all(req.params.lineId);
  const evCounts = stmts.getEvidenceCountsByLine.all(req.params.lineId);
  const evMap = {};
  for (const e of evCounts) evMap[e.checklist_item_id] = e.evidence_count;
  for (const item of items) item.evidence_count = evMap[item.id] || 0;
  res.json(items);
});

app.post('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  const b = req.body;
  const id = uuidv4();
  stmts.createChecklistItem.run(
    id, req.params.lineId,
    b.section || 'THEORETICAL', b.sort_order || 0,
    b.regulation_ref || '', b.compliance_check || '',
    b.evaluation || '', b.auditor_comment || '', b.document_ref || ''
  );
  // Auto-CAP logic
  const evalVal = b.evaluation || '';
  if (['O', 'L1', 'L2', 'L3'].includes(evalVal)) {
    const dl = calcCapDeadline(evalVal, line.performed_date);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const deptId = plan ? plan.department_id : null;
    stmts.createCapItem.run(uuidv4(), id, dl, '', '', '', '', 'OPEN', null, '', deptId, 'audit', null);
  }
  res.status(201).json(stmts.getChecklistItem.get(id));
});

app.put('/api/checklist-items/:id', (req, res) => {
  const existing = stmts.getChecklistItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Checklist item not found' });
  const b = req.body;
  stmts.updateChecklistItem.run(
    b.section || 'THEORETICAL', b.sort_order || 0,
    b.regulation_ref || '', b.compliance_check || '',
    b.evaluation || '', b.auditor_comment || '', b.document_ref || '',
    req.params.id
  );
  // Auto-CAP logic
  const evalVal = b.evaluation || '';
  const needsCap = ['O', 'L1', 'L2', 'L3'].includes(evalVal);
  const existingCap = stmts.getCapItemByChecklistItem.get(req.params.id);
  if (needsCap && !existingCap) {
    const lineForCap = stmts.getAuditPlanLine.get(existing.audit_plan_line_id);
    const dl = calcCapDeadline(evalVal, lineForCap ? lineForCap.performed_date : null);
    const planForCap = lineForCap ? stmts.getAuditPlan.get(lineForCap.audit_plan_id) : null;
    const deptIdForCap = planForCap ? planForCap.department_id : null;
    stmts.createCapItem.run(uuidv4(), req.params.id, dl, '', '', '', '', 'OPEN', null, '', deptIdForCap, 'audit', null);
  } else if (!needsCap && existingCap) {
    stmts.deleteCapItemByChecklistItem.run(req.params.id);
  }
  res.json(stmts.getChecklistItem.get(req.params.id));
});

app.delete('/api/checklist-items/:id', (req, res) => {
  const existing = stmts.getChecklistItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Checklist item not found' });
  stmts.deleteChecklistItem.run(req.params.id);
  res.status(204).end();
});

// ── API: Bulk Import Audit XLSX per Audit Plan ──────────────
const XLSX = require('xlsx');

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const d = new Date(epoch.getTime() + serial * 86400000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findInRow(row, label) {
  if (!row) return null;
  for (let i = 0; i < row.length; i++) {
    if (row[i] && String(row[i]).trim().toLowerCase().startsWith(label.toLowerCase())) {
      // Check if label cell itself contains the value after ":"
      const cellVal = String(row[i]).trim();
      const colonIdx = cellVal.indexOf(':');
      if (colonIdx >= 0) {
        const after = cellVal.substring(colonIdx + 1).trim();
        if (after) return after;
      }
      // Otherwise return next non-null value (but stop at the next label containing ":")
      for (let j = i + 1; j < row.length; j++) {
        if (row[j] == null || String(row[j]).trim() === '') continue;
        const val = String(row[j]).trim();
        if (val.includes(':')) return null; // next label reached, field is empty
        return row[j];
      }
      return null;
    }
  }
  return null;
}

function normalizeEval(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (s === 'C' || s === 'NA' || s === 'O') return s;
  if (/^level\s*1$/i.test(s) || s === 'L1') return 'L1';
  if (/^level\s*2$/i.test(s) || s === 'L2') return 'L2';
  if (/^level\s*3$/i.test(s) || s === 'L3') return 'L3';
  return s;
}

function parseAuditChecklist(rows) {
  const meta = {};
  // Row 0: Audit Subject
  meta.audit_subject = findInRow(rows[0], 'Audit Subject') || '';
  // Row 2: Audit No, Audit Title
  meta.audit_no = findInRow(rows[2], 'Audit No') || '';
  meta.audit_title = findInRow(rows[2], 'Audit Title') || '';
  // Row 6: Auditor Team, Auditee, Audit Start Date
  meta.auditor_team = findInRow(rows[6], 'Auditor Team') || '';
  meta.auditee = findInRow(rows[6], 'Auditee') || '';
  const startRaw = findInRow(rows[6], 'Audit Start Date');
  meta.audit_start_date = typeof startRaw === 'number' ? excelDateToISO(startRaw) : null;
  // Row 8: Location, Document Ref, Iss/Rev, Rev Date, Audit End Date
  meta.audit_location = findInRow(rows[8], 'Location') || '';
  meta.document_ref = findInRow(rows[8], 'Document Ref') || '';
  meta.document_iss_rev = findInRow(rows[8], 'Iss/Rev') || '';
  const revDateRaw = findInRow(rows[8], 'Rev. Date');
  meta.document_rev_date = typeof revDateRaw === 'number' ? excelDateToISO(revDateRaw) : null;
  const endRaw = findInRow(rows[8], 'Audit End Date');
  meta.audit_end_date = typeof endRaw === 'number' ? excelDateToISO(endRaw) : null;

  // Parse sections and items
  const items = [];
  let currentSection = null;
  let itemOrder = 0;

  for (let i = 10; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const firstCell = row[0] != null ? String(row[0]).trim() : '';
    // Detect section headers
    if (/^theoretical/i.test(firstCell)) { currentSection = 'THEORETICAL'; continue; }
    if (/^practical/i.test(firstCell)) { currentSection = 'PRACTICAL'; continue; }
    if (/^procedure/i.test(firstCell)) { currentSection = 'PROCEDURE'; continue; }
    if (/^recommendation\s+for\s+management/i.test(firstCell)) {
      // Next non-empty row is the recommendation text (skip signature header rows)
      const sigPattern = /\b(date|signature|accountable\s+manager|maintenance\s+manager)\b/i;
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[j]) {
          const recText = rows[j].filter(c => c != null).map(c => String(c).trim()).filter(Boolean).join(' ');
          if (recText) {
            if (sigPattern.test(recText)) break; // reached signature block, no recommendation
            meta.recommendation = recText;
            break;
          }
        }
      }
      break; // done parsing items
    }

    // Skip header rows (Nr.: / Regulation ref.: etc.)
    if (/^nr/i.test(firstCell)) continue;

    // Parse checklist item: must have a number-like value in col 0
    if (currentSection && firstCell && /^\d/.test(firstCell)) {
      const regRef = row[2] != null ? String(row[2]).trim() : '';
      const compCheck = row[8] != null ? String(row[8]).trim() : '';
      const evalVal = normalizeEval(row[26]);
      const comment = row[29] != null ? String(row[29]).trim() : '';
      const docRef = row[42] != null ? String(row[42]).trim() : '';
      // Skip empty rows that only have a number
      if (!regRef && !compCheck && !evalVal && !comment && !docRef) continue;
      itemOrder++;
      items.push({
        section: currentSection,
        sort_order: itemOrder,
        regulation_ref: regRef,
        compliance_check: compCheck,
        evaluation: evalVal,
        auditor_comment: comment,
        document_ref: docRef,
      });
    }
  }

  return { meta, items };
}

app.post('/api/audit-plans/:id/import-audits', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const { files, mappings } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  if (!mappings || typeof mappings !== 'object') {
    return res.status(400).json({ error: 'No mappings provided' });
  }

  // Resolve company city as fallback for empty audit_location
  const dept = stmts.getDepartment.get(plan.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const fallbackCity = (company && company.city) || '';

  const planLines = stmts.getAuditPlanLinesByPlan.all(req.params.id);
  const matched = [];
  const skipped = [];

  const importAll = db.transaction(() => {
    for (const file of files) {
      const lineId = mappings[file.name];
      if (!lineId) {
        skipped.push({ filename: file.name });
        continue;
      }

      const line = planLines.find(l => l.id === lineId);
      if (!line) {
        skipped.push({ filename: file.name, error: 'Themenbereich nicht gefunden' });
        continue;
      }

      try {
        const buf = Buffer.from(file.data, 'base64');
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        const { meta, items } = parseAuditChecklist(rows);

        // Update audit plan line with extracted metadata
        stmts.updateAuditPlanLine.run(
          line.sort_order,
          line.subject,
          line.regulations || '',
          meta.audit_location || line.location || fallbackCity,
          line.planned_window || '',
          line.signature || '',
          meta.auditor_team || line.auditor_team || '',
          meta.auditee || line.auditee || '',
          meta.audit_start_date || line.audit_start_date || null,
          meta.audit_end_date || line.audit_end_date || null,
          meta.audit_location || fallbackCity,
          meta.document_ref || line.document_ref || '',
          meta.document_iss_rev || line.document_iss_rev || '',
          meta.document_rev_date || line.document_rev_date || null,
          meta.recommendation || line.recommendation || '',
          line.id
        );

        // Delete existing checklist items and insert new ones
        stmts.deleteChecklistItemsByLine.run(line.id);
        for (const item of items) {
          const ciId = uuidv4();
          stmts.createChecklistItem.run(
            ciId, line.id,
            item.section, item.sort_order,
            item.regulation_ref, item.compliance_check,
            item.evaluation, item.auditor_comment, item.document_ref
          );
          // Auto-CAP for findings/observations
          if (['O', 'L1', 'L2', 'L3'].includes(item.evaluation)) {
            const perfDate = line.performed_date || meta.audit_end_date || line.audit_end_date;
            const dl = calcCapDeadline(item.evaluation, perfDate);
            const planForImport = stmts.getAuditPlan.get(req.params.id);
            const deptIdForImport = planForImport ? planForImport.department_id : null;
            stmts.createCapItem.run(uuidv4(), ciId, dl, '', '', '', '', 'OPEN', null, '', deptIdForImport, 'audit', null);
          }
        }

        matched.push({ filename: file.name, lineSubject: line.subject, itemCount: items.length });
      } catch (err) {
        skipped.push({ filename: file.name, error: err.message });
      }
    }
  });

  try {
    importAll();
    const biDept = stmts.getDepartment.get(plan.department_id);
    const biCompany = biDept ? stmts.getCompany.get(biDept.company_id) : null;
    logAction('Audit-Checklisten importiert', 'audit_plan', req.params.id, '', matched.length + ' Dateien importiert', biCompany ? biCompany.name : '', biDept ? biDept.name : '');
    res.json({ matched, skipped });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + err.message });
  }
});

// ── API: CAP Items ──────────────────────────────────────────

app.get('/api/audit-plans/:id/cap-items', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const items = stmts.getCapItemsByPlan.all(req.params.id);
  const summary = stmts.getCapSummaryByPlan.get(req.params.id);
  res.json({ items, summary });
});

// ── API: Recalculate all CAP deadlines ──────────────────────
app.post('/api/cap-items/recalc-deadlines', (req, res) => {
  const days = getCapDeadlineDays();
  // Get all open CAP items with their audit line context
  const allCaps = db.prepare(
    `SELECT c.id, ci.evaluation, pl.performed_date, pl.audit_end_date
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE (c.completion_date IS NULL OR c.completion_date = '')`
  ).all();

  let updated = 0;
  const updateStmt = db.prepare(`UPDATE cap_item SET deadline = ?, updated_at = datetime('now') WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const cap of allCaps) {
      const baseDate = cap.performed_date || cap.audit_end_date;
      const dl = calcCapDeadline(cap.evaluation, baseDate);
      if (dl) {
        updateStmt.run(dl, cap.id);
        updated++;
      }
    }
  });
  tx();

  logAction('CAP-Fristen neu berechnet', 'cap_item', '', '', updated + ' von ' + allCaps.length + ' aktualisiert');
  res.json({ ok: true, updated, total: allCaps.length });
});

// ── API: Multi-select CAP Items PDF (must be before :id routes) ──
app.get('/api/cap-items/pdf', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="Corrective_Actions.pdf"');
  doc.pipe(res);

  const checklistStmt = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?');

  for (let idx = 0; idx < ids.length; idx++) {
    const cap = stmts.getCapItem.get(ids[idx]);
    if (!cap) continue;
    const checklistItem = checklistStmt.get(cap.checklist_item_id);
    const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const dept = stmts.getDepartment.get(plan.department_id);
    const company = stmts.getCompany.get(dept.company_id);
    const logoRow = stmts.getCompanyLogo.get(company.id);
    const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
    const fiveWhy = hasFiveWhy ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
    const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);

    if (idx > 0) doc.addPage();
    renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY: 50 });
  }

  addPdfFooter(doc);
  doc.end();
});

// Helper: generate multi-CAP PDF as Buffer
function generateCapItemsPdfBuffer(ids) {
  return new Promise((resolve, reject) => {
    if (!ids || ids.length === 0) return reject(new Error('No IDs provided'));
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);

    const checklistStmt = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?');
    let dept, company;
    for (let idx = 0; idx < ids.length; idx++) {
      const cap = stmts.getCapItem.get(ids[idx]);
      if (!cap) continue;
      const checklistItem = checklistStmt.get(cap.checklist_item_id);
      const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
      const plan = stmts.getAuditPlan.get(line.audit_plan_id);
      dept = stmts.getDepartment.get(plan.department_id);
      company = stmts.getCompany.get(dept.company_id);
      const logoRow = stmts.getCompanyLogo.get(company.id);
      const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
      const fiveWhy = hasFiveWhy ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
      const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);
      if (idx > 0) doc.addPage();
      renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY: 50 });
    }
    addPdfFooter(doc);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), dept, company }));
    doc.end();
  });
}

// Send CAP items PDF via email
app.post('/api/cap-items/send-email', async (req, res) => {
  const { ids, to: toAddress, authority } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Keine CAP-Einträge ausgewählt' });

  // For authority mode, resolve the authority email from the first CAP's department
  let to = toAddress;
  if (authority && !to) {
    const firstCap = stmts.getCapItem.get(ids[0]);
    if (firstCap) {
      const ci = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(firstCap.checklist_item_id);
      if (ci) {
        const ln = stmts.getAuditPlanLine.get(ci.audit_plan_line_id);
        if (ln) {
          const pl = stmts.getAuditPlan.get(ln.audit_plan_id);
          if (pl) {
            const dp = stmts.getDepartment.get(pl.department_id);
            if (dp && dp.authority_email) to = dp.authority_email;
          }
        }
      }
    }
  }
  if (!to) return res.status(400).json({ error: authority ? 'Keine Behörden-E-Mail in der Abteilung hinterlegt' : 'E-Mail-Adresse erforderlich' });

  try {
    const { buffer, dept, company } = await generateCapItemsPdfBuffer(ids);

    const nodemailer = require('nodemailer');
    const rows = stmts.getAllSettings.all();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    if (!s.smtp_host || !s.smtp_user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

    const port = parseInt(s.smtp_port) || 587;
    const auth = s.smtp_auth !== 'false';
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port, secure: port === 465,
      auth: auth ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    });

    const filename = `Corrective_Actions.pdf`;
    const personsAll = stmts.getPersonsByCompany.all(company.id);
    const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

    let subject, text, bcc;
    if (authority) {
      const salutation = dept.authority_salutation ? `Sehr geehrte${dept.authority_salutation === 'Herr' ? 'r' : ''} ${dept.authority_salutation} ${dept.authority_name || ''}` : 'Sehr geehrte Damen und Herren';
      const qmName = qm ? `${qm.first_name} ${qm.last_name}` : '';
      const qmTitle = qm ? 'Compliance Monitoring Manager' : '';

      subject = `Corrective Action Plan – ${company.name} (${dept.name})`;
      text = `${salutation.trim()},\n\nanbei übersenden wir Ihnen den Corrective Action Plan der Abteilung ${dept.name} der ${company.name}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}${qmTitle ? '\n' + qmTitle : ''}\n${company.name}\n\n`;
      if (qm && qm.email) bcc = qm.email;
    } else {
      subject = `Corrective Action Plan (${dept.name})`;
      text = `Hallo,\n\nanbei der Corrective Action Plan für die Abteilung ${dept.name} der ${company.name}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${company.name}\n\n`;
    }

    const mailOpts = {
      from: s.smtp_user,
      to, subject, text,
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    };
    if (bcc) mailOpts.bcc = bcc;
    await transporter.sendMail(mailOpts);

    logAction('CAP per E-Mail gesendet', 'cap_item', '', `${ids.length} CAP-Einträge`, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name);
    res.json({ ok: true });
  } catch (e) {
    console.error('CAP send-email error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cap-items/:id', (req, res) => {
  const row = stmts.getCapItem.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'CAP item not found' });
  res.json(row);
});

app.put('/api/cap-items/:id', (req, res) => {
  const b = req.body;
  const compDate = b.completion_date || null;
  stmts.updateCapItem.run(
    b.deadline || null, b.responsible_person || '', b.root_cause || '',
    b.corrective_action || '', b.preventive_action || '',
    compDate, b.evidence || '',
    compDate, compDate,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/cap-items/:id', (req, res) => {
  // Snapshot to trash before deleting
  try {
    const cap = snapshotCapItem(req.params.id);
    if (cap) {
      const checkItem = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(cap.checklist_item_id);
      let compName = '', deptName = '', entityName = '';
      if (checkItem) {
        const line = stmts.getAuditPlanLine.get(checkItem.audit_plan_line_id);
        if (line) {
          entityName = line.subject || line.audit_no || '';
          const plan = stmts.getAuditPlan.get(line.audit_plan_id);
          if (plan) {
            const dept = stmts.getDepartment.get(plan.department_id);
            if (dept) { deptName = dept.name; const comp = stmts.getCompany.get(dept.company_id); if (comp) compName = comp.name; }
          }
        }
      }
      stmts.createTrashItem.run(uuidv4(), 'cap_item', req.params.id, entityName, compName, deptName, cap.checklist_item_id, 'audit_checklist_item', JSON.stringify(cap));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteCapItem.run(req.params.id);
  res.status(204).end();
});

// ── API: Five-Why Analysis ────────────────────────────────────

app.get('/api/cap-items/:id/five-why', (req, res) => {
  const row = stmts.getFiveWhyByCapItem.get(req.params.id);
  res.json(row || null);
});

app.put('/api/cap-items/:id/five-why', (req, res) => {
  const { why1, why2, why3, why4, why5, root_cause } = req.body;
  const existing = stmts.getFiveWhyByCapItem.get(req.params.id);
  if (existing) {
    stmts.updateFiveWhy.run(why1 || '', why2 || '', why3 || '', why4 || '', why5 || '', root_cause || '', req.params.id);
  } else {
    stmts.createFiveWhy.run(uuidv4(), req.params.id, why1 || '', why2 || '', why3 || '', why4 || '', why5 || '', root_cause || '');
  }
  // Sync root_cause to cap_item
  const capItem = stmts.getCapItem.get(req.params.id);
  if (capItem) {
    const compDate2 = capItem.completion_date || null;
    stmts.updateCapItem.run(
      capItem.deadline || null, capItem.responsible_person || '', root_cause || '',
      capItem.corrective_action || '', capItem.preventive_action || '',
      compDate2, capItem.evidence || '',
      compDate2, compDate2,
      req.params.id
    );
  }
  res.json(stmts.getFiveWhyByCapItem.get(req.params.id));
});

// ── API: CAP Evidence Files ──────────────────────────────────

app.get('/api/cap-items/:id/evidence-files', (req, res) => {
  res.json(stmts.getEvidenceFilesByCapItem.all(req.params.id));
});

app.post('/api/cap-items/:id/evidence-files', (req, res) => {
  const { filename, mime_type, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  const id = uuidv4();
  const buf = Buffer.from(data, 'base64');
  stmts.createEvidenceFile.run(id, req.params.id, filename || '', mime_type || 'image/png', buf);
  res.status(201).json({ id, filename, mime_type });
});

app.get('/api/evidence-files/:id', (req, res) => {
  const row = stmts.getEvidenceFile.get(req.params.id);
  if (!row || !row.data) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', row.mime_type || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.data);
});

app.delete('/api/evidence-files/:id', (req, res) => {
  stmts.deleteEvidenceFile.run(req.params.id);
  res.status(204).end();
});

// ── API: Checklist Evidence Files ────────────────────────────

app.get('/api/checklist-items/:id/evidence-files', (req, res) => {
  res.json(stmts.getEvidenceFilesByChecklistItem.all(req.params.id));
});

app.post('/api/checklist-items/:id/evidence-files', (req, res) => {
  const { filename, mime_type, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  const id = uuidv4();
  const buf = Buffer.from(data, 'base64');
  stmts.createChecklistEvidenceFile.run(id, req.params.id, filename || '', mime_type || 'image/png', buf);
  res.status(201).json({ id, filename, mime_type });
});

app.get('/api/checklist-evidence-files/:id', (req, res) => {
  const row = stmts.getChecklistEvidenceFile.get(req.params.id);
  if (!row || !row.data) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', row.mime_type || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.data);
});

app.delete('/api/checklist-evidence-files/:id', (req, res) => {
  stmts.deleteChecklistEvidenceFile.run(req.params.id);
  res.status(204).end();
});

// ── API: Audit Plan PDF Export ───────────────────────────────
const PDFDocument = require('pdfkit');

// Helper: generate audit plan PDF as Buffer (for email attachment)
function generateAuditPlanPdfBuffer(planId, type, filter) {
  return new Promise((resolve, reject) => {
    const isClosed = type === 'closed';
    const plan = stmts.getAuditPlan.get(planId);
    if (!plan) return reject(new Error('Audit plan not found'));
    const dept = stmts.getDepartment.get(plan.department_id);
    if (!dept) return reject(new Error('Department not found'));
    const company = stmts.getCompany.get(dept.company_id);
    if (!company) return reject(new Error('Company not found'));
    const logoRow = stmts.getCompanyLogo.get(company.id);
    let lines = stmts.getAuditPlanLinesByPlan.all(plan.id);
    if (filter === 'planned') lines = lines.filter(l => l.planned_window && l.planned_window.trim());
    if (isClosed) lines = lines.filter(l => l.audit_end_date);

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), plan, dept, company }));
    doc.on('error', reject);
    _renderAuditPlanPdf(doc, { plan, dept, company, logoRow, lines, isClosed });
    doc.end();
  });
}

app.get('/api/audit-plans/:id/pdf', (req, res) => {
  const type = req.query.type || 'open';
  if (type !== 'open' && type !== 'closed') {
    return res.status(400).json({ error: 'type must be open or closed' });
  }
  const isClosed = type === 'closed';

  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const dept = stmts.getDepartment.get(plan.department_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const company = stmts.getCompany.get(dept.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const logoRow = stmts.getCompanyLogo.get(company.id);
  let lines = stmts.getAuditPlanLinesByPlan.all(plan.id);
  const filter = req.query.filter;
  if (filter === 'planned') {
    lines = lines.filter(l => l.planned_window && l.planned_window.trim());
  }
  if (isClosed) {
    lines = lines.filter(l => l.audit_end_date);
  }

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

  const suffix = isClosed ? 'Durchgefuehrte' : 'Geplante';
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Auditplan_${plan.year}_${suffix}.pdf"`);
  doc.pipe(res);

  _renderAuditPlanPdf(doc, { plan, dept, company, logoRow, lines, isClosed });
  doc.end();
});

// ── Send audit plan PDF via email ───────────────────────────
app.post('/api/audit-plans/:id/send-email', async (req, res) => {
  const { to, type, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
  if (type !== 'open' && type !== 'closed') return res.status(400).json({ error: 'type must be open or closed' });

  try {
    const filter = type === 'open' ? 'planned' : undefined;
    const { buffer, plan, dept, company } = await generateAuditPlanPdfBuffer(req.params.id, type, filter);

    const nodemailer = require('nodemailer');
    const rows = stmts.getAllSettings.all();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    if (!s.smtp_host || !s.smtp_user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

    const port = parseInt(s.smtp_port) || 587;
    const auth = s.smtp_auth !== 'false';
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port, secure: port === 465,
      auth: auth ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    });

    const isClosed = type === 'closed';
    const suffix = isClosed ? 'Durchgeführte' : 'Geplante';
    const filename = `Auditplan_${plan.year}_${suffix.replace(/ü/g, 'ue')}_Audits.pdf`;

    const personsAll = stmts.getPersonsByCompany.all(company.id);
    const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

    let subject, text, bcc;
    if (authority) {
      // Formal letter to authority
      const salutation = dept.authority_salutation ? `Sehr geehrte${dept.authority_salutation === 'Herr' ? 'r' : ''} ${dept.authority_salutation} ${dept.authority_name || ''}` : 'Sehr geehrte Damen und Herren';
      const qmName = qm ? `${qm.first_name} ${qm.last_name}` : '';
      const qmTitle = qm ? 'Compliance Monitoring Manager' : '';

      subject = `Auditplan ${plan.year} – ${suffix} Audits – ${company.name} (${dept.name})`;
      text = `${salutation.trim()},\n\nanbei übersenden wir Ihnen den Auditplan ${plan.year} – ${suffix} Audits der Abteilung ${dept.name} der ${company.name}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}${qmTitle ? '\n' + qmTitle : ''}\n${company.name}\n\n`;
      // BCC the QM
      if (qm && qm.email) bcc = qm.email;
    } else {
      // Regular email
      subject = `Auditplan ${plan.year} – ${suffix} Audits (${dept.name})`;
      text = `Hallo,\n\nanbei der Auditplan ${plan.year} – ${suffix} Audits für die Abteilung ${dept.name} der ${company.name}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${company.name}\n\n`;
    }

    const mailOpts = {
      from: s.smtp_user,
      to, subject, text,
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    };
    if (bcc) mailOpts.bcc = bcc;
    await transporter.sendMail(mailOpts);

    logAction('Auditplan per E-Mail gesendet', 'audit_plan', plan.id, `${plan.year} Rev. ${plan.revision || 0}`, `An: ${to}, Typ: ${suffix}${authority ? ' (Behörde)' : ''}`, company.name, dept.name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Internal: render audit plan PDF content ─────────────────
function _renderAuditPlanPdf(doc, { plan, dept, company, logoRow, lines, isClosed }) {
  function formatDateDE(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  // ── Header: Logo then text below ──
  let headerY = 50;
  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, 50, headerY, { height: 50 });
      headerY += 60;
    } catch {
      // logo unreadable, skip
    }
  }
  doc.fontSize(16).font('Helvetica-Bold').text(company.name, 50, headerY);
  headerY += 25;

  // ── Sub-header: Department + EASA number ──
  doc.fontSize(10).font('Helvetica');
  let subLine = dept.name;
  if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, 50, headerY);
  headerY += 40;

  // ── Title ──
  const titleLabel = isClosed ? 'Durchgeführte Audits' : 'Geplante Audits';
  const title = `Auditplan ${plan.year} - ${titleLabel}`;
  doc.fontSize(14).font('Helvetica-Bold').text(title, 50, headerY);
  headerY += 20;
  doc.fontSize(10).font('Helvetica').text(`Rev. ${plan.revision || 0}`, 50, headerY);
  headerY += 20;

  // ── Table ──
  const tableTop = headerY;
  const pageW = 595.28;
  const marginRight = 50;
  const tableRight = pageW - marginRight;

  // Load finding details for closed PDF
  let findingMap = {};
  if (isClosed) {
    const findings = stmts.getFindingDetailsByPlan.all(plan.id);
    for (const f of findings) findingMap[f.audit_plan_line_id] = f;
  }

  let colX, colW, colHeaders;
  if (isClosed) {
    colX = [50, 75, 190, 290, 360, 415];
    colW = [25, 115, 100, 70, 55, 80];
    colHeaders = ['Nr.', 'Thema', 'Bezug', 'Geplant', 'Auditiert', 'Findings'];
  } else {
    colX = [50, 80, 250, 370];
    colW = [30, 170, 120, 125];
    colHeaders = ['Nr.', 'Thema', 'Bezug', 'Geplant'];
  }

  // Header row
  doc.fontSize(9).font('Helvetica-Bold');
  doc.rect(50, tableTop, tableRight - 50, 18).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < colHeaders.length; c++) {
    doc.text(colHeaders[c], colX[c] + 4, tableTop + 4, { width: colW[c], align: 'left' });
  }
  doc.fillColor('#000000');

  let y = tableTop + 18;
  doc.font('Helvetica').fontSize(8);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Calculate row height based on content
    const subjectH = doc.heightOfString(line.subject || '', { width: colW[1] - 8 });
    const regsH = doc.heightOfString(line.regulations || '', { width: colW[2] - 8 });
    const plannedH = doc.heightOfString(line.planned_window || '', { width: colW[3] - 8 });
    const rowH = Math.max(16, subjectH + 8, regsH + 8, plannedH + 8);

    // New page if needed
    if (y + rowH > 760) {
      doc.addPage();
      y = 50;
    }

    // Zebra striping
    if (i % 2 === 0) {
      doc.rect(50, y, tableRight - 50, rowH).fill('#f0f4ff');
      doc.fillColor('#000000');
    }

    // Cell borders (light)
    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    doc.rect(50, y, tableRight - 50, rowH).stroke();

    // Cell content
    doc.text(line.audit_no || String(i + 1), colX[0] + 4, y + 4, { width: colW[0] - 8 });
    doc.text(line.subject || '', colX[1] + 4, y + 4, { width: colW[1] - 8 });
    doc.text(line.regulations || '', colX[2] + 4, y + 4, { width: colW[2] - 8 });
    doc.text(line.planned_window || '', colX[3] + 4, y + 4, { width: colW[3] - 8 });
    if (isClosed) {
      doc.text(formatDateDE(line.audit_end_date), colX[4] + 4, y + 4, { width: colW[4] - 8 });
      const fd = findingMap[line.id];
      if (fd) {
        const parts = [];
        if (fd.obs) parts.push(`O:${fd.obs}`);
        if (fd.l1) parts.push(`L1:${fd.l1}`);
        if (fd.l2) parts.push(`L2:${fd.l2}`);
        if (fd.l3) parts.push(`L3:${fd.l3}`);
        doc.text(parts.join(' '), colX[5] + 4, y + 4, { width: colW[5] - 8 });
      }
    }

    y += rowH;
  }

  // ── Findings legend (only for closed PDF) ──
  if (isClosed) {
    y += 10;
    if (y + 60 > 760) { doc.addPage(); y = 50; }
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
    doc.text('Legende:', 50, y);
    y += 12;
    doc.fontSize(7).font('Helvetica').fillColor('#444444');
    const legendItems = [
      'O - Beobachtung, kein Finding, lediglich Empfehlung zur Verbesserung',
      'Level 1 - Nichtkonformit\u00e4t, das Finding wird innerhalb von 5 Arbeitstagen behoben',
      'Level 2 - Nichtkonformit\u00e4t, Behebung des Findings innerhalb von 60 Arbeitstagen',
      'Level 3 - Nicht nur eine Empfehlung, muss umgesetzt oder angepasst werden (bei oder mit der n\u00e4chsten Revision)',
    ];
    for (const item of legendItems) {
      doc.text(item, 58, y, { width: tableRight - 58 });
      y += doc.heightOfString(item, { width: tableRight - 58 }) + 2;
    }
    doc.fillColor('#000000');
  }

  // ── Signature table (skip for authority audits) ──
  if (plan.plan_type === 'AUTHORITY') {
    // No signature section — just add footer
    const pages = doc.bufferedPageRange();
    for (let p = pages.start; p < pages.start + pages.count; p++) {
      doc.switchToPage(p);
      const footerY = 770;
      doc.strokeColor('#000000').lineWidth(0.5);
      doc.moveTo(50, footerY).lineTo(pageW - 50, footerY).stroke();
      doc.fontSize(7).fillColor('#000000').font('Helvetica');
      doc.text('Erstellt mit ac-audit', 50, footerY + 4, { lineBreak: false });
      const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
      doc.text(pageLabel, 50, footerY + 4, { width: pageW - 100, align: 'right', lineBreak: false });
    }
    return;
  }
  // Load persons for this company/department
  const personsAll = stmts.getPersonsByCompany.all(company.id);
  const qmPerson = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);
  const alPerson = personsAll.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
  const accPerson = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

  // Dynamic label for Abteilungsleiter based on regulation
  const deptText = `${dept.name} ${dept.regulation || ''}`.toLowerCase();
  let alLabel = 'Abteilungsleiter';
  if (deptText.includes('145')) alLabel = 'Maintenance Manager';
  else if (deptText.includes('camo') || deptText.includes('part-m')) alLabel = 'Leiter CAMO';
  else if (deptText.includes('ato') || deptText.includes('flugschule') || deptText.includes('training')) alLabel = 'Head of Training';
  else if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) alLabel = 'Flugbetriebsleiter';

  const sigRowH = 50;
  const sigHeaderH = 28;
  const sigTableH = sigHeaderH + sigRowH;
  if (y + sigTableH + 20 > 760) {
    doc.addPage();
    y = 50;
  }
  y += 16; // spacing

  const sigCols = 5;
  const sigColW = (tableRight - 50) / sigCols;

  // First column: "Freigabe" for open, "Erledigt" for closed
  const sigCol0Label = isClosed ? 'Erledigt' : 'Freigabe';
  const sigHeaders = [sigCol0Label, 'Weitergabe LBA', 'Compliance Monitoring Manager', alLabel, 'Accountable Manager'];

  // Header row
  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, sigHeaderH).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sigCols; c++) {
    doc.text(sigHeaders[c], 50 + c * sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });
  }
  doc.fillColor('#000000');
  y += sigHeaderH;

  // Content row
  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, sigRowH).stroke();
  for (let c = 1; c < sigCols; c++) {
    doc.moveTo(50 + c * sigColW, y).lineTo(50 + c * sigColW, y + sigRowH).stroke();
  }

  doc.font('Helvetica').fontSize(9);

  // Col 0: Freigabe date or Erledigt (max audit_end_date)
  if (isClosed) {
    let maxDate = '';
    for (const l of lines) {
      if (l.audit_end_date && l.audit_end_date > maxDate) maxDate = l.audit_end_date;
    }
    doc.text(formatDateDE(maxDate), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });
  } else {
    doc.text(formatDateDE(plan.approved_at), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });
  }

  // Col 1: Weitergabe LBA
  const lbaDate = isClosed ? plan.submitted_at : plan.submitted_planned_at;
  doc.text(formatDateDE(lbaDate), 50 + sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });

  // Col 2-4: Signatures
  const sigPersons = [qmPerson, alPerson, accPerson];
  for (let c = 0; c < 3; c++) {
    const person = sigPersons[c];
    const cx = 50 + (c + 2) * sigColW;
    if (person) {
      const sigRow = stmts.getPersonSignature.get(person.id);
      if (sigRow && sigRow.signature) {
        try {
          doc.image(sigRow.signature, cx + 4, y + 2, { fit: [sigColW - 8, sigRowH - 14], align: 'center', valign: 'center' });
        } catch { /* unreadable */ }
      }
      // Name below signature
      const name = `${person.first_name} ${person.last_name}`.trim();
      if (name) {
        doc.fontSize(6).text(name, cx + 4, y + sigRowH - 10, { width: sigColW - 8, align: 'center' });
      }
    }
  }

  y += sigRowH;

  // Footer on every page
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    const footerY = 770;
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.moveTo(50, footerY).lineTo(tableRight, footerY).stroke();
    doc.fontSize(7).fillColor('#000000').font('Helvetica');
    doc.text('Erstellt mit ac-audit', 50, footerY + 4, { lineBreak: false });
    const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
    doc.text(pageLabel, 50, footerY + 4, { width: tableRight - 50, align: 'right', lineBreak: false });
  }

}

// ── PDF Helper: Render single audit line into doc ────────────
function renderAuditLinePdf(doc, { line, plan, dept, company, logoRow, checklistItems, personsAll, startY }) {
  const pageW = 595.28;
  const tableRight = pageW - 50;

  function formatDateDE(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  let y = startY || 50;

  // ── Header ──
  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, 50, y, { height: 45 });
      y += 55;
    } catch { y += 10; }
  }

  doc.fontSize(14).font('Helvetica-Bold').text(company.name, 50, y);
  y += 20;
  doc.fontSize(9).font('Helvetica');
  let subLine = dept.name;
  if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, 50, y);
  y += 25;

  doc.fontSize(14).font('Helvetica-Bold').text('Audit Checklist', 50, y);
  y += 25;

  // ── Audit Information table ──
  doc.fontSize(10).font('Helvetica-Bold').text('Audit Information', 50, y);
  y += 16;

  const infoItems = [
    ['Auditplan', plan.year || ''],
    ['Audit Nr.', line.audit_no || ''],
    ['Thema', line.subject || ''],
    ['Auditor Team', line.auditor_team || ''],
    ['Auditee', line.auditee || ''],
    ['Audit Start', formatDateDE(line.audit_start_date)],
    ['Audit End', formatDateDE(line.audit_end_date)],
    ['Location', line.audit_location || ''],
    ['Document Ref', line.document_ref || ''],
    ['Iss/Rev', line.document_iss_rev || ''],
    ['Rev Date', formatDateDE(line.document_rev_date)],
  ];

  doc.fontSize(8);
  const labelW = 100;
  const valW = tableRight - 50 - labelW;
  for (const [label, value] of infoItems) {
    doc.rect(50, y, labelW, 16).fill('#f0f4ff');
    doc.rect(50 + labelW, y, valW, 16).stroke();
    doc.rect(50, y, labelW, 16).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font('Helvetica').text(value, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += 16;
  }
  y += 15;

  // ── Checklist sections ──
  const sections = [
    { key: 'THEORETICAL', label: 'Theoretical / Documentation Verification' },
    { key: 'PRACTICAL', label: 'Practical Review' },
    { key: 'PROCEDURE', label: 'Procedure / MOE Review' },
  ];

  const evalColors = {
    'C': '#d4edda', 'NA': '#e2e3e5', 'O': '#fff3cd',
    'L1': '#f8d7da', 'L2': '#f5c6cb', 'L3': '#f1b0b7'
  };

  const clColX = [50, 70, 140, 290, 330, 400];
  const clColW = [20, 70, 150, 40, 70, 95.28];
  const clHeaders = ['Nr', 'Regulation Ref', 'Compliance Check', 'Eval', 'Auditor Comment', 'Document Ref'];

  for (const section of sections) {
    const items = checklistItems.filter(i => i.section === section.key);

    if (items.length === 0) {
      if (y + 34 > 740) { doc.addPage(); y = 50; }
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(section.label, 50, y);
      y += 16;
      doc.fontSize(8).font('Helvetica').fillColor('#888888').text('No items', 50, y);
      doc.fillColor('#000000');
      y += 18;
      continue;
    }

    doc.font('Helvetica').fontSize(7);
    const firstItem = items[0];
    const firstCompH = doc.heightOfString(firstItem.compliance_check || '', { width: clColW[2] - 6 });
    const firstCommH = doc.heightOfString(firstItem.auditor_comment || '', { width: clColW[4] - 6 });
    const firstRowH = Math.max(14, firstCompH + 6, firstCommH + 6);
    if (y + 16 + 16 + firstRowH > 740) { doc.addPage(); y = 50; }

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text(section.label, 50, y);
    y += 16;

    doc.fontSize(7).font('Helvetica-Bold');
    doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
    doc.fillColor('#ffffff');
    for (let c = 0; c < clHeaders.length; c++) {
      doc.text(clHeaders[c], clColX[c] + 3, y + 3, { width: clColW[c] - 6 });
    }
    doc.fillColor('#000000');
    y += 16;

    doc.font('Helvetica').fontSize(7);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const compH = doc.heightOfString(item.compliance_check || '', { width: clColW[2] - 6 });
      const commH = doc.heightOfString(item.auditor_comment || '', { width: clColW[4] - 6 });
      const rowH = Math.max(14, compH + 6, commH + 6);

      if (y + rowH > 740) {
        doc.addPage();
        y = 50;
        doc.fontSize(7).font('Helvetica-Bold');
        doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
        doc.fillColor('#ffffff');
        for (let c = 0; c < clHeaders.length; c++) {
          doc.text(clHeaders[c], clColX[c] + 3, y + 3, { width: clColW[c] - 6 });
        }
        doc.fillColor('#000000');
        y += 16;
        doc.font('Helvetica').fontSize(7);
      }

      if (i % 2 === 0) {
        doc.rect(50, y, tableRight - 50, rowH).fill('#f8f9fa');
        doc.fillColor('#000000');
      }

      const evalVal = (item.evaluation || '').trim().toUpperCase();
      if (evalColors[evalVal]) {
        doc.rect(clColX[3], y, clColW[3], rowH).fill(evalColors[evalVal]);
        doc.fillColor('#000000');
      }

      doc.strokeColor('#d0d0d0').lineWidth(0.5);
      doc.rect(50, y, tableRight - 50, rowH).stroke();
      for (let c = 1; c < clColX.length; c++) {
        doc.moveTo(clColX[c], y).lineTo(clColX[c], y + rowH).stroke();
      }

      doc.text(String(i + 1), clColX[0] + 3, y + 3, { width: clColW[0] - 6 });
      doc.text(item.regulation_ref || '', clColX[1] + 3, y + 3, { width: clColW[1] - 6 });
      doc.text(item.compliance_check || '', clColX[2] + 3, y + 3, { width: clColW[2] - 6 });
      doc.text(item.evaluation || '', clColX[3] + 3, y + 3, { width: clColW[3] - 6 });
      doc.text(item.auditor_comment || '', clColX[4] + 3, y + 3, { width: clColW[4] - 6 });
      doc.text(item.document_ref || '', clColX[5] + 3, y + 3, { width: clColW[5] - 6 });

      y += rowH;
    }
    y += 12;
  }

  // ── Summary ──
  if (y + 50 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Summary', 50, y);
  y += 16;

  const totalQ = checklistItems.length;
  const cCount = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'C').length;
  const naCount = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'NA').length;
  const oCount = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'O').length;
  const l1Count = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'L1').length;
  const l2Count = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'L2').length;
  const l3Count = checklistItems.filter(i => (i.evaluation || '').toUpperCase() === 'L3').length;

  const sumHeaders = ['Total Questions', 'Conformities', 'Not Applicable', 'Observation', 'Level 1', 'Level 2', 'Level 3'];
  const sumValues = [totalQ, cCount, naCount, oCount, l1Count, l2Count, l3Count];
  const sumColW = (tableRight - 50) / sumHeaders.length;

  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, 16).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sumHeaders.length; c++) {
    doc.text(sumHeaders[c], 50 + c * sumColW + 2, y + 3, { width: sumColW - 4, align: 'center' });
  }
  doc.fillColor('#000000');
  y += 16;

  doc.fontSize(9).font('Helvetica');
  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, 18).stroke();
  for (let c = 1; c < sumHeaders.length; c++) {
    doc.moveTo(50 + c * sumColW, y).lineTo(50 + c * sumColW, y + 18).stroke();
  }
  for (let c = 0; c < sumValues.length; c++) {
    doc.text(String(sumValues[c]), 50 + c * sumColW + 2, y + 4, { width: sumColW - 4, align: 'center' });
  }
  y += 30;

  // ── Recommendation ──
  if (y + 40 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(10).font('Helvetica-Bold').text('Recommendation for Management', 50, y);
  y += 16;
  doc.fontSize(8).font('Helvetica');
  const recText = line.recommendation || '—';
  doc.rect(50, y, tableRight - 50, Math.max(30, doc.heightOfString(recText, { width: tableRight - 60 }) + 10)).stroke();
  doc.text(recText, 55, y + 5, { width: tableRight - 60 });
  y += Math.max(30, doc.heightOfString(recText, { width: tableRight - 60 }) + 10) + 15;

  // ── Signature table ──
  const qmPerson = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);
  const alPerson = personsAll.find(p => p.role === 'ABTEILUNGSLEITER' && p.department_id === dept.id);
  const accPerson = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

  const deptText = `${dept.name} ${dept.regulation || ''}`.toLowerCase();
  let alLabel = 'Abteilungsleiter';
  if (deptText.includes('145')) alLabel = 'Maintenance Manager';
  else if (deptText.includes('camo') || deptText.includes('part-m')) alLabel = 'Leiter CAMO';
  else if (deptText.includes('ato') || deptText.includes('flugschule') || deptText.includes('training')) alLabel = 'Head of Training';
  else if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) alLabel = 'Flugbetriebsleiter';

  const sigCols = 4;
  const sigColW = (tableRight - 50) / sigCols;
  const sigHeaderH = 20;
  const sigRowH = 50;

  if (y + sigHeaderH + sigRowH + 10 > 740) { doc.addPage(); y = 50; }

  const sigHeaders = ['Date', 'Auditor', alLabel, 'Accountable Manager'];

  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, sigHeaderH).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sigCols; c++) {
    doc.text(sigHeaders[c], 50 + c * sigColW + 4, y + 5, { width: sigColW - 8, align: 'center' });
  }
  doc.fillColor('#000000');
  y += sigHeaderH;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, sigRowH).stroke();
  for (let c = 1; c < sigCols; c++) {
    doc.moveTo(50 + c * sigColW, y).lineTo(50 + c * sigColW, y + sigRowH).stroke();
  }

  doc.fontSize(8).font('Helvetica');
  doc.text(formatDateDE(line.audit_end_date), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });

  const sigPersons = [qmPerson, alPerson, accPerson];
  for (let c = 0; c < 3; c++) {
    const person = sigPersons[c];
    const cx = 50 + (c + 1) * sigColW;
    if (person) {
      const sigRow = stmts.getPersonSignature.get(person.id);
      if (sigRow && sigRow.signature) {
        try {
          doc.image(sigRow.signature, cx + 4, y + 2, { fit: [sigColW - 8, sigRowH - 14], align: 'center', valign: 'center' });
        } catch { /* unreadable */ }
      }
      const name = `${person.first_name} ${person.last_name}`.trim();
      if (name) {
        doc.fontSize(6).text(name, cx + 4, y + sigRowH - 10, { width: sigColW - 8, align: 'center' });
      }
    }
  }
  y += sigRowH + 15;

  // ── Legend ──
  if (y + 60 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Legend', 50, y);
  y += 14;
  doc.fontSize(7).font('Helvetica').fillColor('#444444');
  const legendItems = [
    'C - Conform: The requirement is fully met',
    'NA - Not Applicable: The requirement does not apply',
    'O - Observation: No finding, recommendation for improvement',
    'Level 1 - Non-conformity: Finding to be resolved within 5 working days',
    'Level 2 - Non-conformity: Finding to be resolved within 60 working days',
    'Level 3 - Not just a recommendation, must be implemented or adapted (at or with the next revision)',
  ];
  for (const item of legendItems) {
    doc.text(item, 58, y, { width: tableRight - 58 });
    y += doc.heightOfString(item, { width: tableRight - 58 }) + 2;
  }
  doc.fillColor('#000000');

  return y;
}

// ── PDF Helper: Render single CAP item into doc ──────────────
function renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY }) {
  const pageW = 595.28;
  const tableRight = pageW - 50;
  const contentW = tableRight - 50;

  function formatDateDE(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  const evalColors = {
    'C': '#d4edda', 'NA': '#e2e3e5', 'O': '#fff3cd',
    'L1': '#f8d7da', 'L2': '#f5c6cb', 'L3': '#f1b0b7'
  };

  let y = startY || 50;

  // ── Header ──
  if (logoRow && logoRow.logo) {
    try {
      doc.image(logoRow.logo, 50, y, { height: 45 });
      y += 55;
    } catch { y += 10; }
  }

  doc.fontSize(14).font('Helvetica-Bold').text(company.name, 50, y);
  y += 20;
  doc.fontSize(9).font('Helvetica');
  let subLine = dept.name;
  if (dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, 50, y);
  y += 25;

  doc.fontSize(14).font('Helvetica-Bold').text('Corrective Action', 50, y);
  y += 25;

  // ── Helper: key-value row ──
  const labelW = 130;
  const valW = contentW - labelW;

  function drawInfoRow(label, value, options) {
    const { evalHighlight, bold } = options || {};
    const textVal = value || '';
    doc.fontSize(8).font('Helvetica');
    const valH = Math.max(16, doc.heightOfString(textVal, { width: valW - 8 }) + 6);
    if (y + valH > 740) { doc.addPage(); y = 50; }

    doc.rect(50, y, labelW, valH).fill('#f0f4ff');
    doc.rect(50, y, labelW, valH).stroke();
    if (evalHighlight && evalColors[evalHighlight]) {
      doc.rect(50 + labelW, y, valW, valH).fill(evalColors[evalHighlight]);
    }
    doc.rect(50 + labelW, y, valW, valH).stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').text(label, 54, y + 3, { width: labelW - 8 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(textVal, 50 + labelW + 4, y + 3, { width: valW - 8 });
    y += valH;
  }

  // ── Section 1: Finding Info ──
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Finding-Info', 50, y);
  y += 16;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  drawInfoRow('Auditplan', `${plan.year || ''} – ${plan.name || ''}`);
  drawInfoRow('Audit-Nr.', cap.audit_no);
  drawInfoRow('Thema', cap.subject);
  drawInfoRow('Finding', cap.compliance_check);
  drawInfoRow('Level', cap.evaluation, { evalHighlight: cap.evaluation, bold: true });
  drawInfoRow('Regulation Ref.', cap.regulation_ref);
  drawInfoRow('Kommentar', cap.auditor_comment);
  y += 15;

  // ── Section 2: 5-Why (only L1/L2) ──
  const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
  if (hasFiveWhy && fiveWhy) {
    if (y + 30 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('5-Why Analyse', 50, y);
    y += 16;

    doc.strokeColor('#d0d0d0').lineWidth(0.5);
    drawInfoRow('1. Warum?', fiveWhy.why1);
    drawInfoRow('2. Warum?', fiveWhy.why2);
    drawInfoRow('3. Warum?', fiveWhy.why3);
    drawInfoRow('4. Warum?', fiveWhy.why4);
    drawInfoRow('5. Warum?', fiveWhy.why5);
    drawInfoRow('Root Cause', fiveWhy.root_cause, { bold: true });
    y += 15;
  }

  // ── Section 3: Corrective Action Details ──
  if (y + 30 > 740) { doc.addPage(); y = 50; }
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Corrective Action', 50, y);
  y += 16;

  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  drawInfoRow('Deadline', formatDateDE(cap.deadline));
  drawInfoRow('Verantwortlich', cap.responsible_person);
  drawInfoRow('Ursache', cap.root_cause);
  drawInfoRow('Korrekturmaßnahme', cap.corrective_action);
  drawInfoRow('Vorbeugemaßnahme', cap.preventive_action);
  drawInfoRow('Erledigt am', formatDateDE(cap.completion_date));
  drawInfoRow('Nachweis', cap.evidence);
  y += 15;

  // ── Section 4: Evidence Images ──
  const imageFiles = (evidenceFiles || []).filter(f => (f.mime_type || '').startsWith('image/'));
  if (imageFiles.length > 0) {
    if (y + 30 > 740) { doc.addPage(); y = 50; }
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Nachweise', 50, y);
    y += 16;

    for (const ef of imageFiles) {
      const fullFile = stmts.getEvidenceFile.get(ef.id);
      if (!fullFile || !fullFile.data) continue;
      try {
        const maxH = 300;
        if (y + maxH + 20 > 740) { doc.addPage(); y = 50; }
        doc.fontSize(7).font('Helvetica').fillColor('#666666').text(ef.filename || 'Bild', 50, y);
        y += 12;
        doc.image(fullFile.data, 50, y, { fit: [contentW, maxH], align: 'center' });
        y += maxH + 10;
        if (y > 740) { doc.addPage(); y = 50; }
      } catch { /* skip unreadable image */ }
    }
  }

  return y;
}

// ── PDF Helper: Add footer to all pages ──────────────────────
function addPdfFooter(doc, opts = {}) {
  const label = opts.label || 'Erstellt mit ac-audit';
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const marginL = 40;
    const tableRight = pageW - 40;
    const footerY = pageH - 30;
    doc.save();
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.moveTo(marginL, footerY).lineTo(tableRight, footerY).stroke();
    doc.fontSize(7).fillColor('#000000').font('Helvetica');
    doc.text(label, marginL, footerY + 4, { lineBreak: false, height: 10 });
    const pageLabel = `Seite ${p - pages.start + 1}/${pages.count}`;
    doc.text(pageLabel, tableRight - 60, footerY + 4, { width: 60, align: 'right', lineBreak: false, height: 10 });
    doc.restore();
  }
}


// ── API: Audit Checklist PDF (Einzelaudit) ───────────────────
app.get('/api/audit-plan-lines/:id/pdf', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.id);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });

  const plan = stmts.getAuditPlan.get(line.audit_plan_id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const dept = stmts.getDepartment.get(plan.department_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const company = stmts.getCompany.get(dept.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const logoRow = stmts.getCompanyLogo.get(company.id);
  const checklistItems = stmts.getChecklistItemsByLine.all(line.id);
  const personsAll = stmts.getPersonsByCompany.all(company.id);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Audit_${line.audit_no || 'X'}_${(line.subject || 'Checklist').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  renderAuditLinePdf(doc, { line, plan, dept, company, logoRow, checklistItems, personsAll, startY: 50 });
  addPdfFooter(doc);
  doc.end();
});

// ── API: CAP Item PDF Export (single) ─────────────────────────
app.get('/api/cap-items/:id/pdf', (req, res) => {
  const cap = stmts.getCapItem.get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'CAP item not found' });

  const checklistItem = db.prepare('SELECT * FROM audit_checklist_item WHERE id = ?').get(cap.checklist_item_id);
  const line = stmts.getAuditPlanLine.get(checklistItem.audit_plan_line_id);
  const plan = stmts.getAuditPlan.get(line.audit_plan_id);
  const dept = stmts.getDepartment.get(plan.department_id);
  const company = stmts.getCompany.get(dept.company_id);
  const logoRow = stmts.getCompanyLogo.get(company.id);
  const hasFiveWhy = cap.evaluation === 'L1' || cap.evaluation === 'L2';
  const fiveWhy = hasFiveWhy ? stmts.getFiveWhyByCapItem.get(cap.id) : null;
  const evidenceFiles = stmts.getEvidenceFilesByCapItem.all(cap.id);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="CAP_${cap.audit_no || 'X'}_${(cap.evaluation || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  renderCapItemPdf(doc, { cap, line, plan, dept, company, logoRow, fiveWhy, evidenceFiles, startY: 50 });
  addPdfFooter(doc);
  doc.end();
});

// ── API: Persons ──────────────────────────────────────────────

const COMPANY_ROLES = ['ACCOUNTABLE'];
const DEPT_ROLES = ['QM', 'ABTEILUNGSLEITER'];
const ALL_ROLES = [...COMPANY_ROLES, ...DEPT_ROLES];

app.get('/api/companies/:companyId/persons', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(stmts.getPersonsByCompany.all(req.params.companyId));
});

app.post('/api/companies/:companyId/persons', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const { role, first_name, last_name, department_id } = req.body;
  if (!role || !ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (DEPT_ROLES.includes(role) && !department_id) return res.status(400).json({ error: 'department_id required for department roles' });
  const deptId = DEPT_ROLES.includes(role) ? department_id : null;
  const existing = deptId
    ? stmts.getPersonByRoleDept.get(req.params.companyId, role, deptId)
    : stmts.getPersonByRoleCompany.get(req.params.companyId, role);
  if (existing) return res.status(409).json({ error: 'Role already assigned' });
  const id = uuidv4();
  const { email } = req.body;
  stmts.createPerson.run(id, req.params.companyId, deptId, role, first_name || '', last_name || '', email || '');
  res.status(201).json(stmts.getPerson.get(id));
});

app.put('/api/persons/:id', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  const { first_name, last_name, email } = req.body;
  stmts.updatePerson.run(first_name || '', last_name || '', email || '', req.params.id);
  res.json(stmts.getPerson.get(req.params.id));
});

app.delete('/api/persons/:id', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  stmts.deletePerson.run(req.params.id);
  res.status(204).end();
});

app.put('/api/persons/:id/signature', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  const { signature } = req.body;
  const sigBuf = signature ? Buffer.from(signature, 'base64') : null;
  stmts.updatePersonSignature.run(sigBuf, req.params.id);
  res.json({ ok: true });
});

app.get('/api/persons/:id/signature', (req, res) => {
  const row = stmts.getPersonSignature.get(req.params.id);
  if (!row || !row.signature) return res.status(404).json({ error: 'No signature' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.signature);
});

// ── Health ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── API: Logs ───────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const logs = stmts.getRecentLogs.all(limit, offset);
  res.json(logs);
});

app.get('/logs', (req, res) => {
  renderPage(res, 'logs', { activePage: 'logs', pageScript: 'logs.js' });
});

// ── API: Trash (Papierkorb) ─────────────────────────────────

app.get('/api/trash', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json(stmts.getTrashItems.all(limit, offset));
});

app.get('/api/trash/count', (req, res) => {
  const row = stmts.getTrashItemCount.get();
  res.json({ count: row ? row.cnt : 0 });
});

app.post('/api/trash/:id/restore', (req, res) => {
  const item = stmts.getTrashItem.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Trash item not found' });

  const snapshot = JSON.parse(item.snapshot);

  // Check parent existence
  if (item.entity_type === 'audit_plan') {
    const dept = stmts.getDepartment.get(item.parent_id);
    if (!dept) return res.status(409).json({ error: 'Abteilung existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'audit_plan_line') {
    const plan = stmts.getAuditPlan.get(item.parent_id);
    if (!plan) return res.status(409).json({ error: 'Auditplan existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'cap_item') {
    const checkItem = db.prepare('SELECT id FROM audit_checklist_item WHERE id = ?').get(item.parent_id);
    if (!checkItem) return res.status(409).json({ error: 'Prüfpunkt existiert nicht mehr. Wiederherstellung nicht möglich.' });
  }

  try {
    const restoreTx = db.transaction(() => {
      if (item.entity_type === 'audit_plan') {
        restoreAuditPlan(snapshot);
      } else if (item.entity_type === 'audit_plan_line') {
        restoreAuditPlanLine(snapshot);
      } else if (item.entity_type === 'cap_item') {
        restoreCapItem(snapshot);
      }
      stmts.deleteTrashItem.run(req.params.id);
    });
    restoreTx();
    logAction('Wiederhergestellt', item.entity_type, item.entity_id, item.entity_name, 'Aus Papierkorb', item.company_name, item.department_name);
    res.json({ ok: true });
  } catch (e) {
    console.error('Restore failed:', e.message);
    res.status(500).json({ error: 'Wiederherstellung fehlgeschlagen: ' + e.message });
  }
});

app.delete('/api/trash/:id', (req, res) => {
  stmts.deleteTrashItem.run(req.params.id);
  res.status(204).end();
});

app.post('/api/trash/empty', (req, res) => {
  stmts.deleteAllTrashItems.run();
  res.json({ ok: true });
});

app.get('/trash', (req, res) => {
  renderPage(res, 'trash', { activePage: 'trash', pageScript: 'trash.js' });
});

// ── API: Department-level CAPs (shared) ──────────────────────

app.get('/api/departments/:departmentId/cap-items', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getCapItemsByDepartment.all(req.params.departmentId));
});

app.post('/api/departments/:departmentId/cap-items', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { source, source_ref_id, deadline, responsible_person } = req.body;
  const id = uuidv4();
  stmts.createCapItemGeneric.run(id, req.params.departmentId, source || 'manual', source_ref_id || null, deadline || null, responsible_person || '');
  res.status(201).json({ id });
});

// ── API: Change Requests ─────────────────────────────────────

app.get('/api/departments/:departmentId/change-requests', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getChangeRequestsByDept.all(req.params.departmentId));
});

app.post('/api/departments/:departmentId/change-requests', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { title, description, category, priority, requested_by, requested_date, target_date, change_type } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const id = uuidv4();
  const maxNo = stmts.getMaxChangeNo.get(req.params.departmentId).max_no;
  const changeNo = 'MOC-' + String(maxNo + 1).padStart(3, '0');
  stmts.createChangeRequest.run(id, dept.company_id, req.params.departmentId, changeNo, title.trim(), description || '', category || 'OFFEN', priority || 'MEDIUM', requested_by || '', requested_date || null, target_date || null, change_type || '');
  // Auto-create first task: Prüfung Prior/Non-Prior Approval
  const taskId = uuidv4();
  stmts.createChangeTask.run(taskId, id, 1, 'Prüfung Prior/Non-Prior Approval', 'Antrag', '', '', requested_by || '', null, null, '');
  const company = stmts.getCompany.get(dept.company_id);
  logAction('Change Request erstellt', 'change_request', id, changeNo + ' ' + title.trim(), '', company ? company.name : '', dept.name);
  res.status(201).json(stmts.getChangeRequest.get(id));
});

app.get('/api/change-requests/:id', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  res.json(cr);
});

app.put('/api/change-requests/:id', (req, res) => {
  const existing = stmts.getChangeRequest.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Change request not found' });
  const { title, description, category, priority, requested_by, requested_date, target_date, change_type } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  stmts.updateChangeRequest.run(title.trim(), description || '', category || 'OFFEN', priority || 'MEDIUM', requested_by || '', requested_date || null, target_date || null, change_type || '', req.params.id);
  res.json(stmts.getChangeRequest.get(req.params.id));
});

app.delete('/api/change-requests/:id', (req, res) => {
  const existing = stmts.getChangeRequest.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Change request not found' });
  try {
    const snapshot = JSON.stringify(existing);
    const dept = stmts.getDepartment.get(existing.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    stmts.createTrashItem.run(uuidv4(), 'change_request', existing.id, existing.change_no + ' ' + existing.title, company ? company.name : '', dept ? dept.name : '', existing.department_id, 'department', snapshot);
    logAction('Change Request gelöscht', 'change_request', existing.id, existing.change_no, '', company ? company.name : '', dept ? dept.name : '');
  } catch {}
  stmts.deleteChangeRequest.run(req.params.id);
  res.status(204).end();
});

// ── API: Change Request Status ─────────────────────────────
app.patch('/api/change-requests/:id/status', (req, res) => {
  const existing = stmts.getChangeRequest.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Change request not found' });
  const { status } = req.body;
  const valid = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'IMPLEMENTED', 'CLOSED', 'REJECTED'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  stmts.updateChangeRequestStatus.run(status, req.params.id);
  const dept = stmts.getDepartment.get(existing.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  logAction('Change Status geändert', 'change_request', req.params.id, existing.change_no + ' → ' + status, '', company ? company.name : '', dept ? dept.name : '');
  res.json(stmts.getChangeRequest.get(req.params.id));
});

// ── API: Change Tasks ─────────────────────────────────────────
app.get('/api/change-requests/:id/tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  res.json(stmts.getChangeTasksByRequest.all(req.params.id));
});

app.post('/api/change-requests/:id/tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header } = req.body;
  const id = uuidv4();
  const maxOrder = stmts.getMaxChangeTaskOrder.get(req.params.id).max_order;
  stmts.createChangeTask.run(id, req.params.id, maxOrder + 1, process || '', area || '', safety_note || '', measures || '', responsible_person || '', target_date || null, completion_date || null, section_header || '');
  const dept = stmts.getDepartment.get(cr.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  logAction('Aufgabe erstellt', 'change_task', id, (process || '').substring(0, 60), '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getChangeTask.get(id));
});

app.put('/api/change-tasks/:id', (req, res) => {
  const existing = stmts.getChangeTask.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { sort_order, process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header } = req.body;
  stmts.updateChangeTask.run(
    sort_order != null ? sort_order : existing.sort_order,
    process || '', area || '', safety_note || '', measures || '',
    responsible_person || '', target_date || null, completion_date || null, section_header || '',
    req.params.id
  );
  res.json(stmts.getChangeTask.get(req.params.id));
});

app.delete('/api/change-tasks/:id', (req, res) => {
  const existing = stmts.getChangeTask.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  stmts.deleteChangeTask.run(req.params.id);
  res.status(204).end();
});

// ── API: Change Request Form 2 Data ─────────────────────────
app.put('/api/change-requests/:id/form2-data', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const json = JSON.stringify(req.body || {});
  db.prepare(`UPDATE change_request SET form2_data = ?, updated_at = datetime('now') WHERE id = ?`).run(json, req.params.id);
  res.json({ ok: true });
});

// ── API: Risk Analysis ────────────────────────────────────────

function computeRiskScore(p, s) {
  if (!p || !s) return { score: null, level: '' };
  const score = p * s;
  let level = 'Gering oder kein Risiko';
  if (score >= 12) level = 'Nicht akzeptabel';
  else if (score >= 4) level = 'Akzeptabel';
  return { score, level };
}

app.get('/api/change-requests/:id/risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const ra = stmts.getRiskAnalysisByRequest.get(req.params.id);
  if (!ra) return res.json(null);
  const itemCount = stmts.getRiskItemCount.get(ra.id).cnt;
  res.json({ ...ra, item_count: itemCount });
});

app.post('/api/change-requests/:id/risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const existing = stmts.getRiskAnalysisByRequest.get(req.params.id);
  if (existing) return res.status(409).json({ error: 'Risk analysis already exists' });
  const { title, author, safety_manager } = req.body;
  const id = uuidv4();
  const today = new Date().toISOString().slice(0, 10);
  stmts.createRiskAnalysis.run(id, req.params.id, title || cr.title || '', 1, today, author || '', safety_manager || '', '', '');
  // Create initial history entry
  stmts.createRiskAnalysisHistory.run(uuidv4(), id, 1, today, author || '', 'Erstellt');
  const dept = stmts.getDepartment.get(cr.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  logAction('Risikoanalyse erstellt', 'risk_analysis', id, cr.change_no, '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getRiskAnalysis.get(id));
});

app.get('/api/risk-analysis/:id', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const itemCount = stmts.getRiskItemCount.get(ra.id).cnt;
  res.json({ ...ra, item_count: itemCount });
});

app.put('/api/risk-analysis/:id', (req, res) => {
  const existing = stmts.getRiskAnalysis.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk analysis not found' });
  const { title, version, version_date, author, safety_manager, signed_at, overall_initial, overall_residual } = req.body;
  stmts.updateRiskAnalysis.run(
    title || '', version != null ? version : existing.version, version_date || null,
    author || existing.author || '', safety_manager || '', signed_at || null,
    overall_initial || '', overall_residual || '',
    req.params.id
  );
  // Auto-history for meaningful changes
  const changes = [];
  if ((title || '') !== (existing.title || '')) changes.push('Titel');
  if ((safety_manager || '') !== (existing.safety_manager || '')) changes.push('Safety Manager');
  if ((signed_at || '') !== (existing.signed_at || '')) changes.push('Freigabe');
  res.json(stmts.getRiskAnalysis.get(req.params.id));
});

app.get('/api/risk-analysis/:id/history', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  res.json(stmts.getRiskAnalysisHistory.all(req.params.id));
});

app.post('/api/risk-analysis/:id/history', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const { version, version_date, author, reason } = req.body;
  const id = uuidv4();
  stmts.createRiskAnalysisHistory.run(id, req.params.id, version || ra.version + 1, version_date || null, author || '', reason || '');
  res.status(201).json({ id, risk_analysis_id: req.params.id, version: version || ra.version + 1, version_date, author, reason });
});

// ── API: Risk Items ───────────────────────────────────────────
app.get('/api/risk-analysis/:id/items', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  res.json(stmts.getRiskItemsByAnalysis.all(req.params.id));
});

// Helper: auto-add history entry for risk analysis changes
function addRiskHistoryAuto(raId, reason) {
  const ra = stmts.getRiskAnalysis.get(raId);
  if (!ra) return;
  const cr = stmts.getChangeRequest.get(ra.change_request_id);
  const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
  const qm = personsAll.find(p => p.role === 'QM' && dept && p.department_id === dept.id);
  const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
  const history = stmts.getRiskAnalysisHistory.all(raId);
  const nextVersion = history.length > 0 ? Math.max(...history.map(h => h.version || 0)) + 1 : 1;
  const today = new Date().toISOString().slice(0, 10);
  stmts.createRiskAnalysisHistory.run(uuidv4(), raId, nextVersion, today, qmName, reason);
}

app.post('/api/risk-analysis/:id/items', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const b = req.body;
  const id = uuidv4();
  const existingItems = stmts.getRiskItemsByAnalysis.all(req.params.id);
  const sortOrder = existingItems.length + 1;
  const ini = computeRiskScore(b.initial_probability, b.initial_severity);
  const res2 = computeRiskScore(b.residual_probability, b.residual_severity);
  stmts.createRiskItem.run(id, req.params.id, sortOrder,
    b.risk_type || '', b.description || '', b.consequence || '',
    b.initial_probability || null, b.initial_severity || null, ini.score, ini.level,
    b.responsible_person || '', b.mitigation_topic || '', b.treatment || '', b.implementation_date || null,
    b.residual_probability || null, b.residual_severity || null, res2.score, res2.level,
    b.next_step || ''
  );
  addRiskHistoryAuto(req.params.id, `Risiko hinzugefügt: ${b.risk_type || b.description || ''}`);
  res.status(201).json(stmts.getRiskItem.get(id));
});

app.put('/api/risk-items/:id', (req, res) => {
  const existing = stmts.getRiskItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk item not found' });
  const b = req.body;
  const ini = computeRiskScore(b.initial_probability, b.initial_severity);
  const res2 = computeRiskScore(b.residual_probability, b.residual_severity);
  // Detect which fields changed
  const fieldLabels = {
    risk_type: 'Risikotyp', description: 'Beschreibung', consequence: 'Auswirkung',
    responsible_person: 'Verantwortlich', mitigation_topic: 'Maßnahme', treatment: 'Behandlung',
    next_step: 'Nächster Schritt',
  };
  const changes = [];
  for (const [key, label] of Object.entries(fieldLabels)) {
    if ((b[key] || '') !== (existing[key] || '')) changes.push(label);
  }
  if ((b.initial_probability || null) != existing.initial_probability || (b.initial_severity || null) != existing.initial_severity) changes.push('Anfangsrisiko');
  if ((b.residual_probability || null) != existing.residual_probability || (b.residual_severity || null) != existing.residual_severity) changes.push('Restrisiko');
  stmts.updateRiskItem.run(
    b.sort_order != null ? b.sort_order : existing.sort_order,
    b.risk_type || '', b.description || '', b.consequence || '',
    b.initial_probability || null, b.initial_severity || null, ini.score, ini.level,
    b.responsible_person || '', b.mitigation_topic || '', b.treatment || '', b.implementation_date || null,
    b.residual_probability || null, b.residual_severity || null, res2.score, res2.level,
    b.next_step || '',
    req.params.id
  );
  res.json(stmts.getRiskItem.get(req.params.id));
});

app.delete('/api/risk-items/:id', (req, res) => {
  const existing = stmts.getRiskItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk item not found' });
  const raId = existing.risk_analysis_id;
  const desc = existing.risk_type || existing.description || '';
  stmts.deleteRiskItem.run(req.params.id);
  addRiskHistoryAuto(raId, `Risiko gelöscht: ${desc}`);
  res.status(204).end();
});

// ── API: Import Change Management .xlsx ──────────────────────
app.post('/api/change-requests/:id/import-tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File data required' });

  try {
    const buf = Buffer.from(file, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Detect layout: CAMO vs FB
    let headerRowIdx = -1;
    let isFB = false;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const rowStr = (rows[i] || []).map(c => String(c).toLowerCase()).join('|');
      if (rowStr.includes('prozesse') || rowStr.includes('maßnahmen') || rowStr.includes('massnahmen')) {
        headerRowIdx = i;
        isFB = rowStr.includes('bemerkungen') || rowStr.includes('verantwortlichkeit');
        break;
      }
    }

    if (headerRowIdx < 0) return res.status(400).json({ error: 'Konnte Spaltenüberschriften nicht finden' });

    // Extract header info from rows before header
    let importTitle = '';
    for (let i = 0; i < headerRowIdx; i++) {
      const firstCell = rows[i] && rows[i][0] ? String(rows[i][0]).trim() : '';
      if (firstCell && firstCell.length > 5 && !importTitle) importTitle = firstCell;
    }

    // Map column indices — process and measures are distinct fields
    const headerRow = rows[headerRowIdx].map(c => String(c).toLowerCase().trim());
    const colMap = {};
    headerRow.forEach((h, idx) => {
      if (h.includes('nr') && !colMap.nr) colMap.nr = idx;
      // "eingeleitete Maßnahmen" / "To Do" / "Bemerkungen" → measures (must check before process)
      if (h.includes('eingeleitete') || h.includes('to do') || h.includes('bemerkungen')) {
        colMap.measures = idx;
      }
      // "Prozesse" or standalone "Maßnahmen" (not "eingeleitete") → process
      else if ((h.includes('prozesse') || h.includes('maßnahmen') || h.includes('massnahmen')) && !colMap.process) {
        colMap.process = idx;
      }
      if (h.includes('sicherheitsbewertung')) colMap.safety_note = idx;
      if (h.includes('bereich')) colMap.area = idx;
      if (h.includes('verantwortlich') || h.includes('verantwortlichkeit')) colMap.responsible = idx;
      if (h.includes('datum') || h.includes('ziel')) colMap.target_date = idx;
      if (h.includes('erledigt') || h.includes('status')) colMap.completion = idx;
    });

    // Delete existing tasks before import
    const existingTasks = stmts.getChangeTasksByRequest.all(cr.id);
    for (const t of existingTasks) stmts.deleteChangeTask.run(t.id);

    let imported = 0;
    let currentSectionHeader = '';
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c || String(c).trim() === '')) continue;

      const processVal = colMap.process != null ? String(row[colMap.process] || '').trim() : '';
      const areaVal = colMap.area != null ? String(row[colMap.area] || '').trim() : '';

      // Detect section header: row with text in first column but no process content
      if (processVal === '' && areaVal === '' && row[0] && String(row[0]).trim().length > 1) {
        const candidate = String(row[0]).trim();
        // Only treat as section header if it's not a number
        if (isNaN(candidate)) {
          currentSectionHeader = candidate;
          continue;
        }
      }

      // Skip empty process rows
      if (!processVal && !areaVal) continue;

      let targetDateVal = colMap.target_date != null ? row[colMap.target_date] : null;
      if (typeof targetDateVal === 'number') targetDateVal = excelDateToISO(targetDateVal);
      else if (targetDateVal) targetDateVal = null; // text dates not parsed

      let completionVal = colMap.completion != null ? row[colMap.completion] : null;
      if (typeof completionVal === 'number') completionVal = excelDateToISO(completionVal);
      else if (completionVal && String(completionVal).trim().toLowerCase() === 'erledigt') {
        completionVal = new Date().toISOString().slice(0, 10);
      } else completionVal = null;

      const id = uuidv4();
      imported++;
      stmts.createChangeTask.run(id, cr.id, imported,
        processVal,
        areaVal,
        colMap.safety_note != null ? String(row[colMap.safety_note] || '').trim() : '',
        colMap.measures != null ? String(row[colMap.measures] || '').trim() : '',
        colMap.responsible != null ? String(row[colMap.responsible] || '').trim() : '',
        targetDateVal, completionVal,
        currentSectionHeader
      );
    }

    // Update change request title if we found one in the header
    if (importTitle && !cr.title) {
      db.prepare(`UPDATE change_request SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(importTitle, cr.id);
    }

    const dept = stmts.getDepartment.get(cr.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    logAction('Aufgaben importiert', 'change_request', cr.id, cr.change_no + ' (' + imported + ' Aufgaben)', '', company ? company.name : '', dept ? dept.name : '');
    res.json({ imported, title: importTitle || cr.title });
  } catch (e) {
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + e.message });
  }
});

// ── API: Import Risikoanalyse .xlsx ──────────────────────────
app.post('/api/change-requests/:id/import-risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File data required' });

  try {
    const buf = Buffer.from(file, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });

    const findSheet = (patterns) => {
      for (const name of wb.SheetNames) {
        const lower = name.toLowerCase();
        for (const p of patterns) { if (lower.includes(p)) return wb.Sheets[name]; }
      }
      return null;
    };

    const historieSheet = findSheet(['historie', 'history', 'version']);
    const detailSheet = findSheet(['detail']);
    const mainSheet = detailSheet || wb.Sheets[wb.SheetNames[wb.SheetNames.length > 2 ? 2 : 0]];

    // Delete existing risk analysis if present
    const existingRA = stmts.getRiskAnalysisByRequest.get(cr.id);
    if (existingRA) {
      db.prepare('DELETE FROM risk_item WHERE risk_analysis_id = ?').run(existingRA.id);
      db.prepare('DELETE FROM risk_analysis_history WHERE risk_analysis_id = ?').run(existingRA.id);
      db.prepare('DELETE FROM risk_analysis WHERE id = ?').run(existingRA.id);
    }

    let raTitle = cr.title;
    let raAuthor = '';
    let raSafetyManager = '';
    let overallInitial = '';
    let overallResidual = '';

    // Extract title from first row of detail sheet
    if (mainSheet) {
      const allRows = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
      if (allRows[0] && allRows[0][1]) raTitle = String(allRows[0][1]).trim();
      if (!raTitle && allRows[0] && allRows[0][0]) raTitle = String(allRows[0][0]).trim();
    }

    const raId = uuidv4();
    const today = new Date().toISOString().slice(0, 10);
    stmts.createRiskAnalysis.run(raId, cr.id, raTitle, 1, today, raAuthor, raSafetyManager, overallInitial, overallResidual);

    // ── Parse Historie ──
    let historyCount = 0;
    if (historieSheet) {
      const histRows = XLSX.utils.sheet_to_json(historieSheet, { header: 1, defval: '' });
      let hdrIdx = -1;
      for (let i = 0; i < Math.min(histRows.length, 10); i++) {
        const rowStr = histRows[i].map(c => String(c).toLowerCase()).join('|');
        if (rowStr.includes('version') && (rowStr.includes('datum') || rowStr.includes('autor'))) { hdrIdx = i; break; }
      }
      if (hdrIdx >= 0) {
        const hHdr = histRows[hdrIdx].map(c => String(c).toLowerCase().trim());
        const hColMap = {};
        hHdr.forEach((h, idx) => {
          if (h.includes('version') && !hColMap.version) hColMap.version = idx;
          if (h.includes('datum') || h.includes('date')) hColMap.date = idx;
          if (h.includes('autor') || h.includes('author')) hColMap.author = idx;
          if (h.includes('änderung') || h.includes('grund') || h.includes('bemerkung')) hColMap.reason = idx;
        });
        for (let i = hdrIdx + 1; i < histRows.length; i++) {
          const row = histRows[i];
          if (!row || row.every(c => !c || String(c).trim() === '')) continue;
          let ver = hColMap.version != null ? row[hColMap.version] : historyCount + 1;
          if (typeof ver === 'string') ver = parseInt(ver) || historyCount + 1;
          let dateVal = hColMap.date != null ? row[hColMap.date] : null;
          if (typeof dateVal === 'number') dateVal = excelDateToISO(dateVal);
          else dateVal = null;
          stmts.createRiskAnalysisHistory.run(uuidv4(), raId,
            ver, dateVal,
            hColMap.author != null ? String(row[hColMap.author] || '').trim() : '',
            hColMap.reason != null ? String(row[hColMap.reason] || '').trim() : ''
          );
          historyCount++;
        }
      }
    }
    if (historyCount === 0) {
      stmts.createRiskAnalysisHistory.run(uuidv4(), raId, 1, today, '', 'Importiert');
    }

    // ── Parse Detail sheet for risk items ──
    let itemCount = 0;
    if (mainSheet) {
      const detailRows = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });

      // Find header row containing "Risikotyp" or "Risiko-beschreibung"
      let dHdrIdx = -1;
      for (let i = 0; i < Math.min(detailRows.length, 15); i++) {
        const rowStr = detailRows[i].map(c => String(c).toLowerCase().replace(/[\s-]/g, '')).join('|');
        if (rowStr.includes('risikotyp') || rowStr.includes('risikobeschreibung')) { dHdrIdx = i; break; }
      }
      if (dHdrIdx < 0) throw new Error('Konnte Spaltenüberschriften nicht finden (Risikotyp/Risikobeschreibung)');

      // Map columns by header text
      const dHdr = detailRows[dHdrIdx].map(c => String(c).toLowerCase().replace(/[\s-]/g, '').trim());
      const dColMap = {};
      // Collect all probability and severity columns to distinguish initial vs residual
      const probCols = [];
      const sevCols = [];
      dHdr.forEach((h, idx) => {
        if ((h.includes('risikotyp') || h === 'typ') && dColMap.risk_type == null) dColMap.risk_type = idx;
        if (h.includes('risikobeschreibung') && dColMap.description == null) dColMap.description = idx;
        if (h.includes('auswirkung')) dColMap.consequence = idx;
        if (h.includes('wahrscheinlichkeit')) probCols.push(idx);
        if (h.includes('schwere')) sevCols.push(idx);
        if (h.includes('einbindung') || h.includes('verantwortlich')) dColMap.responsible = idx;
        if (h.includes('themadermassnahme') || (h.includes('thema') && h.includes('massnahme'))) dColMap.mitigation = idx;
        if (h.includes('behandlung')) dColMap.treatment = idx;
        if (h.includes('terminfür') || (h.includes('termin') && h.includes('umsetzung'))) dColMap.impl_date = idx;
        if (h.includes('nächster') || h.includes('nächsterschritt')) dColMap.next_step = idx;
      });
      // First pair = initial, second pair = residual
      if (probCols.length >= 2) { dColMap.init_prob = probCols[0]; dColMap.res_prob = probCols[1]; }
      else if (probCols.length === 1) dColMap.init_prob = probCols[0];
      if (sevCols.length >= 2) { dColMap.init_sev = sevCols[0]; dColMap.res_sev = sevCols[1]; }
      else if (sevCols.length === 1) dColMap.init_sev = sevCols[0];

      // Parse data rows — stop when we hit the embedded risk matrix or empty section
      for (let i = dHdrIdx + 1; i < detailRows.length; i++) {
        const row = detailRows[i];
        if (!row) continue;

        // Stop at embedded matrix (row starting with "Risiko" in lower columns without risk data)
        const col5Val = String(row[5] || '').toLowerCase();
        if (col5Val.includes('risikoschwere') || col5Val.includes('geringfügig')) break;

        // Skip empty rows
        const riskType = dColMap.risk_type != null ? String(row[dColMap.risk_type] || '').trim() : '';
        const desc = dColMap.description != null ? String(row[dColMap.description] || '').trim() : '';
        if (!desc && !riskType) continue;

        const initP = dColMap.init_prob != null ? parseInt(row[dColMap.init_prob]) || null : null;
        const initS = dColMap.init_sev != null ? parseInt(row[dColMap.init_sev]) || null : null;
        const resP = dColMap.res_prob != null ? parseInt(row[dColMap.res_prob]) || null : null;
        const resS = dColMap.res_sev != null ? parseInt(row[dColMap.res_sev]) || null : null;
        const ini = computeRiskScore(initP, initS);
        const residual = computeRiskScore(resP, resS);

        let implDate = dColMap.impl_date != null ? row[dColMap.impl_date] : null;
        if (typeof implDate === 'number') implDate = excelDateToISO(implDate);
        else if (implDate && typeof implDate === 'string' && implDate.trim()) implDate = null; // text dates not parsed
        else implDate = null;

        itemCount++;
        stmts.createRiskItem.run(uuidv4(), raId, itemCount,
          riskType, desc,
          dColMap.consequence != null ? String(row[dColMap.consequence] || '').trim() : '',
          initP, initS, ini.score, ini.level,
          dColMap.responsible != null ? String(row[dColMap.responsible] || '').trim() : '',
          dColMap.mitigation != null ? String(row[dColMap.mitigation] || '').trim() : '',
          dColMap.treatment != null ? String(row[dColMap.treatment] || '').trim() : '',
          implDate,
          resP, resS, residual.score, residual.level,
          dColMap.next_step != null ? String(row[dColMap.next_step] || '').trim() : ''
        );
      }

      // Extract footer: Safety Manager, overall assessments
      for (let i = dHdrIdx + 1; i < detailRows.length; i++) {
        const row = detailRows[i];
        if (!row) continue;
        const rowStr = row.map(c => String(c).toLowerCase()).join('|');
        if (rowStr.includes('safety manager') || rowStr.includes('unterschrift')) {
          // Name is usually in column 9 or nearby
          for (let c = 5; c < row.length; c++) {
            const v = String(row[c] || '').trim();
            if (v && v.length > 2 && !v.match(/^\d/) && !v.toLowerCase().includes('datum')) { raSafetyManager = v; break; }
          }
          // Date in column 5
          if (typeof row[5] === 'number') {
            const signedDate = excelDateToISO(row[5]);
            // Update signed_at
            if (signedDate) stmts.updateRiskAnalysis.run(raTitle, 1, signedDate, '', raSafetyManager, signedDate, overallInitial, overallResidual, raId);
          }
        }
        if (rowStr.includes('anfangsrisiko') || rowStr.includes('einschätzung anfangs')) {
          overallInitial = String(row[5] || '').trim();
        }
        if (rowStr.includes('nach der ma') || rowStr.includes('einschätzung risiko nach')) {
          overallResidual = String(row[5] || '').trim();
        }
      }
      // Final update with all extracted metadata
      if (overallInitial || overallResidual || raSafetyManager) {
        const ra = stmts.getRiskAnalysis.get(raId);
        stmts.updateRiskAnalysis.run(raTitle, ra.version, ra.version_date, raAuthor, raSafetyManager, ra.signed_at, overallInitial, overallResidual, raId);
      }
    }

    const dept = stmts.getDepartment.get(cr.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    logAction('Risikoanalyse importiert', 'risk_analysis', raId, cr.change_no + ' (' + itemCount + ' Risiken)', '', company ? company.name : '', dept ? dept.name : '');
    res.json({ imported: itemCount, history: historyCount, title: raTitle });
  } catch (e) {
    res.status(500).json({ error: 'Import fehlgeschlagen: ' + e.message });
  }
});

// ── API: Risk Analysis PDF ────────────────────────────────────
function renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm }) {
  function fmtDE(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : isoStr;
  }
  function riskColor(score) {
    if (score >= 12) return '#ef4444';
    if (score >= 4) return '#eab308';
    return '#22c55e';
  }
  function riskLabel(score) {
    if (score >= 12) return 'Nicht akzeptabel';
    if (score >= 4) return 'Akzeptabel';
    return 'Gering oder kein Risiko';
  }

  const marginL = 40;
  const maxY = 540; // page break threshold (landscape A4 height ~595, minus footer)
  let y = 40;

  // ── Header (like audit plans) ──
  if (logoRow && logoRow.logo) {
    try { doc.image(logoRow.logo, marginL, y, { height: 50 }); y += 60; } catch { /* skip */ }
  }
  doc.fontSize(16).font('Helvetica-Bold').text(company ? company.name : '', marginL, y);
  y += 25;
  doc.fontSize(10).font('Helvetica');
  let subLine = dept ? dept.name : '';
  if (dept && dept.easa_permission_number) subLine += `  |  ${dept.easa_permission_number}`;
  if (dept && dept.regulation) subLine += `  |  ${dept.regulation}`;
  doc.text(subLine, marginL, y);
  y += 30;

  // ── Title ──
  doc.fontSize(14).font('Helvetica-Bold').text('Risikoanalyse: ' + (ra.title || ''), marginL, y);
  y += 18;
  if (cr) { doc.fontSize(9).font('Helvetica').text(cr.change_no + (cr.title ? ' – ' + cr.title : ''), marginL, y); y += 15; }
  y += 10;

  // ── Table ──
  const pageW = doc.page.width;
  const fullTableW = pageW - marginL - 40; // use full width between margins
  const baseCols = [
    { key: 'nr', label: 'Nr.', w: 22 },
    { key: 'risk_type', label: 'Risikotyp', w: 52 },
    { key: 'description', label: 'Beschreibung', w: 85 },
    { key: 'consequence', label: 'Auswirkung', w: 85 },
    { key: 'ip', label: 'W', w: 16 }, { key: 'is', label: 'S', w: 16 }, { key: 'ic', label: '', w: 16 },
    { key: 'responsible', label: 'Verantwortlich', w: 65 },
    { key: 'mitigation', label: 'Maßnahme', w: 75 },
    { key: 'treatment', label: 'Behandlung', w: 85 },
    { key: 'rp', label: 'W', w: 16 }, { key: 'rs', label: 'S', w: 16 }, { key: 'rc', label: '', w: 16 },
    { key: 'next_step', label: 'Nächster Schritt', w: 96 },
  ];
  // Scale columns to fill full width
  const baseW = baseCols.reduce((s, c) => s + c.w, 0);
  const scale = fullTableW / baseW;
  const cols = baseCols.map(c => ({ ...c, w: Math.round(c.w * scale) }));
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const anfX = cols.slice(0, 4).reduce((s, c) => s + c.w, marginL);
  const anfW = cols[4].w + cols[5].w + cols[6].w;
  const restX = cols.slice(0, 10).reduce((s, c) => s + c.w, marginL);
  const restW = cols[10].w + cols[11].w + cols[12].w;

  // Reusable table header renderer
  function drawTableHeader() {
    doc.fontSize(7).font('Helvetica-Bold');
    // Group headers with blue background
    doc.rect(anfX, y, anfW, 10).fill('#2563eb');
    doc.fillColor('#fff').text('Anfangsrisiko', anfX + 2, y + 2, { width: anfW - 4 });
    doc.rect(restX, y, restW, 10).fill('#2563eb');
    doc.fillColor('#fff').text('Restrisiko', restX + 2, y + 2, { width: restW - 4 });
    doc.fillColor('#000');
    y += 12;
    doc.rect(marginL, y, tableW, 13).fill('#2563eb'); doc.fillColor('#fff');
    let x = marginL;
    for (const col of cols) { doc.text(col.label, x + 2, y + 3, { width: col.w - 4 }); x += col.w; }
    doc.fillColor('#000');
    y += 15;
    doc.font('Helvetica').fontSize(6.5);
  }

  drawTableHeader();

  // Data rows with dynamic height
  const textCols = ['description', 'consequence', 'responsible', 'mitigation', 'treatment', 'next_step', 'risk_type'];

  items.forEach((item, idx) => {
    const vals = {
      nr: String(idx + 1), risk_type: item.risk_type || '', description: item.description || '',
      consequence: item.consequence || '', ip: String(item.initial_probability || ''),
      is: String(item.initial_severity || ''), ic: '', responsible: item.responsible_person || '',
      mitigation: item.mitigation_topic || '', treatment: item.treatment || '',
      rp: String(item.residual_probability || ''), rs: String(item.residual_severity || ''),
      rc: '', next_step: item.next_step || '',
    };

    // Compute row height
    let maxH = 14;
    for (const col of cols) {
      if (textCols.includes(col.key) && vals[col.key]) {
        const h = doc.heightOfString(vals[col.key], { width: col.w - 4, fontSize: 6.5 });
        if (h + 6 > maxH) maxH = h + 6;
      }
    }
    maxH = Math.min(maxH, 80);

    // Page break with repeated header
    if (y + maxH > maxY) {
      doc.addPage();
      y = 40;
      drawTableHeader();
    }

    // Zebra stripe
    if (idx % 2 === 0) doc.rect(marginL, y, tableW, maxH).fill('#f8fafc').fillColor('#000');
    doc.moveTo(marginL, y + maxH).lineTo(marginL + tableW, y + maxH).strokeColor('#e2e8f0').lineWidth(0.3).stroke();

    let x = marginL;
    for (const col of cols) {
      if (col.key === 'ic' && item.initial_score) {
        doc.rect(x + 3, y + 2, 10, 10).fill(riskColor(item.initial_score)).fillColor('#000');
      } else if (col.key === 'rc' && item.residual_score) {
        doc.rect(x + 3, y + 2, 10, 10).fill(riskColor(item.residual_score)).fillColor('#000');
      } else {
        doc.text(String(vals[col.key]), x + 2, y + 3, { width: col.w - 4, height: maxH - 4 });
      }
      x += col.w;
    }
    y += maxH;
  });

  y += 20;

  // ── Overall Risk + Signature + Matrix Legend ──
  // Ensure the entire footer block fits: overall risk + signature + matrix (~300pt)
  if (y + 300 > maxY) { doc.addPage(); y = 40; }
  const footerStartY = y;
  const maxInitScore = Math.max(0, ...items.map(i => i.initial_score || 0));
  const maxResScore = Math.max(0, ...items.map(i => i.residual_score || 0));

  doc.fontSize(9).font('Helvetica-Bold');
  if (maxInitScore > 0) {
    doc.rect(marginL, y, 12, 12).fill(riskColor(maxInitScore)).fillColor('#000');
    doc.text(`  Gesamt-Anfangsrisiko: ${riskLabel(maxInitScore)}`, marginL + 16, y + 1);
    y += 18;
  }
  if (maxResScore > 0) {
    doc.rect(marginL, y, 12, 12).fill(riskColor(maxResScore)).fillColor('#000');
    doc.text(`  Gesamt-Restrisiko: ${riskLabel(maxResScore)}`, marginL + 16, y + 1);
    y += 18;
  }
  y += 30;

  // ── Signature block ──
  const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : (ra.safety_manager || '');

  // Ort, Datum above signature
  doc.fontSize(9).font('Helvetica');
  doc.text(`${company ? company.city || '' : ''}, ${fmtDE(new Date().toISOString().slice(0, 10))}`, marginL, y);
  y += 20;

  // Signature image
  if (qm) {
    const sigRow = stmts.getPersonSignature.get(qm.id);
    if (sigRow && sigRow.signature) {
      try { doc.image(sigRow.signature, marginL, y, { height: 40 }); y += 45; } catch { /* skip */ }
    }
  }

  // Line
  doc.moveTo(marginL, y).lineTo(marginL + 200, y).strokeColor('#000').lineWidth(0.5).stroke();
  y += 5;
  doc.fontSize(9).font('Helvetica');
  doc.text(qmName, marginL, y);
  y += 12;
  doc.text('Safety Manager', marginL, y);

  // ── Risk Matrix Legend (right side, matching XLSX layout) ──
  const matrixRight = marginL + tableW; // align with table right edge
  const matrixLeft = pageW / 2 + 20;
  const availW = matrixRight - matrixLeft;
  const labelW = Math.round(availW * 0.35); // space for row labels + factor
  const gridW = availW - labelW;
  const cellSz = Math.floor(gridW / 5);
  const gridX = matrixLeft + labelW;
  let my = footerStartY;

  const probLabels = ['häufig', 'gelegentlich', 'gering', 'unwahrscheinlich', 'extrem\nunwahrscheinlich'];
  const sevLabels = ['geringfügig', 'gering', 'bedeutend', 'gefährlich', 'katastrophal'];
  const probFactors = [5, 4, 3, 2, 1];
  const sevFactors = [1, 2, 3, 4, 5];

  // "Risikoschwere" header
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Risikoschwere', gridX, my, { width: cellSz * 5, align: 'center' });
  my += 12;

  // Severity column labels
  doc.fontSize(6.5).font('Helvetica');
  for (let s = 0; s < 5; s++) {
    doc.text(sevLabels[s], gridX + s * cellSz, my, { width: cellSz, align: 'center' });
  }
  my += 10;

  // "Faktor" row
  doc.fontSize(7).font('Helvetica-Bold');
  doc.text('Faktor', matrixLeft, my + 1, { width: labelW - 5, align: 'right' });
  for (let s = 0; s < 5; s++) {
    doc.text(String(sevFactors[s]), gridX + s * cellSz, my + 1, { width: cellSz, align: 'center' });
  }
  my += 14;

  // "Risikowahrscheinlichkeit" vertical label — positioned 1 char before "unwahrscheinlich"
  doc.save();
  doc.fontSize(6.5).font('Helvetica');
  const matrixTotalH = cellSz * 5;
  const unwWidth = doc.widthOfString('unwahrscheinlich', { fontSize: 6.5 });
  doc.fontSize(7).font('Helvetica-Bold');
  const labelX = gridX - 14 - unwWidth - 4; // factor col - "unwahrscheinlich" width - 1 char
  doc.translate(labelX, my + matrixTotalH / 2 + 40);
  doc.rotate(-90);
  doc.text('Risikowahrscheinlichkeit', -40, 0, { width: matrixTotalH, align: 'center' });
  doc.restore();

  // Matrix rows
  for (let p = 0; p < 5; p++) {
    // Row label + factor
    doc.fontSize(6.5).font('Helvetica');
    doc.text(probLabels[p], matrixLeft + 10, my + (cellSz - 8) / 2, { width: labelW - 22, align: 'right', lineGap: 0 });
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text(String(probFactors[p]), gridX - 12, my + (cellSz - 8) / 2, { width: 10, align: 'center' });

    // Score cells
    for (let s = 0; s < 5; s++) {
      const score = probFactors[p] * sevFactors[s];
      const color = riskColor(score);
      doc.rect(gridX + s * cellSz, my, cellSz, cellSz).fill(color);
      doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
      doc.text(String(score), gridX + s * cellSz, my + (cellSz - 9) / 2, { width: cellSz, align: 'center' });
      doc.fillColor('#000');
    }
    // Cell borders
    for (let s = 0; s <= 5; s++) {
      doc.moveTo(gridX + s * cellSz, my).lineTo(gridX + s * cellSz, my + cellSz).strokeColor('#ffffff').lineWidth(1).stroke();
    }
    doc.moveTo(gridX, my).lineTo(gridX + cellSz * 5, my).strokeColor('#ffffff').lineWidth(1).stroke();
    my += cellSz;
  }
  // Bottom border
  doc.moveTo(gridX, my).lineTo(gridX + cellSz * 5, my).strokeColor('#ffffff').lineWidth(1).stroke();

  // Legend (under matrix, one line)
  my += 8;
  let lx = gridX;
  doc.fontSize(7).font('Helvetica');
  [{ color: '#ef4444', label: 'Nicht akzeptabel' },
   { color: '#eab308', label: 'Akzeptabel' },
   { color: '#22c55e', label: 'Gering oder kein Risiko' }].forEach(entry => {
    doc.rect(lx, my, 10, 10).fill(entry.color).fillColor('#000');
    const tw = doc.widthOfString(entry.label, { fontSize: 7 });
    doc.text(entry.label, lx + 13, my + 1);
    lx += 13 + tw + 12;
  });
}

app.get('/api/risk-analysis/:id/pdf', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const cr = stmts.getChangeRequest.get(ra.change_request_id);
  const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const logoRow = company ? stmts.getCompanyLogo.get(company.id) : null;
  const items = stmts.getRiskItemsByAnalysis.all(ra.id);
  const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
  const qm = personsAll.find(p => p.role === 'QM' && dept && p.department_id === dept.id);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Risikoanalyse_${cr ? cr.change_no : 'RA'}.pdf"`);
  doc.pipe(res);
  renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm });
  addPdfFooter(doc, { label: 'Erstellt mit ac-change' });
  doc.end();
});

// ── API: Risk Analysis Send Email ────────────────────────────
app.post('/api/risk-analysis/:id/send-email', async (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const { to, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });

  try {
    // Generate PDF as buffer
    const cr = stmts.getChangeRequest.get(ra.change_request_id);
    const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
    const qm = personsAll.find(p => p.role === 'QM' && dept && p.department_id === dept.id);

    const items = stmts.getRiskItemsByAnalysis.all(ra.id);
    const logoRow = company ? stmts.getCompanyLogo.get(company.id) : null;
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm });
      addPdfFooter(doc, { label: 'Erstellt mit ac-change' });
      doc.end();
    });

    const filename = `Risikoanalyse_${cr ? cr.change_no : 'RA'}.pdf`;
    const nodemailer = require('nodemailer');
    const rows = stmts.getAllSettings.all();
    const s = {}; rows.forEach(r => { s[r.key] = r.value; });
    if (!s.smtp_host || !s.smtp_user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

    const port = parseInt(s.smtp_port) || 587;
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port, secure: port === 465,
      auth: s.smtp_auth !== 'false' ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    });

    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    let subject, text, bcc;
    if (authority) {
      const sal = dept && dept.authority_salutation ? `Sehr geehrte${dept.authority_salutation === 'Herr' ? 'r' : ''} ${dept.authority_salutation} ${dept.authority_name || ''}` : 'Sehr geehrte Damen und Herren';
      subject = `Risikoanalyse – ${cr ? cr.change_no : ''} – ${company ? company.name : ''} (${dept ? dept.name : ''})`;
      text = `${sal.trim()},\n\nanbei übersenden wir Ihnen die Risikoanalyse für ${cr ? cr.change_no + ' – ' : ''}${ra.title || ''}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}${qm ? '\nCompliance Monitoring Manager' : ''}\n${company ? company.name : ''}\n\n`;
      if (qm && qm.email) bcc = qm.email;
    } else {
      subject = `Risikoanalyse – ${cr ? cr.change_no : ''} (${dept ? dept.name : ''})`;
      text = `Hallo,\n\nanbei die Risikoanalyse für ${cr ? cr.change_no + ' – ' : ''}${ra.title || ''}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${company ? company.name : ''}\n\n`;
    }

    const mailOpts = { from: s.smtp_user, to, subject, text, attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }] };
    if (bcc) mailOpts.bcc = bcc;
    await transporter.sendMail(mailOpts);

    logAction('Risikoanalyse gesendet', 'risk_analysis', ra.id, cr ? cr.change_no : '', `An: ${to}${authority ? ' (Behörde)' : ''}`, company ? company.name : '', dept ? dept.name : '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: EASA Form 2 PDF ─────────────────────────────────────
app.get('/api/change-requests/:id/easa-form2/pdf', async (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const dept = stmts.getDepartment.get(cr.department_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(dept.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const personsAll = stmts.getPersonsByCompany.all(company.id);
  const accountable = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
  const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

  // Get form data from query string
  const formData = {
    antragsart: req.query.antragsart || 'aenderung',
    standorte: req.query.standorte || 'siehe oben',
    telefon: req.query.telefon || '',
    fax: req.query.fax || '',
    genart: req.query.genart || 'teil-145',
    scope_5a: req.query.scope_5a || '',
    scope_5b: req.query.scope_5b || '',
    scope_5c: req.query.scope_5c || '',
    scope_5d: req.query.scope_5d || '',
    scope_single: req.query.scope_single || '',
    check_5a: req.query.check_5a === 'true',
    check_5b: req.query.check_5b === 'true',
    check_5c: req.query.check_5c === 'true',
    check_5d: req.query.check_5d === 'true',
    einverstaendnis: req.query.einverstaendnis || 'ja',
  };

  try {
    const buffer = await generateEasaForm2Buffer({ cr, dept, company, accountable, qm, formData });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="EASA_Form2_${cr.change_no}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// EASA Form 2 — fill LBA template PDF form fields using pdf-lib
// Supports CAMO and Part-145 templates based on department regulation
async function generateEasaForm2Buffer({ cr, dept, company, accountable, qm, formData }) {
  const { PDFDocument: PDFLib } = require('pdf-lib');
  function fmtDate(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  const regAndName = ((dept.regulation || '') + ' ' + (dept.name || '')).toLowerCase();
  const is145 = regAndName.includes('145') || regAndName.includes('cao');
  const templateFile = is145 ? 'EASA_Form_2_Part145.pdf' : 'EASA_Form_2_CAMO.pdf';
  const templatePath = path.join(__dirname, 'public', 'templates', templateFile);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template ${templateFile} nicht gefunden`);
  }

  const templateBuf = fs.readFileSync(templatePath);
  const pdf = await PDFLib.load(templateBuf);
  const form = pdf.getForm();
  const addr = [company.street, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const amName = accountable ? `${accountable.first_name} ${accountable.last_name}`.trim() + ', Accountable Manager' : '';
  const email = qm ? (qm.email || '') : '';

  if (is145) {
    // ── Part-145 / Part-CAO template ──
    for (const field of form.getFields()) {
      if (field.constructor.name === 'PDFTextField') field.setFontSize(10);
    }

    // Antragsart
    try { form.getRadioGroup('Antragsart').select(formData.antragsart === 'erstgenehmigung' ? 'Erstgenehmigung' : '#c4nderung'); } catch {}
    // Genehmigungsart (Teil-145 vs Teil-CAO)
    try { form.getRadioGroup('Genehmigungsart').select(formData.genart === 'teil-cao' ? 'Teil-CAO' : 'Teil-145'); } catch {}
    // Genehmigungsnummer (strip prefix)
    const permNo145 = (dept.easa_permission_number || '').replace(/^DE\.145\.\s*/i, '').replace(/^DE\.CAO\.\s*/i, '');
    form.getTextField('Genehmigungsnummer').setText(permNo145);
    // Veröffentlichung
    try { form.getRadioGroup('Veröffentlichung').select(formData.einverstaendnis === 'ja' ? 'JA' : 'NEIN'); } catch {}

    form.getTextField('Name des Betriebs').setText(company.name || '');
    form.getTextField('Adresse des Betriebs').setText(addr);
    form.getTextField('Standorte').setText(formData.standorte || 'siehe oben');
    form.getTextField('Bedingungen und Umfang').setText(formData.scope_single || '');
    form.getTextField('Stellung und Name des AccM').setText(amName);
    form.getTextField('Ort der Unterschrift').setText(company.city || '');
    form.getTextField('Datum der Unterschrift').setText(fmtDate(new Date().toISOString().slice(0, 10)));
    form.getTextField('Telefonnummer').setText(formData.telefon || company.phone || '');
    form.getTextField('Faxnummer').setText(formData.fax || company.fax || '');
    form.getTextField('E-Mail').setText(email);

    // Signature for Part-145
    if (accountable) {
      const sigRow = stmts.getPersonSignature.get(accountable.id);
      if (sigRow && sigRow.signature) {
        try {
          let sigImage;
          try { sigImage = await pdf.embedPng(sigRow.signature); }
          catch { sigImage = await pdf.embedJpg(sigRow.signature); }
          // Place signature at half page width, above "Ort der Unterschrift" field
          const ortField = form.getTextField('Ort der Unterschrift');
          const widgets = ortField.acroField.getWidgets();
          if (widgets.length > 0) {
            const rect = widgets[0].getRectangle();
            const page = pdf.getPage(0);
            const pageW = page.getSize().width;
            const dims = sigImage.scaleToFit(180, 45);
            page.drawImage(sigImage, {
              x: pageW / 2, y: rect.y + rect.height + 5,
              width: dims.width, height: dims.height,
            });
          }
        } catch {}
      }
    }

  } else {
    // ── CAMO template ──
    const multilineFields = new Set([
      'beantragte Luftfahrzeugmuster', 'beantragte Privilegien',
      'beantragte organisatorische Änderungen', 'beantragte Änderungen Handbuch',
      'Adresse des Unternehmens', 'Beantragte Genehmigungsstandorte',
      'Name verantwortlicher Betriebsleiter',
    ]);
    for (const field of form.getFields()) {
      if (field.constructor.name === 'PDFTextField') {
        field.setFontSize(10);
        if (multilineFields.has(field.getName())) field.enableMultiline();
      }
    }

    form.getRadioGroup('Antragsart').select(formData.antragsart === 'erstgenehmigung' ? 'Erstgenehmigung' : 'Änderung');
    const permNo = (dept.easa_permission_number || '').replace(/^DE\.CAMO\.\s*/i, '');
    form.getTextField('Genehmigungsnummer CAMO').setText(permNo);
    form.getTextField('Name des Unternehmens').setText(company.name || '');
    form.getTextField('Adresse des Unternehmens').setText(addr);
    form.getTextField('Telefon').setText(formData.telefon || company.phone || '');
    form.getTextField('E-Mail').setText(email);
    form.getTextField('Beantragte Genehmigungsstandorte').setText(formData.standorte || 'siehe oben');

    if (formData.check_5a) form.getCheckBox('Antrag Luftfahrzeugmuster').check();
    form.getTextField('beantragte Luftfahrzeugmuster').setText(formData.scope_5a || '');
    if (formData.check_5b) form.getCheckBox('Antrag Privilegien').check();
    form.getTextField('beantragte Privilegien').setText(formData.scope_5b || '');
    if (formData.check_5c) form.getCheckBox('Antrag organisatorische Änderungen').check();
    form.getTextField('beantragte organisatorische Änderungen').setText(formData.scope_5c || '');
    if (formData.check_5d) form.getCheckBox('Antrag Änderungen Handbuch').check();
    form.getTextField('beantragte Änderungen Handbuch').setText(formData.scope_5d || '');

    form.getRadioGroup('Einverständniserklärung').select(formData.einverstaendnis === 'ja' ? 'Ja' : 'Nein');
    form.getTextField('Name verantwortlicher Betriebsleiter').setText(amName);
    form.getTextField('Datum').setText(fmtDate(new Date().toISOString().slice(0, 10)));

    // Embed signature into CAMO template
    if (accountable) {
      const sigRow = stmts.getPersonSignature.get(accountable.id);
      if (sigRow && sigRow.signature) {
        try {
          let sigImage;
          try { sigImage = await pdf.embedPng(sigRow.signature); }
          catch { sigImage = await pdf.embedJpg(sigRow.signature); }
          const sigField = form.getTextField('Unterschrift Betriebsleiter');
          const widgets = sigField.acroField.getWidgets();
          if (widgets.length > 0) {
            const rect = widgets[0].getRectangle();
            const page = pdf.getPage(1);
            const dims = sigImage.scaleToFit(rect.width, rect.height);
            page.drawImage(sigImage, {
              x: rect.x, y: rect.y + (rect.height - dims.height) / 2,
              width: dims.width, height: dims.height,
            });
          }
        } catch {}
      }
    }
  }

  // Flatten form so fields are not editable in output
  form.flatten();

  // Remove instruction pages (keep only form pages)
  const pageCount = pdf.getPageCount();
  const keepPages = is145 ? 1 : 2;
  for (let i = pageCount - 1; i >= keepPages; i--) {
    pdf.removePage(i);
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

// ── API: Send Change Email ───────────────────────────────────
app.post('/api/change-requests/:id/send-email', async (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { to, type } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });

  try {
    const dept = stmts.getDepartment.get(cr.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
    const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

    if (type === 'form2') {
      // Generate EASA Form 2 PDF from template
      const formData = req.body.formData || {};
      // Ensure checkbox booleans
      formData.check_5a = formData.check_5a === true || formData.check_5a === 'true';
      formData.check_5b = formData.check_5b === true || formData.check_5b === 'true';
      formData.check_5c = formData.check_5c === true || formData.check_5c === 'true';
      formData.check_5d = formData.check_5d === true || formData.check_5d === 'true';
      const accountable = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

      const buffer = await generateEasaForm2Buffer({ cr, dept, company, accountable, qm, formData });
      const filename = `EASA_Form2_${cr.change_no}.pdf`;

      const nodemailer = require('nodemailer');
      const rows = stmts.getAllSettings.all();
      const s = {};
      rows.forEach(r => { s[r.key] = r.value; });
      if (!s.smtp_host || !s.smtp_user) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });

      const port = parseInt(s.smtp_port) || 587;
      const auth = s.smtp_auth !== 'false';
      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port, secure: port === 465,
        auth: auth ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
      });

      const subject = `EASA Form 2 – ${cr.change_no} – ${company.name} (${dept.name})`;
      const text = `Sehr geehrte Damen und Herren,\n\nanbei übersenden wir Ihnen den Antrag EASA Form 2 für ${cr.change_no} – ${cr.title}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${company.name}\n\n`;

      const mailOpts = {
        from: s.smtp_user,
        to, subject, text,
        attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
      };
      if (qm && qm.email) mailOpts.bcc = qm.email;
      await transporter.sendMail(mailOpts);

      logAction('EASA Form 2 gesendet', 'change_request', cr.id, cr.change_no, `An: ${to}`, company ? company.name : '', dept ? dept.name : '');
      res.json({ ok: true });
    } else {
      return res.status(400).json({ error: 'Unbekannter E-Mail-Typ' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ac-audit running on http://localhost:${PORT}`);
});
