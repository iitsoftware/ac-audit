const { stmts } = require('../db');

function getCapDeadlineDays() {
  const rows = stmts.getAllSettings.all();
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return {
    O: parseInt(s.cap_deadline_O) || 180,
    L1: parseInt(s.cap_deadline_L1) || 5,
    L2: parseInt(s.cap_deadline_L2) || 60,
    L3: parseInt(s.cap_deadline_L3) || 90,
  };
}

function calcCapDeadline(evaluation, performedDate) {
  if (!performedDate || !evaluation) return null;
  const days = getCapDeadlineDays();
  const d = days[evaluation];
  if (d === undefined) return null;
  const base = new Date(performedDate);
  if (isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + d);
  return base.toISOString().slice(0, 10);
}

module.exports = { getCapDeadlineDays, calcCapDeadline };
