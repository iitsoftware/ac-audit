const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { calcCapDeadline } = require('../services/cap-deadlines');

const router = express.Router();

router.put('/api/checklist-items/:id', (req, res) => {
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
    const lineForCap = stmts.getAuditPlanLine.get(existing.audit_plan_line_id);
    const dl = calcCapDeadline(evalVal, lineForCap ? lineForCap.performed_date : null);
    const planForCap = lineForCap ? stmts.getAuditPlan.get(lineForCap.audit_plan_id) : null;
    const deptIdForCap = planForCap ? planForCap.department_id : null;
    stmts.createCapItem.run(uuidv4(), req.params.id, dl, '', '', '', '', 'OPEN', null, '', deptIdForCap, 'audit', null);
  } else if (!needsCap && existingCap) {
    stmts.deleteCapItemByChecklistItem.run(req.params.id);
  }
  res.json(stmts.getChecklistItem.get(req.params.id));
});

router.delete('/api/checklist-items/:id', (req, res) => {
  const existing = stmts.getChecklistItem.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Checklist item not found' });
  stmts.deleteChecklistItem.run(req.params.id);
  res.status(204).end();
});

// ── Checklist Evidence Files ────────────────────────────
router.get('/api/checklist-items/:id/evidence-files', (req, res) => {
  res.json(stmts.getEvidenceFilesByChecklistItem.all(req.params.id));
});

router.post('/api/checklist-items/:id/evidence-files', (req, res) => {
  const { filename, mime_type, data } = req.body;
  if (!data) return res.status(400).json({ error: 'data is required' });
  const id = uuidv4();
  const buf = Buffer.from(data, 'base64');
  stmts.createChecklistEvidenceFile.run(id, req.params.id, filename || '', mime_type || 'image/png', buf);
  res.status(201).json({ id, filename, mime_type });
});

router.get('/api/checklist-evidence-files/:id', (req, res) => {
  const row = stmts.getChecklistEvidenceFile.get(req.params.id);
  if (!row || !row.data) return res.status(404).json({ error: 'Not found' });
  res.set('Content-Type', row.mime_type || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.data);
});

router.delete('/api/checklist-evidence-files/:id', (req, res) => {
  stmts.deleteChecklistEvidenceFile.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
