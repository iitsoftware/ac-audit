const { getQmForDepartment } = require('./email');

// Die Behörde eines Behördenaudits. Für jede hier geführte Organisation ist das
// das Luftfahrt-Bundesamt, also ist 'LBA' die Vorbelegung — sie hängt bewusst an
// diesem Helfer und NICHT am Spalten-Default von auditor_team, der sonst auch
// das Auditorenteam eines internen Audits füllen würde (siehe schema.sql).
const DEFAULT_AUTHORITY = 'LBA';

// Vorbelegung der Beanstandungsbericht-Zeile eines Behördenaudits: der Kopfblock
// eines Besuchs trennt drei Rollen — auditor_team ist die *Behörde*,
// authority_auditor ihr zuständiger Bearbeiter (der Wert, den
// views/partials/dept-dialog.ejs als "Zuständige Aufsichtsperson Behörde"
// pflegt, also department.authority_name) und auditee der QM. Beide Anlagewege
// lesen dieselbe Quelle — der Plan, der seinen einen Bericht gleich mitanlegt
// (POST /api/departments/:departmentId/audit-plans), und das manuelle Anlegen
// einer Zeile (POST /api/audit-plans/:auditPlanId/lines).
function authorityLineDefaults(dept) {
  // Ohne Abteilung bleibt die Behörde trotzdem vorbelegt: sie ist der eine Wert,
  // der nicht aus den Stammdaten kommt. Verloren gehen nur Bearbeiter und QM.
  if (!dept) return { auditorTeam: DEFAULT_AUTHORITY, authorityAuditor: '', auditee: '' };
  const qm = getQmForDepartment(dept.company_id, dept.id);
  return {
    auditorTeam: DEFAULT_AUTHORITY,
    authorityAuditor: dept.authority_name || '',
    auditee: qm ? `${qm.first_name} ${qm.last_name}`.trim() : '',
  };
}

module.exports = { authorityLineDefaults };
