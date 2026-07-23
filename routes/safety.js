const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('../db');
const { logAction, formatDateDE } = require('../services/audit-log');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { snapshotSmsMeeting, snapshotSafetyObjective, snapshotSpiEvaluation } = require('../services/trash');
const { generateSmsMeetingPdfBuffer, generateSpiEvaluationPdfBuffer } = require('../pdf/safety');

const router = express.Router();

const MEETING_TYPE_LABELS = { MANAGEMENT_REVIEW: 'Management Review', SRB: 'SRB' };

const getAllOpenSpiFindings = db.prepare(
  `SELECT e.id, e.safety_objective_id, e.eval_date, e.spi_value, e.fulfilled, e.result, e.improvement,
          e.decided_at, e.closed_at, o.objective, o.spt, o.department_id,
          d.name AS department_name, c.name AS company_name
   FROM spi_evaluation e
   JOIN safety_objective o ON o.id = e.safety_objective_id
   JOIN department d ON d.id = o.department_id
   JOIN company c ON c.id = d.company_id
   WHERE (e.fulfilled = 0 OR e.result = 'NEGATIV' OR e.improvement = 1)
     AND (e.closed_at IS NULL OR e.closed_at = '')
   ORDER BY e.eval_date DESC`
);

function deptContext(departmentId) {
  const dept = stmts.getDepartment.get(departmentId);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  return { dept, company };
}

function meetingLabel(meeting) {
  const type = MEETING_TYPE_LABELS[meeting.meeting_type] || meeting.meeting_type || '';
  const date = formatDateDE(meeting.meeting_date);
  return date ? `${type} ${date}` : type;
}

// ── SMS Meetings (Management Review / SRB) ───────────────

router.get('/api/departments/:departmentId/sms-meetings', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getSmsMeetingsByDepartment.all(req.params.departmentId));
});

router.post('/api/departments/:departmentId/sms-meetings', (req, res) => {
  const { dept, company } = deptContext(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const b = req.body;
  const id = uuidv4();
  stmts.createSmsMeeting.run(
    id, req.params.departmentId, b.meeting_type || 'MANAGEMENT_REVIEW', b.meeting_date || null,
    b.participants || '', b.topics || '', b.results || '', b.actions || ''
  );
  const meeting = stmts.getSmsMeeting.get(id);
  logAction('SMS-Meeting erstellt', 'sms_meeting', id, meetingLabel(meeting), '', company ? company.name : '', dept.name);
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
    b.meeting_type || existing.meeting_type, b.meeting_date !== undefined ? b.meeting_date : existing.meeting_date,
    b.participants !== undefined ? b.participants : existing.participants,
    b.topics !== undefined ? b.topics : existing.topics,
    b.results !== undefined ? b.results : existing.results,
    b.actions !== undefined ? b.actions : existing.actions,
    req.params.id
  );
  res.json(stmts.getSmsMeeting.get(req.params.id));
});

router.delete('/api/sms-meetings/:id', (req, res) => {
  const existing = stmts.getSmsMeeting.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SMS meeting not found' });
  const { dept, company } = deptContext(existing.department_id);
  try {
    const snapshot = snapshotSmsMeeting(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'sms_meeting', req.params.id, meetingLabel(existing),
        company ? company.name : '', dept ? dept.name : '', existing.department_id, 'department', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSmsMeeting.run(req.params.id);
  logAction('SMS-Meeting gelöscht', 'sms_meeting', req.params.id, meetingLabel(existing), '', company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

router.get('/api/sms-meetings/:id/pdf', async (req, res) => {
  const meeting = stmts.getSmsMeeting.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'SMS meeting not found' });
  try {
    const { buffer } = await generateSmsMeetingPdfBuffer(req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="SMS-Sitzungsprotokoll_${meeting.meeting_date || 'Protokoll'}.pdf"`);
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
      subject = `SMS-Sitzungsprotokoll – ${label} – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen das SMS-Sitzungsprotokoll (${label}).\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    } else {
      subject = `SMS-Sitzungsprotokoll – ${label} (${dept.name})`;
      text = `Hallo,\n\nanbei das SMS-Sitzungsprotokoll (${label}).\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'change', to, subject, text,
      filename: `SMS-Sitzungsprotokoll_${meeting.meeting_date || 'Protokoll'}.pdf`, buffer, qm,
      logParams: ['SMS-Sitzungsprotokoll gesendet', 'sms_meeting', meeting.id, label, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── Safety Objectives (SPI definitions) ──────────────────

router.get('/api/departments/:departmentId/safety-objectives', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const objectives = stmts.getSafetyObjectivesByDepartment.all(req.params.departmentId);
  const counts = stmts.getSpiFindingCountsByObjective.all(req.params.departmentId);
  const countsById = new Map(counts.map(c => [c.safety_objective_id, c]));
  res.json(objectives.map(o => {
    const c = countsById.get(o.id);
    return { ...o, eval_count: c ? c.eval_count : 0, open_finding_count: c ? c.open_finding_count : 0 };
  }));
});

router.post('/api/departments/:departmentId/safety-objectives', (req, res) => {
  const { dept, company } = deptContext(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const b = req.body;
  if (!b.objective || !b.objective.trim()) return res.status(400).json({ error: 'Objective is required' });
  const id = uuidv4();
  const maxOrder = stmts.getMaxSafetyObjectiveOrder.get(req.params.departmentId).max_order;
  stmts.createSafetyObjective.run(
    id, req.params.departmentId, maxOrder + 1, b.objective.trim(), b.spt || '',
    b.interval_months != null ? b.interval_months : 12, b.active != null ? b.active : 1
  );
  logAction('Safety Objective erstellt', 'safety_objective', id, b.objective.trim(), '', company ? company.name : '', dept.name);
  res.status(201).json(stmts.getSafetyObjective.get(id));
});

router.put('/api/safety-objectives/:id', (req, res) => {
  const existing = stmts.getSafetyObjective.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety objective not found' });
  const b = req.body;
  if (!b.objective || !b.objective.trim()) return res.status(400).json({ error: 'Objective is required' });
  stmts.updateSafetyObjective.run(
    b.sort_order != null ? b.sort_order : existing.sort_order,
    b.objective.trim(), b.spt !== undefined ? b.spt : existing.spt,
    b.interval_months != null ? b.interval_months : existing.interval_months,
    b.active != null ? b.active : existing.active,
    req.params.id
  );
  res.json(stmts.getSafetyObjective.get(req.params.id));
});

router.delete('/api/safety-objectives/:id', (req, res) => {
  const existing = stmts.getSafetyObjective.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety objective not found' });
  const { dept, company } = deptContext(existing.department_id);
  try {
    const snapshot = snapshotSafetyObjective(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'safety_objective', req.params.id, existing.objective || '',
        company ? company.name : '', dept ? dept.name : '', existing.department_id, 'department', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSafetyObjective.run(req.params.id);
  logAction('Safety Objective gelöscht', 'safety_objective', req.params.id, existing.objective || '', '', company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

router.patch('/api/departments/:departmentId/safety-objectives/reorder', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { order } = req.body; // array of objective IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
  const reorderTx = db.transaction(() => {
    order.forEach((id, idx) => {
      stmts.updateSafetyObjectiveSortOrder.run(idx + 1, id);
    });
  });
  reorderTx();
  res.json(stmts.getSafetyObjectivesByDepartment.all(req.params.departmentId));
});

// ── SPI Evaluations (Bewertungen) ────────────────────────

router.get('/api/safety-objectives/:objectiveId/spi-evaluations', (req, res) => {
  const objective = stmts.getSafetyObjective.get(req.params.objectiveId);
  if (!objective) return res.status(404).json({ error: 'Safety objective not found' });
  res.json(stmts.getSpiEvaluationsByObjective.all(req.params.objectiveId));
});

router.post('/api/safety-objectives/:objectiveId/spi-evaluations', (req, res) => {
  const objective = stmts.getSafetyObjective.get(req.params.objectiveId);
  if (!objective) return res.status(404).json({ error: 'Safety objective not found' });
  const b = req.body;
  const id = uuidv4();
  // SPT + interval are snapshotted from the objective at creation time so the
  // evaluation stays historically accurate when the objective is edited later
  stmts.createSpiEvaluation.run(
    id, req.params.objectiveId, b.eval_date || null, objective.spt || '', objective.interval_months,
    b.spi_value || '', b.fulfilled != null ? b.fulfilled : 1, b.result || 'POSITIV',
    b.improvement != null ? b.improvement : 0, b.cause_analysis || '', b.measures || '',
    b.decision || '', b.decision_place || '', b.decided_at || null, b.closed_at || null
  );
  const { dept, company } = deptContext(objective.department_id);
  logAction('SPI-Bewertung erstellt', 'spi_evaluation', id, objective.objective || '', formatDateDE(b.eval_date) || '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getSpiEvaluation.get(id));
});

router.get('/api/spi-evaluations/:id', (req, res) => {
  const evaluation = stmts.getSpiEvaluation.get(req.params.id);
  if (!evaluation) return res.status(404).json({ error: 'SPI evaluation not found' });
  res.json(evaluation);
});

router.put('/api/spi-evaluations/:id', (req, res) => {
  const existing = stmts.getSpiEvaluationRaw.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SPI evaluation not found' });
  const b = req.body;
  // Snapshots are immutable — set once at creation, never overwritten by edits
  stmts.updateSpiEvaluation.run(
    b.eval_date !== undefined ? b.eval_date : existing.eval_date,
    existing.spt_snapshot, existing.interval_snapshot,
    b.spi_value !== undefined ? b.spi_value : existing.spi_value,
    b.fulfilled != null ? b.fulfilled : existing.fulfilled,
    b.result || existing.result,
    b.improvement != null ? b.improvement : existing.improvement,
    b.cause_analysis !== undefined ? b.cause_analysis : existing.cause_analysis,
    b.measures !== undefined ? b.measures : existing.measures,
    b.decision !== undefined ? b.decision : existing.decision,
    b.decision_place !== undefined ? b.decision_place : existing.decision_place,
    b.decided_at !== undefined ? b.decided_at : existing.decided_at,
    b.closed_at !== undefined ? b.closed_at : existing.closed_at,
    req.params.id
  );
  res.json(stmts.getSpiEvaluation.get(req.params.id));
});

router.delete('/api/spi-evaluations/:id', (req, res) => {
  const existing = stmts.getSpiEvaluationRaw.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SPI evaluation not found' });
  const objective = stmts.getSafetyObjective.get(existing.safety_objective_id);
  const { dept, company } = objective ? deptContext(objective.department_id) : { dept: null, company: null };
  const entityName = `${objective ? objective.objective : ''} ${formatDateDE(existing.eval_date) || ''}`.trim();
  try {
    const snapshot = snapshotSpiEvaluation(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'spi_evaluation', req.params.id, entityName,
        company ? company.name : '', dept ? dept.name : '', existing.safety_objective_id, 'safety_objective', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSpiEvaluation.run(req.params.id);
  logAction('SPI-Bewertung gelöscht', 'spi_evaluation', req.params.id, entityName, '', company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

router.patch('/api/spi-evaluations/:id/close', (req, res) => {
  const existing = stmts.getSpiEvaluationRaw.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SPI evaluation not found' });
  const today = new Date().toISOString().slice(0, 10);
  stmts.updateSpiEvaluation.run(
    existing.eval_date, existing.spt_snapshot, existing.interval_snapshot, existing.spi_value,
    existing.fulfilled, existing.result, existing.improvement, existing.cause_analysis,
    existing.measures, existing.decision, existing.decision_place, existing.decided_at,
    today, req.params.id
  );
  const objective = stmts.getSafetyObjective.get(existing.safety_objective_id);
  const { dept, company } = objective ? deptContext(objective.department_id) : { dept: null, company: null };
  logAction('SPI-Finding geschlossen', 'spi_evaluation', req.params.id, objective ? objective.objective : '', formatDateDE(existing.eval_date) || '', company ? company.name : '', dept ? dept.name : '');
  res.json(stmts.getSpiEvaluation.get(req.params.id));
});

router.get('/api/spi-evaluations/:id/pdf', async (req, res) => {
  const evaluation = stmts.getSpiEvaluationRaw.get(req.params.id);
  if (!evaluation) return res.status(404).json({ error: 'SPI evaluation not found' });
  try {
    const { buffer } = await generateSpiEvaluationPdfBuffer(req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="Safety-Performance-Analysis_${evaluation.eval_date || 'SPI'}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/spi-evaluations/:id/send-email', async (req, res) => {
  const evaluation = stmts.getSpiEvaluationRaw.get(req.params.id);
  if (!evaluation) return res.status(404).json({ error: 'SPI evaluation not found' });
  const { to, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
  try {
    const objective = stmts.getSafetyObjective.get(evaluation.safety_objective_id);
    const { buffer, dept, company } = await generateSpiEvaluationPdfBuffer(req.params.id);
    const qm = getQmForDepartment(company.id, dept.id);
    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    const label = `${objective ? objective.objective : ''} ${formatDateDE(evaluation.eval_date) || ''}`.trim();
    let subject, text;
    if (authority) {
      subject = `Safety Performance Analysis – ${label} – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen die Safety Performance Analysis (${label}).\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    } else {
      subject = `Safety Performance Analysis – ${label} (${dept.name})`;
      text = `Hallo,\n\nanbei die Safety Performance Analysis (${label}).\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'change', to, subject, text,
      filename: `Safety-Performance-Analysis_${evaluation.eval_date || 'SPI'}.pdf`, buffer, qm,
      logParams: ['Safety Performance Analysis gesendet', 'spi_evaluation', evaluation.id, label, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── SPI Findings (derived, open) ─────────────────────────

router.get('/api/departments/:departmentId/spi-findings', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getOpenSpiFindingsByDepartment.all(req.params.departmentId));
});

router.get('/api/spi-findings/all', (req, res) => {
  res.json(getAllOpenSpiFindings.all());
});

module.exports = router;
