const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('../db');
const { logAction, formatDateDE } = require('../services/audit-log');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { snapshotSafetyYear, snapshotSmsMeeting, snapshotSafetyObjective, snapshotSpiEvaluation } = require('../services/trash');
const { seedObjectivesForYear } = require('../services/safety-defaults');
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

// Ein Sicherheitsjahr entsteht nie ohne Zielkatalog: Anlegen und Seeding laufen in
// EINER Transaktion, ein Fehler beim Seeding rollt also auch das Jahr zurück.
// Ohne `source` gewinnt der Vorjahreskatalog, sonst greift der eingebaute Standard —
// das ist genau das Default-Verhalten von seedObjectivesForYear().
const createSafetyYearWithCatalog = db.transaction((id, departmentId, year) => {
  stmts.createSafetyYear.run(id, departmentId, year);
  return seedObjectivesForYear(id);
});

// Quellen-Bezeichnung für Log-Detail und API-Antwort.
const SEED_SOURCE_LABELS = { previous: 'Vorjahreskatalog', default: 'Standardkatalog' };

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
  const seeded = createSafetyYearWithCatalog(id, req.params.departmentId, year);
  const detail = seeded.created
    ? `Katalog: ${seeded.created} Ziele aus ${SEED_SOURCE_LABELS[seeded.source]}`
    : '';
  logAction('Safety-Jahr erstellt', 'safety_year', id, String(year), detail, company ? company.name : '', dept.name);
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

// ── Sicherheitszielkatalog (CM-006 Objectives) ───────────

// Der Titel ist die CM-006-Spalte "Objective" und im Dialog Pflichtfeld — er ist
// damit auch das Label für Log-Einträge und Papierkorb.
function objectiveLabel(objective) {
  return (objective.title || '').trim() || 'Sicherheitsziel';
}

// spt_value ist REAL und optional: leer/ungültig heißt "kein maschinenlesbares
// Ziel", also NULL — dann schlägt das Frontend schlicht kein Rating vor.
function normalizeSptValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeIntervalMonths(value) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : 12;
}

router.get('/api/safety-years/:yearId/objectives', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  res.json(stmts.getSafetyObjectivesByYear.all(req.params.yearId));
});

router.post('/api/safety-years/:yearId/objectives', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  const { dept, company } = deptContext(year.department_id);
  const b = req.body;
  const title = (b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });
  // Neue Ziele hängen sich unten an den Katalog; die Reihenfolge selbst pflegt
  // der Nutzer über die Reorder-Route.
  const existing = stmts.getSafetyObjectivesByYearRaw.all(req.params.yearId);
  const sortOrder = existing.reduce((max, o) => Math.max(max, o.sort_order || 0), -1) + 1;
  const id = uuidv4();
  stmts.createSafetyObjective.run(
    id, req.params.yearId, year.department_id, sortOrder, title,
    b.objective || '', b.spt || '', b.spt_direction || '', normalizeSptValue(b.spt_value),
    b.spi_description || '', normalizeIntervalMonths(b.interval_months),
    (b.active === undefined || Number(b.active)) ? 1 : 0 // neue Ziele sind aktiv
  );
  logAction('Sicherheitsziel erstellt', 'safety_objective', id, title, `Jahr: ${year.year}`,
    company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getSafetyObjective.get(id));
});

router.post('/api/safety-years/:yearId/seed-objectives', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  const { source } = req.body || {};
  if (source !== undefined && source !== 'previous' && source !== 'default') {
    return res.status(400).json({ error: "source muss 'previous' oder 'default' sein" });
  }
  // seedObjectivesForYear ist idempotent und würde einen gefüllten Katalog still
  // unangetastet lassen — hier ist das Nachladen aber ein ausdrücklicher Wunsch,
  // also wird der Konflikt gemeldet statt "0 Ziele übernommen" zu quittieren.
  if (stmts.getSafetyObjectivesByYearRaw.all(req.params.yearId).length) {
    return res.status(409).json({ error: 'Der Zielkatalog dieses Jahres ist nicht leer' });
  }
  const { dept, company } = deptContext(year.department_id);
  const seeded = seedObjectivesForYear(req.params.yearId, source);
  if (!seeded.created) {
    return res.status(409).json({ error: 'Kein Vorjahreskatalog vorhanden' });
  }
  logAction('Sicherheitszielkatalog übernommen', 'safety_year', req.params.yearId, String(year.year),
    `${seeded.created} Ziele aus ${SEED_SOURCE_LABELS[seeded.source]}`,
    company ? company.name : '', dept ? dept.name : '');
  res.status(201).json({ created: seeded.created, source: seeded.source });
});

router.patch('/api/safety-years/:yearId/objectives/reorder', (req, res) => {
  const year = stmts.getSafetyYear.get(req.params.yearId);
  if (!year) return res.status(404).json({ error: 'Safety year not found' });
  const { ids } = req.body; // array of objective IDs in desired order
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array of IDs' });
  // Nur Ziele DIESES Jahres werden umsortiert — eine fremde ID im Array darf den
  // Katalog eines anderen Jahres nicht umschreiben.
  const own = new Set(stmts.getSafetyObjectivesByYearRaw.all(req.params.yearId).map(o => o.id));
  const reorder = db.transaction(() => {
    ids.filter(id => own.has(id)).forEach((id, idx) => {
      stmts.updateSafetyObjectiveSortOrder.run(idx, id);
    });
  });
  reorder();
  const { dept, company } = deptContext(year.department_id);
  logAction('Sicherheitszielkatalog sortiert', 'safety_year', req.params.yearId, String(year.year), '',
    company ? company.name : '', dept ? dept.name : '');
  res.json(stmts.getSafetyObjectivesByYear.all(req.params.yearId));
});

router.get('/api/safety-objectives/:id', (req, res) => {
  const objective = stmts.getSafetyObjective.get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'Safety objective not found' });
  res.json(objective);
});

// Partiell wie PUT /api/sms-meetings/:id — ausgelassene Felder behalten ihren Wert.
router.put('/api/safety-objectives/:id', (req, res) => {
  const existing = stmts.getSafetyObjective.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety objective not found' });
  const b = req.body;
  const title = b.title !== undefined ? (b.title || '').trim() : existing.title;
  if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });
  stmts.updateSafetyObjective.run(
    title,
    b.objective !== undefined ? b.objective : existing.objective,
    b.spt !== undefined ? b.spt : existing.spt,
    b.spt_direction !== undefined ? b.spt_direction : existing.spt_direction,
    b.spt_value !== undefined ? normalizeSptValue(b.spt_value) : existing.spt_value,
    b.spi_description !== undefined ? b.spi_description : existing.spi_description,
    b.interval_months !== undefined ? normalizeIntervalMonths(b.interval_months) : existing.interval_months,
    b.active !== undefined ? (Number(b.active) ? 1 : 0) : existing.active,
    req.params.id
  );
  const objective = stmts.getSafetyObjective.get(req.params.id);
  const { dept, company } = deptContext(objective.department_id);
  logAction('Sicherheitsziel geändert', 'safety_objective', req.params.id, objectiveLabel(objective), '',
    company ? company.name : '', dept ? dept.name : '');
  res.json(objective);
});

router.delete('/api/safety-objectives/:id', (req, res) => {
  const existing = stmts.getSafetyObjective.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Safety objective not found' });
  const { dept, company } = deptContext(existing.department_id);
  try {
    const snapshot = snapshotSafetyObjective(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'safety_objective', req.params.id, objectiveLabel(existing),
        company ? company.name : '', dept ? dept.name : '', existing.safety_year_id, 'safety_year', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSafetyObjective.run(req.params.id); // evaluations cascade
  logAction('Sicherheitsziel gelöscht', 'safety_objective', req.params.id, objectiveLabel(existing), '',
    company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

// ── SPI-Bewertungen (CM-006 Formular) ────────────────────

// Eine Bewertung trägt keinen eigenen Namen — Log-Eintrag und Papierkorb brauchen
// aber einen. Das Ziel benennt die Sache, das Bewertungsdatum unterscheidet die
// mehreren Bewertungen desselben Ziels im selben Jahr. Nach der Unterschrift zählt
// dabei der eingefrorene Wortlaut, den getSpiEvaluation als eff_objective liefert.
function evaluationLabel(evaluation) {
  const title = (evaluation.eff_objective || '').trim() || 'SPI-Bewertung';
  const date = formatDateDE(evaluation.eval_date);
  return date ? `${title} – ${date}` : title;
}

// eval_date und decided_at sind nullable TEXT, das Frontend leert sie aber als ''.
// Nur echtes NULL fällt im ORDER BY der Listen auf created_at zurück und gilt als
// "noch nicht unterschrieben" — '' wäre beides nicht.
function normalizeDate(value) {
  return value ? value : null;
}

// Die Unterschrift friert das Dokument ein: ab jetzt druckt es identisch nach,
// auch wenn der Jahreskatalog danach noch korrigiert wird. Nur beim Übergang
// leer -> gesetzt, damit ein späteres Speichern die Snapshots nicht überschreibt.
// Ohne `previous` (POST) startet ein Entwurf ohne Snapshots; wird eine Bewertung
// direkt unterschrieben angelegt, friert sie sofort ein — sonst hinge ein
// unterschriebenes Dokument doch wieder am lebenden Katalog.
// Rückgabe in der Spaltenreihenfolge von createSpiEvaluation/updateSpiEvaluation:
// objective_snapshot, spt_snapshot, interval_snapshot.
function signingSnapshots(objective, decidedAt, previous = {}) {
  const signing = !previous.decided_at && !!decidedAt;
  if (signing) return [objective.title, objective.spt, objective.interval_months];
  return [
    previous.objective_snapshot !== undefined ? previous.objective_snapshot : null,
    previous.spt_snapshot !== undefined ? previous.spt_snapshot : null,
    previous.interval_snapshot !== undefined ? previous.interval_snapshot : null,
  ];
}

router.get('/api/safety-objectives/:id/spi-evaluations', (req, res) => {
  const objective = stmts.getSafetyObjective.get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'Safety objective not found' });
  res.json(stmts.getSpiEvaluationsByObjective.all(req.params.id));
});

router.post('/api/safety-objectives/:id/spi-evaluations', (req, res) => {
  const objective = stmts.getSafetyObjective.get(req.params.id);
  if (!objective) return res.status(404).json({ error: 'Safety objective not found' });
  const { dept, company } = deptContext(objective.department_id);
  const b = req.body;
  const decidedAt = normalizeDate(b.decided_at);
  const id = uuidv4();
  // safety_year_id und department_id kommen aus dem Ziel: beide sind denormalisiert,
  // damit Jahres-PDF, Papierkorb-Snapshot und Log-Eintrag ohne Join auskommen.
  // result_text und rating werden übernommen wie eingegeben — die Original-PDFs
  // führen "Erfüllt", "Nicht erfüllt" und blanke Zahlen wie "-2" nebeneinander und
  // bewerten SPT 20 / SPI 0 auch schon mal als "Positiv"; eine Serverautomatik
  // wäre hier fachlich falsch.
  stmts.createSpiEvaluation.run(
    id, objective.id, objective.safety_year_id, objective.department_id,
    normalizeDate(b.eval_date), b.spi_value || '', b.result_text || '', b.rating || '',
    b.cause_analysis || '', b.measures || '', b.decision || '', b.decision_place || '',
    decidedAt, b.copy_to || '',
    ...signingSnapshots(objective, decidedAt)
  );
  const evaluation = stmts.getSpiEvaluation.get(id);
  logAction('SPI-Bewertung erstellt', 'spi_evaluation', id, evaluationLabel(evaluation), '',
    company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(evaluation);
});

router.get('/api/spi-evaluations/:id', (req, res) => {
  const evaluation = stmts.getSpiEvaluation.get(req.params.id);
  if (!evaluation) return res.status(404).json({ error: 'SPI evaluation not found' });
  res.json(evaluation);
});

// Partiell wie PUT /api/sms-meetings/:id — ausgelassene Felder behalten ihren Wert.
router.put('/api/spi-evaluations/:id', (req, res) => {
  const existing = stmts.getSpiEvaluation.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SPI evaluation not found' });
  // Der JOIN in getSpiEvaluation garantiert das Ziel — ohne es gäbe es die Zeile nicht.
  const objective = stmts.getSafetyObjective.get(existing.safety_objective_id);
  const b = req.body;
  const decidedAt = b.decided_at !== undefined ? normalizeDate(b.decided_at) : existing.decided_at;
  stmts.updateSpiEvaluation.run(
    b.eval_date !== undefined ? normalizeDate(b.eval_date) : existing.eval_date,
    b.spi_value !== undefined ? b.spi_value : existing.spi_value,
    b.result_text !== undefined ? b.result_text : existing.result_text,
    b.rating !== undefined ? b.rating : existing.rating,
    b.cause_analysis !== undefined ? b.cause_analysis : existing.cause_analysis,
    b.measures !== undefined ? b.measures : existing.measures,
    b.decision !== undefined ? b.decision : existing.decision,
    b.decision_place !== undefined ? b.decision_place : existing.decision_place,
    decidedAt,
    b.copy_to !== undefined ? b.copy_to : existing.copy_to,
    ...signingSnapshots(objective, decidedAt, existing),
    req.params.id
  );
  const evaluation = stmts.getSpiEvaluation.get(req.params.id);
  const { dept, company } = deptContext(evaluation.department_id);
  // Die Unterschrift ist der prüfrelevante Moment und steht deshalb im Log-Detail.
  const detail = !existing.decided_at && decidedAt ? `Unterschrieben: ${formatDateDE(decidedAt)}` : '';
  logAction('SPI-Bewertung geändert', 'spi_evaluation', req.params.id, evaluationLabel(evaluation), detail,
    company ? company.name : '', dept ? dept.name : '');
  res.json(evaluation);
});

router.delete('/api/spi-evaluations/:id', (req, res) => {
  const existing = stmts.getSpiEvaluation.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SPI evaluation not found' });
  const { dept, company } = deptContext(existing.department_id);
  const label = evaluationLabel(existing);
  try {
    const snapshot = snapshotSpiEvaluation(req.params.id);
    if (snapshot) {
      stmts.createTrashItem.run(uuidv4(), 'spi_evaluation', req.params.id, label,
        company ? company.name : '', dept ? dept.name : '', existing.safety_objective_id, 'safety_objective', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  stmts.deleteSpiEvaluation.run(req.params.id);
  logAction('SPI-Bewertung gelöscht', 'spi_evaluation', req.params.id, label, '',
    company ? company.name : '', dept ? dept.name : '');
  res.status(204).end();
});

module.exports = router;
