# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ac-audit is an EASA Audit Management System with audit tracking, compliance management, and hierarchical question trees with compliance state aggregation.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` (embedded, single file)
- **Frontend**: Server-rendered EJS templates + vanilla JS
- **CSS**: Custom CSS with auto dark/light mode (blue theme)
- **Single process**: `npm start` runs everything

## Dependencies (4 total)

- `express` — HTTP server + routing
- `better-sqlite3` — synchronous SQLite
- `ejs` — HTML templates
- `uuid` — UUID generation

## Commands

```bash
# Install dependencies
npm install

# Start the server (default port 8080)
npm start

# Start on a custom port
PORT=3000 npm start
```

No build step. No external database server.

## Architecture

```
ac-audit/
├── package.json
├── server.js              # Express app, all routes, page rendering
├── db.js                  # SQLite setup, prepared statements
├── schema.sql             # All tables (CREATE IF NOT EXISTS)
├── public/                # Static files
│   ├── style.css          # Custom CSS (blue theme, dark/light auto)
│   ├── app.js             # Shared: fetchJSON, escapeHtml, toast
│   └── companies.js       # Companies page logic
├── views/                 # EJS templates
│   ├── layout.ejs         # Base HTML (nav, CSS, scripts)
│   └── companies.ejs      # Companies page (left pane + detail)
└── data/                  # SQLite DB file (gitignored)
    └── acaudit.db
```

## Data Model

```
Company (id, name, street, postal_code, city, logo BLOB, created_at, updated_at)
  └── Department (id, company_id FK, name, easa_permission_number, created_at, updated_at)
       └── AuditPlan (id, department_id FK, name, year, created_at, updated_at)
```

## API Endpoints

### Companies
- `GET /api/companies` — list all (includes has_logo flag)
- `GET /api/companies/:id` — single company detail
- `POST /api/companies` — create (JSON, optional base64 logo)
- `PUT /api/companies/:id` — update fields
- `DELETE /api/companies/:id` — delete (CASCADE deletes departments)
- `GET /api/companies/:id/logo` — serve logo image
- `PUT /api/companies/:id/logo` — upload/remove logo (base64 JSON)

### Departments
- `GET /api/companies/:companyId/departments` — list for a company
- `POST /api/companies/:companyId/departments` — create
- `PUT /api/departments/:id` — update name + description
- `DELETE /api/departments/:id` — delete

### Audit Plans
- `GET /api/departments/:departmentId/audit-plans` — list for a department
- `POST /api/departments/:departmentId/audit-plans` — create
- `PUT /api/audit-plans/:id` — update name + year
- `DELETE /api/audit-plans/:id` — delete

### Other
- `GET /health` — Health check

## Key Patterns

- Database schema runs on every startup with `CREATE TABLE IF NOT EXISTS`
- SQLite pragmas: `foreign_keys = ON`, `journal_mode = WAL`
- All API handlers in `server.js` follow: parse request → call db → return JSON
- Frontend pages: EJS template (HTML shell) + vanilla JS file (fetch data, render, handle events)
- Page rendering: `renderPage()` helper renders page EJS into layout
- Modals: native `<dialog>` element (`.showModal()` / `.close()`)                                                              
- Logo stored as BLOB in SQLite, served via dedicated endpoint
- Logo upload: file → base64 in browser → JSON to API → Buffer in DB
- Left pane: company list with inline logo, name/city, hover edit/delete icons
- Right pane: department list for selected company
- CSS auto dark/light mode via `@media (prefers-color-scheme: dark)`

## Database Tables

company, department, audit_plan
