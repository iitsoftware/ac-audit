const express = require('express');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { getCapDeadlineDays, calcCapDeadline } = require('../services/cap-deadlines');
const { snapshotCapItem } = require('../services/trash');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { renderCapItemPdf, generateCapItemsPdfBuffer } = require('../pdf/cap');
const { addPdfFooter } = require('../pdf/common');

const router = express.Router();

// ── Recalculate all CAP deadlines (ORDER: before :id routes) ──
router.post('/api/cap-items/recalc-deadlines', (req, res) => {
  getCapDeadlineDays();
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

// ── Multi-select CAP Items PDF (ORDER: before :id routes) ──
router.get('/api/cap-items/pdf', (req, res) => {
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

// ── Send CAP items PDF via email (ORDER: before :id routes) ──
router.post('/api/cap-items/send-email', async (req, res) => {
  const { ids, to: toAddress, authority } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Keine CAP-Einträge ausgewählt' });

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
    const qm = getQmForDepartment(company.id, dept.id);
    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    let subject, text;
    if (authority) {
      subject = `Corrective Action Plan – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen den Corrective Action Plan der Abteilung ${dept.name} der ${company.name}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    } else {
      subject = `Corrective Action Plan (${dept.name})`;
      text = `Hallo,\n\nanbei der Corrective Action Plan für die Abteilung ${dept.name} der ${company.name}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'audit', to, subject, text, filename: 'Corrective_Actions.pdf', buffer, qm,
      logParams: ['CAP per E-Mail gesendet', 'cap_item', '', `${ids.length} CAP-Einträge`, `An: ${to}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    console.error('CAP send-email error:', e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ── CAP Item CRUD ────────────────────────────────────────
router.get('/api/cap-items/:id', (req, res) => {
  const row = stmts.getCapItem.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'CAP item not found' });
  res.json(row);
});

router.put('/api/cap-items/:id', (req, res) => {
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

router.delete('/api/cap-items/:id', (req, res) => {
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

// ── CAP Item PDF (single) ────────────────────────────────
router.get('/api/cap-items/:id/pdf', (req, res) => {
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

// ── Five-Why Analysis ────────────────────────────────────
router.get('/api/cap-items/:id/five-why', (req, res) => {
  const row = stmts.getFiveWhyByCapItem.get(req.params.id);
  res.json(row || null);
});

router.put('/api/cap-items/:id/five-why', (req, res) => {
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

// ── CAP Evidence Files ───────────────────────────────────
router.get('/api/cap-items/:id/evidence-files', (req, res) => {
  res.json(stmts.getEvidenceFilesByCapItem.all(req.params.id));
});

router.post('/api/cap-items/:id/evidence-files', (req, res) => {
  const { filename, mime_type, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  const id = uuidv4();
  const buf = Buffer.from(data, 'base64');
  stmts.createEvidenceFile.run(id, req.params.id, filename || '', mime_type || 'image/png', buf);
  res.status(201).json({ id, filename, mime_type });
});

router.get('/api/evidence-files/:id', (req, res) => {
  const row = stmts.getEvidenceFile.get(req.params.id);
  if (!row || !row.data) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', row.mime_type || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.data);
});

router.delete('/api/evidence-files/:id', (req, res) => {
  stmts.deleteEvidenceFile.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
