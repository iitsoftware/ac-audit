const { getQmForDepartment } = require('./email');

// Vorbelegung der Beanstandungsbericht-Zeile eines Behördenaudits: die Behörde
// ist das "Auditteam", der QM der Abteilung der Auditierte. Beide Anlagewege
// lesen dieselbe Quelle — der Plan, der seinen einen Bericht gleich mitanlegt
// (POST /api/departments/:departmentId/audit-plans), und das manuelle Anlegen
// einer Zeile (POST /api/audit-plans/:auditPlanId/lines).
function authorityLineDefaults(dept) {
  if (!dept) return { auditorTeam: '', auditee: '' };
  const qm = getQmForDepartment(dept.company_id, dept.id);
  return {
    auditorTeam: dept.authority_name || '',
    auditee: qm ? `${qm.first_name} ${qm.last_name}`.trim() : '',
  };
}

module.exports = { authorityLineDefaults };
