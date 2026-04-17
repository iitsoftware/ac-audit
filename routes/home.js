const express = require('express');
const { db, stmts } = require('../db');

const router = express.Router();

router.get('/api/home/stats', (req, res) => {
  try {
    const openCount = stmts.getCapStatsOpen.get().cnt;
    const overdueCount = stmts.getCapStatsOverdue.get().cnt;
    const totalAudits = stmts.getTotalAudits.get().cnt;
    const openChanges = stmts.getOpenChangeRequests.get().cnt;
    const totalChanges = stmts.getTotalChangeRequests.get().cnt;
    const openTasks = db.prepare(`SELECT COUNT(*) AS cnt FROM change_task WHERE (completion_date IS NULL OR completion_date = '')`).get().cnt;
    const totalTasks = db.prepare('SELECT COUNT(*) AS cnt FROM change_task').get().cnt;

    // Build enriched CAP items list via multi-query approach
    const openCaps = stmts.getOpenCapItems.all();
    const capItems = [];

    if (openCaps.length > 0) {
      // Step 2: Get checklist items
      const checklistItemIds = [...new Set(openCaps.map(c => c.checklist_item_id))];
      const checklistItems = db.prepare(
        `SELECT id, audit_plan_line_id, evaluation, compliance_check, regulation_ref
         FROM audit_checklist_item WHERE id IN (${checklistItemIds.map(() => '?').join(',')})`
      ).all(...checklistItemIds);
      const ciMap = Object.fromEntries(checklistItems.map(ci => [ci.id, ci]));

      // Step 3: Get plan lines
      const planLineIds = [...new Set(checklistItems.map(ci => ci.audit_plan_line_id))];
      const planLines = planLineIds.length > 0 ? db.prepare(
        `SELECT id, audit_plan_id, audit_no, subject
         FROM audit_plan_line WHERE id IN (${planLineIds.map(() => '?').join(',')})`
      ).all(...planLineIds) : [];
      const plMap = Object.fromEntries(planLines.map(pl => [pl.id, pl]));

      // Step 4: Get plans
      const planIds = [...new Set(planLines.map(pl => pl.audit_plan_id))];
      const plans = planIds.length > 0 ? db.prepare(
        `SELECT id, department_id, year
         FROM audit_plan WHERE id IN (${planIds.map(() => '?').join(',')})`
      ).all(...planIds) : [];
      const apMap = Object.fromEntries(plans.map(p => [p.id, p]));

      // Step 5: Get departments
      const deptIds = [...new Set(plans.map(p => p.department_id))];
      const depts = deptIds.length > 0 ? db.prepare(
        `SELECT id, company_id, name
         FROM department WHERE id IN (${deptIds.map(() => '?').join(',')})`
      ).all(...deptIds) : [];
      const dMap = Object.fromEntries(depts.map(d => [d.id, d]));

      // Step 6: Get companies
      const companyIds = [...new Set(depts.map(d => d.company_id))];
      const companies = companyIds.length > 0 ? db.prepare(
        `SELECT id, name
         FROM company WHERE id IN (${companyIds.map(() => '?').join(',')})`
      ).all(...companyIds) : [];
      const coMap = Object.fromEntries(companies.map(c => [c.id, c]));

      // Step 7: Merge
      const today = new Date().toISOString().slice(0, 10);
      for (const cap of openCaps) {
        const ci = ciMap[cap.checklist_item_id];
        if (!ci) continue;
        const pl = plMap[ci.audit_plan_line_id];
        if (!pl) continue;
        const ap = apMap[pl.audit_plan_id];
        if (!ap) continue;
        const dept = dMap[ap.department_id];
        if (!dept) continue;
        const co = coMap[dept.company_id];
        if (!co) continue;

        const isOverdue = cap.deadline && cap.deadline !== '' && cap.deadline < today;
        capItems.push({
          id: cap.id,
          companyId: co.id,
          companyName: co.name,
          departmentId: dept.id,
          departmentName: dept.name,
          auditPlanId: ap.id,
          auditPlanYear: ap.year,
          auditNo: pl.audit_no,
          auditSubject: pl.subject,
          evaluation: ci.evaluation,
          description: ci.compliance_check,
          deadline: cap.deadline,
          status: isOverdue ? 'OVERDUE' : 'OPEN',
          isOverdue,
          source: cap.source || 'audit',
        });
      }

      // Sort: overdue first, then by deadline ASC
      capItems.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return (a.deadline || '').localeCompare(b.deadline || '');
      });
    }

    res.json({
      modules: {
        audit: {
          openCaps: openCount,
          overdueCaps: overdueCount,
          totalAudits,
        },
        change: {
          openChanges,
          totalChanges,
          openTasks,
          totalTasks,
        },
      },
      capItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
