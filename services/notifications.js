const { db, stmts } = require('../db');
const { getSmtpConfig, createTransporter } = require('./email');

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

async function sendNotification() {
  const cfg = getNotifySettings();
  if (!cfg.enabled) return;

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

  const smtp = getSmtpConfig('audit');
  if (!smtp) return;
  const transporter = createTransporter(smtp);

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
      from: smtp.user, to: qm.email, replyTo: qm.email, subject,
      html: buildNotifyHtml(deptItems),
    });

    if (!cfg.repeat) {
      for (const item of deptItems) stmts.markCapNotified.run(item.id);
    }

    sent++;
    console.log(`[Notify] E-Mail gesendet an ${qm.email} (${deptItems[0].department_name}): ${deptItems.length} CAP(s)`);
  }

  return sent;
}

function startNotifyScheduler() {
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
  }, 60000);
}

module.exports = {
  getNotifySettings,
  buildNotifyHtml,
  buildNotifyTable,
  sendNotification,
  startNotifyScheduler,
};
