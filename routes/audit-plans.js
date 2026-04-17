const express = require('express');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { calcCapDeadline } = require('../services/cap-deadlines');
const { snapshotAuditPlan } = require('../services/trash');
const { sendDocumentEmail, getQmForDepartment, buildAuthoritySalutation } = require('../services/email');
const { _renderAuditPlanPdf, generateAuditPlanPdfBuffer } = require('../pdf/audit');

const router = express.Router();

router.get('/api/departments/:departmentId/audit-plans', (req, res) => {
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

// Get all audit plans (for template selection) — must be before /:id
router.get('/api/audit-plans/all', (req, res) => {
  res.json(stmts.getAllAuditPlans.all());
});

router.get('/api/audit-plans/:id', (req, res) => {
  const row = stmts.getAuditPlan.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Audit plan not found' });
  res.json(row);
});

router.post('/api/departments/:departmentId/audit-plans', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { year, plan_type } = req.body;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Year is required' });
  const id = uuidv4();
  const pType = plan_type === 'AUTHORITY' ? 'AUTHORITY' : 'AUDIT';
  stmts.createAuditPlan.run(id, req.params.departmentId, year, 'ENTWURF', 0, pType);
  res.status(201).json(stmts.getAuditPlan.get(id));
});

router.put('/api/audit-plans/:id', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { year } = req.body;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Year is required' });
  stmts.updateAuditPlan.run(year, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

const VALID_STATUSES = ['ARCHIV', 'ENTWURF', 'AKTIV'];

router.patch('/api/audit-plans/:id/status', (req, res) => {
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
    stmts.archiveActiveByDepartment.run(existing.department_id);
  }
  stmts.updateAuditPlanStatus.run(status, existing.approved_by || '', existing.approved_at || null, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

router.patch('/api/audit-plans/:id/dates', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const { approved_at, submitted_planned_at, submitted_at } = req.body;
  stmts.updateAuditPlanDates.run(approved_at || null, submitted_planned_at || null, submitted_at || null, existing.status, req.params.id);
  res.json(stmts.getAuditPlan.get(req.params.id));
});

// Copy an audit plan (revision or template)
router.post('/api/audit-plans/:id/copy', (req, res) => {
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

  const isTemplate = mode === 'template';
  const sourceLines = stmts.getAuditPlanLinesByPlan.all(source.id);
  for (const line of sourceLines) {
    const newLineId = uuidv4();
    if (isTemplate) {
      stmts.createAuditPlanLine.run(
        newLineId, newId, line.sort_order,
        line.subject || '', line.regulations || '', line.location || '', '',
        '', '', '', '', '',
        null, null, '',
        '', '', null,
        '', 'OPEN'
      );
    } else {
      stmts.createAuditPlanLine.run(
        newLineId, newId, line.sort_order,
        line.subject || '', line.regulations || '', line.location || '', line.planned_window || '',
        line.audit_no || '', line.audit_subject || '', line.audit_title || '',
        line.auditor_team || '', line.auditee || '',
        line.audit_start_date || null, line.audit_end_date || null, line.audit_location || '',
        line.document_ref || '', line.document_iss_rev || '', line.document_rev_date || null,
        line.recommendation || '', line.audit_status || 'OPEN'
      );

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

router.delete('/api/audit-plans/:id', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  const delDept = stmts.getDepartment.get(existing.department_id);
  const delCompany = delDept ? stmts.getCompany.get(delDept.company_id) : null;
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

// CAP Items for plan
router.get('/api/audit-plans/:id/cap-items', (req, res) => {
  const plan = stmts.getAuditPlan.get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Audit plan not found' });
  const items = stmts.getCapItemsByPlan.all(req.params.id);
  const summary = stmts.getCapSummaryByPlan.get(req.params.id);
  res.json({ items, summary });
});

// Import Audit Plan from .docx
router.post('/api/departments/:departmentId/import-audit-plan',
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  (req, res) => {
    const dept = stmts.getDepartment.get(req.params.departmentId);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    try {
      const zip = new AdmZip(req.body);
      const docEntry = zip.getEntry('word/document.xml');
      if (!docEntry) return res.status(400).json({ error: 'Keine word/document.xml in der .docx Datei gefunden' });

      const xml = docEntry.getData().toString('utf8');

      const tblMatch = xml.match(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/);
      if (!tblMatch) return res.status(400).json({ error: 'Keine Tabelle in der .docx Datei gefunden' });

      const tblXml = tblMatch[0];

      const rows = [];
      const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tblXml)) !== null) {
        rows.push(rowMatch[0]);
      }

      if (rows.length < 2) return res.status(400).json({ error: 'Tabelle hat keine Datenzeilen' });

      function decodeXml(str) {
        return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      }

      function parseCells(rowXml) {
        const cells = [];
        const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const cellXml = cellMatch[1];
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

      function parseDate(str) {
        if (!str || !str.trim()) return null;
        const m = str.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (!m) return null;
        return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }

      const lines = [];
      for (let i = 1; i < rows.length; i++) {
        const cells = parseCells(rows[i]);
        if (cells.length < 4) continue;

        const sortOrder = parseInt(cells[0], 10) || i;
        const subject = cells[1] || '';
        const regulations = cells[2] || '';
        const plannedWindow = cells[3] || '';
        const performedDate = cells.length > 4 ? parseDate(cells[4]) : null;
        const signature = cells.length > 6 ? (cells[6] || '') : '';

        if (!subject.trim()) continue;

        lines.push({ sortOrder, subject, regulations, plannedWindow, performedDate, signature });
      }

      if (lines.length === 0) return res.status(400).json({ error: 'Keine Themenbereiche in der Tabelle gefunden' });

      let year = new Date().getFullYear();
      for (const line of lines) {
        if (line.performedDate) {
          const y = parseInt(line.performedDate.substring(0, 4), 10);
          if (y >= 2000 && y <= 2099) { year = y; break; }
        }
      }

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

// Audit Plan PDF Export
router.get('/api/audit-plans/:id/pdf', (req, res) => {
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

// Send audit plan PDF via email
router.post('/api/audit-plans/:id/send-email', async (req, res) => {
  const { to, type, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
  if (type !== 'open' && type !== 'closed') return res.status(400).json({ error: 'type must be open or closed' });

  try {
    const filter = type === 'open' ? 'planned' : undefined;
    const { buffer, plan, dept, company } = await generateAuditPlanPdfBuffer(req.params.id, type, filter);
    const qm = getQmForDepartment(company.id, dept.id);
    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    const isClosed = type === 'closed';
    const suffix = isClosed ? 'Durchgeführte' : 'Geplante';
    const filename = `Auditplan_${plan.year}_${suffix.replace(/ü/g, 'ue')}_Audits.pdf`;
    let subject, text;
    if (authority) {
      subject = `Auditplan ${plan.year} – ${suffix} Audits – ${company.name} (${dept.name})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen den Auditplan ${plan.year} – ${suffix} Audits der Abteilung ${dept.name} der ${company.name}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    } else {
      subject = `Auditplan ${plan.year} – ${suffix} Audits (${dept.name})`;
      text = `Hallo,\n\nanbei der Auditplan ${plan.year} – ${suffix} Audits für die Abteilung ${dept.name} der ${company.name}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nCompliance Monitoring Manager\n${company.name}\n\n`;
    }
    await sendDocumentEmail({ module: 'audit', to, subject, text, filename, buffer, qm,
      logParams: ['Auditplan per E-Mail gesendet', 'audit_plan', plan.id, `${plan.year} Rev. ${plan.revision || 0}`, `An: ${to}, Typ: ${suffix}${authority ? ' (Behörde)' : ''}`, company.name, dept.name] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

module.exports = router;
