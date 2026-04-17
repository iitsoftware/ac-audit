const express = require('express');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const { getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail } = require('../services/email');
const { computeRiskScore, renderRiskAnalysisPdf } = require('../pdf/risk');
const { addPdfFooter } = require('../pdf/common');
const { parseRiskAnalysisXlsx } = require('../imports/risk');

const router = express.Router();

// Helper: auto-add history entry for risk analysis changes
function addRiskHistoryAuto(raId, reason) {
  const ra = stmts.getRiskAnalysis.get(raId);
  if (!ra) return;
  const cr = stmts.getChangeRequest.get(ra.change_request_id);
  const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
  const qm = personsAll.find(p => p.role === 'QM' && dept && p.department_id === dept.id);
  const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
  const history = stmts.getRiskAnalysisHistory.all(raId);
  const nextVersion = history.length > 0 ? Math.max(...history.map(h => h.version || 0)) + 1 : 1;
  const today = new Date().toISOString().slice(0, 10);
  stmts.createRiskAnalysisHistory.run(uuidv4(), raId, nextVersion, today, qmName, reason);
}

// ── Risk Analysis ────────────────────────────────────────

router.get('/api/change-requests/:id/risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const ra = stmts.getRiskAnalysisByRequest.get(req.params.id);
  if (!ra) return res.json(null);
  const itemCount = stmts.getRiskItemCount.get(ra.id).cnt;
  res.json({ ...ra, item_count: itemCount });
});

router.post('/api/change-requests/:id/risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const existing = stmts.getRiskAnalysisByRequest.get(req.params.id);
  if (existing) return res.status(409).json({ error: 'Risk analysis already exists' });
  const { title, author, safety_manager } = req.body;
  const id = uuidv4();
  const today = new Date().toISOString().slice(0, 10);
  stmts.createRiskAnalysis.run(id, req.params.id, title || cr.title || '', 1, today, author || '', safety_manager || '', '', '');
  stmts.createRiskAnalysisHistory.run(uuidv4(), id, 1, today, author || '', 'Erstellt');
  const dept = stmts.getDepartment.get(cr.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  logAction('Risikoanalyse erstellt', 'risk_analysis', id, cr.change_no, '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getRiskAnalysis.get(id));
});

router.get('/api/risk-analysis/:id', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const itemCount = stmts.getRiskItemCount.get(ra.id).cnt;
  res.json({ ...ra, item_count: itemCount });
});

router.put('/api/risk-analysis/:id', (req, res) => {
  const existing = stmts.getRiskAnalysis.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk analysis not found' });
  const { title, version, version_date, author, safety_manager, signed_at, overall_initial, overall_residual } = req.body;
  stmts.updateRiskAnalysis.run(
    title || '', version != null ? version : existing.version, version_date || null,
    author || existing.author || '', safety_manager || '', signed_at || null,
    overall_initial || '', overall_residual || '',
    req.params.id
  );
  res.json(stmts.getRiskAnalysis.get(req.params.id));
});

router.get('/api/risk-analysis/:id/history', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  res.json(stmts.getRiskAnalysisHistory.all(req.params.id));
});

router.post('/api/risk-analysis/:id/history', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const { version, version_date, author, reason } = req.body;
  const id = uuidv4();
  stmts.createRiskAnalysisHistory.run(id, req.params.id, version || ra.version + 1, version_date || null, author || '', reason || '');
  res.status(201).json({ id, risk_analysis_id: req.params.id, version: version || ra.version + 1, version_date, author, reason });
});

// ── Risk Items ───────────────────────────────────────────
router.get('/api/risk-analysis/:id/items', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  res.json(stmts.getRiskItemsByAnalysis.all(req.params.id));
});

router.post('/api/risk-analysis/:id/items', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const b = req.body;
  const id = uuidv4();
  const existingItems = stmts.getRiskItemsByAnalysis.all(req.params.id);
  const sortOrder = existingItems.length + 1;
  const ini = computeRiskScore(b.initial_probability, b.initial_severity);
  const res2 = computeRiskScore(b.residual_probability, b.residual_severity);
  stmts.createRiskItem.run(id, req.params.id, sortOrder,
    b.risk_type || '', b.description || '', b.consequence || '',
    b.initial_probability || null, b.initial_severity || null, ini.score, ini.level,
    b.responsible_person || '', b.mitigation_topic || '', b.treatment || '', b.implementation_date || null,
    b.residual_probability || null, b.residual_severity || null, res2.score, res2.level,
    b.next_step || ''
  );
  addRiskHistoryAuto(req.params.id, `Risiko hinzugefügt: ${b.risk_type || b.description || ''}`);
  res.status(201).json(stmts.getRiskItem.get(id));
});

router.put('/api/risk-items/:id', (req, res) => {
  const existing = stmts.getRiskItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk item not found' });
  const b = req.body;
  const ini = computeRiskScore(b.initial_probability, b.initial_severity);
  const res2 = computeRiskScore(b.residual_probability, b.residual_severity);
  stmts.updateRiskItem.run(
    b.sort_order != null ? b.sort_order : existing.sort_order,
    b.risk_type || '', b.description || '', b.consequence || '',
    b.initial_probability || null, b.initial_severity || null, ini.score, ini.level,
    b.responsible_person || '', b.mitigation_topic || '', b.treatment || '', b.implementation_date || null,
    b.residual_probability || null, b.residual_severity || null, res2.score, res2.level,
    b.next_step || '',
    req.params.id
  );
  res.json(stmts.getRiskItem.get(req.params.id));
});

router.delete('/api/risk-items/:id', (req, res) => {
  const existing = stmts.getRiskItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Risk item not found' });
  const raId = existing.risk_analysis_id;
  const desc = existing.risk_type || existing.description || '';
  stmts.deleteRiskItem.run(req.params.id);
  addRiskHistoryAuto(raId, `Risiko gelöscht: ${desc}`);
  res.status(204).end();
});

// ── Import Risikoanalyse .xlsx ──────────────────────────
router.post('/api/change-requests/:id/import-risk-analysis', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'File data required' });

  try {
    const buf = Buffer.from(file, 'base64');
    const { items, history, meta } = parseRiskAnalysisXlsx(buf, cr.title);

    // Delete existing risk analysis if present
    const existingRA = stmts.getRiskAnalysisByRequest.get(cr.id);
    if (existingRA) {
      db.prepare('DELETE FROM risk_item WHERE risk_analysis_id = ?').run(existingRA.id);
      db.prepare('DELETE FROM risk_analysis_history WHERE risk_analysis_id = ?').run(existingRA.id);
      db.prepare('DELETE FROM risk_analysis WHERE id = ?').run(existingRA.id);
    }

    const raId = uuidv4();
    const today = new Date().toISOString().slice(0, 10);
    stmts.createRiskAnalysis.run(raId, cr.id, meta.title || cr.title, 1, today, meta.author || '', meta.safety_manager || '', meta.overall_initial || '', meta.overall_residual || '');

    // Insert history entries
    let historyCount = 0;
    for (const h of history) {
      stmts.createRiskAnalysisHistory.run(uuidv4(), raId, h.version, h.version_date, h.author, h.reason);
      historyCount++;
    }
    if (historyCount === 0) {
      stmts.createRiskAnalysisHistory.run(uuidv4(), raId, 1, today, '', 'Importiert');
    }

    // Insert risk items
    let itemCount = 0;
    for (const it of items) {
      itemCount++;
      stmts.createRiskItem.run(uuidv4(), raId, itemCount,
        it.risk_type, it.description, it.consequence,
        it.initial_probability, it.initial_severity, it.initial_score, it.initial_level,
        it.responsible_person, it.mitigation_topic, it.treatment, it.implementation_date,
        it.residual_probability, it.residual_severity, it.residual_score, it.residual_level,
        it.next_step
      );
    }

    // Final update with all extracted metadata (incl. signed_at if present)
    if (meta.signed_at || meta.overall_initial || meta.overall_residual || meta.safety_manager) {
      const raCurrent = stmts.getRiskAnalysis.get(raId);
      stmts.updateRiskAnalysis.run(
        meta.title || cr.title,
        raCurrent.version,
        raCurrent.version_date,
        meta.author || '',
        meta.safety_manager || '',
        meta.signed_at || raCurrent.signed_at,
        meta.overall_initial || '',
        meta.overall_residual || '',
        raId
      );
    }

    const dept = stmts.getDepartment.get(cr.department_id);
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    logAction('Risikoanalyse importiert', 'risk_analysis', raId, cr.change_no + ' (' + itemCount + ' Risiken)', '', company ? company.name : '', dept ? dept.name : '');
    res.json({ imported: itemCount, history: historyCount, title: meta.title });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: 'Import fehlgeschlagen: ' + e.message });
  }
});

// ── Risk Analysis PDF ───────────────────────────────────
router.get('/api/risk-analysis/:id/pdf', (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const cr = stmts.getChangeRequest.get(ra.change_request_id);
  const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  const logoRow = company ? stmts.getCompanyLogo.get(company.id) : null;
  const items = stmts.getRiskItemsByAnalysis.all(ra.id);
  const personsAll = company ? stmts.getPersonsByCompany.all(company.id) : [];
  const qm = personsAll.find(p => p.role === 'QM' && dept && p.department_id === dept.id);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="Risikoanalyse_${cr ? cr.change_no : 'RA'}.pdf"`);
  doc.pipe(res);
  renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm });
  addPdfFooter(doc, { label: 'Erstellt mit ac-change' });
  doc.end();
});

// ── Risk Analysis Send Email ────────────────────────────
router.post('/api/risk-analysis/:id/send-email', async (req, res) => {
  const ra = stmts.getRiskAnalysis.get(req.params.id);
  if (!ra) return res.status(404).json({ error: 'Risk analysis not found' });
  const { to, authority } = req.body;
  if (!to) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });

  try {
    const cr = stmts.getChangeRequest.get(ra.change_request_id);
    const dept = cr ? stmts.getDepartment.get(cr.department_id) : null;
    const company = dept ? stmts.getCompany.get(dept.company_id) : null;
    const qm = company && dept ? getQmForDepartment(company.id, dept.id) : null;

    const items = stmts.getRiskItemsByAnalysis.all(ra.id);
    const logoRow = company ? stmts.getCompanyLogo.get(company.id) : null;
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      renderRiskAnalysisPdf(doc, { ra, cr, dept, company, logoRow, items, qm });
      addPdfFooter(doc, { label: 'Erstellt mit ac-change' });
      doc.end();
    });

    const qmName = qm ? `${qm.first_name} ${qm.last_name}`.trim() : '';
    let subject, text;
    if (authority) {
      subject = `Risikoanalyse – ${cr ? cr.change_no : ''} – ${company ? company.name : ''} (${dept ? dept.name : ''})`;
      text = `${buildAuthoritySalutation(dept).trim()},\n\nanbei übersenden wir Ihnen die Risikoanalyse für ${cr ? cr.change_no + ' – ' : ''}${ra.title || ''}.\n\nBei Rückfragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n\n\n${qmName}\nSafety Manager\n${company ? company.name : ''}\n\n`;
    } else {
      subject = `Risikoanalyse – ${cr ? cr.change_no : ''} (${dept ? dept.name : ''})`;
      text = `Hallo,\n\nanbei die Risikoanalyse für ${cr ? cr.change_no + ' – ' : ''}${ra.title || ''}.\n\nBei Fragen stehen wir gerne zur Verfügung.\n\nViele Grüße\n\n\n${qmName}\nSafety Manager\n${company ? company.name : ''}\n\n`;
    }
    await sendDocumentEmail({ module: 'change', to, subject, text, filename: `Risikoanalyse_${cr ? cr.change_no : 'RA'}.pdf`, buffer: pdfBuffer, qm,
      logParams: ['Risikoanalyse gesendet', 'risk_analysis', ra.id, cr ? cr.change_no : '', `An: ${to}${authority ? ' (Behörde)' : ''}`, company ? company.name : '', dept ? dept.name : ''] });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

module.exports = router;
