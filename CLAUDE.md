# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AC Suite is an EASA-compliant Aviation Compliance Management System with three modules: AC-Audit (audit tracking, compliance management, CAP, 5-Why), AC-Change (Management of Change, task lists, risk analysis, EASA Form 2), and Organization (company/department/personnel management).

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` (embedded, single file)
- **Frontend**: Server-rendered EJS templates + vanilla JS
- **PDF**: PDFKit for PDF generation, pdf-lib for LBA template filling
- **CSS**: Custom CSS with auto dark/light mode (blue theme)
- **Single process**: `npm start` runs everything

## Dependencies (9 total)

- `express` — HTTP server + routing
- `better-sqlite3` — synchronous SQLite
- `ejs` — HTML templates
- `uuid` — UUID generation
- `pdfkit` — PDF generation
- `pdf-lib` — PDF template filling (EASA Form 2)
- `xlsx` — Excel file parsing (.xlsx import)
- `adm-zip` — .docx/.zip extraction
- `nodemailer` — SMTP email sending

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (default port 8090)
PORT=3000 npm start  # Custom port
```

```bash
docker compose up -d          # Docker start (local dev)
docker compose up -d --build  # Docker rebuild (local dev)
docker compose -f docker-compose.prod.yml up -d  # Production deploy (pre-built image)
```

No build step. No external database server.

## Architecture

```
ac-audit/
├── package.json
├── server.js              # Express app bootstrap: middleware + route mounting + scheduler startup
├── db.js                  # SQLite connection + prepared statements (exports db, stmts, dataDir)
├── migrations.js          # Schema execution + additive column migrations (runs on boot from db.js)
├── schema.sql             # All tables (CREATE IF NOT EXISTS)
├── Dockerfile             # Docker image (node:20-alpine)
├── docker-compose.yml     # Docker Compose config (local dev)
├── docker-compose.prod.yml # Docker Compose config (production, pre-built image)
├── middleware/
│   ├── auth.js            # parseCookies, session token, authMiddleware
│   └── load-resource.js   # loadResource(stmtKey, paramKey, msg) — 404 helper factory
├── routes/
│   ├── auth.js            # /login (GET/POST), /logout
│   ├── pages.js           # EJS-rendered page routes (/, /home, /companies, /change, /safety, /organization, /settings, /logs, /trash)
│   ├── health.js          # /health
│   ├── home.js            # /api/home/stats
│   ├── companies.js       # Company CRUD + logo
│   ├── departments.js     # Department CRUD + reorder
│   ├── persons.js         # Person CRUD + signature
│   ├── audit-plans.js     # Audit plan CRUD + copy + PDF + email + docx import
│   ├── audit-plan-lines.js # Audit line CRUD + PDF (single + batch) + xlsx import
│   ├── checklist-items.js # Checklist item CRUD + evidence files
│   ├── cap-items.js       # CAP CRUD + PDF + 5-Why + evidence + email + deadline recalc
│   ├── change-requests.js # Change request CRUD + Form 2 + import + PDF + email
│   ├── change-tasks.js    # Change task CRUD
│   ├── risk-analysis.js   # Risk analysis CRUD + items + history + PDF + email + import
│   ├── safety.js          # AC-SMS: safety years + SRB meetings + objective catalogue + SPI evaluations, each with PDF + email
│   ├── settings.js        # Settings CRUD + SMTP test
│   ├── backup.js          # /api/backup/now + /api/backup/list
│   ├── logs.js            # /api/logs
│   └── trash.js           # Trash list/count/restore/delete/empty
├── services/
│   ├── audit-log.js       # logAction()
│   ├── audit-lines.js     # authorityLineDefaults() — Vorbelegung der Behörden-Line (Behörde + QM)
│   ├── email.js           # getSmtpConfig, createTransporter, getQmForDepartment, buildAuthoritySalutation, sendDocumentEmail
│   ├── cap-deadlines.js   # getCapDeadlineDays, calcCapDeadline
│   ├── trash.js           # snapshot* + restore* helpers + startTrashCleanupScheduler
│   ├── backup.js          # SQLite Online Backup API + startBackupScheduler
│   ├── notifications.js   # CAP deadline notifications + startNotifyScheduler
│   ├── log-cleanup.js     # Audit-log retention scheduler
│   ├── safety-defaults.js # DEFAULT_SRB_TOPICS + getSrbDefaultTopics() (AC-SMS Standard-Themen), DEFAULT_SAFETY_OBJECTIVES + seedObjectivesForYear() (CM-006 Zielkatalog)
│   └── form2.js           # EASA Form 2 PDF filling (pdf-lib)
├── pdf/
│   ├── common.js          # createPdfDoc({ landscape, margin }) + addPdfFooter
│   ├── audit.js           # renderAuditPlanPdf, renderAuditLinePdf + buffer generators
│   ├── cap.js             # renderCapItemPdf + generateCapItemsPdfBuffer
│   ├── risk.js            # renderRiskAnalysisPdf + buffer generator
│   └── safety.js          # renderSrbMeetingPdf (CM-025), renderSpiEvaluationPdf (CM-006), renderSafetyObjectivesPdf (MOE-Anhangtabelle) + buffer generators (single + batch)
├── imports/
│   ├── audit.js           # parseAuditChecklist (xlsx), parseAuditPlanDocx (docx)
│   ├── change.js          # parseChangeTasks (xlsx/docx)
│   └── risk.js            # parseRiskAnalysis (xlsx/docx)
├── public/
│   ├── style.css          # Custom CSS (blue theme, dark/light auto)
│   ├── app.js             # Shared: fetchJSON, escapeHtml, toast, date formatting, parseDateDE, saveNavState/loadNavState, renderCompanyTabs/renderDeptTabs, nav toggles, trash badge
│   ├── companies.js       # Main frontend logic (2000+ lines)
│   ├── change.js          # AC-Change frontend (change requests, tasks, risk analysis, Form 2)
│   ├── safety.js          # AC-SMS frontend (safety years, SRB meetings, objective catalogue, SPI evaluations)
│   ├── organization.js    # Organization management (companies, departments, persons)
│   ├── risk-matrix.js     # Risk probability/severity matrix widget
│   ├── home.js            # Home dashboard logic
│   ├── settings.js        # Settings page logic
│   ├── trash.js           # Trash page logic (restore, delete, empty)
│   └── logs.js            # Audit log page logic
├── views/
│   ├── layout.ejs         # Base HTML shell (nav with toggle buttons, CSS, scripts)
│   ├── partials/
│   │   └── dialog.ejs     # Shared <dialog> shell (id, title, body, optional footer/formId)
│   ├── companies.ejs      # Main page template (dialogs, file inputs)
│   ├── change.ejs         # AC-Change page (change requests, tasks, risk, Form 2)
│   ├── safety.ejs         # AC-SMS page (year tabs: SRB meetings + Sicherheitsziele & SPI)
│   ├── organization.ejs   # Organization management page (companies, departments, persons)
│   ├── home.ejs           # Home dashboard
│   ├── settings.ejs       # Settings page (SMTP, backup, CAP deadlines, notifications)
│   ├── trash.ejs          # Trash page (restore/delete table)
│   ├── logs.ejs           # Audit log page
│   └── login.ejs          # Login form
├── documents/             # Sample audit files (.docx/.xlsx)
└── data/                  # SQLite DB + backups (gitignored, Docker volume)
    ├── acaudit.db
    └── backups/
```

## Data Model

```
Company (id, name, street, postal_code, city, logo BLOB)
  ├── Person (id, company_id, department_id?, role, first_name, last_name, email, signature BLOB)
  └── Department (id, company_id, name, easa_permission_number, regulation, sort_order, authority_salutation/name/email)
       └── AuditPlan (id, department_id, name, year, revision, status, approved_at, submitted_at, ...)
            └── AuditPlanLine (id, audit_plan_id, subject, regulations, location, planned_window, audit metadata...)
                 └── AuditChecklistItem (id, audit_plan_line_id, section, regulation_ref, compliance_check, evaluation)
                      ├── ChecklistEvidenceFile (id, checklist_item_id, filename, mime_type, data BLOB)
                      └── CapItem (id, checklist_item_id, deadline, responsible_person, root_cause, corrective/preventive_action, completion_date, notified_at)
                           ├── FiveWhy (id, cap_item_id, why1-why5, root_cause) — internal: L1/L2 only, authority: every Beanstandung
                           └── CapEvidenceFile (id, cap_item_id, filename, mime_type, data BLOB)

Company + Department (shared)
  └── ChangeRequest (id, company_id, department_id, change_no, title, description, category, status, priority, requested_by/date, target_date, implemented_date, closed_date, change_type, form2_data JSON)
       ├── ChangeTask (id, change_request_id, sort_order, process, area, safety_note, measures, responsible_person, target_date, completion_date, section_header)
       └── RiskAnalysis (id, change_request_id, title, version, version_date, author, safety_manager, signed_at, overall_initial/residual)
            ├── RiskAnalysisHistory (id, risk_analysis_id, version, version_date, author, reason)
            └── RiskItem (id, risk_analysis_id, sort_order, risk_type, description, consequence, initial_probability/severity/score/level, responsible_person, mitigation_topic, treatment, implementation_date, residual_probability/severity/score/level)

Department (AC-SMS)
  └── SafetyYear (id, department_id, year) — navigation root, unique per (department_id, year)
       ├── SmsMeeting (id, safety_year_id, department_id, meeting_date, location, participants, participants_excused, meeting_no, topics, general_result, positives, negatives, improvements, remarks, outlook) — CM-025 SRB meeting minutes
       └── SafetyObjective (id, safety_year_id, department_id, sort_order, title, objective, spt, spt_direction, spt_value, spi_description, interval_months, active) — CM-006 objective catalogue
            └── SpiEvaluation (id, safety_objective_id, safety_year_id, department_id, eval_date, spi_value, result_text, rating, cause_analysis, measures, decision, decision_place, decided_at, copy_to, objective_snapshot, spt_snapshot, interval_snapshot)
```

`sms_meeting.department_id` is denormalized on purpose: trash snapshot, PDF header
and audit-log entry all need the department without walking through `safety_year`.
`safety_objective` and `spi_evaluation` carry both `safety_year_id` **and**
`department_id` for the same reason — year-package PDF, trash snapshot, PDF header
and audit-log entry each need the department without a join.

The objective catalogue hangs off the **safety year**, not the department: a new
year copies the previous year's catalogue and the years stay frozen against each
other afterwards. `spi_evaluation` deliberately has **no** UNIQUE index on
(safety_objective_id, safety_year_id) — intervals shorter than 12 months and
re-evaluations produce several evaluations per objective and year. Its
`*_snapshot` columns stay NULL until `decided_at` is set; signing an evaluation
freezes objective wording, target and interval, so a later catalogue edit cannot
rewrite a signed record. `spt` is the printed target text ("Mindestens 20 Stck.");
`spt_direction`/`spt_value` are its machine-readable half, used only to propose a
rating in the frontend. `result_text` is free text because the original CM-006
form carries "Erfüllt", "Nicht erfüllt" and bare numbers like "-2" in that column.

## API Endpoints

### Auth
- `GET /login` — Login page
- `POST /login` — Authenticate (sets session cookie, 7-day expiry)
- `GET /logout` — Clear session

### Companies
- `GET /api/companies` — List all (includes has_logo flag)
- `GET /api/companies/:id` — Single company
- `POST /api/companies` — Create (optional base64 logo)
- `PUT /api/companies/:id` — Update fields
- `DELETE /api/companies/:id` — Delete (CASCADE)
- `GET /api/companies/:id/logo` — Serve logo image
- `PUT /api/companies/:id/logo` — Upload/remove logo

### Departments
- `GET /api/companies/:companyId/departments` — List (sorted by sort_order)
- `POST /api/companies/:companyId/departments` — Create
- `PUT /api/departments/:id` — Update (name, easa_permission_number, regulation)
- `DELETE /api/departments/:id` — Delete
- `PATCH /api/companies/:companyId/departments/reorder` — Reorder

### Home
- `GET /api/home/stats` — Dashboard statistics (open CAPs, upcoming audits, etc.)

### Audit Plans
- `GET /api/audit-plans/all` — List ALL plans across all departments (unfiltered)
- `GET /api/departments/:departmentId/audit-plans` — List (sorted year DESC)
- `POST /api/departments/:departmentId/audit-plans` — Create. With `plan_type = 'AUTHORITY'` the plan and its one `audit_plan_line` are created in ONE transaction; the response carries `authority_line_id` (NULL for internal plans)
- `GET /api/audit-plans/:id` — Single plan
- `PUT /api/audit-plans/:id` — Update year
- `PATCH /api/audit-plans/:id/status` — Update plan status (ENTWURF, AKTIV, ARCHIV)
- `PATCH /api/audit-plans/:id/dates` — Update dates (approved_at, submitted_planned_at, submitted_at)
- `POST /api/audit-plans/:id/copy` — Copy to new year (increments revision)
- `DELETE /api/audit-plans/:id` — Delete

### Audit Plan Lines
- `GET /api/audit-plans/:auditPlanId/lines` — List with checklist/finding/evidence counts
- `POST /api/audit-plans/:auditPlanId/lines` — Create
- `GET /api/audit-plan-lines/:id` — Single line
- `PUT /api/audit-plan-lines/:id` — Update all fields
- `PATCH /api/audit-plan-lines/:id/performed` — Update performed_date
- `DELETE /api/audit-plan-lines/:id` — Delete

### Checklist Items
- `GET /api/audit-plan-lines/:lineId/checklist-items` — List (with evidence counts and `cap_deadline` — the deadline of the item's CAP item, `''` when there is none)
- `POST /api/audit-plan-lines/:lineId/checklist-items` — Create (optional `cap_deadline` wins over `calcCapDeadline()`)
- `PUT /api/checklist-items/:id` — Update (replaces the whole row; optional `cap_deadline` overwrites the CAP item's deadline, an omitted one keeps it)
- `DELETE /api/checklist-items/:id` — Delete

### Checklist Evidence
- `GET /api/checklist-items/:id/evidence-files` — List
- `POST /api/checklist-items/:id/evidence-files` — Upload (base64)
- `GET /api/checklist-evidence-files/:id` — Serve file
- `DELETE /api/checklist-evidence-files/:id` — Delete

The routes stay as they are for every plan type — an **authority** plan simply
never offers this pot in the UI: a Beanstandung has exactly one evidence pot,
`cap_evidence_file` on its CAP item (see Key Patterns). Internal audits keep both.

### CAP Items (Corrective Actions)
- `GET /api/audit-plans/:id/cap-items` — List for plan (with summary counts)
- `GET /api/departments/:departmentId/cap-items` — List for department
- `POST /api/departments/:departmentId/cap-items` — Create manually (standalone CAP)
- `GET /api/cap-items/:id` — Single CAP with audit context
- `PUT /api/cap-items/:id` — Update (status auto-derived from completion_date)
- `DELETE /api/cap-items/:id` — Delete
- `POST /api/cap-items/send-email` — Send CAP PDF(s) via email (body: ids[], to, authority?)

### CAP Evidence
- `GET /api/cap-items/:id/evidence-files` — List
- `POST /api/cap-items/:id/evidence-files` — Upload (base64)
- `GET /api/evidence-files/:id` — Serve file
- `DELETE /api/evidence-files/:id` — Delete

### 5-Why Analysis (internal: L1/L2 only — authority: every Beanstandung)
- `GET /api/cap-items/:id/five-why` — Get 5-Why record
- `PUT /api/cap-items/:id/five-why` — Create/update (syncs root_cause to CAP item)

Neither route is gated — the boundary lives in the two readers: `capHasFiveWhy()`
in `pdf/cap.js` for the CM-003 PDF and the frontend gate on the CAP level. The
Beanstandungs-Ebene of an authority plan shows the block unconditionally.

### PDF Export
- `GET /api/audit-plans/:id/pdf` — Audit plan PDF (query: type=open|closed, filter=planned)
- `GET /api/audit-plan-lines/pdf` — Multi-select checklist PDF (query: ids=id1,id2,...)
- `GET /api/audit-plan-lines/:id/pdf` — Single Einzelaudit PDF
- `GET /api/cap-items/pdf` — Multi-select CAP PDF (query: ids=id1,id2,...)
- `GET /api/cap-items/:id/pdf` — Single CAP PDF (5-Why per `capHasFiveWhy()`; file name `CAP_<Audit-Nr.>_<Stufe>.pdf`)

### Email Sending
- `POST /api/audit-plans/:id/send-email` — Send PDF via email (body: to, type, authority?)
  - Regular: informal email with company mention
  - Authority (`authority: true`): formal letter with salutation, CMM signature, BCC to QM

### Import
- `POST /api/departments/:departmentId/import-audit-plan` — Import from .docx
- `POST /api/audit-plans/:id/import-audits` — Bulk import .xlsx checklists

### Persons & Signatures
- `GET /api/companies/:companyId/persons` — List
- `POST /api/companies/:companyId/persons` — Create (role: ACCOUNTABLE, QM, ABTEILUNGSLEITER)
- `PUT /api/persons/:id` — Update
- `DELETE /api/persons/:id` — Delete
- `PUT /api/persons/:id/signature` — Upload signature (base64)
- `GET /api/persons/:id/signature` — Serve signature image

### Settings
- `GET /api/settings` — Get all settings (key-value)
- `PUT /api/settings` — Update settings (bulk key-value)
- `POST /api/settings/test-email` — Send SMTP test email
- `POST /api/settings/notify-test` — Send test notification to provided email

### Backup
- `POST /api/backup/now` — Trigger immediate backup (async, uses SQLite Online Backup API)
- `GET /api/backup/list` — List existing backup files

### CAP Deadline Recalculation
- `POST /api/cap-items/recalc-deadlines` — Recalculate all open CAP deadlines based on configured days per evaluation

### Audit Log
- `GET /api/logs` — List log entries (query: limit, offset)

### Trash (Papierkorb)
- `GET /api/trash` — List trash items (query: limit, offset, without snapshot data)
- `GET /api/trash/count` — Count (for nav badge)
- `POST /api/trash/:id/restore` — Restore (checks parent existence, atomic transaction)
- `DELETE /api/trash/:id` — Permanently delete
- `POST /api/trash/empty` — Empty entire trash

### AC-Change: Change Requests
- `GET /api/departments/:departmentId/change-requests` — List for department
- `POST /api/departments/:departmentId/change-requests` — Create
- `GET /api/change-requests/:id` — Single change request
- `PUT /api/change-requests/:id` — Update
- `DELETE /api/change-requests/:id` — Delete
- `PATCH /api/change-requests/:id/status` — Update status

### AC-Change: Change Tasks
- `GET /api/change-requests/:id/tasks` — List tasks in change request
- `POST /api/change-requests/:id/tasks` — Create task
- `PUT /api/change-tasks/:id` — Update task
- `DELETE /api/change-tasks/:id` — Delete task

### AC-Change: EASA Form 2
- `PUT /api/change-requests/:id/form2-data` — Store form field data (JSON)
- `GET /api/change-requests/:id/easa-form2/pdf` — Generate EASA Form 2 PDF

### AC-Change: Risk Analysis
- `GET /api/change-requests/:id/risk-analysis` — Get risk analysis for change request
- `POST /api/change-requests/:id/risk-analysis` — Create risk analysis
- `GET /api/risk-analysis/:id` — Single risk analysis
- `PUT /api/risk-analysis/:id` — Update risk analysis
- `GET /api/risk-analysis/:id/history` — List version history
- `POST /api/risk-analysis/:id/history` — Record history entry
- `GET /api/risk-analysis/:id/items` — List risk items
- `POST /api/risk-analysis/:id/items` — Create risk item
- `PUT /api/risk-items/:id` — Update risk item
- `DELETE /api/risk-items/:id` — Delete risk item

### AC-Change: Import
- `POST /api/change-requests/:id/import-tasks` — Bulk import tasks from .xlsx/.docx
- `POST /api/change-requests/:id/import-risk-analysis` — Bulk import risk analysis from file

### AC-Change: PDF & Email
- `GET /api/risk-analysis/:id/pdf` — Generate risk analysis PDF
- `POST /api/risk-analysis/:id/send-email` — Send risk analysis PDF via email
- `POST /api/change-requests/:id/send-email` — Send change request PDF via email

### AC-SMS: Safety Years & SRB Meetings
- `GET /api/departments/:departmentId/safety-years` — List years for department (sorted year DESC, incl. `meeting_count`)
- `POST /api/departments/:departmentId/safety-years` — Create year (409 if the year already exists for the department). Year row + objective seeding run in ONE transaction, so a year never exists without a catalogue — previous year wins, otherwise the built-in default catalogue
- `PUT /api/safety-years/:id` — Update year (409 on collision with an existing year)
- `DELETE /api/safety-years/:id` — Delete year (CASCADE to its meetings and its objective catalogue, snapshot to trash)
- `GET /api/safety-years/:yearId/sms-meetings` — List SRB meetings in the year
- `POST /api/safety-years/:yearId/sms-meetings` — Create SRB meeting (CM-025 fields)
- `GET /api/sms-meetings/:id` — Single SRB meeting
- `PUT /api/sms-meetings/:id` — Update SRB meeting (partial: omitted fields keep their value)
- `DELETE /api/sms-meetings/:id` — Delete SRB meeting (snapshot to trash)
- `GET /api/sms-meetings/:id/pdf` — CM-025 SRB meeting PDF (2 pages)
- `POST /api/sms-meetings/:id/send-email` — Send meeting PDF via email (body: to, authority?)

### AC-SMS: Sicherheitszielkatalog (CM-006 Objectives)
- `GET /api/safety-years/:yearId/objectives` — Catalogue of the year incl. the derived `last_*` columns of the last evaluation (`last_evaluation_id`, `last_eval_date`, `last_spi_value`, `last_result_text`, `last_rating`) and `eval_count`. `last_evaluation_id` is the id the catalogue's multi-select hands to `GET /api/spi-evaluations/pdf`; a row without it has no evaluation to export and therefore no checkbox
- `POST /api/safety-years/:yearId/objectives` — Create objective (`title` required, `sort_order` = max+1)
- `POST /api/safety-years/:yearId/seed-objectives` — Bootstrap the catalogue, body `{ source?: 'previous' | 'default' }` (omitted: previous year, else default). 409 when the catalogue is not empty or `previous` has no source year; returns `{ created, source }`
- `PATCH /api/safety-years/:yearId/objectives/reorder` — Body `{ ids: [...] }`; IDs not belonging to the year are ignored. Returns the re-sorted catalogue
- `GET /api/safety-years/:yearId/objectives/pdf` — Katalog-PDF (MOE-Anhangtabelle) of the year. An empty catalogue is **not** an error: the PDF still carries the header and one speaking row
- `GET /api/safety-objectives/:id` — Single objective
- `PUT /api/safety-objectives/:id` — Update objective (partial: omitted fields keep their value)
- `DELETE /api/safety-objectives/:id` — Delete objective (CASCADE to its SPI evaluations, snapshot to trash)

### AC-SMS: SPI-Bewertungen (CM-006 Evaluations)
- `GET /api/safety-objectives/:id/spi-evaluations` — Evaluations of one objective, chronological
- `POST /api/safety-objectives/:id/spi-evaluations` — Create evaluation; `safety_year_id` and `department_id` are taken from the objective (denormalized), snapshots stay NULL
- `GET /api/spi-evaluations/:id` — Single evaluation incl. the effective `eff_objective` / `eff_spt` / `eff_interval` (`COALESCE(snapshot, catalogue)`)
- `PUT /api/spi-evaluations/:id` — Update (partial: omitted fields keep their value). Setting `decided_at` on a record that had none freezes `objective_snapshot` / `spt_snapshot` / `interval_snapshot` **once** — the signature makes the document reprint identically even after a later catalogue edit; a further save never rewrites them
- `DELETE /api/spi-evaluations/:id` — Delete evaluation (snapshot to trash, parent `safety_objective`)
- `GET /api/spi-evaluations/pdf?ids=id1,id2,…` — Jahrespaket fürs SRB, one page per evaluation (**registered before the `:id` routes**, otherwise `:id` swallows the segment `pdf`)
- `POST /api/spi-evaluations/send-email` — Body `{ ids: [], to, authority? }`, sends the same package (**also before the `:id` routes**)
- `GET /api/spi-evaluations/:id/pdf` — Single CM-006 evaluation PDF
- `POST /api/spi-evaluations/:id/send-email` — Body `{ to, authority? }`

IDs that no longer exist are filtered out **before** the PDF is generated, so the
count in subject, file name and log entry matches what was really printed; a
selection where nothing is left yields 400 (download) / 404 (email) instead of a
PDF without pages.

`result_text` is free text and `rating` (`'' | 'POSITIV' | 'NEGATIV'`) is set by
hand — neither is derived or overwritten server-side. The original CM-006 forms
are inconsistent (`-2`, `Nicht erfüllt`, and `Erfüllt` + `Positiv` at SPT 20 /
SPI 0), so any automatic rule would be factually wrong. `spt_direction` /
`spt_value` only feed the frontend's rating *proposal*.

### Other
- `GET /health` — Health check

## Key Patterns

- Database schema runs on every startup with `CREATE TABLE IF NOT EXISTS`
- SQLite pragmas: `foreign_keys = ON`, `journal_mode = WAL`
- API handlers live in `routes/*.js`, mounted by `server.js`. Each handler: parse request → call db/service → return JSON
- Cross-cutting logic factored into `services/*.js` (email, audit-log, cap-deadlines, trash, backup, notifications, log-cleanup, form2)
- PDF generation lives in `pdf/*.js`: `pdf/common.js` exports `createPdfDoc({ landscape, margin })` + `addPdfFooter()`; domain-specific renderers in `pdf/audit.js`, `pdf/cap.js`, `pdf/risk.js`
- Import parsers live in `imports/*.js` (audit, change, risk) — pure functions that accept a buffer/rows array and return parsed records
- Migrations run on boot: `db.js` calls `runMigrations(db)` from `migrations.js` before preparing statements. The `audit_checklist_item` drop+recreate migration is wrapped in a single `db.transaction()`
- Frontend: EJS template (HTML shell) + vanilla JS (fetch data, render, handle events)
- Page rendering: `renderPage()` helper renders page EJS into layout
- Modals: native `<dialog>` element (`.showModal()` / `.close()`)
- Logo/signature/evidence stored as BLOB in SQLite, served via dedicated endpoints
- Upload pattern: file → base64 in browser → JSON to API → Buffer in DB
- CSS auto dark/light mode via `@media (prefers-color-scheme: dark)`
- CAP status derived from `completion_date` (not stored explicitly)
- CAP items auto-created when checklist evaluation is O/L1/L2/L3, deadline auto-calculated from performed_date + configurable days
- CAP deadline defaults: O=180, L1=5, L2=60, L3=90 days (configurable in settings)
- Notifications: email to department QM when CAP deadline approaches, with repeat option
- Backup: SQLite Online Backup API (async), scheduled with change detection via DB mtime. Path: `BACKUP_PATH` env > DB setting > `$DATA_DIR/backups/`
- Settings stored in `app_setting` table (key-value)
- PDF helpers extracted: `renderAuditLinePdf()`, `renderCapItemPdf()`, `renderRiskAnalysisPdf()`, `addPdfFooter()`
- Multi-select PDF: batch routes registered before `:id` routes (Express route ordering)
- Auth: HMAC-SHA256 session token in HttpOnly cookie, 7-day expiry
- Evaluations: C (Conform), NA (Not Applicable), O (Observation), L1/L2/L3 (Finding levels)
- Audit log: `logAction()` records company_name/department_name context for every action
- Nav toggle buttons: Trash/Log/Config buttons navigate to page on click, back to previous page when active (localStorage breadcrumb)
- Template copy: copies plan structure (subjects/regulations/location only), clears all audit data
- Email helpers extracted: `sendDocumentEmail()` (SMTP config, transporter, replyTo, BCC, sendMail, logAction), `getQmForDepartment()` (finds QM person), `buildAuthoritySalutation()` (formal/informal salutation)
- Authority email: formal letter with salutation, Compliance Monitoring Manager signature, BCC to QM
- Person fields shown in both add and edit dialogs (company: Accountable Manager; department: QM, Abteilungsleiter)
- Trash: DELETE handlers snapshot entity tree (incl. BLOBs as base64) to `trash_item` table before CASCADE delete. Restore re-inserts with original UUIDs in a transaction. Auto-cleanup of expired items (configurable `trash_retention_days`, default 30)
- Docker: `DATA_DIR` env configures DB + backup location (default `/data` in container). Single volume mount for all persistent data
- Share button blink: `has-selection` class on `.select-header` triggers CSS blink animation when checkboxes are selected
- A plan with `plan_type = 'AUTHORITY'` reuses the audit hierarchy with a different reading: the `audit_plan_line` is the **Beanstandungsbericht** of one authority visit (its `subject` is labelled `Finding`, `Monat geplant` disappears — the authority does not plan windows), and every single Beanstandung is exactly ONE `audit_checklist_item` in a flat list. There is no separate table and no new column: `section` is pinned to `'THEORETICAL'` for those rows, with one constant section the existing `ORDER BY section, sort_order, created_at` of `getChecklistItemsByLine` collapses to the order of the report itself. The plan tile, the line list, the CAP items, the evidence files and the trash snapshots stay exactly the tables they are for an internal audit — the whole feature is presentation plus the navigation, labelling, deadline and 5-Why rules below
- **Navigation of a Behördenaudit in one picture** — Abteilung → Kachel → **Beanstandungsbericht** → **Beanstandung**, and nothing else. The plan level and the CAP level, both navigation targets of an internal audit, are skipped: a Behördenaudit has exactly one report, so the plan level would be a list with one row, and the CAP item of a Beanstandung is edited on the Beanstandung itself, so the CAP level would be a second screen for the same record. The four moves that produce it, each detailed in its own pattern below: (1) the tile jumps straight into the report with the `authority_line_id` that `getAuditPlansByDepartment` carries along — a `LEFT JOIN` under a `COUNT(*) = 1` guard, so it stays NULL for internal plans and for an authority Altbestand with 0 or >1 lines, and that NULL *is* the fallback onto the plan level; (2) `POST /api/departments/:departmentId/audit-plans` creates plan **and** report in one transaction, so that id always exists and the `+`-Button of the Zeilenliste becomes superfluous and disappears; (3) `renderCurrentLevel()` knows the segment `{type:'finding'}` and the row click of the Beanstandungstabelle pushes it instead of opening `#checklist-item-dialog`; (4) `renderCapSection()` on the report level becomes the overview **Offene Beanstandungen** and its rows push `finding` as well. Every one of them is a frontend branch plus a read-only enrichment of an existing statement (`getAuditPlansByDepartment`, `getCapItemsByPlan`) — **no schema change, no migration, no new table and no new column**. Internal audits are untouched in every one of the four: `renderCapDetailLevel()`, the plan level and the edit dialog all stay exactly where they were, and each branch is guarded rather than replacing the old path — on `plan_type` for (1)–(3), on `capSectionLine` for (4), which only the report level of an authority audit sets
- The Beanstandungs-Screen (`renderFindingLevel()` / `renderFindingDetail()` in `public/companies.js`) carries Stammdaten, Ursachenanalyse (5-Why), Behebungs- und Präventivmaßnahme and Beweismittel on ONE screen — which is a **view onto two rows**, not a new record: Stammdaten save through `PUT /api/checklist-items/:id` into the `audit_checklist_item`, Maßnahmen and Erledigt am through `PUT /api/cap-items/:id` into its `cap_item`, the 5-Why through `PUT /api/cap-items/:id/five-why` and the Nachweise into `cap_evidence_file`. `cap_item` therefore keeps being the storage of everything corrective — CAP-PDF, deadline notifications, the home dashboard and every statistic keep reading exactly the rows they always read; it only disappears from the *surface*, where the LBA sees one Beanstandung and not an audit item plus a corrective action. Both routes **replace** the whole row, which is why each save carries the fields its own screen does not show (`section`, `sort_order`, `auditor_comment`, `document_ref` on the item; `deadline`, `root_cause`, `evidence` on the CAP) unchanged from the loaded object
- The checklist of an **authority** plan (`plan_type = 'AUTHORITY'`) renders as ONE flat Beanstandungstabelle instead of the three sections — `Beanstandung Nr. | Referenz Paragraph | Beanstandung Beschreibung | Stufe | Frist` (`renderLineDetail()` in `public/companies.js`). `Beanstandung Nr.` is **derived** from the row index like the `Lfd.` of the AC-SMS tables, so it stays gapless 1..n when a Beanstandung is deleted; `Stufe` is labelled through `evalLabel(item.evaluation, true)` (the stored value stays `O`/`L1`/`L2`), and `Frist` is the `cap_deadline` the list endpoint carries along from the CAP item. New rows are stored with `section = 'THEORETICAL'` and the section select is hidden in the dialog — the authority knows no sections, and pinning one value keeps sorting and saving untouched. A **row click drills into the Beanstandung** (`{type:'finding'}`) instead of opening `#checklist-item-dialog`; the dialog stays the *add* path of both views. Internal plans keep the three-section view and the dialog for editing unchanged
- `openChecklistItemDialog()` in `public/companies.js` mirrors that table for an authority plan — on such a plan it is only ever reached through the `+`-Button, since editing an existing Beanstandung drills into its own screen: the labels of `ci-form-regulation-ref` / `ci-form-compliance-check` become `Referenz Paragraph` / `Beanstandung Beschreibung`, the whole `.form-row` of Sektion + Sortierung disappears (both keep being set and sent — `section` is pinned to `THEORETICAL`), and `#ci-form-deadline-group` shows a **Frist** field in `TT.MM.JJJJ` running through `initDateAutoFormat()` like `cap-f-deadline`. The listener is attached **once** next to the dialog's other one-time listeners, not per open. On save the value goes out as `cap_deadline` (ISO) in the body of the checklist-item route, which creates the CAP item with it or overwrites the existing deadline; an empty field sends nothing and leaves the deadline maintained on the CAP item alone. Internal plans keep the original labels, the visible section row and no Frist field
- **"Bemerkung" is not a new evaluation value.** The stored set stays `C` / `NA` / `O` / `L1` / `L2` / `L3`; an authority plan only *labels* it differently — `O` → `Bemerkung`, `L1` → `Level 1`, `L2` → `Level 2` — through the single helper `evalLabel(value, isAuthority)` in `public/companies.js` (`capEvalLabel()` in `pdf/cap.js` is its PDF twin). The evaluation menu of an authority plan is filtered to `authorityEvalValues = ['', 'O', 'L1', 'L2']`: `C`/`NA` are no verdicts in a Beanstandungsliste and the authority knows no `L3`. Reason for labelling instead of a new value: no migration on `audit_checklist_item`, and the CSS badge classes (`eval-O`), `evalHighlight`, the eval summary, the CAP auto-creation (`['O','L1','L2','L3']`), the deadline settings and every statistic keep reading the raw value untouched. A value that was stored before it left the menu (a legacy `L3` on an authority plan) is added back to the option list for that one dialog — otherwise it would silently collapse to `''` on the next save
- On an authority plan the CAP deadline is an **input, not a computed result**: the authority hands over its own Frist and it is taken verbatim. Both write paths of a checklist item use the same expression `b.cap_deadline || calcCapDeadline(evalVal, line.performed_date)` (`POST /api/audit-plan-lines/:lineId/checklist-items`, `PUT /api/checklist-items/:id`), so an explicit `cap_deadline` in the body wins and `calcCapDeadline()` stays the fallback for everything that sends none — internal audits therefore behave exactly as before. On an *existing* CAP item only an explicitly sent `cap_deadline` overwrites the stored one (`updateCapItemDeadline`); an omitted field never resets the deadline maintained on the CAP item, which is why the Frist field sends nothing when it is empty. `POST /api/cap-items/recalc-deadlines` remains a pure `calcCapDeadline()` batch — running it re-derives authority deadlines from the internal rule, so it is meant for internal plans
- The 5-Why section of the CAP detail (`renderCapDetailLevel()` in `public/companies.js` — since the Beanstandungs-Ebene exists no longer an authority navigation target, but still reachable from a nav path persisted before it, which is exactly why the gate reads the API and not `currentPlan`) is unlocked for **every** Beanstandung of an authority plan, not just for `L1`/`L2` — the authority demands the root-cause analysis (CM-002) down to the level "Bemerkung". Internal plans keep the `L1`/`L2` boundary exactly. The gate reads `plan_type` from `GET /api/cap-items/:id` (`getCapItem` joins `audit_plan`) and **not** from the frontend's `currentPlan`: the nav path is persisted, so a reload straight onto the CAP level has no plan loaded and would silently fall back to the internal rule. `PUT /api/cap-items/:id/five-why` was never gated, so the frontend switch is the whole feature. That same `plan_type` reading now also drives the `Level` row of the Finding-Info block, which printed the raw `O` while the CM-003 PDF had long since said `Bemerkung`: it goes through the existing `evalLabel(value, isAuthority)` and mirrors `capEvalLabel()` in `pdf/cap.js` exactly — Klartext only for an authority plan, **the raw short form for internal audits** (which is also what the plan-level CAP table next to it prints, so the two do not drift). Labelling only: the badge class stays `eval-${cap.evaluation}` on the stored value, so `evalHighlight`, the eval summary and every statistic are untouched
- The CM-003 CAP-PDF follows the same rule through `capHasFiveWhy(cap)` in `pdf/cap.js` — the one place the "authority or `L1`/`L2`" boundary is written down, exported because the three callers (`generateCapItemsPdfBuffer` plus the single and the batch route in `routes/cap-items.js`) decide *before* the renderer whether they load the 5-Why record at all; a gate only inside `renderCapItemPdf()` would print nothing because `fiveWhy` arrives as `null`. The `Level` row prints `capEvalLabel(cap)` — on an authority plan `O` → `Bemerkung`, `L1` → `Level 1`, `L2` → `Level 2`, which is what the real LBA-CAP carries; internal plans keep the short form. Labelling only: the stored value stays `O`/`L1`/`L2` and `evalHighlight` keeps reading the raw value, so the colour map needs no authority entries
- The Audit-Line-PDF (`renderAuditLinePdf()` in `pdf/audit.js`) prints the same split as the UI: `renderAuthorityFindings()` draws the flat `Beanstandung Nr. | Referenz Paragraph | Beanstandung Beschreibung | Stufe | Frist` table for `plan_type = 'AUTHORITY'`, `renderInternalSections()` the unchanged three sections for everything else — two sibling renderers that both take `startY` and return the new `y`, so the caller just picks one. `Beanstandung Nr.` is **derived** from the row index like in `renderLineDetail()`, and `Frist` comes from `stmts.getCapDeadlinesByLine` — one lookup per audit line instead of a CAP read per Beanstandung, mirroring how the list endpoint enriches the UI. `Stufe`, the `Summary` count row and the `Legend` all follow the one authority boundary: the count row drops to `Beanstandungen | Bemerkung | Level 1 | Level 2` and the legend to those three, because `C`/`NA` are no verdict in a Beanstandungsliste and the authority knows no `L3`. Labelling only — counted, coloured and stored is still the raw `O`/`L1`/`L2`, which is why `EVAL_COLORS` (module scope, shared by both renderers) needs no authority entries. The Klartext lives in `authorityEvalLabel()` in `pdf/common.js` because the CAP-PDF's `capEvalLabel()` prints the same words
- On an **authority** plan the plan level is no navigation target of its own: a Behördenaudit has exactly one Beanstandungsbericht, so the plan level would be a list with a single row. The tile click in `renderAuditPlans()` (`public/companies.js`) pushes `{type: 'audit-plan-line'}` straight away — `renderCurrentLevel()` needs no change, the segment type has existed since the internal drill-down. The line id travels with the plan list instead of costing an extra fetch: `stmts.getAuditPlansByDepartment` `LEFT JOIN`s the line under a `COUNT(*) = 1` guard and hands out `authority_line_id`, `authority_date` (`COALESCE` of `performed_date` / `audit_end_date` / `audit_start_date`) and `authority_auditor_team`. The guard keeps the join single-row, so internal plans and authority plans with 0 or >1 lines yield NULL — and NULL is the whole fallback: the click handler then pushes the plan level as before, which is also what a freshly created authority plan needs, since its report is only created there. The tile itself prints `authority_date` + Behörde in place of year + `Rev.`
- **`audit_plan.year` never reaches the surface of a Behördenaudit.** It stays the required, sorted column of the route (`POST /api/departments/:departmentId/audit-plans` rejects a missing year), but every label of an authority plan is written from its Beanstandungsbericht — a freshly created visit carries no date yet and would otherwise simply be called "2026". Three helpers next to `renderAuditPlans()` in `public/companies.js` are the one place that rule lives: `authorityTitle(date)` for the tile's title line (the Behörde sits underneath it), `authorityName(date, team)` for a breadcrumb segment and the plan-level `<h2>`, where a bare date would have no context, and `authorityInfoFromLines(lines)` for the **plan level**, which loads its plan through `GET /api/audit-plans/:id` and therefore has neither `authority_date` nor `authority_auditor_team` — it re-derives them from its already loaded `planLines` in the same `COALESCE(performed_date, audit_end_date, audit_start_date)` order as `getAuditPlansByDepartment`, so both levels print the same date. Without a date the label is `Behördenaudit (ohne Datum)` — a state, not a fallback onto the year. It covers the tile, both nav pushes of the tile click, the push right after creating an authority plan (whose POST response carries neither column, so it starts as "ohne Datum" until `loadLineData()` renames the segment from the report's subject), the plan-level rename in `loadAuditPlanDetail()`, the plan-level heading and the delete dialog, which hangs on the same tile. Internal plans keep year + `Rev.` in all six. That heading now runs through `escapeHtml()`: the label carries `auditor_team`, i.e. user input, where it used to carry only a number. **Not** covered, deliberately: the Vorlagen- and Revisions-Auswahl still lists authority plans as `<Jahr> Rev. <n>` — that a Behördenaudit is offered as a copy template at all is a separate defect, and filtering it out there is more than a labelling change
- Because that jump — and any reload onto the persisted nav path — skips the plan level, `loadLineData()` (the pure loader behind `loadLineDetail()`) fetches the plan whenever `currentPlan` is missing or points elsewhere. Without it `currentPlan` would be null and the Beanstandungsbericht would silently render as an internal audit with three sections; the same reasoning already drove the CAP level to read `plan_type` from the API. It also renames its own nav segment from the loaded `subject`, since the jump from the tile does not know the report's title yet
- One authority visit = one plan = one report, so `POST /api/departments/:departmentId/audit-plans` creates the `audit_plan` **and** its single `audit_plan_line` in one `db.transaction()` when `plan_type = 'AUTHORITY'` — a Behördenplan never exists without its Beanstandungsbericht, which is exactly what the tile jump above needs (a plan with 0 lines yields `authority_line_id = NULL` and would strand the user on an empty plan level). The response mirrors the list endpoint and carries `authority_line_id`, so the frontend jumps into the fresh report right after creating it instead of routing the user over the tile. Internal plans are untouched: only the plan row is written and `authority_line_id` is NULL. The prefill of that line (`auditor_team` = `department.authority_name`, `auditee` = QM of the department) lives in `authorityLineDefaults(dept)` in `services/audit-lines.js` — the manual `POST /api/audit-plans/:auditPlanId/lines` reads the same helper, so both anlage paths cannot drift apart; there it still only fires when the body sends neither field
- Because that report already exists, the `+`-Button of the Zeilenliste (`renderAuditPlanDetail()` in `public/companies.js`) disappears on an authority plan — a second Beanstandungsbericht is not a thing a Behördenaudit has. The condition is `!isAuthority || sortedLines.length === 0` and **not** a plain `!isAuthority`: the plan level is still reachable for the Altbestand the tile jump falls back on (a Behördenplan with 0 lines yields `authority_line_id = NULL`), and hiding the button unconditionally would leave those plans with no way to ever create their report. So it is hidden exactly when it is superfluous. Its listener is bound through a `if (addLineBtn)` guard like `btn-pdf-export` next to it — the click handler keeps its authority branch, since the 0-line fallback is precisely the case that still uses it. Internal plans are untouched
- A single Beanstandung of an authority plan is a navigation level of its own: `renderCurrentLevel()` knows the segment `{type: 'finding', id: <audit_checklist_item_id>}` and branches into `renderFindingLevel(id)` (`public/companies.js`). The row click of the flat Beanstandungstabelle pushes that segment instead of opening `#checklist-item-dialog` — Stammdaten, Maßnahme, Ursachenanalyse and Nachweise of one Beanstandung do not fit into a modal. **Internal audits keep the dialog**, and so does the `+` button of both views: adding a row still happens in the dialog, only editing an existing Beanstandung drills down. Both pushes go through the new `pushNavSegment(segment)` (push + `renderCurrentLevel()`), which is also what the other four drill-downs use now. The nav-state serialization needs nothing: `saveNav()` persists the whole `navPath` as JSON, so the new type rides along and a reload lands back on the Beanstandung
- `loadFinding()` takes the report from the **nav path** (the nearest `audit-plan-line` ancestor) instead of fetching the checklist item on its own: that segment is persisted, so a reload straight onto the Beanstandung finds it again, and the report's item list is needed anyway — `Beanstandung Nr.` is derived from the row index exactly as in `renderLineDetail()`, and it is that number the nav segment carries as its label (renamed after loading, so deleting an earlier Beanstandung renumbers the breadcrumb too). The `cap_item` comes from `GET /api/audit-plans/:id/cap-items` matched on `checklist_item_id` — on an authority plan those are precisely the CAPs of the one report, so no new endpoint is needed; a Beanstandung without a Stufe has no CAP, which is a state and not an error. The department stays the active tab as on every other level, so the visible chain is Abteilung → Bericht → Beanstandung with the breadcrumb carrying its last two segments
- The Stammdaten section of that screen (`#finding-basics`, filled by `renderFindingDetail()`) is the flat Beanstandungstabelle turned upright — `Beanstandung Nr. | Referenz Paragraph | Beanstandung Beschreibung | Stufe | Frist` — and **auto-saves on blur / change** through `saveFindingFields()`, exactly like the report level (`saveLineFields()`) and the CAP level (`saveCapFields()`). `Beanstandung Nr.` is derived from the row index and therefore the one field that is displayed, not edited (`.inline-form-label`, a `<label>` without a control would point at nothing); `Stufe` is the same `authorityEvalValues` menu labelled through `evalLabel(value, true)` as the dialog, incl. the legacy value that is added back so it cannot collapse to `''`. `PUT /api/checklist-items/:id` **replaces** the whole row, so `section`, `sort_order`, `auditor_comment` and `document_ref` travel unchanged from the loaded item — this screen does not show them and must not clear them. The Frist goes out as `cap_deadline` (ISO), an empty field sends nothing and the deadline maintained on the CAP item stays (the same contract as the dialog), so an empty field is refilled from the stored value after saving instead of pretending the Frist was deleted
- After a save the screen is patched, not redrawn — a full re-render on blur would drop the focus of the field the user just tabbed into. Only the Stufe crossing the CAP boundary (`['O','L1','L2','L3']` vs. no CAP) forces `loadLineData()` + `loadFinding()` + `renderFindingDetail()`: the route creates or deletes the CAP item there, and the Frist of a freshly created one may be the *computed* one. `loadLineData()` has to run **before** `loadFinding()` — the Frist rides on the report's list endpoint, which `loadFinding()` would otherwise take from the cache. Everything else is written into `currentFinding` in place (the same object as in `checklistItems`, so the report table shows the new state on the way back), and a changed Frist redraws just `#finding-cap-fields` via `findingCapHtml()`
- The Ursachenanalyse section of that screen (`#finding-rootcause`) is the 5-Why block (CM-002) and is **not** gated on `L1`/`L2`: the Beanstandungs-Ebene only exists for authority plans, where the root-cause analysis is demanded down to the level "Bemerkung". The `L1`/`L2` boundary therefore stays where it belongs — on the CAP level (`renderCapDetailLevel()`), i.e. for internal audits. Markup and wiring are shared by the two screens through `fiveWhyHtml()` + `initFiveWhy(capItemId, onRootCause)` so they cannot drift; the `fw-*` field IDs may be reused because only ever one of the two levels sits in `contentEl`. The record hangs off the **CAP item**, which only exists once the Beanstandung has a Stufe — without one the section renders a speaking empty state instead of fields that could not be saved anywhere. `PUT /api/cap-items/:id/five-why` mirrors the Root Cause into `cap_item.root_cause`, and `onRootCause()` carries that second copy to wherever the calling screen also holds it: the read-only `Ursache` field on the CAP level, `currentFindingCap.root_cause` on the Beanstandung. `initFiveWhy()` scopes every lookup to `#five-why-grid` and drops a late `GET` response when that grid is no longer `isConnected` — on the Beanstandungs-Ebene every Stufenwechsel re-renders the screen, and the reused IDs would otherwise let an in-flight load write another CAP item's analysis into the fresh fields
- The Maßnahmen section of that screen (`#finding-actions`, `findingActionsHtml()`) is the CAP item of the Beanstandung — Behebungsmaßnahme (`corrective_action`), Präventivmaßnahme (`preventive_action`), Verantwortlicher (`responsible_person`), Erledigt am (`completion_date`) — and **auto-saves on blur** through `saveFindingCapFields()` like every other field of the screen. The **Status is derived, never stored**: `capStatus(cap)` reads `completion_date` and is the one place that boundary is written down (`renderCapItemsLevel()` dropped its own nested copy), so the badge is patched in place after a save instead of redrawing the section and losing the focus of the field the user just tabbed into. `PUT /api/cap-items/:id` **replaces** the whole row, so `deadline`, `root_cause` and `evidence` travel unchanged from `currentFindingCap` — the Frist is edited in the Stammdaten, the Ursache is mirrored in by the 5-Why (`onRootCause()` keeps that copy current) and the Nachweis-Text this screen does not show at all; without them every save here would silently clear all three. For the same reason `saveFindingFields()` writes a changed Frist back into `currentFindingCap.deadline`: the next Maßnahmen-Save would otherwise restore the Frist from before. The Frist is deliberately **not** shown a second time in this section — one column (`cap_item.deadline`) on two screens means one of them is stale after every save. Without a Stufe there is no CAP item and the section renders the same speaking empty state as the Ursachenanalyse
- The Beweismittel section of that screen (`#finding-evidence`) is the **one** evidence pot of a Beanstandung: `cap_evidence_file`, hanging off the CAP item (`GET`/`POST /api/cap-items/:id/evidence-files`, `GET`/`DELETE /api/evidence-files/:id`). The `checklist_evidence_file` block of `#checklist-item-dialog` is therefore hidden on an authority plan (`isEdit && !isAuthorityPlan` in `openChecklistItemDialog()`) — two places for the same thing is the failure mode, and the CAP pot is the one the CM-003 CAP-PDF and the LBA care about. Internal audits keep **both** pots exactly as they were. Like the 5-Why, markup and wiring are shared with the CAP level through `capEvidenceHtml()` + `initCapEvidence(capItemId)` so the two screens cannot drift; the `cap-evidence-*` IDs may be reused because only ever one of the two levels sits in `contentEl`, and `initCapEvidence()` drops a late `GET` response when the container is no longer `isConnected` — every Stufenwechsel re-renders the Beanstandung, and the shared IDs would otherwise fill it with another CAP item's files. Without a Stufe there is no CAP item and the section renders the same speaking empty state as Maßnahme and Ursachenanalyse
- The share button of that screen (`#finding-share` in the header, next to the `<h2>` like on the report and the CAP level) exports the CM-003 CAP-PDF of the one Beanstandung and reuses `#cap-export-dialog` with `selectedCapIds = [cap.id]` — Download, Behördenversand and free recipient are for a single Beanstandung exactly what they are for a single CAP item, so there is no second dialog and no second selection variable. `pdf/cap.js` needs nothing: `capHasFiveWhy()` and `capEvalLabel()` already put the 5-Why section and the Stufen-Klartext into an authority CAP down to `O`. The dialog's Download button picks the **single** route `GET /api/cap-items/:id/pdf` at `selectedCapIds.length === 1` and the batch route only beyond that — same PDF, but the file is named `CAP_<Audit-Nr.>_<Stufe>.pdf` instead of the generic `Corrective_Actions.pdf`, which is what the two single-entry screens hand to the authority. The PDF is the CAP item's, so without a Stufe there is none: the button then stays visible and `disabled` with the reason in its `title` rather than vanishing — the same speaking empty state the three sections below it render (hence the new `.btn-icon:disabled` rule and the `:not(:disabled)` guard on its hover)
- With that screen in place the **CAP level is no navigation target of an authority audit any more**: `renderCapSection()` (`public/companies.js`) renders as the overview **Offene Beanstandungen** whenever it sits on the report level, and its row click pushes `{type:'finding', id: cap.checklist_item_id}` instead of `{type:'cap-item', id: cap.id}`. `renderCapDetailLevel()` stays untouched for internal audits and is simply never jumped to. Which of the two the section is depends on `capSectionLine`, set by `loadCapSection(planId, line)`: the report level (`renderLineDetail()`, authority only) passes its `audit_plan_line`, the plan level passes nothing — so internal plans and the authority Altbestand that still reaches the plan level (0 or >1 lines) keep the CAP section, the `cap-item` navigation and all seven columns exactly as they were. The section **moves** rather than being duplicated, because the tile jump means nobody reaches the plan level of an authority audit any more. It shows only what the flat Beanstandungstabelle above it does not — `Beanstandung Nr. | Beanstandung Beschreibung | Stufe | Frist | Status` plus the ALLE/OPEN/CLOSED filter and the multi-select CAP export; Audit-Nr. and Thema are the report's own fields and constant on that screen. `Beanstandung Nr.` is the row index in `checklistItems` (**not** the index in the CAP list), so the same Beanstandung carries the same number in the table, in the overview, in the breadcrumb and on its own screen; a CAP whose checklist item is not in the loaded report yields no number and no navigation. `getCapItemsByPlan` in `db.js` hands out `ci.audit_plan_line_id` for the scoping — the route delivers the CAPs of the whole *plan*, and the overview shows those of its one *report* (identical for a real authority plan, not for the Altbestand). Progress and count come from that scoped list instead of the plan-wide `summary` for the same reason
- AC-SMS PDFs (`pdf/safety.js`) pass the footer label `CM-025, SRB Meeting, Rev. 1, 28.08.2024  |  Erstellt mit ac-sms` to `addPdfFooter()` — the LBA form reference of the SRB meeting minutes plus the app hint. `label` *replaces* the `addPdfFooter()` default `Erstellt mit ac-audit`, so both parts have to live in the one string (AC-Change does the same with `label: 'Erstellt mit ac-change'`)
- AC-SMS navigation mirrors AC-Audit: Firma → Abteilung → year tiles (`.plan-tile`, reusing the audit-plan tile styles) → meeting detail. Tile state: `plan-tile-done` once the year has meetings, `plan-tile-wip` while it is empty
- The SRB-meeting table of a safety year shows a **derived** running number (`Lfd.` = index+1 of the chronologically sorted list, `public/safety.js`) next to the free-text `SRB Nr.` (`meeting_no`) from the CM-025 form. The `ORDER BY meeting_date, created_at` of the `sms_meeting` list statements in `db.js` carries that numbering — it is never stored, so `Lfd.` stays gapless 1..n and renumbers when a meeting is inserted or deleted. The columns are `Lfd. | SRB Nr. | Datum | Ort | Teilnehmer` — the former `Themen` column was dropped: the standard agenda now prefills every protocol, so the cell was the same wall of text in every row
- The AC-SMS year detail (`#year-detail` in `views/safety.ejs`) is split into two tabs — **SRB Meetings** and **Sicherheitsziele & SPI** — reusing the `.settings-tabs` / `.settings-tab` / `.settings-tab-content` classes and the `aria-selected` toggle of `views/settings.ejs`. The toggle is a small inline script at the bottom of `safety.ejs`, scoped to `#year-tabs`, and deliberately keeps no `localStorage` state (which tab is open is transient navigation inside a year). `public/safety.js` may attach its own click listeners to the same buttons to lazy-load the catalogue and can `.click()` a tab to switch back
- The objective catalogue lives in the second tabpanel: the multi-select controls (`.select-header` with select-all + `.select-share-btn`) and the `Katalog-PDF` button sit in the section header in the EJS, while the table itself (`#objectives-table`, incl. the per-row checkboxes) is rendered by `public/safety.js`. `#objectives-empty` holds the two bootstrap buttons ("Katalog aus &lt;Vorjahr&gt; übernehmen" / "Standard-Katalog laden"). The catalogue fields of one objective are edited in `#objective-dialog`; the CM-006 evaluation is a full-page panel (`#spi-detail`) next to the CM-025 meeting panel, with `#spi-form-context` carrying the read-only objective/SPT/interval header and `#spi-form-rating-hint` the POSITIV/NEGATIV proposal derived from `spt_direction`/`spt_value`
- The catalogue table is the MOE appendix table — `Nr. | Sicherheitsziel | SPT | Intervall | SPI | Datum der Feststellung | Bewertung`. `Nr.` is **derived** from the row index like the `Lfd.` of the SRB table, so it stays gapless 1..n across reorder and delete; the last three columns come from the `last_*` columns of the list endpoint (no N+1 read). A row whose last evaluation is older than `interval_months` — or that was never evaluated — carries a "fällig" badge; deactivated objectives (`active = 0`) are exempt, they are deliberately out of the cycle. The catalogue is lazy-loaded on the first click of its tab and dropped again on every year/department/company switch
- Reorder uses two `.reorder-btn` (▲/▼) per row instead of a drag handle: `PATCH …/objectives/reorder` wants the whole new order anyway, the buttons are keyboard- and touch-operable without a drag surface, and the 44×44 class already exists for exactly this. After each step the focus follows the moved row so keyboard reordering does not lose its place
- The rating proposal in `#spi-form-rating-hint` (`Vorschlag: Negativ (SPI 0 < SPT min. 20)`) is computed **client-side only** and never writes — it neither sets the radios nor is it sent to the server. It needs `spt_direction`, `spt_value` and a strictly numeric `spi_value` (a German decimal comma is accepted, free text like "Erfüllt" is not), otherwise the hint stays empty. The original CM-006 forms rate SPT 20 / SPI 0 as "Erfüllt / Positiv", so the call belongs to the Safety Manager, not to an automatism
- The evaluation panel opens on a row click with the objective's **newest** evaluation (the list endpoint sorts ascending, so it is the last element) and blank for the first one; the per-row `+` opens an additional evaluation, which is what intervals shorter than 12 months need. `#spi-form-context` mirrors the `COALESCE(snapshot, catalogue)` of `getSpiEvaluation` with `??` — only NULL falls back to the catalogue, an empty snapshot is a valid freeze
- AC-SMS SRB standard topics: the setting `sms_default_topics` overrides the built-in fallback `DEFAULT_SRB_TOPICS` in `services/safety-defaults.js` (edited on the AC-SMS settings tab). `getSrbDefaultTopics()` resolves the two and the `/safety` route in `routes/pages.js` passes the result as the EJS local `srbDefaultTopics` into a hidden textarea (`#srb-default-topics`, `views/safety.ejs`); `public/safety.js` copies that value into the THEMEN field when a **new** protocol is opened. The copy is a snapshot — a later change of the default never rewrites existing protocols. An empty setting means "use the built-in topics", which is why there is no reset button
- The objective catalogue is **copied per year**, not shared: `seedObjectivesForYear()` in `services/safety-defaults.js` fills a fresh year from the last year of the same department that has a catalogue, and only otherwise from the built-in `DEFAULT_SAFETY_OBJECTIVES`. It is a `db.transaction()` and idempotent — a non-empty catalogue is a no-op, so creating the year, the `#objectives-empty` bootstrap buttons and a retry all call the same function. An explicit `source: 'previous'` without a source year does **not** fall back to the default: the caller asked for a specific origin and gets a 409 instead of a silently foreign catalogue. Only catalogue fields travel, never evaluations. That is also why there is deliberately **no** settings override in the style of `sms_default_topics` — the living catalogue of the previous year is the real default, an app setting would compete with it and freeze the state of the day it was edited
- Snapshot semantics of a CM-006 evaluation: `objective_snapshot` / `spt_snapshot` / `interval_snapshot` stay NULL as long as `decided_at` is NULL. Setting `decided_at` on a record that had none — on create as well as on update — freezes the objective wording, the SPT and the interval **once** (`signingSnapshots()` in `routes/safety.js`); every later save carries the three columns over verbatim, and clearing `decided_at` again does not release the freeze either. Everything that *reads* an evaluation — `getSpiEvaluation` (`eff_objective` / `eff_spt` / `eff_interval`), the CM-006 PDF, `#spi-form-context` — goes through `COALESCE(snapshot, catalogue)`, so a draft follows catalogue edits and a signed document reprints identically forever. NULL is the only trigger for the fallback: an empty snapshot is a valid freeze (`spt` is optional in the catalogue), which is why trash restore and the frontend guard with `=== undefined` / `??` instead of `||`
- Derived, never stored, in the catalogue table: `Nr.` is the row index like the `Lfd.` of the SRB table, `Datum der Feststellung` is the `eval_date` of the **last** evaluation (`last_eval_date`), and the "fällig" badge is that date plus `interval_months` against today — an objective that was never evaluated is due as well, a deactivated one (`active = 0`) never is. Nothing of this has a column: numbering stays gapless across reorder and delete, a corrected evaluation date immediately moves the due date, and changing `interval_months` re-evaluates every row without a migration
- `Ergebnis` (`result_text`) is free text and `Bewertung` (`rating`) is set by hand to `''` / `POSITIV` / `NEGATIV` — neither is derived or overwritten server-side, and the frontend proposal from `spt_direction` / `spt_value` only renders a hint, it never writes a field or reaches the server. Reason: the original CM-006 forms contradict each other (`-2` and `Nicht erfüllt` in the same column, `Erfüllt` + `Positiv` at SPT 20 / SPI 0), so every automatic rule would print something the Safety Manager did not decide

## Accessibility

- Dialogs use `aria-labelledby` pointing to their heading element
- Tab bars use `role="tablist"` / `role="tab"` / `role="tabpanel"` with `aria-selected` toggled dynamically
- Visually-hidden labels use `.sr-only` CSS utility class (e.g., login password label)
- Icon-only nav buttons have `aria-label` for screen readers
- Global `:focus-visible` outline (2px solid primary); bare `outline: none` replaced with `:focus:not(:focus-visible)` pattern
- Touch targets: minimum 44×44px on interactive elements (tab buttons, icon buttons, reorder handles)
- Toast accessibility: container has `aria-live="polite"`, error toasts use `role="alert"` and persist with close button, success toasts use `role="status"`
- `@media (prefers-reduced-motion: reduce)` disables toast-in animation, share-blink animation, progress bar transitions, and the inline `.spinner` rotation
- Clickable table rows: use `makeRowClickable(row, handler)` from `app.js` — sets `role="button"`, `tabindex="0"`, and a keydown handler that fires the click on Enter/Space (used by audit lines, change rows, home CAP rows)
- Icon-only buttons: wrap bare clickable `<svg>` in `<button type="button" class="icon-btn" aria-label="…">` (44×44 min touch target). The PDF-share buttons in audit/CAP table headers use `.select-share-btn` on top of `.icon-btn`
- Skip link: `<a href="#main" class="skip-link">` is the first child of `<body>`; off-screen by default, slides into view on `:focus`. The page wraps `<%- body %>` in `<main id="main">`
- Color contrast: `.eval-O` uses `#78350f` on `#fde68a` (≥4.5:1 ratio) — earlier `#713f12` was too low
- Inline progress feedback: long-running ops (backup, deadline recalc, email send, imports) swap the button label for `<span class="spinner" aria-hidden="true"></span>…` while disabled
- Native date hints: text-based `TT.MM.JJJJ` inputs in `views/change.ejs` carry `pattern="\d{2}\.\d{2}\.\d{4}"`, `inputmode="numeric"`, `title="TT.MM.JJJJ"` so the browser surfaces format errors immediately

## Database Tables

company, department, audit_plan, audit_plan_line, audit_checklist_item, checklist_evidence_file, cap_item, cap_evidence_file, five_why, person, app_setting, audit_log, trash_item, change_request, change_task, risk_analysis, risk_analysis_history, risk_item, safety_year, sms_meeting, safety_objective, spi_evaluation

`safety_objective` and `spi_evaluation` are back in `schema.sql` in CM-006 form —
scoped to the safety year, not the department. The department-scoped predecessors
had been dead code since the CM-025 rework (no route, no prepared statement read
them), so a **pre-schema** block at the top of `runMigrations()` drops the pair
whenever `safety_objective` lacks `safety_year_id`; nothing is carried over.
The drop has to run before `db.exec(schema)` because `CREATE TABLE IF NOT EXISTS`
leaves an existing table untouched — it would never reshape the legacy pair.
`routes/trash.js` has a restore helper for every AC-SMS type, so it no longer
keeps an obsolete-type list. Snapshots of the *predecessors* that may still sit
in `trash_item` are told apart by **shape** instead: neither the old
`safety_objective` nor the old `spi_evaluation` knew `safety_year_id`, so a
snapshot without that field is rejected with 409 and only the CM-006 rows
restore. A `safety_objective` snapshot carries its evaluations and a
`safety_year` snapshot its whole catalogue, because both cascade on delete.
Deleting a single evaluation snapshots it on its own (parent
`safety_objective`) — `snapshotSpiEvaluation()` reads the **raw** row, since the
`COALESCE` columns of `getSpiEvaluation` would hand an unsigned draft the
current catalogue as its snapshot and freeze a document nobody signed.
Restore writes the three `*_snapshot` columns back verbatim and never re-derives
them from the catalogue, so `restoreSpiEvaluation()` guards them with
`=== undefined` instead of `||`: an empty `spt_snapshot` is a valid freeze (`spt`
is optional in the catalogue), and collapsing it to NULL would let the `COALESCE`
of `getSpiEvaluation` print today's target on a document signed without one.
Only a snapshot predating those columns yields `undefined` — which better-sqlite3
rejects as a binding, hence the explicit NULL.

## Email Routing

- AC-Audit emails use `smtp_*` settings (from: ac-audit@...), title: "Compliance Monitoring Manager"
- AC-Change emails use `change_smtp_*` settings (from: ac-change@...), title: "Safety Manager"
- AC-SMS emails (SRB protocol, SPI evaluations, SPI year package) ride the **AC-Change** route: module `'change'`, so the same `change_smtp_*` settings and the same "Safety Manager" signature. All three build subject and body through `safetyMail()` in `routes/safety.js` — the formal and the informal variant differ only in salutation and closing, so the caller passes just the noun phrase (`document`) that appears in both
- All outgoing emails set `replyTo` to the QM email of the department
- Settings split into tabs: Global (backup), AC-Audit (CAP, notifications, SMTP), AC-Change (SMTP), AC-SMS (SRB-Standard-Themen)

## EASA Form 2 Templates

- `public/templates/EASA_Form_2_CAMO.pdf` — LBA Part-CAMO template, filled via pdf-lib form fields
- `public/templates/EASA_Form_2_Part145.pdf` — LBA Part-145/CAO template, filled via pdf-lib form fields
- Template selection based on department name/regulation (CAMO vs 145/CAO)
- Form data persisted in `change_request.form2_data` (JSON)
