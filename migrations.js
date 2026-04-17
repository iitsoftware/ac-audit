const fs = require('fs');
const path = require('path');

function runMigrations(db) {
  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Migration: add phone/fax to company
  try { db.prepare('SELECT phone FROM company LIMIT 1').get(); }
  catch { try { db.exec("ALTER TABLE company ADD COLUMN phone TEXT DEFAULT ''"); } catch {} }
  try { db.prepare('SELECT fax FROM company LIMIT 1').get(); }
  catch { try { db.exec("ALTER TABLE company ADD COLUMN fax TEXT DEFAULT ''"); } catch {} }

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

  // Migration: add plan_type to audit_plan
  try {
    db.prepare('SELECT plan_type FROM audit_plan LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE audit_plan ADD COLUMN plan_type TEXT DEFAULT 'AUDIT'"); } catch {}
  }

  // Migration: add authority contact fields to department
  try {
    db.prepare('SELECT authority_salutation FROM department LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE department ADD COLUMN authority_salutation TEXT DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE department ADD COLUMN authority_name TEXT DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE department ADD COLUMN authority_email TEXT DEFAULT ''"); } catch {}
  }

  // Migration: add email to person
  try {
    db.prepare('SELECT email FROM person LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE person ADD COLUMN email TEXT DEFAULT ''"); } catch { /* already exists */ }
  }

  // Migration: add notified_at to cap_item
  try {
    db.prepare('SELECT notified_at FROM cap_item LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE cap_item ADD COLUMN notified_at TEXT"); } catch {}
  }

  // Migration: add source tracking to cap_item
  try {
    db.prepare('SELECT source FROM cap_item LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE cap_item ADD COLUMN source TEXT DEFAULT 'audit'"); } catch {}
    try { db.exec("ALTER TABLE cap_item ADD COLUMN source_ref_id TEXT"); } catch {}
  }

  // Migration: add department_id to cap_item (shared CAP support)
  try {
    db.prepare('SELECT department_id FROM cap_item LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE cap_item ADD COLUMN department_id TEXT"); } catch {}
  }

  // Backfill department_id from audit chain for existing audit CAPs
  try {
    db.exec(`UPDATE cap_item SET department_id = (
      SELECT ap.department_id FROM audit_checklist_item ci
      JOIN audit_plan_line apl ON ci.audit_plan_line_id = apl.id
      JOIN audit_plan ap ON apl.audit_plan_id = ap.id
      WHERE ci.id = cap_item.checklist_item_id
    ) WHERE department_id IS NULL AND checklist_item_id IS NOT NULL`);
  } catch {}

  // Migration: add company_name and department_name to audit_log
  try {
    db.prepare('SELECT company_name FROM audit_log LIMIT 1').get();
  } catch {
    try { db.exec("ALTER TABLE audit_log ADD COLUMN company_name TEXT DEFAULT ''"); } catch {}
    try { db.exec("ALTER TABLE audit_log ADD COLUMN department_name TEXT DEFAULT ''"); } catch {}
  }

  // Migration: add change_request new columns
  const changeRequestMigrations = [
    { name: 'change_type', sql: "ALTER TABLE change_request ADD COLUMN change_type TEXT DEFAULT ''" },
    { name: 'revision', sql: "ALTER TABLE change_request ADD COLUMN revision INTEGER DEFAULT 0" },
    { name: 'signed_by', sql: "ALTER TABLE change_request ADD COLUMN signed_by TEXT DEFAULT ''" },
    { name: 'signed_at', sql: "ALTER TABLE change_request ADD COLUMN signed_at TEXT" },
    { name: 'form2_data', sql: "ALTER TABLE change_request ADD COLUMN form2_data TEXT DEFAULT ''" },
  ];
  for (const col of changeRequestMigrations) {
    try { db.prepare(`SELECT ${col.name} FROM change_request LIMIT 1`).get(); }
    catch { try { db.exec(col.sql); } catch {} }
  }

  // Migration: add initial_approval_email to department
  try { db.prepare('SELECT initial_approval_email FROM department LIMIT 1').get(); }
  catch { try { db.exec("ALTER TABLE department ADD COLUMN initial_approval_email TEXT DEFAULT ''"); } catch {} }

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
    // Old schema has audit_id — drop and recreate, wrapped in a transaction
    try {
      const recreateChecklist = db.transaction(() => {
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
      });
      recreateChecklist();
    } catch { /* ignore */ }
  }

  // Migration: drop old audit table (no longer needed)
  try {
    db.exec('DROP TABLE IF EXISTS audit');
  } catch { /* ignore */ }

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
}

module.exports = { runMigrations };
