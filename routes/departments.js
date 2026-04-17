const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');

const router = express.Router();

router.get('/api/companies/:companyId/departments', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(stmts.getDepartmentsByCompany.all(req.params.companyId));
});

router.post('/api/companies/:companyId/departments', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const { name, easa_permission_number, regulation, authority_salutation, authority_name, authority_email, initial_approval_email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  stmts.createDepartment.run(id, req.params.companyId, name.trim(), easa_permission_number || '', regulation || '', authority_salutation || '', authority_name || '', authority_email || '', initial_approval_email || '');
  logAction('Abteilung erstellt', 'department', id, name.trim(), '', company.name, name.trim());
  res.status(201).json(stmts.getDepartment.get(id));
});

router.put('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(existing.company_id);
  const { name, easa_permission_number, regulation, authority_salutation, authority_name, authority_email, initial_approval_email } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateDepartment.run(name.trim(), easa_permission_number || '', regulation || '', authority_salutation || '', authority_name || '', authority_email || '', initial_approval_email || '', req.params.id);
  logAction('Abteilung aktualisiert', 'department', req.params.id, name.trim(), '', company ? company.name : '', name.trim());
  res.json(stmts.getDepartment.get(req.params.id));
});

router.delete('/api/departments/:id', (req, res) => {
  const existing = stmts.getDepartment.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });
  const company = stmts.getCompany.get(existing.company_id);
  stmts.deleteDepartment.run(req.params.id);
  logAction('Abteilung gelöscht', 'department', req.params.id, existing.name, '', company ? company.name : '', existing.name);
  res.status(204).end();
});

router.patch('/api/companies/:companyId/departments/reorder', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const { order } = req.body; // array of department IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
  order.forEach((id, idx) => {
    stmts.updateDepartmentSortOrder.run(idx, id);
  });
  res.json(stmts.getDepartmentsByCompany.all(req.params.companyId));
});

// Department-level CAPs (shared with AC-Change)
router.get('/api/departments/:departmentId/cap-items', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(stmts.getCapItemsByDepartment.all(req.params.departmentId));
});

router.post('/api/departments/:departmentId/cap-items', (req, res) => {
  const dept = stmts.getDepartment.get(req.params.departmentId);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { source, source_ref_id, deadline, responsible_person } = req.body;
  const id = uuidv4();
  db.prepare(
    `INSERT INTO cap_item (id, department_id, source, source_ref_id, deadline, responsible_person, status)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`
  ).run(id, req.params.departmentId, source || 'manual', source_ref_id || null, deadline || null, responsible_person || '');
  res.status(201).json({ id });
});

module.exports = router;
