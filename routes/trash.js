const express = require('express');
const { db, stmts } = require('../db');
const { logAction } = require('../services/audit-log');
const {
  restoreAuditPlan, restoreAuditPlanLine, restoreCapItem,
  restoreSmsMeeting, restoreSafetyYear,
} = require('../services/trash');

// safety_objective/spi_evaluation were dropped with the CM-025 rework; snapshots of
// them may still sit in an old trash table but can no longer be restored.
const OBSOLETE_ENTITY_TYPES = ['safety_objective', 'spi_evaluation'];

const router = express.Router();

router.get('/api/trash', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  res.json(stmts.getTrashItems.all(limit, offset));
});

router.get('/api/trash/count', (req, res) => {
  const row = stmts.getTrashItemCount.get();
  res.json({ count: row ? row.cnt : 0 });
});

router.post('/api/trash/:id/restore', (req, res) => {
  const item = stmts.getTrashItem.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Trash item not found' });

  if (OBSOLETE_ENTITY_TYPES.includes(item.entity_type)) {
    return res.status(409).json({ error: 'Dieser Eintrag stammt aus einer älteren Safety-Version und kann nicht mehr wiederhergestellt werden.' });
  }

  const snapshot = JSON.parse(item.snapshot);

  // Check parent existence
  if (item.entity_type === 'audit_plan') {
    const dept = stmts.getDepartment.get(item.parent_id);
    if (!dept) return res.status(409).json({ error: 'Abteilung existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'audit_plan_line') {
    const plan = stmts.getAuditPlan.get(item.parent_id);
    if (!plan) return res.status(409).json({ error: 'Auditplan existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'cap_item') {
    const checkItem = db.prepare('SELECT id FROM audit_checklist_item WHERE id = ?').get(item.parent_id);
    if (!checkItem) return res.status(409).json({ error: 'Prüfpunkt existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'safety_year') {
    const dept = stmts.getDepartment.get(item.parent_id);
    if (!dept) return res.status(409).json({ error: 'Abteilung existiert nicht mehr. Wiederherstellung nicht möglich.' });
  } else if (item.entity_type === 'sms_meeting') {
    // CM-025 meetings hang off a safety_year; snapshots from before that off the department.
    if (item.parent_type === 'safety_year') {
      const year = stmts.getSafetyYear.get(item.parent_id);
      if (!year) return res.status(409).json({ error: 'Safety-Jahr existiert nicht mehr. Wiederherstellung nicht möglich.' });
    } else {
      const dept = stmts.getDepartment.get(item.parent_id);
      if (!dept) return res.status(409).json({ error: 'Abteilung existiert nicht mehr. Wiederherstellung nicht möglich.' });
    }
  }

  try {
    const restoreTx = db.transaction(() => {
      if (item.entity_type === 'audit_plan') {
        restoreAuditPlan(snapshot);
      } else if (item.entity_type === 'audit_plan_line') {
        restoreAuditPlanLine(snapshot);
      } else if (item.entity_type === 'cap_item') {
        restoreCapItem(snapshot);
      } else if (item.entity_type === 'safety_year') {
        restoreSafetyYear(snapshot);
      } else if (item.entity_type === 'sms_meeting') {
        restoreSmsMeeting(snapshot);
      }
      stmts.deleteTrashItem.run(req.params.id);
    });
    restoreTx();
    logAction('Wiederhergestellt', item.entity_type, item.entity_id, item.entity_name, 'Aus Papierkorb', item.company_name, item.department_name);
    res.json({ ok: true });
  } catch (e) {
    console.error('Restore failed:', e.message);
    res.status(500).json({ error: 'Wiederherstellung fehlgeschlagen: ' + e.message });
  }
});

router.delete('/api/trash/:id', (req, res) => {
  stmts.deleteTrashItem.run(req.params.id);
  res.status(204).end();
});

router.post('/api/trash/empty', (req, res) => {
  stmts.deleteAllTrashItems.run();
  res.json({ ok: true });
});

module.exports = router;
