const express = require('express');
const fs = require('fs');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { getSmtpConfig, createTransporter } = require('../services/email');
const { getNotifySettings, buildNotifyHtml } = require('../services/notifications');

const router = express.Router();

router.get('/api/settings', (req, res) => {
  const rows = stmts.getAllSettings.all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.put('/api/settings', (req, res) => {
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

router.post('/api/settings/test-email', async (req, res) => {
  const { to, module } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
  const smtp = getSmtpConfig(module || 'audit');
  if (!smtp) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });
  const transporter = createTransporter(smtp);
  const label = module === 'change' ? 'AC-Change' : 'AC-Audit';
  try {
    await transporter.sendMail({
      from: smtp.user, to,
      subject: `${label} – Test E-Mail`,
      text: `Diese E-Mail wurde als Test aus ${label} gesendet.`,
    });
    logAction('Test-E-Mail gesendet', 'settings', '', '', `${to} (${label})`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/settings/notify-test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'Test E-Mail-Adresse erforderlich' });

    const smtpCheck = getSmtpConfig('audit');
    if (!smtpCheck) return res.status(400).json({ error: 'SMTP-Einstellungen (AC-Audit) unvollständig' });

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

    const smtp = getSmtpConfig('audit');
    if (!smtp) return res.status(400).json({ error: 'SMTP-Einstellungen unvollständig' });
    const transporter = createTransporter(smtp);

    const overdue = items.filter(i => i.deadline < new Date().toISOString().slice(0, 10));
    const upcoming = items.filter(i => i.deadline >= new Date().toISOString().slice(0, 10));
    const subject = `AC Audit [TEST] – ${overdue.length} überfällig, ${upcoming.length} bald fällig`;

    await transporter.sendMail({
      from: smtp.user, to, subject,
      html: buildNotifyHtml(items),
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
