const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { getQmForDepartment, sendDocumentEmail } = require('../services/email');
const { generateEasaForm2Buffer } = require('../services/form2');
const { parseChangeTasksXlsx } = require('../imports/change');

const router = express.Router();

// ── Change Requests ─────────────────────────────────────

router.get('/api/departments/:departmentId/change-requests', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getChangeRequestsByDept.all(req.params.departmentId));
});

router.post('/api/departments/:departmentId/change-requests', (req, res) => {
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

router.get('/api/change-requests/:id', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  res.json(cr);
});

router.put('/api/change-requests/:id', (req, res) => {
  const existing = stmts.getChangeRequest.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Change request not found' });
  const { title, description, category, priority, requested_by, requested_date, target_date, change_type } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  stmts.updateChangeRequest.run(title.trim(), description || '', category || 'OFFEN', priority || 'MEDIUM', requested_by || '', requested_date || null, target_date || null, change_type || '', req.params.id);
  res.json(stmts.getChangeRequest.get(req.params.id));
});

router.delete('/api/change-requests/:id', (req, res) => {
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

router.patch('/api/change-requests/:id/status', (req, res) => {
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

// ── Change Request Form 2 Data ─────────────────────────
router.put('/api/change-requests/:id/form2-data', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const json = JSON.stringify(req.body || {});
  db.prepare(`UPDATE change_request SET form2_data = ?, updated_at = datetime('now') WHERE id = ?`).run(json, req.params.id);
  res.json({ ok: true });
});

// ── EASA Form 2 PDF ─────────────────────────────────────
router.get('/api/change-requests/:id/easa-form2/pdf', async (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const dept = stmts.getDepartment.get(cr.department_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(dept.company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const personsAll = stmts.getPersonsByCompany.all(company.id);
  const accountable = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);
  const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id);

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

// ── Import Change Management .xlsx ─────────────────────
router.post('/api/change-requests/:id/import-tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File data required' });

  try {
    const buf = Buffer.from(file, 'base64');
    const { tasks, title: importTitle } = parseChangeTasksXlsx(buf);

    // Delete existing tasks before import
    const existingTasks = stmts.getChangeTasksByRequest.all(cr.id);
    for (const t of existingTasks) stmts.deleteChangeTask.run(t.id);

    let imported = 0;
    for (const t of tasks) {
      const id = uuidv4();
      imported++;
      stmts.createChangeTask.run(id, cr.id, imported,
        t.process, t.area, t.safety_note, t.measures,
        t.responsible, t.target_date, t.completion_date, t.section_header
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
    res.status(e.statusCode || 500).json({ error: 'Import fehlgeschlagen: ' + e.message });
  }
});

// ── Send Change Email ───────────────────────────────────
router.post('/api/change-requests/:id/send-email', async (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { to, type } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });

  try {
    const dept = stmts.getDepartment.get(cr.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
    const qm = personsAll.find(p => p.role === 'QM' && p.department_id === dept.id) || null;

    if (type === 'form2') {
      const formData = req.body.formData || {};
      formData.check_5a = formData.check_5a === true || formData.check_5a === 'true';
      formData.check_5b = formData.check_5b === true || formData.check_5b === 'true';
      formData.check_5c = formData.check_5c === true || formData.check_5c === 'true';
      formData.check_5d = formData.check_5d === true || formData.check_5d === 'true';
      const accountable = personsAll.find(p => p.role === 'ACCOUNTABLE' && !p.department_id);

      const buffer = await generateEasaForm2Buffer({ cr, dept, company, accountable, qm, formData });
      const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
      const subject = `EASA Form 2 – ${cr.change_no} – ${company.name} (${dept.name})`;
      const text = `Sehr geehrte Damen und Herren,\n\nanbei übersenden wir Ihnen den Antrag EASA Form 2 für ${cr.change_no} – ${cr.title}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nSafety Manager\n${company.name}\n\n`;

      await sendDocumentEmail({ module: 'change', to, subject, text, filename: `EASA_Form2_${cr.change_no}.pdf`, buffer, qm,
        logParams: ['EASA Form 2 gesendet', 'change_request', cr.id, cr.change_no, `An: ${to}`, company ? company.name : '', dept ? dept.name : ''] });
      res.json({ ok: true });
    } else {
      return res.status(400).json({ error: 'Unbekannter E-Mail-Typ' });
    }
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

module.exports = router;
