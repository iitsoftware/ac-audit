const express = require('express');
const path = require('path');
const ejs = require('ejs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const { db, stmts } = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: render a page inside layout
function renderPage(res, view, opts = {}) {
  const viewPath = path.join(__dirname, 'views', `${view}.ejs`);
  ejs.renderFile(viewPath, opts, (err, body) => {
    if (err) return res.status(500).send(err.message);
    res.render('layout', { body, ...opts });
  });
}

// ── Pages ───────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/companies'));

app.get('/companies', (req, res) => {
  renderPage(res, 'companies', { activePage: 'companies', pageScript: 'companies.js' });
});

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
  const { name, street, postal_code, city, logo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  stmts.createCompany.run(id, name.trim(), street || '', postal_code || '', city || '', logoBuf);
  const created = stmts.getCompany.get(id);
  created.has_logo = !!logoBuf;
  res.status(201).json(created);
});

app.put('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { name, street, postal_code, city } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateCompany.run(name.trim(), street || '', postal_code || '', city || '', req.params.id);
  const updated = stmts.getCompany.get(req.params.id);
  const logoRow = stmts.getCompanyLogo.get(req.params.id);
  updated.has_logo = !!(logoRow && logoRow.logo);
  res.json(updated);
});

app.delete('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  stmts.deleteCompany.run(req.params.id);
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
  const { name, easa_permission_number, regulation } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  stmts.createDepartment.run(id, req.params.companyId, name.trim(), easa_permission_number || '', regulation || '');
  res.status(201).json(stmts.getDepartment.get(id));
});

app.put('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const { name, easa_permission_number, regulation } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateDepartment.run(name.trim(), easa_permission_number || '', regulation || '', req.params.id);
  res.json(stmts.getDepartment.get(req.params.id));
});

app.delete('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  stmts.deleteDepartment.run(req.params.id);
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
  const { year } = req.body;
  if (!year || !Number.isInteger(year)) return res.status(400).json({ error: 'Year is required' });
  const id = uuidv4();
  stmts.createAuditPlan.run(id, req.params.departmentId, year, 'ENTWURF', 0);
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

  stmts.createAuditPlan.run(newId, targetDeptId, newYear, 'ENTWURF', newRevision);

  // Copy lines (with integrated audit fields) and their checklist items
  const sourceLines = stmts.getAuditPlanLinesByPlan.all(source.id);
  for (const line of sourceLines) {
    const newLineId = uuidv4();
    stmts.createAuditPlanLine.run(
      newLineId, newId, line.sort_order,
      line.subject || '', line.regulations || '', line.location || '', line.planned_window || '',
      line.audit_no || '', line.audit_subject || '', line.audit_title || '',
      line.auditor_team || '', line.auditee || '',
      line.audit_start_date || null, line.audit_end_date || null, line.audit_location || '',
      line.document_ref || '', line.document_iss_rev || '', line.document_rev_date || null,
      line.recommendation || '', line.audit_status || 'OPEN'
    );

    // Copy checklist items for this line
    const sourceItems = stmts.getChecklistItemsByLine.all(line.id);
    for (const item of sourceItems) {
      const newItemId = uuidv4();
      stmts.createChecklistItem.run(
        newItemId, newLineId,
        item.section || 'THEORETICAL', item.sort_order || 0,
        item.regulation_ref || '', item.compliance_check || '',
        item.evaluation || '', item.auditor_comment || '', item.document_ref || ''
      );
      // Auto-CAP for findings/observations
      if (['O', 'L1', 'L2', 'L3'].includes(item.evaluation)) {
        stmts.createCapItem.run(uuidv4(), newItemId, null, '', '', '', '', 'OPEN', null, '');
      }
    }
  }

  res.status(201).json(stmts.getAuditPlan.get(newId));
});

app.delete('/api/audit-plans/:id', (req, res) => {
  const existing = stmts.getAuditPlan.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Audit plan not found' });
  stmts.deleteAuditPlan.run(req.params.id);
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
        stmts.createAuditPlan.run(planId, req.params.departmentId, year, 'ENTWURF', 0);
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
  for (const line of lines) {
    const c = countMap[line.id];
    line.checklist_count = c ? c.checklist_count : 0;
    line.finding_count = c ? c.finding_count : 0;
    line.observation_count = c ? c.observation_count : 0;
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
  stmts.createAuditPlanLine.run(
    id, req.params.auditPlanId,
    b.sort_order || 0, b.subject || '', b.regulations || '', b.location || '', b.planned_window || '',
    auditNo, b.audit_subject || '', b.audit_title || '',
    b.auditor_team || '', b.auditee || '',
    b.audit_start_date || null, b.audit_end_date || null, b.audit_location || '',
    b.document_ref || '', b.document_iss_rev || '', b.document_rev_date || null,
    b.recommendation || '', b.audit_status || 'OPEN'
  );
  res.status(201).json(stmts.getAuditPlanLine.get(id));
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
  stmts.deleteAuditPlanLine.run(req.params.id);
  res.status(204).end();
});

// ── API: Audit Checklist Items (now under audit-plan-lines) ──

app.get('/api/audit-plan-lines/:lineId/checklist-items', (req, res) => {
  const line = stmts.getAuditPlanLine.get(req.params.lineId);
  if (!line) return res.status(404).json({ error: 'Audit plan line not found' });
  res.json(stmts.getChecklistItemsByLine.all(req.params.lineId));
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
    stmts.createCapItem.run(uuidv4(), id, null, '', '', '', '', 'OPEN', null, '');
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
    stmts.createCapItem.run(uuidv4(), req.params.id, null, '', '', '', '', 'OPEN', null, '');
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
            stmts.createCapItem.run(uuidv4(), ciId, null, '', '', '', '', 'OPEN', null, '');
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

app.get('/api/cap-items/:id', (req, res) => {
  const row = stmts.getCapItem.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'CAP item not found' });
  res.json(row);
});

app.put('/api/cap-items/:id', (req, res) => {
  const b = req.body;
  stmts.updateCapItem.run(
    b.deadline || null, b.responsible_person || '', b.root_cause || '',
    b.corrective_action || '', b.preventive_action || '',
    b.status || 'OPEN', b.completion_date || null, b.evidence || '',
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/cap-items/:id', (req, res) => {
  stmts.deleteCapItem.run(req.params.id);
  res.status(204).end();
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

app.get('/api/audit-plans/:id/pdf', (req, res) => {
  const type = req.query.type || 'open';
  if (type === 'closed') {
    return res.status(501).json({ error: 'Geschlossener Plan ist noch nicht implementiert' });
  }
  if (type !== 'open') {
    return res.status(400).json({ error: 'type must be open or closed' });
  }

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

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Auditplan_${plan.year}.pdf"`);
  doc.pipe(res);

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
  const title = `Auditplan ${plan.year} - Geplante Audits`;
  doc.fontSize(14).font('Helvetica-Bold').text(title, 50, headerY);
  headerY += 20;
  doc.fontSize(10).font('Helvetica').text(`Rev. ${plan.revision || 0}`, 50, headerY);
  headerY += 20;

  // ── Table ──
  const tableTop = headerY;
  const colX = [50, 80, 250, 370];  // Nr, Thema, Bezug, Geplant
  const colW = [30, 170, 120, 125]; // widths
  const pageW = 595.28;
  const marginRight = 50;
  const tableRight = pageW - marginRight;

  // Header row
  doc.fontSize(9).font('Helvetica-Bold');
  doc.rect(50, tableTop, tableRight - 50, 18).fill('#2563eb');
  doc.fillColor('#ffffff');
  doc.text('Nr.', colX[0] + 4, tableTop + 4, { width: colW[0], align: 'left' });
  doc.text('Thema', colX[1] + 4, tableTop + 4, { width: colW[1], align: 'left' });
  doc.text('Bezug', colX[2] + 4, tableTop + 4, { width: colW[2], align: 'left' });
  doc.text('Geplant', colX[3] + 4, tableTop + 4, { width: colW[3], align: 'left' });
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

    y += rowH;
  }

  // ── Signature table ──
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
  else if (deptText.includes('flug') || deptText.includes('ops') || deptText.includes('ore') || deptText.includes('965')) alLabel = 'Flugbetriebsleiter';

  const sigRowH = 50;
  const sigTableH = 18 + sigRowH; // header + content
  if (y + sigTableH + 20 > 760) {
    doc.addPage();
    y = 50;
  }
  y += 16; // spacing

  const sigCols = 5;
  const sigColW = (tableRight - 50) / sigCols;
  const sigHeaders = ['Freigabe', 'Weitergabe LBA', 'Quality Manager', alLabel, 'Accountable Manager'];

  // Header row
  doc.fontSize(7).font('Helvetica-Bold');
  doc.rect(50, y, tableRight - 50, 18).fill('#2563eb');
  doc.fillColor('#ffffff');
  for (let c = 0; c < sigCols; c++) {
    doc.text(sigHeaders[c], 50 + c * sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });
  }
  doc.fillColor('#000000');
  y += 18;

  // Content row
  doc.strokeColor('#d0d0d0').lineWidth(0.5);
  doc.rect(50, y, tableRight - 50, sigRowH).stroke();
  for (let c = 1; c < sigCols; c++) {
    doc.moveTo(50 + c * sigColW, y).lineTo(50 + c * sigColW, y + sigRowH).stroke();
  }

  function formatDateDE(isoStr) {
    if (!isoStr) return '';
    const d = isoStr.substring(0, 10).split('-');
    if (d.length !== 3) return isoStr;
    return `${d[2]}.${d[1]}.${d[0]}`;
  }

  doc.font('Helvetica').fontSize(9);

  // Col 0: Freigabe date
  doc.text(formatDateDE(plan.approved_at), 50 + 4, y + 4, { width: sigColW - 8, align: 'center' });

  // Col 1: Weitergabe LBA (geplant)
  doc.text(formatDateDE(plan.submitted_planned_at), 50 + sigColW + 4, y + 4, { width: sigColW - 8, align: 'center' });

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

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ac-audit running on http://localhost:${PORT}`);
});
