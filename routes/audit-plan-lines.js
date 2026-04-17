const express = require('express');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { calcCapDeadline } = require('../services/cap-deadlines');
const { snapshotAuditPlanLine } = require('../services/trash');
const { renderAuditLinePdf } = require('../pdf/audit');
const { addPdfFooter } = require('../pdf/common');
const { parseAuditChecklist } = require('../imports/audit');

const router = express.Router();

router.get('/api/audit-plans/:auditPlanId/lines', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.auditPlanId);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const rawLines = stmts.getAuditPlanLinesByPlan.all(req.params.auditPlanId);
  let needsRenumber = false;
  for (let i = 0; i < rawLines.length; i++) {
    if (String(rawLines[i].audit_no) !== String(i + 1)) { needsRenumber = true; break; }
  }
  if (needsRenumber) {
    const renumber = db.prepare('UPDATE audit_plan_line SET audit_no = ? WHERE id = ?');
    db.transaction(() => { rawLines.forEach((l, i) => renumber.run(String(i + 1), l.id)); })();
  }
  const lines = needsRenumber ? stmts.getAuditPlanLinesByPlan.all(req.params.auditPlanId) : rawLines;
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

router.post('/api/audit-plans/:auditPlanId/lines', (req, res) => {
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

// Multi-select Audit Checklist PDF (must be before :id routes)
router.get('/api/audit-plan-lines/pdf', (req, res) => {
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

// Audit Checklist PDF (Einzelaudit)
router.get('/api/audit-plan-lines/:id/pdf', (req, res) => {
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

router.get('/api/audit-plan-lines/:id', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.id);
  if (!line) return res.status(404).json({ error: 'Not found' });
  res.json(line);
});

router.put('/api/audit-plan-lines/:id', (req, res) => {
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

router.patch('/api/audit-plan-lines/:id/performed', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  const { performed_date } = req.body;
  stmts.updateAuditPlanLinePerformed.run(performed_date || null, req.params.id);
  res.json(stmts.getAuditPlanLine.get(req.params.id));
});

router.delete('/api/audit-plan-lines/:id', (req, res) => {
  const existing = stmts.getAuditPlanLine.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan line not found' });
  try {
    const snapshot = snapshotAuditPlanLine(req.params.id);
    if (snapshot) {
      const plan = stmts.getAuditPlan.get(existing.audit_plan_id);
      const dept = plan ? stmts.getDepartment.get(plan.department_id) : null;
      const comp = dept ? stmts.getCompany.get(dept.company_id) : null;
      stmts.createTrashItem.run(uuidv4(), 'audit_plan_line', req.params.id, existing.subject || existing.audit_no || '', comp ? comp.name : '', dept ? dept.name : '', existing.audit_plan_id, 'audit_plan', JSON.stringify(snapshot));
    }
  } catch (e) { console.error('Trash snapshot failed:', e.message); }
  const planId = existing.audit_plan_id;
  stmts.deleteAuditPlanLine.run(req.params.id);
  // Renumber remaining lines
  const remaining = stmts.getAuditPlanLinesByPlan.all(planId);
  const renumber = db.prepare(`UPDATE audit_plan_line SET audit_no = ? WHERE id = ?`);
  const renumberTx = db.transaction(() => {
    remaining.forEach((line, idx) => {
      renumber.run(String(idx + 1), line.id);
    });
  });
  renumberTx();
  res.status(204).end();
});

// Checklist items under audit-plan-lines
router.get('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  const items = stmts.getChecklistItemsByLine.all(req.params.lineId);
  const evCounts = stmts.getEvidenceCountsByLine.all(req.params.lineId);
  const evMap = {};
  for (const e of evCounts) evMap[e.checklist_item_id] = e.evidence_count;
  for (const item of items) item.evidence_count = evMap[item.id] || 0;
  res.json(items);
});

router.post('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
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
  const evalVal = b.evaluation || '';
  if (['O', 'L1', 'L2', 'L3'].includes(evalVal)) {
    const dl = calcCapDeadline(evalVal, line.performed_date);
    const plan = stmts.getAuditPlan.get(line.audit_plan_id);
    const deptId = plan ? plan.department_id : null;
    stmts.createCapItem.run(uuidv4(), id, dl, '', '', '', '', 'OPEN', null, '', deptId, 'audit', null);
  }
  res.status(201).json(stmts.getChecklistItem.get(id));
});

// Bulk Import Audit XLSX per Audit Plan
router.post('/api/audit-plans/:id/import-audits', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });

  const { files, mappings } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  if (!mappings || typeof mappings !== 'object') {
    return res.status(400).json({ error: 'No mappings provided' });
  }

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

        stmts.deleteChecklistItemsByLine.run(line.id);
        for (const item of items) {
          const ciId = uuidv4();
          stmts.createChecklistItem.run(
            ciId, line.id,
            item.section, item.sort_order,
            item.regulation_ref, item.compliance_check,
            item.evaluation, item.auditor_comment, item.document_ref
          );
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

module.exports = router;
