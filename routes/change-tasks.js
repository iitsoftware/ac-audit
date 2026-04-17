const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { stmts } = require('../db');
const { logAction } = require('../services/audit-log');

const router = express.Router();

router.get('/api/change-requests/:id/tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  res.json(stmts.getChangeTasksByRequest.all(req.params.id));
});

router.post('/api/change-requests/:id/tasks', (req, res) => {
  const cr = stmts.getChangeRequest.get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Change request not found' });
  const { process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header } = req.body;
  const id = uuidv4();
  const maxOrder = stmts.getMaxChangeTaskOrder.get(req.params.id).max_order;
  stmts.createChangeTask.run(id, req.params.id, maxOrder + 1, process || '', area || '', safety_note || '', measures || '', responsible_person || '', target_date || null, completion_date || null, section_header || '');
  const dept = stmts.getDepartment.get(cr.department_id);
  const company = dept ? stmts.getCompany.get(dept.company_id) : null;
  logAction('Aufgabe erstellt', 'change_task', id, (process || '').substring(0, 60), '', company ? company.name : '', dept ? dept.name : '');
  res.status(201).json(stmts.getChangeTask.get(id));
});

router.put('/api/change-tasks/:id', (req, res) => {
  const existing = stmts.getChangeTask.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  const { sort_order, process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header } = req.body;
  stmts.updateChangeTask.run(
    sort_order != null ? sort_order : existing.sort_order,
    process || '', area || '', safety_note || '', measures || '',
    responsible_person || '', target_date || null, completion_date || null, section_header || '',
    req.params.id
  );
  res.json(stmts.getChangeTask.get(req.params.id));
});

router.delete('/api/change-tasks/:id', (req, res) => {
  const existing = stmts.getChangeTask.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });
  stmts.deleteChangeTask.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
