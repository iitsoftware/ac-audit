# AC Audit

EASA Audit Management System for tracking audit plans, checklists, findings, and corrective actions.

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:8090. No build step, no external database.

## Features

- **Company & Department Management** — Organize by company with logo, address, and EASA permission numbers
- **Audit Plans** — Yearly plans with revision tracking, status workflow (Entwurf / Aktiv / Archiv), and approval/submission dates
- **Audit Plan Lines** — Subject areas with planned/performed dates, auditor team, auditee, and document references
- **Audit Checklists** — Per-line checklists with Theoretical, Practical, and Procedure sections; evaluations (C, NA, O, L1, L2, L3)
- **Corrective Action Plan (CAP)** — Auto-generated for findings/observations, inline detail with deadline, root cause, corrective/preventive actions, and status tracking
- **Evidence Upload** — Attach images to CAP items as proof of corrective actions
- **Import** — Import audit plans from .docx, bulk-import audit checklists from .xlsx
- **Copy & Revision** — Create new plan revisions or copy plans as templates across departments
- **Filter & Tags** — Filter audit lines by status (open/planned/in progress/done), findings, observations, and checklist presence
- **Persistent Navigation** — Breadcrumb path and filter settings survive page reloads via localStorage

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (embedded, single file via `better-sqlite3`)
- **Frontend**: Server-rendered EJS templates + vanilla JavaScript
- **CSS**: Custom CSS with auto dark/light mode (blue theme)

6 dependencies. Single process. No build step.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `8090`  | HTTP server port |

```bash
PORT=3000 npm start
```

## Data Model

```
Company
  └── Department
       └── Audit Plan (year, revision, status)
            └── Audit Plan Line (subject area, audit metadata)
                 └── Audit Checklist Item (regulation ref, evaluation)
                      └── CAP Item (corrective action, status)
                           └── CAP Evidence File (image BLOB)
```

## Project Structure

```
ac-audit/
├── server.js        # Express app, all routes and API endpoints
├── db.js            # SQLite setup, migrations, prepared statements
├── schema.sql       # Database schema (7 tables)
├── package.json
├── public/          # Static files
│   ├── style.css    # Custom CSS (blue theme, dark/light auto)
│   ├── app.js       # Shared utilities (fetchJSON, escapeHtml, toast)
│   └── companies.js # Main page logic (navigation, CRUD, filters)
├── views/           # EJS templates
│   ├── layout.ejs   # Base HTML shell (nav, CSS, scripts)
│   └── companies.ejs # Companies page (left pane + drill-down detail)
└── data/            # SQLite database file (auto-created, gitignored)
    └── acaudit.db
```
