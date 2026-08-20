const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('./migrations');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'acaudit.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema + migrations
runMigrations(db);

// Prepared statements
const LINE_FIELDS = `id, audit_plan_id, sort_order, subject, regulations, location, planned_window, performed_date, signature,
  audit_no, audit_subject, audit_title, auditor_team, authority_auditor, auditee, audit_start_date, audit_end_date, audit_location,
  document_ref, document_iss_rev, document_rev_date, recommendation, audit_status, created_at, updated_at`;

const stmts = {
  getAllCompanies: db.prepare(
    'SELECT id, name, street, postal_code, city, phone, fax, created_at, updated_at FROM company ORDER BY name'
  ),
  getCompany: db.prepare(
    'SELECT id, name, street, postal_code, city, phone, fax, created_at, updated_at FROM company WHERE id = ?'
  ),
  getCompanyLogo: db.prepare(
    'SELECT logo FROM company WHERE id = ?'
  ),
  createCompany: db.prepare(
    'INSERT INTO company (id, name, street, postal_code, city, phone, fax, logo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateCompany: db.prepare(
    `UPDATE company SET name = ?, street = ?, postal_code = ?, city = ?, phone = ?, fax = ?, updated_at = datetime('now') WHERE id = ?`
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
    'SELECT id, company_id, name, easa_permission_number, regulation, sort_order, authority_salutation, authority_name, authority_email, initial_approval_email, created_at, updated_at FROM department WHERE company_id = ? ORDER BY sort_order, name'
  ),
  getDepartment: db.prepare(
    'SELECT id, company_id, name, easa_permission_number, regulation, sort_order, authority_salutation, authority_name, authority_email, initial_approval_email, created_at, updated_at FROM department WHERE id = ?'
  ),
  updateDepartmentSortOrder: db.prepare(
    `UPDATE department SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  createDepartment: db.prepare(
    'INSERT INTO department (id, company_id, name, easa_permission_number, regulation, authority_salutation, authority_name, authority_email, initial_approval_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateDepartment: db.prepare(
    `UPDATE department SET name = ?, easa_permission_number = ?, regulation = ?, authority_salutation = ?, authority_name = ?, authority_email = ?, initial_approval_email = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteDepartment: db.prepare(
    'DELETE FROM department WHERE id = ?'
  ),

  // Audit Plan
  // Bei plan_type = 'AUTHORITY' ist die Plan-Ebene kein eigenes Navigationsziel:
  // die Kachel springt direkt in den Beanstandungsbericht. Damit das ohne
  // Zwischen-Fetch geht, liefert der LEFT JOIN die (einzige) audit_plan_line samt
  // Datum und Behörde mit. Der COUNT-Guard hält den Join einzeilig — bei internen
  // Plänen und bei 0 oder >1 Zeilen bleibt authority_line_id NULL, worauf der
  // Klick-Handler auf die heutige Plan-Ebene zurückfällt.
  getAuditPlansByDepartment: db.prepare(
    `SELECT ap.id, ap.department_id, ap.year, ap.status, ap.revision, ap.approved_by, ap.approved_at,
            ap.submitted_to, ap.submitted_planned_at, ap.submitted_at, ap.plan_type, ap.created_at, ap.updated_at,
            al.id AS authority_line_id,
            COALESCE(NULLIF(al.performed_date, ''), NULLIF(al.audit_end_date, ''), NULLIF(al.audit_start_date, '')) AS authority_date,
            al.auditor_team AS authority_auditor_team
     FROM audit_plan ap
     LEFT JOIN audit_plan_line al
            ON ap.plan_type = 'AUTHORITY'
           AND al.audit_plan_id = ap.id
           AND (SELECT COUNT(*) FROM audit_plan_line x WHERE x.audit_plan_id = ap.id) = 1
     WHERE ap.department_id = ?
     ORDER BY ap.year DESC`
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
    'SELECT id, department_id, year, status, revision, approved_by, approved_at, submitted_to, submitted_planned_at, submitted_at, plan_type, created_at, updated_at FROM audit_plan WHERE id = ?'
  ),
  createAuditPlan: db.prepare(
    "INSERT INTO audit_plan (id, department_id, name, year, status, revision, plan_type) VALUES (?, ?, '', ?, ?, ?, ?)"
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
    `SELECT ap.id, ap.department_id, ap.year, ap.status, ap.revision, ap.plan_type, ap.created_at, ap.updated_at,
            d.name as department_name, c.name as company_name
     FROM audit_plan ap
     JOIN department d ON d.id = ap.department_id
     JOIN company c ON c.id = d.company_id
     ORDER BY c.name, d.name, ap.year DESC`
  ),
  deleteAuditPlan: db.prepare(
    'DELETE FROM audit_plan WHERE id = ?'
  ),
  getAuditPlanRaw: db.prepare(
    'SELECT * FROM audit_plan WHERE id = ?'
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
  getAuditPlanLineRaw: db.prepare(
    'SELECT * FROM audit_plan_line WHERE id = ?'
  ),
  getAuditPlanLineIdsByPlan: db.prepare(
    'SELECT id FROM audit_plan_line WHERE audit_plan_id = ?'
  ),
  createAuditPlanLine: db.prepare(
    `INSERT INTO audit_plan_line (id, audit_plan_id, sort_order, subject, regulations, location, planned_window,
      audit_no, audit_subject, audit_title, auditor_team, authority_auditor, auditee, audit_start_date, audit_end_date, audit_location,
      document_ref, document_iss_rev, document_rev_date, recommendation, audit_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
  getChecklistItemsByLineRaw: db.prepare(
    'SELECT * FROM audit_checklist_item WHERE audit_plan_line_id = ? ORDER BY section, sort_order'
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
  getChecklistItemById: db.prepare(
    'SELECT id FROM audit_checklist_item WHERE id = ?'
  ),
  deleteChecklistItem: db.prepare(
    'DELETE FROM audit_checklist_item WHERE id = ?'
  ),
  deleteChecklistItemsByLine: db.prepare(
    'DELETE FROM audit_checklist_item WHERE audit_plan_line_id = ?'
  ),

  // CAP Items
  getEvidenceCountsByLine: db.prepare(
    `SELECT checklist_item_id, COUNT(*) AS evidence_count
     FROM checklist_evidence_file
     WHERE checklist_item_id IN (SELECT id FROM audit_checklist_item WHERE audit_plan_line_id = ?)
     GROUP BY checklist_item_id`
  ),

  // Fristen der CAP-Items einer Zeile — die flache Beanstandungstabelle der
  // Behördenaudits zeigt sie als Spalte, ohne pro Zeile ein CAP-Item nachzuladen.
  getCapDeadlinesByLine: db.prepare(
    `SELECT c.checklist_item_id, c.deadline
     FROM cap_item c
     WHERE c.checklist_item_id IN (SELECT id FROM audit_checklist_item WHERE audit_plan_line_id = ?)`
  ),

  getEvidenceCountsByPlan: db.prepare(
    `SELECT ci.audit_plan_line_id, COUNT(*) AS evidence_count
     FROM checklist_evidence_file cef
     JOIN audit_checklist_item ci ON ci.id = cef.checklist_item_id
     WHERE ci.audit_plan_line_id IN (SELECT id FROM audit_plan_line WHERE audit_plan_id = ?)
     GROUP BY ci.audit_plan_line_id`
  ),

  // audit_plan_line_id reist mit, weil die Übersicht "Offene Beanstandungen" auf der
  // Berichtsebene steht: sie zeigt genau die CAPs ihres Berichts, die Route liefert
  // aber die des ganzen Plans (beim Altbestand mehrere Berichte).
  getCapItemsByPlan: db.prepare(
    `SELECT c.id, c.checklist_item_id, c.deadline, c.responsible_person, c.root_cause,
            c.corrective_action, c.preventive_action, c.status, c.completion_date, c.evidence,
            c.created_at, c.updated_at,
            ci.audit_plan_line_id, ci.regulation_ref, ci.compliance_check, ci.evaluation, ci.auditor_comment,
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
    `INSERT INTO cap_item (id, checklist_item_id, deadline, responsible_person, root_cause, corrective_action, preventive_action, status, completion_date, evidence, department_id, source, source_ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  createCapItemManual: db.prepare(
    `INSERT INTO cap_item (id, department_id, source, source_ref_id, deadline, responsible_person, status)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`
  ),
  updateCapItem: db.prepare(
    `UPDATE cap_item SET deadline = ?, responsible_person = ?, root_cause = ?, corrective_action = ?,
                         preventive_action = ?, completion_date = ?, evidence = ?,
                         status = CASE WHEN ? IS NOT NULL AND ? != '' THEN 'CLOSED' ELSE 'OPEN' END,
                         updated_at = datetime('now')
     WHERE id = ?`
  ),
  updateCapItemDeadline: db.prepare(
    `UPDATE cap_item SET deadline = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteCapItem: db.prepare(
    'DELETE FROM cap_item WHERE id = ?'
  ),
  deleteCapItemByChecklistItem: db.prepare(
    'DELETE FROM cap_item WHERE checklist_item_id = ?'
  ),
  getCapItem: db.prepare(
    `SELECT c.*, ci.regulation_ref, ci.compliance_check, ci.evaluation, ci.auditor_comment,
            pl.subject, pl.audit_no, p.plan_type
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     JOIN audit_plan p ON p.id = pl.audit_plan_id
     WHERE c.id = ?`
  ),
  getCapItemRaw: db.prepare(
    'SELECT * FROM cap_item WHERE id = ?'
  ),
  getOpenCapItemsWithLineContext: db.prepare(
    `SELECT c.id, ci.evaluation, pl.performed_date, pl.audit_end_date
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE (c.completion_date IS NULL OR c.completion_date = '')`
  ),

  // CAP Actions — mehrere durchnummerierte Maßnahmen je Beanstandung.
  // ORDER BY kind, sort_order, created_at hält Behebungs- und Präventivmaßnahmen
  // getrennt und innerhalb ihrer Gruppe stabil: genau die Reihenfolge, aus deren
  // Index das CM-003-PDF und der Screen ihre Nummer ("1. … 2. …") ableiten.
  getCapActionsByCapItem: db.prepare(
    'SELECT * FROM cap_action WHERE cap_item_id = ? ORDER BY kind, sort_order, created_at'
  ),
  getCapAction: db.prepare(
    'SELECT * FROM cap_action WHERE id = ?'
  ),
  createCapAction: db.prepare(
    `INSERT INTO cap_action (id, cap_item_id, sort_order, kind, description, responsible_person, target_date, completion_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateCapAction: db.prepare(
    `UPDATE cap_action SET sort_order = ?, kind = ?, description = ?, responsible_person = ?,
                           target_date = ?, completion_date = ?, updated_at = datetime('now')
     WHERE id = ?`
  ),
  deleteCapAction: db.prepare(
    'DELETE FROM cap_action WHERE id = ?'
  ),
  // -1 als Default, damit der Aufrufer beim Anlegen wie beim Zielkatalog mit
  // max+1 rechnet und die erste Maßnahme einer Gruppe sort_order 0 bekommt.
  getMaxCapActionSortOrder: db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM cap_action WHERE cap_item_id = ? AND kind = ?'
  ),

  // CAP Evidence Files
  getEvidenceFilesByCapItem: db.prepare(
    'SELECT id, filename, mime_type FROM cap_evidence_file WHERE cap_item_id = ? ORDER BY created_at'
  ),
  getEvidenceFilesByCapItemFull: db.prepare(
    'SELECT id, cap_item_id, filename, mime_type, data, created_at FROM cap_evidence_file WHERE cap_item_id = ?'
  ),
  getEvidenceFile: db.prepare(
    'SELECT id, filename, mime_type, data FROM cap_evidence_file WHERE id = ?'
  ),
  createEvidenceFile: db.prepare(
    'INSERT INTO cap_evidence_file (id, cap_item_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)'
  ),
  insertEvidenceFileFull: db.prepare(
    'INSERT INTO cap_evidence_file (id, cap_item_id, filename, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  deleteEvidenceFile: db.prepare(
    'DELETE FROM cap_evidence_file WHERE id = ?'
  ),

  // Checklist Evidence Files
  getEvidenceFilesByChecklistItem: db.prepare(
    'SELECT id, filename, mime_type FROM checklist_evidence_file WHERE checklist_item_id = ? ORDER BY created_at'
  ),
  getEvidenceFilesByChecklistItemFull: db.prepare(
    'SELECT id, checklist_item_id, filename, mime_type, data, created_at FROM checklist_evidence_file WHERE checklist_item_id = ?'
  ),
  getChecklistEvidenceFile: db.prepare(
    'SELECT id, filename, mime_type, data FROM checklist_evidence_file WHERE id = ?'
  ),
  createChecklistEvidenceFile: db.prepare(
    'INSERT INTO checklist_evidence_file (id, checklist_item_id, filename, mime_type, data) VALUES (?, ?, ?, ?, ?)'
  ),
  insertChecklistEvidenceFileFull: db.prepare(
    'INSERT INTO checklist_evidence_file (id, checklist_item_id, filename, mime_type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
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

  // Five-Why Analysis
  getFiveWhyByCapItem: db.prepare(
    'SELECT * FROM five_why WHERE cap_item_id = ?'
  ),
  createFiveWhy: db.prepare(
    'INSERT INTO five_why (id, cap_item_id, why1, why2, why3, why4, why5, root_cause) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  insertFiveWhyFull: db.prepare(
    'INSERT INTO five_why (id, cap_item_id, why1, why2, why3, why4, why5, root_cause, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  updateFiveWhy: db.prepare(
    `UPDATE five_why SET why1 = ?, why2 = ?, why3 = ?, why4 = ?, why5 = ?, root_cause = ?, updated_at = datetime('now') WHERE cap_item_id = ?`
  ),

  getCapSummaryByPlan: db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN c.completion_date IS NOT NULL AND c.completion_date != '' THEN 1 ELSE 0 END), 0) AS closed
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     WHERE pl.audit_plan_id = ?`
  ),

  // CAP items by department (all sources)
  getCapItemsByDepartment: db.prepare(
    `SELECT c.id, c.checklist_item_id, c.deadline, c.responsible_person, c.root_cause,
            c.corrective_action, c.preventive_action, c.status, c.completion_date, c.evidence,
            c.source, c.source_ref_id, c.department_id, c.created_at, c.updated_at
     FROM cap_item c WHERE c.department_id = ?
     ORDER BY c.deadline ASC`
  ),

  // CAP items due/overdue (not yet notified)
  getCapItemsDue: db.prepare(
    `SELECT c.id, c.deadline, c.responsible_person,
            ci.regulation_ref, ci.evaluation,
            pl.subject AS audit_subject, pl.audit_no,
            ap.name AS plan_name, ap.year AS plan_year,
            d.id AS department_id, d.name AS department_name,
            co.id AS company_id, co.name AS company_name
     FROM cap_item c
     JOIN audit_checklist_item ci ON ci.id = c.checklist_item_id
     JOIN audit_plan_line pl ON pl.id = ci.audit_plan_line_id
     JOIN audit_plan ap ON ap.id = pl.audit_plan_id
     JOIN department d ON d.id = ap.department_id
     JOIN company co ON co.id = d.company_id
     WHERE (c.completion_date IS NULL OR c.completion_date = '')
       AND c.deadline IS NOT NULL AND c.deadline != ''
       AND c.deadline <= date('now', '+' || ? || ' days')
       AND c.notified_at IS NULL
     ORDER BY c.deadline ASC`
  ),
  markCapNotified: db.prepare(
    `UPDATE cap_item SET notified_at = datetime('now') WHERE id = ?`
  ),

  // App Settings (key-value)
  getSetting: db.prepare('SELECT value FROM app_setting WHERE key = ?'),
  getAllSettings: db.prepare('SELECT key, value FROM app_setting'),
  upsertSetting: db.prepare(
    `INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ),

  // Home stats
  getOpenCapItems: db.prepare(
    `SELECT id, checklist_item_id, deadline, responsible_person, source
     FROM cap_item WHERE completion_date IS NULL OR completion_date = ''
     ORDER BY deadline ASC`
  ),
  getCapStatsOpen: db.prepare(
    `SELECT COUNT(*) AS cnt FROM cap_item WHERE completion_date IS NULL OR completion_date = ''`
  ),
  getCapStatsOverdue: db.prepare(
    `SELECT COUNT(*) AS cnt FROM cap_item
     WHERE (completion_date IS NULL OR completion_date = '')
       AND deadline IS NOT NULL AND deadline != ''
       AND deadline < date('now')`
  ),
  getTotalAudits: db.prepare(
    `SELECT COUNT(*) AS cnt FROM audit_plan_line`
  ),

  // Audit Log
  insertLog: db.prepare(
    'INSERT INTO audit_log (action, entity_type, entity_id, entity_name, company_name, department_name, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  getRecentLogs: db.prepare(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ),
  deleteOldLogs: db.prepare(
    "DELETE FROM audit_log WHERE created_at < datetime('now', '-1 month')"
  ),

  // ── Change Module ─────────────────────────────────────────
  getChangeRequestsByDept: db.prepare(
    `SELECT cr.id, cr.company_id, cr.department_id, cr.change_no, cr.title, cr.description, cr.category, cr.status, cr.priority,
            cr.requested_by, cr.requested_date, cr.target_date, cr.implemented_date, cr.closed_date,
            cr.change_type, cr.revision, cr.signed_by, cr.signed_at, cr.created_at, cr.updated_at,
            (SELECT COUNT(*) FROM change_task ct WHERE ct.change_request_id = cr.id) AS task_total,
            (SELECT COUNT(*) FROM change_task ct WHERE ct.change_request_id = cr.id AND ct.completion_date IS NOT NULL AND ct.completion_date != '') AS task_done
     FROM change_request cr WHERE cr.department_id = ? ORDER BY cr.created_at DESC`
  ),
  getChangeRequest: db.prepare(
    `SELECT * FROM change_request WHERE id = ?`
  ),
  getMaxChangeNo: db.prepare(
    `SELECT COALESCE(MAX(CAST(REPLACE(change_no, 'MOC-', '') AS INTEGER)), 0) AS max_no FROM change_request WHERE department_id = ?`
  ),
  createChangeRequest: db.prepare(
    `INSERT INTO change_request (id, company_id, department_id, change_no, title, description, category, status, priority, requested_by, requested_date, target_date, change_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`
  ),
  updateChangeRequest: db.prepare(
    `UPDATE change_request SET title = ?, description = ?, category = ?, priority = ?, requested_by = ?, requested_date = ?, target_date = ?, change_type = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateChangeRequestTitle: db.prepare(
    `UPDATE change_request SET title = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateChangeRequestStatus: db.prepare(
    `UPDATE change_request SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateChangeRequestForm2Data: db.prepare(
    `UPDATE change_request SET form2_data = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteChangeRequest: db.prepare(
    'DELETE FROM change_request WHERE id = ?'
  ),

  // Change stats for home
  getOpenChangeRequests: db.prepare(
    `SELECT COUNT(*) AS cnt FROM change_request WHERE status NOT IN ('CLOSED', 'REJECTED')`
  ),
  getTotalChangeRequests: db.prepare(
    `SELECT COUNT(*) AS cnt FROM change_request`
  ),

  // Change Tasks
  getChangeTasksByRequest: db.prepare(
    `SELECT id, change_request_id, sort_order, process, area, safety_note, measures,
            responsible_person, target_date, completion_date, section_header, created_at, updated_at
     FROM change_task WHERE change_request_id = ? ORDER BY sort_order, created_at`
  ),
  createChangeTask: db.prepare(
    `INSERT INTO change_task (id, change_request_id, sort_order, process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateChangeTask: db.prepare(
    `UPDATE change_task SET sort_order = ?, process = ?, area = ?, safety_note = ?, measures = ?,
            responsible_person = ?, target_date = ?, completion_date = ?, section_header = ?,
            updated_at = datetime('now') WHERE id = ?`
  ),
  deleteChangeTask: db.prepare(
    'DELETE FROM change_task WHERE id = ?'
  ),
  getChangeTask: db.prepare(
    'SELECT * FROM change_task WHERE id = ?'
  ),
  getChangeTaskProgress: db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN completion_date IS NOT NULL AND completion_date != '' THEN 1 ELSE 0 END) AS done
     FROM change_task WHERE change_request_id = ?`
  ),
  getMaxChangeTaskOrder: db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM change_task WHERE change_request_id = ?'
  ),

  // Risk Analysis
  getRiskAnalysisByRequest: db.prepare(
    `SELECT * FROM risk_analysis WHERE change_request_id = ?`
  ),
  createRiskAnalysis: db.prepare(
    `INSERT INTO risk_analysis (id, change_request_id, title, version, version_date, author, safety_manager, overall_initial, overall_residual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateRiskAnalysis: db.prepare(
    `UPDATE risk_analysis SET title = ?, version = ?, version_date = ?, author = ?, safety_manager = ?,
            signed_at = ?, overall_initial = ?, overall_residual = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  getRiskAnalysis: db.prepare(
    'SELECT * FROM risk_analysis WHERE id = ?'
  ),
  deleteRiskAnalysisByRequest: db.prepare(
    'DELETE FROM risk_analysis WHERE id = ?'
  ),

  // Risk Analysis History
  getRiskAnalysisHistory: db.prepare(
    'SELECT * FROM risk_analysis_history WHERE risk_analysis_id = ? ORDER BY version'
  ),
  createRiskAnalysisHistory: db.prepare(
    'INSERT INTO risk_analysis_history (id, risk_analysis_id, version, version_date, author, reason) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  deleteRiskAnalysisHistoryByAnalysis: db.prepare(
    'DELETE FROM risk_analysis_history WHERE risk_analysis_id = ?'
  ),

  // Risk Items
  getRiskItemsByAnalysis: db.prepare(
    `SELECT * FROM risk_item WHERE risk_analysis_id = ? ORDER BY sort_order, created_at`
  ),
  createRiskItem: db.prepare(
    `INSERT INTO risk_item (id, risk_analysis_id, sort_order, risk_type, description, consequence,
            initial_probability, initial_severity, initial_score, initial_level,
            responsible_person, mitigation_topic, treatment, implementation_date,
            residual_probability, residual_severity, residual_score, residual_level, next_step)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateRiskItem: db.prepare(
    `UPDATE risk_item SET sort_order = ?, risk_type = ?, description = ?, consequence = ?,
            initial_probability = ?, initial_severity = ?, initial_score = ?, initial_level = ?,
            responsible_person = ?, mitigation_topic = ?, treatment = ?, implementation_date = ?,
            residual_probability = ?, residual_severity = ?, residual_score = ?, residual_level = ?,
            next_step = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteRiskItem: db.prepare(
    'DELETE FROM risk_item WHERE id = ?'
  ),
  deleteRiskItemsByAnalysis: db.prepare(
    'DELETE FROM risk_item WHERE risk_analysis_id = ?'
  ),
  getRiskItem: db.prepare(
    'SELECT * FROM risk_item WHERE id = ?'
  ),
  getRiskItemCount: db.prepare(
    'SELECT COUNT(*) AS cnt FROM risk_item WHERE risk_analysis_id = ?'
  ),

  // ── Safety Module (Hub) ───────────────────────────────────
  // Safety Years — navigation root of AC-SMS (Firma → Abteilung → Jahr → Meeting)
  getSafetyYearsByDepartment: db.prepare(
    `SELECT y.*, (SELECT COUNT(*) FROM sms_meeting m WHERE m.safety_year_id = y.id) AS meeting_count
     FROM safety_year y WHERE y.department_id = ? ORDER BY y.year DESC`
  ),
  getSafetyYear: db.prepare(
    'SELECT * FROM safety_year WHERE id = ?'
  ),
  getSafetyYearByDeptAndYear: db.prepare(
    'SELECT * FROM safety_year WHERE department_id = ? AND year = ?'
  ),
  createSafetyYear: db.prepare(
    'INSERT INTO safety_year (id, department_id, year) VALUES (?, ?, ?)'
  ),
  updateSafetyYear: db.prepare(
    `UPDATE safety_year SET year = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSafetyYear: db.prepare(
    'DELETE FROM safety_year WHERE id = ?'
  ),

  // SMS Meetings (CM-025 Sitzungsprotokoll)
  // Chronologisch sortiert: meeting_date ist ISO, lexikographisch = chronologisch;
  // created_at bricht Gleichstände bei zwei Protokollen am selben Tag. meeting_no
  // taugt nicht als Sortierschlüssel — TEXT-Freitext aus dem CM-025-Formular
  // ("10" vor "2", leere Werte vorne). Diese Reihenfolge ist die Basis der
  // laufenden Nummer innerhalb des Jahres.
  getSmsMeetingsByYear: db.prepare(
    `SELECT id, safety_year_id, department_id, meeting_date, location, participants, participants_excused,
            meeting_no, topics, general_result, positives, negatives, improvements, remarks, outlook,
            created_at, updated_at
     FROM sms_meeting WHERE safety_year_id = ? ORDER BY meeting_date, created_at`
  ),
  getSmsMeetingsByYearRaw: db.prepare(
    'SELECT * FROM sms_meeting WHERE safety_year_id = ? ORDER BY meeting_date, created_at'
  ),
  getSmsMeeting: db.prepare(
    'SELECT * FROM sms_meeting WHERE id = ?'
  ),
  createSmsMeeting: db.prepare(
    `INSERT INTO sms_meeting (id, safety_year_id, department_id, meeting_date, location, participants,
            participants_excused, meeting_no, topics, general_result, positives, negatives, improvements,
            remarks, outlook)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateSmsMeeting: db.prepare(
    `UPDATE sms_meeting SET meeting_date = ?, location = ?, participants = ?, participants_excused = ?,
            meeting_no = ?, topics = ?, general_result = ?, positives = ?, negatives = ?, improvements = ?,
            remarks = ?, outlook = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSmsMeeting: db.prepare(
    'DELETE FROM sms_meeting WHERE id = ?'
  ),

  // Sicherheitszielkatalog (CM-006 Objectives)
  // Der Katalog hängt am Sicherheitsjahr, nicht an der Abteilung: ein neues Jahr
  // kopiert den Vorjahreskatalog, danach sind die Jahre gegeneinander eingefroren.
  // Diese Liste IST die MOE-Anhangtabelle — die letzte Bewertung je Ziel liefert
  // die gefüllten SPI- und Datumsspalten, damit das Frontend keinen N+1-Read braucht.
  // last_evaluation_id gehört dazu: die Mehrfachauswahl der Katalogtabelle schickt
  // genau diese IDs an GET /api/spi-evaluations/pdf (Jahrespaket fürs SRB).
  // "Letzte" = jüngster Datensatz über COALESCE(eval_date, created_at) DESC. Ein frisch
  // angelegter Entwurf ohne eval_date zählt dabei mit seinem created_at und verdrängt
  // ältere Bewertungen — die Zeile zeigt bewusst den aktuellen Bearbeitungsstand (dann
  // eben mit leeren SPI-Spalten), eval_count daneben die Gesamtzahl der Bewertungen.
  getSafetyObjectivesByYear: db.prepare(
    `SELECT o.*,
            e.id          AS last_evaluation_id,
            e.eval_date   AS last_eval_date,
            e.spi_value   AS last_spi_value,
            e.result_text AS last_result_text,
            e.rating      AS last_rating,
            (SELECT COUNT(*) FROM spi_evaluation x WHERE x.safety_objective_id = o.id) AS eval_count
     FROM safety_objective o
     LEFT JOIN spi_evaluation e ON e.id = (
       SELECT x.id FROM spi_evaluation x WHERE x.safety_objective_id = o.id
       ORDER BY COALESCE(x.eval_date, x.created_at) DESC, x.created_at DESC LIMIT 1)
     WHERE o.safety_year_id = ? ORDER BY o.sort_order, o.created_at`
  ),
  // Ohne Join — Jahreskopie und Trash-Snapshot brauchen die reinen Spalten.
  getSafetyObjectivesByYearRaw: db.prepare(
    'SELECT * FROM safety_objective WHERE safety_year_id = ? ORDER BY sort_order, created_at'
  ),
  getSafetyObjective: db.prepare(
    'SELECT * FROM safety_objective WHERE id = ?'
  ),
  createSafetyObjective: db.prepare(
    `INSERT INTO safety_objective (id, safety_year_id, department_id, sort_order, title, objective,
            spt, spt_direction, spt_value, spi_description, interval_months, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateSafetyObjective: db.prepare(
    `UPDATE safety_objective SET title = ?, objective = ?, spt = ?, spt_direction = ?, spt_value = ?,
            spi_description = ?, interval_months = ?, active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ),
  updateSafetyObjectiveSortOrder: db.prepare(
    `UPDATE safety_objective SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSafetyObjective: db.prepare(
    'DELETE FROM safety_objective WHERE id = ?'
  ),
  // Letztes Jahr derselben Abteilung, das überhaupt einen Katalog hat — Quelle für
  // "Katalog aus <Vorjahr> übernehmen". Nicht zwingend year - 1: Lücken sind erlaubt.
  getPrevSafetyYearWithObjectives: db.prepare(
    `SELECT * FROM safety_year
     WHERE department_id = ? AND year < ?
       AND EXISTS (SELECT 1 FROM safety_objective o WHERE o.safety_year_id = safety_year.id)
     ORDER BY year DESC LIMIT 1`
  ),

  // SPI-Bewertungen (CM-006 Formular)
  // Alle Listen sortieren COALESCE(eval_date, created_at), created_at — analog zum
  // ORDER BY meeting_date, created_at der sms_meeting-Statements, damit eine im
  // Frontend abgeleitete Nummerierung stabil bleibt. eval_date ist ISO, also
  // lexikographisch = chronologisch; unsignierte Entwürfe ohne Datum fallen auf
  // created_at zurück statt geschlossen vorne zu landen.
  getSpiEvaluationsByObjective: db.prepare(
    `SELECT * FROM spi_evaluation WHERE safety_objective_id = ?
     ORDER BY COALESCE(eval_date, created_at), created_at`
  ),
  getSpiEvaluationsByYearRaw: db.prepare(
    `SELECT * FROM spi_evaluation WHERE safety_year_id = ?
     ORDER BY COALESCE(eval_date, created_at), created_at`
  ),
  getSpiEvaluationsByObjectiveRaw: db.prepare(
    `SELECT * FROM spi_evaluation WHERE safety_objective_id = ?
     ORDER BY COALESCE(eval_date, created_at), created_at`
  ),
  // Effektive Werte: nach der Unterschrift zählt der Snapshot, davor der aktuelle
  // Katalogstand. Der Batch-PDF liest pro id einzeln über dieses Statement — wie
  // pdf/cap.js es mit getCapItem tut; department/company hängt der Aufrufer selbst an.
  getSpiEvaluation: db.prepare(
    `SELECT e.*,
            COALESCE(e.objective_snapshot, o.title)           AS eff_objective,
            COALESCE(e.spt_snapshot, o.spt)                   AS eff_spt,
            COALESCE(e.interval_snapshot, o.interval_months)  AS eff_interval,
            o.objective, o.spi_description, o.spt_direction, o.spt_value, o.sort_order,
            y.year
     FROM spi_evaluation e
     JOIN safety_objective o ON o.id = e.safety_objective_id
     JOIN safety_year y ON y.id = e.safety_year_id
     WHERE e.id = ?`
  ),
  getSpiEvaluationRaw: db.prepare(
    'SELECT * FROM spi_evaluation WHERE id = ?'
  ),
  createSpiEvaluation: db.prepare(
    `INSERT INTO spi_evaluation (id, safety_objective_id, safety_year_id, department_id, eval_date,
            spi_value, result_text, rating, cause_analysis, measures, decision, decision_place,
            decided_at, copy_to, objective_snapshot, spt_snapshot, interval_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateSpiEvaluation: db.prepare(
    `UPDATE spi_evaluation SET eval_date = ?, spi_value = ?, result_text = ?, rating = ?,
            cause_analysis = ?, measures = ?, decision = ?, decision_place = ?, decided_at = ?,
            copy_to = ?, objective_snapshot = ?, spt_snapshot = ?, interval_snapshot = ?,
            updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSpiEvaluation: db.prepare(
    'DELETE FROM spi_evaluation WHERE id = ?'
  ),

  // Trash
  getTrashItems: db.prepare(
    'SELECT id, entity_type, entity_id, entity_name, company_name, department_name, parent_id, parent_type, deleted_at FROM trash_item ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
  ),
  getTrashItem: db.prepare(
    'SELECT * FROM trash_item WHERE id = ?'
  ),
  createTrashItem: db.prepare(
    'INSERT INTO trash_item (id, entity_type, entity_id, entity_name, company_name, department_name, parent_id, parent_type, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  deleteTrashItem: db.prepare(
    'DELETE FROM trash_item WHERE id = ?'
  ),
  deleteAllTrashItems: db.prepare(
    'DELETE FROM trash_item'
  ),
  deleteExpiredTrashItems: db.prepare(
    "DELETE FROM trash_item WHERE deleted_at < datetime('now', '-' || ? || ' days')"
  ),
  getTrashItemCount: db.prepare(
    'SELECT COUNT(*) AS cnt FROM trash_item'
  ),

  // Restore prepared statements (for trash restore)
  restoreCapItem: db.prepare(
    `INSERT INTO cap_item (id, checklist_item_id, deadline, responsible_person, root_cause, corrective_action, preventive_action, status, completion_date, evidence, notified_at, source, source_ref_id, department_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  // Wie createCapAction, nur mit den Original-UUIDs und den Original-Zeitstempeln:
  // die Maßnahmen kaskadieren mit ihrem CAP-Item und kommen mit ihm zurück.
  restoreCapAction: db.prepare(
    `INSERT INTO cap_action (id, cap_item_id, sort_order, kind, description, responsible_person, target_date, completion_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreChecklistItem: db.prepare(
    `INSERT INTO audit_checklist_item (id, audit_plan_line_id, section, sort_order, regulation_ref, compliance_check, evaluation, auditor_comment, document_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreAuditPlanLine: db.prepare(
    `INSERT INTO audit_plan_line (id, audit_plan_id, sort_order, subject, regulations, location, planned_window, performed_date, signature, audit_no, audit_subject, audit_title, auditor_team, authority_auditor, auditee, audit_start_date, audit_end_date, audit_location, document_ref, document_iss_rev, document_rev_date, recommendation, audit_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreAuditPlan: db.prepare(
    `INSERT INTO audit_plan (id, department_id, name, year, status, revision, approved_by, approved_at, submitted_to, submitted_planned_at, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreSmsMeeting: db.prepare(
    `INSERT INTO sms_meeting (id, safety_year_id, department_id, meeting_date, location, participants, participants_excused, meeting_no, topics, general_result, positives, negatives, improvements, remarks, outlook, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreSafetyYear: db.prepare(
    `INSERT INTO safety_year (id, department_id, year, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  restoreSafetyObjective: db.prepare(
    `INSERT INTO safety_objective (id, safety_year_id, department_id, sort_order, title, objective, spt, spt_direction, spt_value, spi_description, interval_months, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  restoreSpiEvaluation: db.prepare(
    `INSERT INTO spi_evaluation (id, safety_objective_id, safety_year_id, department_id, eval_date, spi_value, result_text, rating, cause_analysis, measures, decision, decision_place, decided_at, copy_to, objective_snapshot, spt_snapshot, interval_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
};

module.exports = { db, stmts, dataDir };
