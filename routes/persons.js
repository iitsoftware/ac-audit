const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');

const router = express.Router();

const COMPANY_ROLES = ['ACCOUNTABLE'];
const DEPT_ROLES = ['QM', 'ABTEILUNGSLEITER'];
const ALL_ROLES = [...COMPANY_ROLES, ...DEPT_ROLES];

router.get('/api/companies/:companyId/persons', (req, res) => {
  const company = stmts.getCompany.get(req.params.companyId);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(stmts.getPersonsByCompany.all(req.params.companyId));
});

router.post('/api/companies/:companyId/persons', (req, res) => {
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

router.put('/api/persons/:id', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  const { first_name, last_name, email } = req.body;
  stmts.updatePerson.run(first_name || '', last_name || '', email || '', req.params.id);
  res.json(stmts.getPerson.get(req.params.id));
});

router.delete('/api/persons/:id', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  stmts.deletePerson.run(req.params.id);
  res.status(204).end();
});

router.put('/api/persons/:id/signature', (req, res) => {
  const person = stmts.getPerson.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  const { signature } = req.body;
  const sigBuf = signature ? Buffer.from(signature, 'base64') : null;
  stmts.updatePersonSignature.run(sigBuf, req.params.id);
  res.json({ ok: true });
});

router.get('/api/persons/:id/signature', (req, res) => {
  const row = stmts.getPersonSignature.get(req.params.id);
  if (!row || !row.signature) return res.status(404).json({ error: 'No signature' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.signature);
});

module.exports = router;
