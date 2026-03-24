# AC Suite

EASA-compliant Aviation Compliance Management System covering Audit Management, Change Management, and Risk Analysis.

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:8090. No build step, no external database.

## Modules

### AC-Audit
- Audit plan management (yearly plans with revision tracking, status workflow)
- Audit checklists with evaluation (C, NA, O, L1, L2, L3)
- Corrective Action Plans (CAP) with deadline management and notifications
- 5-Why root cause analysis for L1/L2 findings
- PDF export for audit plans, checklists, and CAP items
- Authority email (formal letter to LBA Betriebsprüfer)
- Import audit plans from .docx, checklists from .xlsx
- Evidence upload for CAP items and checklists

### AC-Change
- Management of Change (MoC) tracking with status workflow
- Task list (Aufgabenliste) with progress tracking and filter tags
- Import Change Management Tracker from .xlsx (CAMO + Flugbetrieb layouts)
- Risk analysis with ICAO 5x5 risk matrix (3-zone: red/amber/green)
- Risk item detail view with inline editing and dual risk matrices
- Import Risikoanalyse from .xlsx (Details + Historie sheets)
- Automatic risk history tracking (add/delete events, QM as author)
- EASA Form 2 PDF using official LBA templates (Part-CAMO + Part-145/CAO)
- Risk analysis PDF export (landscape, full-width table, matrix legend, signature block)
- Share dialog for risk analysis (download PDF, send to authority, email)

### Organization
- Company management (name, address, phone, fax, logo)
- Department management with EASA permission numbers and regulations
- Personnel management (Accountable Manager, QM, Abteilungsleiter)
- Digital signature support
- Authority contact details and initial approval email per department

### Common Features
- **Home Dashboard** — Open CAPs, overdue items, change task metrics
- **Persistent Navigation** — Tab selection, breadcrumb path, filters survive page reloads
- **Settings** — SMTP email, backup schedule, CAP deadline defaults, notifications
- **Automated Backup** — Scheduled SQLite backups with configurable retention
- **Audit Log** — All actions logged with company/department context
- **Trash (Papierkorb)** — Soft delete with JSON snapshots, restore or permanent delete
- **Responsive Design** — Tablet and mobile breakpoints
- **Dark/Light Mode** — Auto via `prefers-color-scheme`

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (embedded, single file via `better-sqlite3`)
- **Frontend**: Server-rendered EJS templates + vanilla JavaScript
- **PDF**: PDFKit (generation) + pdf-lib (LBA template filling)
- **CSS**: Custom CSS with auto dark/light mode (blue theme)

9 dependencies. Single process. No build step.

## Docker

```bash
docker compose up -d          # Start
docker compose up -d --build  # Rebuild after code changes
docker compose down           # Stop
```

Data is stored in `./data/` (DB + backups). To migrate an existing database, copy it to `./data/acaudit.db` before starting.

## Configuration

| Variable         | Default             | Description                              |
|------------------|---------------------|------------------------------------------|
| `PORT`           | `8090`              | HTTP server port                         |
| `LOGIN_PASSWORD` | `audit2024`         | Login password                           |
| `SESSION_SECRET` | random              | HMAC secret (set for persistent sessions)|
| `DATA_DIR`       | `./data`            | Database and backup directory            |
| `BACKUP_PATH`    | `$DATA_DIR/backups` | Override backup location                 |

## Data Model

```
Company (name, address, phone, fax, logo)
  ├── Person (role: ACCOUNTABLE, QM, ABTEILUNGSLEITER)
  └── Department (EASA permission number, regulation, authority contacts)
       ├── AuditPlan → AuditPlanLine → ChecklistItem → CapItem → FiveWhy
       │                             → ChecklistEvidenceFile
       │                                              → CapEvidenceFile
       └── ChangeRequest → ChangeTask
                         → RiskAnalysis → RiskItem
                                        → RiskAnalysisHistory
```

## Risk Matrix (ICAO 5x5)

| | 1 Geringfügig | 2 Gering | 3 Bedeutend | 4 Gefährlich | 5 Katastrophal |
|---|---|---|---|---|---|
| **5 Häufig** | 5 | 10 | 15 | 20 | 25 |
| **4 Gelegentlich** | 4 | 8 | 12 | 16 | 20 |
| **3 Gering** | 3 | 6 | 9 | 12 | 15 |
| **2 Unwahrscheinlich** | 2 | 4 | 6 | 8 | 10 |
| **1 Extrem unwahrsch.** | 1 | 2 | 3 | 4 | 5 |

- **1-3** Gering oder kein Risiko (green)
- **4-10** Akzeptabel (amber)
- **12-25** Nicht akzeptabel (red)

## EASA Form 2 Templates

Official LBA PDF templates filled via `pdf-lib`:
- `public/templates/EASA_Form_2_CAMO.pdf` — Part-CAMO (Rev. 11)
- `public/templates/EASA_Form_2_Part145.pdf` — Part-145 / Part-CAO

Form fields, checkboxes, and radio buttons are filled programmatically. Template selection based on department type.

## Project Structure

```
ac-audit/
├── server.js              # Express app, all routes, PDF rendering, import parsing
├── db.js                  # SQLite setup, migrations, prepared statements
├── schema.sql             # Database schema
├── package.json
├── Dockerfile
├── docker-compose.yml
├── public/
│   ├── style.css          # Custom CSS (blue theme, dark/light auto)
│   ├── app.js             # Shared utilities (fetchJSON, escapeHtml, toast, nav)
│   ├── companies.js       # AC-Audit frontend logic
│   ├── change.js          # AC-Change frontend logic
│   ├── organization.js    # Organization management frontend
│   ├── risk-matrix.js     # Interactive 5x5 risk matrix widget
│   ├── home.js            # Home dashboard
│   ├── settings.js        # Settings page
│   ├── trash.js           # Trash page
│   ├── logs.js            # Audit log page
│   └── templates/         # LBA PDF templates (EASA Form 2)
├── views/
│   ├── layout.ejs         # Base HTML shell
│   ├── companies.ejs      # AC-Audit page
│   ├── change.ejs         # AC-Change page
│   ├── organization.ejs   # Organization page
│   ├── home.ejs           # Home dashboard
│   ├── settings.ejs       # Settings page
│   ├── trash.ejs          # Trash page
│   ├── logs.ejs           # Audit log page
│   └── login.ejs          # Login form
└── data/                  # SQLite DB + backups (gitignored)
```
