const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { logAction } = require('../services/audit-log');

const router = express.Router();

router.get('/api/companies', (req, res) => {
  const rows = stmts.getAllCompanies.all();
  rows.forEach(r => {
    const logoRow = stmts.getCompanyLogo.get(r.id);
    r.has_logo = !!(logoRow && logoRow.logo);
  });
  res.json(rows);
});

router.get('/api/companies/:id', (req, res) => {
  const row = stmts.getCompany.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  const logoRow = stmts.getCompanyLogo.get(req.params.id);
  row.has_logo = !!(logoRow && logoRow.logo);
  res.json(row);
});

router.post('/api/companies', (req, res) => {
  const { name, street, postal_code, city, phone, fax, logo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  stmts.createCompany.run(id, name.trim(), street || '', postal_code || '', city || '', phone || '', fax || '', logoBuf);
  logAction('Firma erstellt', 'company', id, name.trim(), '', name.trim());
  const created = stmts.getCompany.get(id);
  created.has_logo = !!logoBuf;
  res.status(201).json(created);
});

router.put('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { name, street, postal_code, city, phone, fax } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  stmts.updateCompany.run(name.trim(), street || '', postal_code || '', city || '', phone || '', fax || '', req.params.id);
  logAction('Firma aktualisiert', 'company', req.params.id, name.trim(), '', name.trim());
  const updated = stmts.getCompany.get(req.params.id);
  const logoRow = stmts.getCompanyLogo.get(req.params.id);
  updated.has_logo = !!(logoRow && logoRow.logo);
  res.json(updated);
});

router.delete('/api/companies/:id', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { cnt } = stmts.countAuditPlansByCompany.get(req.params.id);
  if (cnt > 0) return res.status(409).json({ error: 'Firma kann nicht gelöscht werden, da Auditpläne vorhanden sind' });
  stmts.deleteCompany.run(req.params.id);
  logAction('Firma gelöscht', 'company', req.params.id, existing.name, '', existing.name);
  res.status(204).end();
});

router.get('/api/companies/:id/logo', (req, res) => {
  const row = stmts.getCompanyLogo.get(req.params.id);
  if (!row || !row.logo) return res.status(404).json({ error: 'No logo' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(row.logo);
});

router.put('/api/companies/:id/logo', (req, res) => {
  const existing = stmts.getCompany.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Company not found' });
  const { logo } = req.body;
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  stmts.updateCompanyLogo.run(logoBuf, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
