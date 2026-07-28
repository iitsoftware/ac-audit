const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { logAction, formatDateDE } = require('../services/audit-log');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { snapshotSafetyYear, snapshotSmsMeeting } = require('../services/trash');
const { generateSmsMeetingPdfBuffer } = require('../pdf/safety');

const router = express.Router();

function deptContext(departmentId) {
  const dept = stmts.getDepartment.get(departmentId);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  return { dept, company };
}

// Human-readable meeting name used for log entries, trash names, PDF file names
// and email subjects — "SRB Nr. 4 – 19.12.2025", or "SRB Meeting 19.12.2025"
// when the meeting has no number yet.
function meetingLabel(meeting) {
  const no = (meeting.meeting_no || '').trim();
  const date = formatDateDE(meeting.meeting_date);
  const prefix = no ? `SRB Nr. ${no}` : 'SRB Meeting';
  if (!date) return prefix;
  return no ? `${prefix} – ${date}` : `${prefix} ${date}`;
}

// ── Safety Years (navigation root: Firma → Abteilung → Jahr) ──

router.get('/api/departments/:departmentId/safety-years', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getSafetyYearsByDepartment.all(req.params.departmentId));
});

router.post('/api/departments/:departmentId/safety-years', (req, res) => {
  const { dept, company } = deptContext(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const year = req.body.year;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Jahr ist erforderlich' });
  if (stmts.getSafetyYearByDeptAndYear.get(req.params.departmentId, year)) {
    return res.status(409).json({ error: `Jahr ${year} existiert bereits für diese Abteilung` });
  }
  const id = uuidv4();
  stmts.createSafetyYear.run(id, req.params.departmentId, year);
  logAction('Safety-Jahr erstellt', 'safety_year', id, String(year), '', company ? company.name : '', dept.name);
  res.status(201).json(stmts.getSafetyYear.get(id));
});

router.put('/api/safety-years/:id', (req, res) => {
  const existing = stmts.getSafetyYear.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety year not found' });
  const year = req.body.year;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Jahr ist erforderlich' });
  const clash = stmts.getSafetyYearByDeptAndYear.get(existing.department_id, year);
  if (clash && clash.id !== existing.id) {
    return res.status(409).json({ error: `Jahr ${year} existiert bereits für diese Abteilung` });
  }
  stmts.updateSafetyYear.run(year, req.params.id);
  const { dept, company } = deptContext(existing.department_id);
  logAction('Safety-Jahr geändert', 'safety_year', req.params.id, String(year), `Vorher: ${existing.year}`,
    company ? company.name : '', dept ? dept.name : '');
  res.json(stmts.getSafetyYear.get(req.params.id));
});

router.delete('/api/safety-years/:id', (req, res) => {
  const existing = stmts.getSafetyYear.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety year not found' });
  const { dept, company } = deptContext(existing.department_id);
  try {
    const snapshot = snapshotSafetyYear(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'safety_year', req.params.id, String(existing.year),
        company ? company.name : '', dept ? dept.name : '', existing.department_id, 'department', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSafetyYear.run(req.params.id); // meetings cascade
  logAction('Safety-Jahr gelöscht', 'safety_year', req.params.id, String(existing.year), '',
    company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

// ── SRB Meetings (CM-025 Sitzungsprotokoll) ──────────────

router.get('/api/safety-years/:yearId/sms-meetings', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  res.json(stmts.getSmsMeetingsByYear.all(req.params.yearId));
});

router.post('/api/safety-years/:yearId/sms-meetings', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  const { dept, company } = deptContext(year.department_id);
  const b = req.body;
  const id = uuidv4();
  stmts.createSmsMeeting.run(
    id, req.params.yearId, year.department_id, b.meeting_date || null,
    b.location || '', b.participants || '', b.participants_excused || '', b.meeting_no || '',
    b.topics || '', b.general_result || '', b.positives || '', b.negatives || '',
    b.improvements || '', b.remarks || '', b.outlook || ''
  );
  const meeting = stmts.getSmsMeeting.get(id);
  logAction('SRB-Meeting erstellt', 'sms_meeting', id, meetingLabel(meeting), '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(meeting);
});

router.get('/api/sms-meetings/:id', (req, res) => {
  const meeting = stmts.getSmsMeeting.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'SMS meeting not found' });
  res.json(meeting);
});

router.put('/api/sms-meetings/:id', (req, res) => {
  const existing = stmts.getSmsMeeting.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SMS meeting not found' });
  const b = req.body;
  stmts.updateSmsMeeting.run(
    b.meeting_date !== undefined ? b.meeting_date : existing.meeting_date,
    b.location !== undefined ? b.location : existing.location,
    b.participants !== undefined ? b.participants : existing.participants,
    b.participants_excused !== undefined ? b.participants_excused : existing.participants_excused,
    b.meeting_no !== undefined ? b.meeting_no : existing.meeting_no,
    b.topics !== undefined ? b.topics : existing.topics,
    b.general_result !== undefined ? b.general_result : existing.general_result,
    b.positives !== undefined ? b.positives : existing.positives,
    b.negatives !== undefined ? b.negatives : existing.negatives,
    b.improvements !== undefined ? b.improvements : existing.improvements,
    b.remarks !== undefined ? b.remarks : existing.remarks,
    b.outlook !== undefined ? b.outlook : existing.outlook,
    req.params.id
  );
  const meeting = stmts.getSmsMeeting.get(req.params.id);
  const { dept, company } = deptContext(meeting.department_id);
  logAction('SRB-Meeting geändert', 'sms_meeting', req.params.id, meetingLabel(meeting), '', company ? company.name : '', dept ? dept.name : '');
  res.json(meeting);
});

router.delete('/api/sms-meetings/:id', (req, res) => {
  const existing = stmts.getSmsMeeting.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SMS meeting not found' });
  const { dept, company } = deptContext(existing.department_id);
  try {
    const snapshot = snapshotSmsMeeting(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'sms_meeting', req.params.id, meetingLabel(existing),
        company ? company.name : '', dept ? dept.name : '', existing.safety_year_id, 'safety_year', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSmsMeeting.run(req.params.id);
  logAction('SRB-Meeting gelöscht', 'sms_meeting', req.params.id, meetingLabel(existing), '', company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

router.get('/api/sms-meetings/:id/pdf', async (req, res) => {
  const meeting = stmts.getSmsMeeting.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'SMS meeting not found' });
  try {
    const { buffer } = await generateSmsMeetingPdfBuffer(req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="SRB-Meeting_${meeting.meeting_date || 'Protokoll'}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/sms-meetings/:id/send-email', async (req, res) => {
  const meeting = stmts.getSmsMeeting.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'SMS meeting not found' });
  const { to, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
  try {
    const { buffer, dept, company } = await generateSmsMeetingPdfBuffer(req.params.id);
    const qm = getQmForDepartment(company.id, dept.id);
    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    const label = meetingLabel(meeting);
    let subject, text;
    if (authority) {
      subject = `SRB Meeting Protokoll – ${label} – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen das SRB Meeting Protokoll (${label}).\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    } else {
      subject = `SRB Meeting Protokoll – ${label} (${dept.name})`;
      text = `Hallo,\n\nanbei das SRB Meeting Protokoll (${label}).\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'change', to, subject, text,
      filename: `SRB-Meeting_${meeting.meeting_date || 'Protokoll'}.pdf`, buffer, qm,
      logParams: ['SRB Meeting Protokoll gesendet', 'sms_meeting', meeting.id, label, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

module.exports = router;
