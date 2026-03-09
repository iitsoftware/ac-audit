# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ac-audit is an EASA Audit Management System with audit tracking, compliance management, corrective action plans (CAP), 5-Why analysis, PDF export, and checklist import from .docx/.xlsx files.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` (embedded, single file)
- **Frontend**: Server-rendered EJS templates + vanilla JS
- **PDF**: PDFKit for PDF generation
- **CSS**: Custom CSS with auto dark/light mode (blue theme)
- **Single process**: `npm start` runs everything

## Dependencies (7 total)

- `express` — HTTP server + routing
- `better-sqlite3` — synchronous SQLite
- `ejs` — HTML templates
- `uuid` — UUID generation
- `pdfkit` — PDF generation
- `xlsx` — Excel file parsing (.xlsx import)
- `adm-zip` — .docx/.zip extraction

## Commands

```bash
npm install          # Install dependencies
npm start            # Start server (default port 8090)
PORT=3000 npm start  # Custom port
```

No build step. No external database server.

## Architecture

```
ac-audit/
├── package.json
├── server.js              # Express app, all routes, PDF rendering, import parsing
├── db.js                  # SQLite setup, migrations, prepared statements
├── schema.sql             # All tables (CREATE IF NOT EXISTS)
├── public/
│   ├── style.css          # Custom CSS (blue theme, dark/light auto)
│   ├── app.js             # Shared: fetchJSON, escapeHtml, toast, date formatting
│   └── companies.js       # Main frontend logic (2000+ lines)
├── views/
│   ├── layout.ejs         # Base HTML shell (nav, CSS, scripts)
│   ├── companies.ejs      # Main page template (dialogs, file inputs)
│   └── login.ejs          # Login form
├── documents/             # Sample audit files (.docx/.xlsx)
└── data/                  # SQLite DB file (gitignored)
    └── acaudit.db
```

## Data Model

```
Company (id, name, street, postal_code, city, logo BLOB)
  ├── Person (id, company_id, department_id?, role, first_name, last_name, email, signature BLOB)
  └── Department (id, company_id, name, easa_permission_number, regulation, sort_order)
       └── AuditPlan (id, department_id, name, year, revision, status, approved_at, submitted_at, ...)
            └── AuditPlanLine (id, audit_plan_id, subject, regulations, location, planned_window, audit metadata...)
                 └── AuditChecklistItem (id, audit_plan_line_id, section, regulation_ref, compliance_check, evaluation)
                      ├── ChecklistEvidenceFile (id, checklist_item_id, filename, mime_type, data BLOB)
                      └── CapItem (id, checklist_item_id, deadline, responsible_person, root_cause, corrective/preventive_action, completion_date)
                           ├── FiveWhy (id, cap_item_id, why1-why5, root_cause) — only for L1/L2
                           └── CapEvidenceFile (id, cap_item_id, filename, mime_type, data BLOB)
```

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

### Audit Plans
- `GET /api/departments/:departmentId/audit-plans` — List (sorted year DESC)
- `POST /api/departments/:departmentId/audit-plans` — Create
- `GET /api/audit-plans/:id` — Single plan
- `PUT /api/audit-plans/:id` — Update year
- `PATCH /api/audit-plans/:id/dates` — Update dates (approved_at, submitted_planned_at, submitted_at)
- `POST /api/audit-plans/:id/copy` — Copy to new year (increments revision)
- `DELETE /api/audit-plans/:id` — Delete

### Audit Plan Lines
- `GET /api/audit-plans/:auditPlanId/lines` — List with checklist/finding/evidence counts
- `POST /api/audit-plans/:auditPlanId/lines` — Create
- `GET /api/audit-plan-lines/:id` — Single line
- `PUT /api/audit-plan-lines/:id` — Update all fields
- `DELETE /api/audit-plan-lines/:id` — Delete

### Checklist Items
- `GET /api/audit-plan-lines/:lineId/checklist-items` — List (with evidence counts)
- `POST /api/audit-plan-lines/:lineId/checklist-items` — Create
- `PUT /api/checklist-items/:id` — Update
- `DELETE /api/checklist-items/:id` — Delete

### Checklist Evidence
- `GET /api/checklist-items/:id/evidence-files` — List
- `POST /api/checklist-items/:id/evidence-files` — Upload (base64)
- `GET /api/checklist-evidence-files/:id` — Serve file
- `DELETE /api/checklist-evidence-files/:id` — Delete

### CAP Items (Corrective Actions)
- `GET /api/audit-plans/:id/cap-items` — List for plan (with summary counts)
- `GET /api/cap-items/:id` — Single CAP with audit context
- `PUT /api/cap-items/:id` — Update (status auto-derived from completion_date)
- `DELETE /api/cap-items/:id` — Delete

### CAP Evidence
- `GET /api/cap-items/:id/evidence-files` — List
- `POST /api/cap-items/:id/evidence-files` — Upload (base64)
- `GET /api/evidence-files/:id` — Serve file
- `DELETE /api/evidence-files/:id` — Delete

### 5-Why Analysis (L1/L2 findings only)
- `GET /api/cap-items/:id/five-why` — Get 5-Why record
- `PUT /api/cap-items/:id/five-why` — Create/update (syncs root_cause to CAP item)

### PDF Export
- `GET /api/audit-plans/:id/pdf` — Audit plan PDF (query: type=open|closed, filter=planned)
- `GET /api/audit-plan-lines/pdf` — Multi-select checklist PDF (query: ids=id1,id2,...)
- `GET /api/audit-plan-lines/:id/pdf` — Single Einzelaudit PDF
- `GET /api/cap-items/pdf` — Multi-select CAP PDF (query: ids=id1,id2,...)
- `GET /api/cap-items/:id/pdf` — Single CAP PDF (with 5-Why for L1/L2)

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

### Other
- `GET /health` — Health check

## Key Patterns

- Database schema runs on every startup with `CREATE TABLE IF NOT EXISTS`
- SQLite pragmas: `foreign_keys = ON`, `journal_mode = WAL`
- All API handlers in `server.js` follow: parse request → call db → return JSON
- Frontend: EJS template (HTML shell) + vanilla JS (fetch data, render, handle events)
- Page rendering: `renderPage()` helper renders page EJS into layout
- Modals: native `<dialog>` element (`.showModal()` / `.close()`)
- Logo/signature/evidence stored as BLOB in SQLite, served via dedicated endpoints
- Upload pattern: file → base64 in browser → JSON to API → Buffer in DB
- CSS auto dark/light mode via `@media (prefers-color-scheme: dark)`
- CAP status derived from `completion_date` (not stored explicitly)
- CAP items auto-created when checklist evaluation is O/L1/L2/L3
- PDF helpers extracted: `renderAuditLinePdf()`, `renderCapItemPdf()`, `addPdfFooter()`
- Multi-select PDF: batch routes registered before `:id` routes (Express route ordering)
- Auth: HMAC-SHA256 session token in HttpOnly cookie, 7-day expiry
- Evaluations: C (Conform), NA (Not Applicable), O (Observation), L1/L2/L3 (Finding levels)

## Database Tables

company, department, audit_plan, audit_plan_line, audit_checklist_item, checklist_evidence_file, cap_item, cap_evidence_file, five_why, person
