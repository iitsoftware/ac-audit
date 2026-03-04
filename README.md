# AC Audit

Audit Management System with hierarchical question trees, compliance tracking, and progress aggregation.

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:8090. That's it — no build step, no external database.

## Features

- **Organization Management** — Companies and departments in a tree structure
- **Audit Templates** — Reusable question sets with unlimited nesting depth
- **Audit Instances** — Create audits from templates, assign to departments
- **Compliance Tracking** — Mark questions as compliant/non-compliant with outcomes (Level 1, Level 2, Recommendation)
- **Progress Aggregation** — Parent questions automatically aggregate child compliance states; audit status computed from root questions

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (embedded, single file via `better-sqlite3`)
- **Frontend**: Server-rendered EJS templates + vanilla JavaScript
- **CSS**: Pico CSS (classless semantic styling)

4 dependencies. Single process. No build step.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | HTTP server port |

```bash
PORT=3000 npm start
```

## Data Model

```
Company → Department → Audit Instance → Question → SubQuestion → ComplianceState
                       Audit Template → Question → SubQuestion
```

## Project Structure

```
ac-audit/
├── server.js        # Express app, all routes
├── db.js            # SQLite setup, prepared statements, business logic
├── schema.sql       # Database schema (7 tables)
├── public/          # Static JS files (one per page)
├── views/           # EJS templates
└── data/            # SQLite database file (auto-created)
```
