const { db, stmts } = require('../db');

// ── Snapshot helpers (read entity + children with BLOBs base64-encoded) ──

function snapshotCapItem(capId) {
  const cap = stmts.getCapItemRaw.get(capId);
  if (!cap) return null;
  const evidenceFiles = stmts.getEvidenceFilesByCapItemFull.all(capId);
  cap.evidence_files = evidenceFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
  const fiveWhy = stmts.getFiveWhyByCapItem.get(capId);
  cap.five_why = fiveWhy || null;
  return cap;
}

function snapshotAuditPlanLine(lineId) {
  const line = stmts.getAuditPlanLineRaw.get(lineId);
  if (!line) return null;
  const items = stmts.getChecklistItemsByLineRaw.all(lineId);
  line.checklist_items = items.map(item => {
    const checkEvFiles = stmts.getEvidenceFilesByChecklistItemFull.all(item.id);
    item.evidence_files = checkEvFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
    const capItem = stmts.getCapItemByChecklistItem.get(item.id);
    if (capItem) {
      const capEvFiles = stmts.getEvidenceFilesByCapItemFull.all(capItem.id);
      capItem.evidence_files = capEvFiles.map(f => ({ ...f, data: f.data ? Buffer.from(f.data).toString('base64') : null }));
      capItem.five_why = stmts.getFiveWhyByCapItem.get(capItem.id) || null;
    }
    item.cap_item = capItem || null;
    return item;
  });
  return line;
}

function snapshotAuditPlan(planId) {
  const plan = stmts.getAuditPlanRaw.get(planId);
  if (!plan) return null;
  const lineIds = stmts.getAuditPlanLineIdsByPlan.all(planId);
  plan.lines = lineIds.map(l => snapshotAuditPlanLine(l.id));
  return plan;
}

// ── Restore helpers (re-insert with original UUIDs) ──

function restoreCapItem(cap) {
  stmts.restoreCapItem.run(
    cap.id, cap.checklist_item_id, cap.deadline, cap.responsible_person,
    cap.root_cause, cap.corrective_action, cap.preventive_action,
    cap.status, cap.completion_date, cap.evidence, cap.notified_at,
    cap.source || 'audit', cap.source_ref_id || null, cap.department_id || null,
    cap.created_at, cap.updated_at
  );
  if (cap.evidence_files) {
    for (const f of cap.evidence_files) {
      stmts.insertEvidenceFileFull.run(
        f.id, f.cap_item_id, f.filename, f.mime_type,
        f.data ? Buffer.from(f.data, 'base64') : null, f.created_at
      );
    }
  }
  if (cap.five_why) {
    const fw = cap.five_why;
    stmts.insertFiveWhyFull.run(
      fw.id, fw.cap_item_id, fw.why1, fw.why2, fw.why3, fw.why4, fw.why5,
      fw.root_cause, fw.created_at, fw.updated_at
    );
  }
}

function restoreChecklistItem(item) {
  stmts.restoreChecklistItem.run(
    item.id, item.audit_plan_line_id, item.section, item.sort_order,
    item.regulation_ref, item.compliance_check, item.evaluation,
    item.auditor_comment, item.document_ref, item.created_at, item.updated_at
  );
  if (item.evidence_files) {
    for (const f of item.evidence_files) {
      stmts.insertChecklistEvidenceFileFull.run(
        f.id, f.checklist_item_id, f.filename, f.mime_type,
        f.data ? Buffer.from(f.data, 'base64') : null, f.created_at
      );
    }
  }
  if (item.cap_item) {
    restoreCapItem(item.cap_item);
  }
}

function restoreAuditPlanLine(line) {
  stmts.restoreAuditPlanLine.run(
    line.id, line.audit_plan_id, line.sort_order, line.subject, line.regulations,
    line.location, line.planned_window, line.performed_date, line.signature,
    line.audit_no, line.audit_subject, line.audit_title, line.auditor_team, line.auditee,
    line.audit_start_date, line.audit_end_date, line.audit_location,
    line.document_ref, line.document_iss_rev, line.document_rev_date,
    line.recommendation, line.audit_status, line.created_at, line.updated_at
  );
  if (line.checklist_items) {
    for (const item of line.checklist_items) {
      restoreChecklistItem(item);
    }
  }
}

function restoreAuditPlan(plan) {
  stmts.restoreAuditPlan.run(
    plan.id, plan.department_id, plan.name || '', plan.year, plan.status, plan.revision,
    plan.approved_by, plan.approved_at, plan.submitted_to, plan.submitted_planned_at, plan.submitted_at,
    plan.created_at, plan.updated_at
  );
  if (plan.lines) {
    for (const line of plan.lines) {
      restoreAuditPlanLine(line);
    }
  }
}

// Start trash cleanup scheduler (purge expired items daily)
function startTrashCleanupScheduler() {
  try {
    const trashDays = (stmts.getSetting.get('trash_retention_days') || {}).value || '30';
    stmts.deleteExpiredTrashItems.run(trashDays);
  } catch {}
  setInterval(() => {
    try {
      const trashDays = (stmts.getSetting.get('trash_retention_days') || {}).value || '30';
      stmts.deleteExpiredTrashItems.run(trashDays);
    } catch {}
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  snapshotCapItem,
  snapshotAuditPlanLine,
  snapshotAuditPlan,
  restoreCapItem,
  restoreChecklistItem,
  restoreAuditPlanLine,
  restoreAuditPlan,
  startTrashCleanupScheduler,
};
