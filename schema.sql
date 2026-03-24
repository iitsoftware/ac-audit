CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  street TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  fax TEXT DEFAULT '',
  logo BLOB,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS department (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  easa_permission_number TEXT DEFAULT '',
  authority_salutation TEXT DEFAULT '',
  authority_name TEXT DEFAULT '',
  authority_email TEXT DEFAULT '',
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
  submitted_planned_at TEXT,
  submitted_at TEXT,
  plan_type TEXT DEFAULT 'AUDIT',
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
  notified_at TEXT,
  source TEXT DEFAULT 'audit',
  source_ref_id TEXT,
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

CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES department(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  signature BLOB,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS five_why (
  id TEXT PRIMARY KEY,
  cap_item_id TEXT NOT NULL UNIQUE REFERENCES cap_item(id) ON DELETE CASCADE,
  why1 TEXT DEFAULT '',
  why2 TEXT DEFAULT '',
  why3 TEXT DEFAULT '',
  why4 TEXT DEFAULT '',
  why5 TEXT DEFAULT '',
  root_cause TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checklist_evidence_file (
  id TEXT PRIMARY KEY,
  checklist_item_id TEXT NOT NULL REFERENCES audit_checklist_item(id) ON DELETE CASCADE,
  filename TEXT DEFAULT '',
  mime_type TEXT DEFAULT 'image/png',
  data BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  entity_name TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  department_name TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── AC-Change Module ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS change_request (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES department(id) ON DELETE CASCADE,
  change_no TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'OFFEN',
  status TEXT DEFAULT 'DRAFT',
  priority TEXT DEFAULT 'MEDIUM',
  requested_by TEXT DEFAULT '',
  requested_date TEXT,
  target_date TEXT,
  implemented_date TEXT,
  closed_date TEXT,
  change_type TEXT DEFAULT '',
  revision INTEGER DEFAULT 0,
  signed_by TEXT DEFAULT '',
  signed_at TEXT,
  form2_data TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_task (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  process TEXT DEFAULT '',
  area TEXT DEFAULT '',
  safety_note TEXT DEFAULT '',
  measures TEXT DEFAULT '',
  responsible_person TEXT DEFAULT '',
  target_date TEXT,
  completion_date TEXT,
  section_header TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_analysis (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  version_date TEXT,
  author TEXT DEFAULT '',
  safety_manager TEXT DEFAULT '',
  signed_at TEXT,
  overall_initial TEXT DEFAULT '',
  overall_residual TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_analysis_history (
  id TEXT PRIMARY KEY,
  risk_analysis_id TEXT NOT NULL REFERENCES risk_analysis(id) ON DELETE CASCADE,
  version INTEGER DEFAULT 1,
  version_date TEXT,
  author TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_item (
  id TEXT PRIMARY KEY,
  risk_analysis_id TEXT NOT NULL REFERENCES risk_analysis(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  risk_type TEXT DEFAULT '',
  description TEXT DEFAULT '',
  consequence TEXT DEFAULT '',
  initial_probability INTEGER,
  initial_severity INTEGER,
  initial_score INTEGER,
  initial_level TEXT DEFAULT '',
  responsible_person TEXT DEFAULT '',
  mitigation_topic TEXT DEFAULT '',
  treatment TEXT DEFAULT '',
  implementation_date TEXT,
  residual_probability INTEGER,
  residual_severity INTEGER,
  residual_score INTEGER,
  residual_level TEXT DEFAULT '',
  next_step TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trash_item (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  department_name TEXT DEFAULT '',
  parent_id TEXT DEFAULT '',
  parent_type TEXT DEFAULT '',
  snapshot TEXT NOT NULL,
  deleted_at TEXT DEFAULT (datetime('now'))
);
