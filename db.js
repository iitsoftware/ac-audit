const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'acaudit.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations: rename description → easa_permission_number if needed
try {
  db.prepare('SELECT easa_permission_number FROM department LIMIT 1').get();
} catch {
  try {
    db.exec('ALTER TABLE department RENAME COLUMN description TO easa_permission_number');
  } catch { /* column already correct or table fresh */ }
}

// Migrations: add new audit_plan columns (for existing DBs)
const auditPlanMigrations = [
  { name: 'scope', sql: "ALTER TABLE audit_plan ADD COLUMN scope TEXT DEFAULT ''" },
  { name: 'regulation', sql: "ALTER TABLE audit_plan ADD COLUMN regulation TEXT DEFAULT ''" },
  { name: 'audit_area', sql: "ALTER TABLE audit_plan ADD COLUMN audit_area TEXT DEFAULT ''" },
  { name: 'status', sql: "ALTER TABLE audit_plan ADD COLUMN status TEXT DEFAULT 'DRAFT'" },
  { name: 'version', sql: "ALTER TABLE audit_plan ADD COLUMN version INTEGER DEFAULT 1" },
  { name: 'revision', sql: "ALTER TABLE audit_plan ADD COLUMN revision INTEGER DEFAULT 0" },
  { name: 'owner', sql: "ALTER TABLE audit_plan ADD COLUMN owner TEXT DEFAULT ''" },
  { name: 'approved_by', sql: "ALTER TABLE audit_plan ADD COLUMN approved_by TEXT DEFAULT ''" },
  { name: 'approved_at', sql: "ALTER TABLE audit_plan ADD COLUMN approved_at TEXT" },
  { name: 'comment', sql: "ALTER TABLE audit_plan ADD COLUMN comment TEXT DEFAULT ''" },
  { name: 'submitted_to', sql: "ALTER TABLE audit_plan ADD COLUMN submitted_to TEXT DEFAULT ''" },
  { name: 'submitted_planned_at', sql: "ALTER TABLE audit_plan ADD COLUMN submitted_planned_at TEXT" },
  { name: 'submitted_at', sql: "ALTER TABLE audit_plan ADD COLUMN submitted_at TEXT" },
];

for (const col of auditPlanMigrations) {
  try {
    db.prepare(`SELECT ${col.name} FROM audit_plan LIMIT 1`).get();
  } catch {
    try { db.exec(col.sql); } catch { /* already exists */ }
  }
}

// Migration: add sort_order to department
try {
  db.prepare('SELECT sort_order FROM department LIMIT 1').get();
} catch {
  try { db.exec("ALTER TABLE department ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch { /* already exists */ }
}

// Migration: add regulation to department
try {
  db.prepare('SELECT regulation FROM department LIMIT 1').get();
} catch {
  try { db.exec("ALTER TABLE department ADD COLUMN regulation TEXT DEFAULT ''"); } catch { /* already exists */ }
}

// Migration: add email to person
try {
  db.prepare('SELECT email FROM person LIMIT 1').get();
} catch {
  try { db.exec("ALTER TABLE person ADD COLUMN email TEXT DEFAULT ''"); } catch { /* already exists */ }
}

// Migration: rename statuses DRAFT → ENTWURF, ACTIVE → AKTIV
try {
  db.exec("UPDATE audit_plan SET status = 'ENTWURF' WHERE status = 'DRAFT'");
  db.exec("UPDATE audit_plan SET status = 'AKTIV' WHERE status = 'ACTIVE'");
} catch { /* ignore */ }

// Migrations: add new audit_plan_line columns (for existing DBs)
const planLineMigrations = [
  { name: 'regulations', sql: "ALTER TABLE audit_plan_line ADD COLUMN regulations TEXT DEFAULT ''" },
  { name: 'location', sql: "ALTER TABLE audit_plan_line ADD COLUMN location TEXT DEFAULT ''" },
  { name: 'performed_date', sql: "ALTER TABLE audit_plan_line ADD COLUMN performed_date TEXT" },
  { name: 'signature', sql: "ALTER TABLE audit_plan_line ADD COLUMN signature TEXT DEFAULT ''" },
  { name: 'audit_no', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_no TEXT DEFAULT ''" },
  { name: 'audit_subject', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_subject TEXT DEFAULT ''" },
  { name: 'audit_title', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_title TEXT DEFAULT ''" },
  { name: 'auditor_team', sql: "ALTER TABLE audit_plan_line ADD COLUMN auditor_team TEXT DEFAULT ''" },
  { name: 'auditee', sql: "ALTER TABLE audit_plan_line ADD COLUMN auditee TEXT DEFAULT ''" },
  { name: 'audit_start_date', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_start_date TEXT" },
  { name: 'audit_end_date', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_end_date TEXT" },
  { name: 'audit_location', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_location TEXT DEFAULT ''" },
  { name: 'document_ref', sql: "ALTER TABLE audit_plan_line ADD COLUMN document_ref TEXT DEFAULT ''" },
  { name: 'document_iss_rev', sql: "ALTER TABLE audit_plan_line ADD COLUMN document_iss_rev TEXT DEFAULT ''" },
  { name: 'document_rev_date', sql: "ALTER TABLE audit_plan_line ADD COLUMN document_rev_date TEXT" },
  { name: 'recommendation', sql: "ALTER TABLE audit_plan_line ADD COLUMN recommendation TEXT DEFAULT ''" },
  { name: 'audit_status', sql: "ALTER TABLE audit_plan_line ADD COLUMN audit_status TEXT DEFAULT 'OPEN'" },
];

for (const col of planLineMigrations) {
  try {
    db.prepare(`SELECT ${col.name} FROM audit_plan_line LIMIT 1`).get();
  } catch {
    try { db.exec(col.sql); } catch { /* already exists */ }
  }
}

// Migration: drop old audit_checklist_item (references audit_id) and recreate with audit_plan_line_id
try {
  db.prepare('SELECT audit_plan_line_id FROM audit_checklist_item LIMIT 1').get();
} catch {
  // Old schema has audit_id — drop and recreate
  try {
    db.exec('DROP TABLE IF EXISTS audit_checklist_item');
    db.exec(`CREATE TABLE IF NOT EXISTS audit_checklist_item (
      id TEXT PRIMARY KEY,
      audit_plan_line_id TEXT NOT NULL REFERENCES audit_plan_line(id) ON DELETE CASCADE,
      section TEXT DEFAULT 'THEORETICAL',
      sort_order INTEGER DEFAULT 0,
      regulation_ref TEXT DEFAULT '',
      compliance_check TEXT DEFAULT '',
      evaluation TEXT DEFAULT '',
      auditor_comment TEXT DEFAULT '',
      document_ref TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch { /* ignore */ }
}

// Migration: drop old audit table (no longer needed)
try {
  db.exec('DROP TABLE IF EXISTS audit');
} catch { /* ignore */ }

// Prepared statements
const LINE_FIELDS = `id, audit_plan_id, sort_order, subject, regulations, location, planned_window, performed_date, signature,
  audit_no, audit_subject, audit_title, auditor_team, auditee, audit_start_date, audit_end_date, audit_location,
  document_ref, document_iss_rev, document_rev_date, recommendation, audit_status, created_at, updated_at`;

const stmts = {
  getAllCompanies: db.prepare(
    'SELECT id, name, street, postal_code, city, created_at, updated_at FROM company ORDER BY name'
  ),
  getCompany: db.prepare(
    'SELECT id, name, street, postal_code, city, created_at, updated_at FROM company WHERE id = ?'
  ),
  getCompanyLogo: db.prepare(
    'SELECT logo FROM company WHERE id = ?'
  ),
  createCompany: db.prepare(
    'INSERT INTO company (id, name, street, postal_code, city, logo) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  updateCompany: db.prepare(
    `UPDATE company SET name = ?, street = ?, postal_code = ?, city = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateCompanyLogo: db.prepare(
    `UPDATE company SET logo = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteCompany: db.prepare(
    'DELETE FROM company WHERE id = ?'
  ),
  countAuditPlansByCompany: db.prepare(
    `SELECT COUNT(*) AS cnt FROM audit_plan WHERE department_id IN (SELECT id FROM department WHERE company_id = ?)`
  ),

  // Department
  getDepartmentsByCompany: db.prepare(
    'SELECT id, company_id, name, easa_permission_number, regulation, sort_order, created_at, updated_at FROM department WHERE company_id = ? ORDER BY sort_order, name'
  ),
  getDepartment: db.prepare(
    'SELECT id, company_id, name, easa_permission_number, regulation, sort_order, created_at, updated_at FROM department WHERE id = ?'
  ),
  updateDepartmentSortOrder: db.prepare(
    `UPDATE department SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  createDepartment: db.prepare(
    'INSERT INTO department (id, company_id, name, easa_permission_number, regulation) VALUES (?, ?, ?, ?, ?)'
  ),
  updateDepartment: db.prepare(
    `UPDATE department SET name = ?, easa_permission_number = ?, regulation = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteDepartment: db.prepare(
    'DELETE FROM department WHERE id = ?'
  ),

  // Audit Plan
  getAuditPlansByDepartment: db.prepare(
    'SELECT id, department_id, year, status, revision, approved_by, approved_at, submitted_to, submitted_planned_at, submitted_at, created_at, updated_at FROM audit_plan WHERE department_id = ? ORDER BY year DESC'
  ),
  getAuditPlanProgress: db.prepare(
    `SELECT audit_plan_id,
            COUNT(*) AS total,
            SUM(CASE WHEN audit_end_date IS NOT NULL AND audit_end_date != '' THEN 1 ELSE 0 END) AS done
     FROM audit_plan_line
     WHERE audit_plan_id IN (SELECT id FROM audit_plan WHERE department_id = ?)
     GROUP BY audit_plan_id`
  ),
  getAuditPlan: db.prepare(
    'SELECT id, department_id, year, status, revision, approved_by, approved_at, submitted_to, submitted_planned_at, submitted_at, created_at, updated_at FROM audit_plan WHERE id = ?'
  ),
  createAuditPlan: db.prepare(
    "INSERT INTO audit_plan (id, department_id, name, year, status, revision) VALUES (?, ?, '', ?, ?, ?)"
  ),
  updateAuditPlan: db.prepare(
    `UPDATE audit_plan SET year = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateAuditPlanStatus: db.prepare(
    `UPDATE audit_plan SET status = ?, approved_by = ?, approved_at = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateAuditPlanSubmission: db.prepare(
    `UPDATE audit_plan SET submitted_to = ?, submitted_at = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateAuditPlanDates: db.prepare(
    `UPDATE audit_plan SET approved_at = ?, submitted_planned_at = ?, submitted_at = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  archiveActiveByDepartment: db.prepare(
    `UPDATE audit_plan SET status = 'ARCHIV', updated_at = datetime('now') WHERE department_id = ? AND status = 'AKTIV'`
  ),
  getAllAuditPlans: db.prepare(
    `SELECT ap.id, ap.department_id, ap.year, ap.status, ap.revision, ap.created_at, ap.updated_at,
            d.name as department_name, c.name as company_name
     FROM audit_plan ap
     JOIN department d ON d.id = ap.department_id
     JOIN company c ON c.id = d.company_id
     ORDER BY c.name, d.name, ap.year DESC`
  ),
  deleteAuditPlan: db.prepare(
    'DELETE FROM audit_plan WHERE id = ?'
  ),

  // Audit Plan Lines (with integrated audit fields)
  getMaxAuditNo: db.prepare(
    `SELECT COALESCE(MAX(CAST(audit_no AS INTEGER)), 0) AS max_no FROM audit_plan_line WHERE audit_plan_id = ?`
  ),
  getAuditPlanLinesByPlan: db.prepare(
    `SELECT ${LINE_FIELDS} FROM audit_plan_line WHERE audit_plan_id = ? ORDER BY CAST(audit_no AS INTEGER)`
  ),
  getAuditPlanLine: db.prepare(
    `SELECT ${LINE_FIELDS} FROM audit_plan_line WHERE id = ?`
  ),
  createAuditPlanLine: db.prepare(
    `INSERT INTO audit_plan_line (id, audit_plan_id, sort_order, subject, regulations, location, planned_window,
      audit_no, audit_subject, audit_title, auditor_team, auditee, audit_start_date, audit_end_date, audit_location,
      document_ref, document_iss_rev, document_rev_date, recommendation, audit_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateAuditPlanLine: db.prepare(
    `UPDATE audit_plan_line SET sort_order = ?, subject = ?, regulations = ?, location = ?, planned_window = ?, signature = ?,
      auditor_team = ?, auditee = ?,
      audit_start_date = ?, audit_end_date = ?, audit_location = ?,
      document_ref = ?, document_iss_rev = ?, document_rev_date = ?, recommendation = ?,
      updated_at = datetime('now')
     WHERE id = ?`
  ),
  updateAuditPlanLinePerformed: db.prepare(
    `UPDATE audit_plan_line SET performed_date = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteAuditPlanLine: db.prepare(
    'DELETE FROM audit_plan_line WHERE id = ?'
  ),

  // Checklist counts per plan (for tags)
  getChecklistCountsByPlan: db.prepare(
    `SELECT audit_plan_line_id,
            COUNT(*) AS checklist_count,
            SUM(CASE WHEN evaluation IN ('L1','L2','L3') THEN 1 ELSE 0 END) AS finding_count,
            SUM(CASE WHEN evaluation = 'O' THEN 1 ELSE 0 END) AS observation_count
     FROM audit_checklist_item
     WHERE audit_plan_line_id IN (SELECT id FROM audit_plan_line WHERE audit_plan_id = ?)
     GROUP BY audit_plan_line_id`
  ),

  getFindingDetailsByPlan: db.prepare(
    `SELECT audit_plan_line_id,
            SUM(CASE WHEN evaluation = 'L1' THEN 1 ELSE 0 END) AS l1,
            SUM(CASE WHEN evaluation = 'L2' THEN 1 ELSE 0 END) AS l2,
            SUM(CASE WHEN evaluation = 'L3' THEN 1 ELSE 0 END) AS l3,
            SUM(CASE WHEN evaluation = 'O' THEN 1 ELSE 0 END) AS obs
     FROM audit_checklist_item
     WHERE audit_plan_line_id IN (SELECT id FROM audit_plan_line WHERE audit_plan_id = ?)
       AND evaluation IN ('L1','L2','L3','O')
     GROUP BY audit_plan_line_id`
  ),

  // Audit Checklist Items (now references audit_plan_line_id)
  getChecklistItemsByLine: db.prepare(
    `SELECT id, audit_plan_line_id, section, sort_order, regulation_ref, compliance_check, evaluation, auditor_comment, document_ref,
            created_at, updated_at
     FROM audit_checklist_item WHERE audit_plan_line_id = ? ORDER BY section, sort_order, created_at`
  ),
  createChecklistItem: db.prepare(
    `INSERT INTO audit_checklist_item (id, audit_plan_line_id, section, sort_order, regulation_ref, compliance_check, evaluation, auditor_comment, document_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateChecklistItem: db.prepare(
    `UPDATE audit_checklist_item SET section = ?, sort_order = ?, regulation_ref = ?, compliance_check = ?, evaluation = ?,
                                     auditor_comment = ?, document_ref = ?, updated_at = datetime('now')
     WHERE id = ?`
  ),
  getChecklistItem: db.prepare(
    'SELECT * FROM audit_checklist_item WHERE id = ?'
  ),
  deleteChecklistItem: db.prepare(
    'DELETE FROM audit_checklist_item WHERE id = ?'
  ),
  deleteChecklistItemsByLine: db.prepare(
    'DELETE FROM audit_checklist_item WHERE audit_plan_line_id = ?'
  ),

  // CAP Items
  getCapItemsByPlan: db.prepare(
    `SELECT c.id, c.checklist_item_id, c.deadline, c.responsible_person, c.root_cause,
            c.corrective_action, c.preventive_action, c.status, c.completion_date, c.evidence,
            c.created_at, c.updated_at,
            ci.regulation_ref, ci.compliance_check, ci.evaluation, ci.auditor_comment,
            pl.subject, pl.audit_no
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE pl.audit_plan_id = ?
     ORDER BY CAST(pl.audit_no AS INTEGER), ci.sort_order`
  ),
  getCapItemByChecklistItem: db.prepare(
    'SELECT * FROM cap_item WHERE checklist_item_id = ?'
  ),
  createCapItem: db.prepare(
    `INSERT INTO cap_item (id, checklist_item_id, deadline, responsible_person, root_cause, corrective_action, preventive_action, status, completion_date, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateCapItem: db.prepare(
    `UPDATE cap_item SET deadline = ?, responsible_person = ?, root_cause = ?, corrective_action = ?,
                         preventive_action = ?, status = ?, completion_date = ?, evidence = ?,
                         updated_at = datetime('now')
     WHERE id = ?`
  ),
  deleteCapItem: db.prepare(
    'DELETE FROM cap_item WHERE id = ?'
  ),
  deleteCapItemByChecklistItem: db.prepare(
    'DELETE FROM cap_item WHERE checklist_item_id = ?'
  ),
  getCapItem: db.prepare(
    `SELECT c.*, ci.regulation_ref, ci.compliance_check, ci.evaluation, ci.auditor_comment,
            pl.subject, pl.audit_no
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE c.id = ?`
  ),

  // CAP Evidence Files
  getEvidenceFilesByCapItem: db.prepare(
    'SELECT id, filename, mime_type FROM cap_evidence_file WHERE cap_item_id = ? ORDER BY created_at'
  ),
  getEvidenceFile: db.prepare(
    'SELECT id, filename, mime_type, data FROM cap_evidence_file WHERE id = ?'
  ),
  createEvidenceFile: db.prepare(
    'INSERT INTO cap_evidence_file (id, cap_item_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)'
  ),
  deleteEvidenceFile: db.prepare(
    'DELETE FROM cap_evidence_file WHERE id = ?'
  ),

  // Checklist Evidence Files
  getEvidenceFilesByChecklistItem: db.prepare(
    'SELECT id, filename, mime_type FROM checklist_evidence_file WHERE checklist_item_id = ? ORDER BY created_at'
  ),
  getChecklistEvidenceFile: db.prepare(
    'SELECT id, filename, mime_type, data FROM checklist_evidence_file WHERE id = ?'
  ),
  createChecklistEvidenceFile: db.prepare(
    'INSERT INTO checklist_evidence_file (id, checklist_item_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)'
  ),
  deleteChecklistEvidenceFile: db.prepare(
    'DELETE FROM checklist_evidence_file WHERE id = ?'
  ),

  // Persons
  getPersonsByCompany: db.prepare(
    `SELECT id, company_id, department_id, role, first_name, last_name, email,
            CASE WHEN signature IS NOT NULL THEN 1 ELSE 0 END AS has_signature,
            created_at, updated_at
     FROM person WHERE company_id = ? ORDER BY role, created_at`
  ),
  getPerson: db.prepare(
    'SELECT id, company_id, department_id, role, first_name, last_name, email, created_at, updated_at FROM person WHERE id = ?'
  ),
  getPersonByRoleCompany: db.prepare(
    'SELECT id FROM person WHERE company_id = ? AND role = ? AND department_id IS NULL'
  ),
  getPersonByRoleDept: db.prepare(
    'SELECT id FROM person WHERE company_id = ? AND role = ? AND department_id = ?'
  ),
  createPerson: db.prepare(
    'INSERT INTO person (id, company_id, department_id, role, first_name, last_name, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  updatePerson: db.prepare(
    `UPDATE person SET first_name = ?, last_name = ?, email = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deletePerson: db.prepare(
    'DELETE FROM person WHERE id = ?'
  ),
  updatePersonSignature: db.prepare(
    `UPDATE person SET signature = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  getPersonSignature: db.prepare(
    'SELECT signature FROM person WHERE id = ?'
  ),

  getCapSummaryByPlan: db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN c.status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS closed
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE pl.audit_plan_id = ?`
  ),
};

// Migration: create CAP items for existing checklist items with O/L1/L2/L3 that have no CAP yet
try {
  const missing = db.prepare(
    `SELECT ci.id FROM audit_checklist_item ci
     WHERE ci.evaluation IN ('O','L1','L2','L3')
       AND NOT EXISTS (SELECT 1 FROM cap_item cap WHERE cap.checklist_item_id = ci.id)`
  ).all();
  if (missing.length > 0) {
    const { v4: uuidv4 } = require('uuid');
    const insertCap = db.prepare(
      `INSERT INTO cap_item (id, checklist_item_id, status) VALUES (?, ?, 'OPEN')`
    );
    const migrate = db.transaction(() => {
      for (const row of missing) {
        insertCap.run(uuidv4(), row.id);
      }
    });
    migrate();
    console.log(`CAP migration: created ${missing.length} CAP item(s) for existing findings/observations`);
  }
} catch { /* cap_item table might not exist yet on first run edge cases */ }

module.exports = { db, stmts };
