CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  street TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  city TEXT DEFAULT '',
  logo BLOB,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS department (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  easa_permission_number TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_plan (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES department(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  year INTEGER NOT NULL,
  status TEXT DEFAULT 'DRAFT',
  revision INTEGER DEFAULT 0,
  approved_by TEXT DEFAULT '',
  approved_at TEXT,
  submitted_to TEXT DEFAULT '',
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_plan_line (
  id TEXT PRIMARY KEY,
  audit_plan_id TEXT NOT NULL REFERENCES audit_plan(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  subject TEXT DEFAULT '',
  regulations TEXT DEFAULT '',
  location TEXT DEFAULT '',
  planned_window TEXT DEFAULT '',
  performed_date TEXT,
  signature TEXT DEFAULT '',
  audit_no TEXT DEFAULT '',
  audit_subject TEXT DEFAULT '',
  audit_title TEXT DEFAULT '',
  auditor_team TEXT DEFAULT '',
  auditee TEXT DEFAULT '',
  audit_start_date TEXT,
  audit_end_date TEXT,
  audit_location TEXT DEFAULT '',
  document_ref TEXT DEFAULT '',
  document_iss_rev TEXT DEFAULT '',
  document_rev_date TEXT,
  recommendation TEXT DEFAULT '',
  audit_status TEXT DEFAULT 'OPEN',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_checklist_item (
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
);

CREATE TABLE IF NOT EXISTS cap_item (
  id TEXT PRIMARY KEY,
  checklist_item_id TEXT NOT NULL REFERENCES audit_checklist_item(id) ON DELETE CASCADE,
  deadline TEXT,
  responsible_person TEXT DEFAULT '',
  root_cause TEXT DEFAULT '',
  corrective_action TEXT DEFAULT '',
  preventive_action TEXT DEFAULT '',
  status TEXT DEFAULT 'OPEN',
  completion_date TEXT,
  evidence TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cap_evidence_file (
  id TEXT PRIMARY KEY,
  cap_item_id TEXT NOT NULL REFERENCES cap_item(id) ON DELETE CASCADE,
  filename TEXT DEFAULT '',
  mime_type TEXT DEFAULT 'image/png',
  data BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
