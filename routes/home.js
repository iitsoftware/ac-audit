const express = require('express');
const { stmts } = require('../db');
const { loadResource } = require('../middleware/load-resource');

const router = express.Router();

// Die vier Levels in der Reihenfolge, in der sie überall stehen (Findingliste,
// Zusammenfassung, Legende des Audit-Line-PDFs). Gespeichert wird der rohe
// Wert; der Klartext ("Bemerkung") ist Beschriftungssache der Oberfläche und
// hat in einem Aggregat nichts verloren — sonst gäbe es ihn zweimal.
const FINDING_LEVELS = ['O', 'L1', 'L2', 'L3'];

// Kennzahlen EINER Abteilung für die Dashboard-Charts. Ein Aufruf, fünf
// Aggregate, alle fertig gezählt in SQL — die Route rechnet nichts, sie formt
// nur die Antwort. Ein globales Dashboard gibt es nicht mehr: nach dem Login
// kommen die Firmenkacheln, und jede Abteilung trägt ihre eigenen Zahlen.
router.get(
  '/api/departments/:id/dashboard',
  loadResource('getDepartment', 'id', 'Department not found'),
  (req, res) => {
    try {
      const deptId = req.resource.id;
      // Das laufende Kalenderjahr ist der Bezug von Auditplan (audit_plan.year)
      // und Sicherheitsjahr (safety_year.year) gleichermaßen — beide sind eine
      // Jahreszahl und kein Datum, deshalb genügt getFullYear().
      const year = new Date().getFullYear();

      // Findings nach Level — jedes Level steht in der Antwort, auch mit 0:
      // ein Chart braucht seine Kategorie, sonst verschieben sich die Balken
      // zwischen zwei Abteilungen.
      const levelRows = stmts.getDashboardFindingsByLevel.all(deptId);
      const levelCounts = Object.fromEntries(levelRows.map(r => [r.level, r.cnt]));
      const findings = {
        total: levelRows.reduce((sum, r) => sum + r.cnt, 0),
        byLevel: FINDING_LEVELS.map(level => ({ level, count: levelCounts[level] || 0 })),
      };

      // CAP-Fristen — drei sich ausschließende Töpfe über allen offenen CAP
      // Items der Abteilung, quellenübergreifend (Audit, Change, manuell).
      const d = stmts.getDashboardCapDeadlines.get(deptId);
      const capDeadlines = {
        total: d.total,
        overdue: d.overdue,
        dueSoon: d.due_soon,
        open: d.later,
      };

      // Audits des laufenden Jahres, geplant vs. durchgeführt.
      const a = stmts.getDashboardAuditsByYear.get(deptId, year);
      const audits = {
        year,
        planned: a.planned,
        performed: a.performed,
        // Ausdrücklich als eigene Zahl und nicht im Frontend gerechnet: sie ist
        // die Aussage des Charts ("was steht noch aus"), und planned - performed
        // an zwei Stellen zu bilden ist die Stelle, an der beide abdriften.
        outstanding: a.planned - a.performed,
      };

      // Sicherheitsziele des Sicherheitsjahres zum laufenden Kalenderjahr. Ein
      // Jahr ohne Katalog — oder gar kein Sicherheitsjahr — liefert lauter
      // Nullen statt eines Fehlers: das ist ein Zustand und keine Störung.
      const s = stmts.getDashboardSafetyObjectives.get(deptId, year);
      const safetyObjectives = {
        year,
        total: s.total,
        fulfilled: s.fulfilled,
        missed: s.missed,
        due: s.due,
      };

      // Change Requests nach Status, in der Reihenfolge, die das Statement
      // liefert — welche Status es gibt, entscheiden die Daten.
      const changeRows = stmts.getDashboardChangeRequestsByStatus.all(deptId);
      const changeRequests = {
        total: changeRows.reduce((sum, r) => sum + r.cnt, 0),
        byStatus: changeRows.map(r => ({ status: r.status || '', count: r.cnt })),
      };

      res.json({
        departmentId: deptId,
        departmentName: req.resource.name,
        findings,
        capDeadlines,
        audits,
        safetyObjectives,
        changeRequests,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
