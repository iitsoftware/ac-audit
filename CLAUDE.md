# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ac-audit is an Audit Management System with audit tracking, compliance management, report generation, and user activity logging.

## Tech Stack

- **Backend**: Java 21 + Vert.x 4.x (reactive, non-blocking)
- **Frontend**: Vue.js 3 + Vite + TypeScript + PrimeVue
- **Database**: PostgreSQL with Flyway migrations
- **Build**: Maven (backend), npm (frontend)

## Configuration

All configuration files reside in `config/`:
- `config/config.json` - Application settings (HTTP port, database credentials)
- `config/logback.xml` - Logging configuration

Default database credentials: user `trading`, password `trading`

## Build Commands

### Backend

```bash
# Build the backend
cd backend && mvn clean package

# Run the backend (starts on port 8080, reads config/config.json)
cd backend && mvn exec:java

# Run with custom logback config
cd backend && mvn exec:java -Dlogback.configurationFile=config/logback.xml

# Run a single test
cd backend && mvn test -Dtest=TestClassName#methodName

# Run all tests
cd backend && mvn test
```

### Frontend

```bash
# Install dependencies
cd frontend && npm install

# Start dev server (port 3000, proxies /api to backend)
cd frontend && npm run dev

# Build for production
cd frontend && npm run build

# Type check
cd frontend && vue-tsc -b
```

### Database

PostgreSQL must be running. Default connection: localhost:5432/acaudit (user: trading, password: trading)

```bash
# Create database
createdb acaudit

# Migrations run automatically on backend startup via Flyway
```

## Architecture

```
ac-audit/
├── config/                     # Configuration files
│   ├── config.json             # App config (db, http port)
│   └── logback.xml             # Logging config
├── backend/                    # Java/Vert.x backend
│   └── src/main/java/com/iitsoftware/acaudit/
│       ├── MainVerticle.java   # Entry point, loads config, HTTP server
│       ├── api/                # REST API handlers
│       ├── config/             # DatabaseConfig (reads from config.json)
│       ├── model/              # Domain records (AuditEntry, ComplianceRule, etc.)
│       ├── repository/         # Database access (Vert.x Pg Client)
│       └── service/            # Business logic
├── frontend/                   # Vue.js 3 frontend
│   └── src/
│       ├── api/client.ts       # API client with types
│       ├── router/             # Vue Router
│       └── views/              # Page components
└── db/migrations/              # Flyway SQL migrations
```

## API Endpoints

- `GET/POST /api/audits` - Audit entries
- `GET/POST/PUT/DELETE /api/compliance/rules` - Compliance rules
- `GET /api/compliance/status` - Compliance status
- `GET /api/reports/templates`, `POST /api/reports/generate`, `POST /api/reports/export/:format` - Reports
- `GET/POST /api/activities` - User activities
- `GET /health` - Health check

## Key Patterns

- Backend uses Vert.x Future for async operations
- Configuration loaded from `config/config.json` using Vert.x ConfigRetriever
- All API handlers follow the pattern: parse request -> call service -> return JSON
- Frontend uses Composition API with `<script setup>`
- PrimeVue components for UI (DataTable, Dialog, Card, etc.)
- Clickable text pattern: `cursor-pointer hover:text-primary`

## Current Data Hierarchy

```
Company → Department → Audit Instance → Question → SubQuestion → ComplianceState
                    → Audit Template → Question → SubQuestion
```

## Hierarchical Audit API Endpoints

- `GET/POST /api/companies`, `GET/PUT/DELETE /api/companies/:id`
- `GET/POST /api/companies/:companyId/departments`, `GET/PUT/DELETE /api/departments/:id`
- `GET/POST /api/audit-templates`, `GET/PUT/DELETE /api/audit-templates/:id`
- `GET/POST /api/audit-templates/:templateId/questions`, `PUT/DELETE /api/audit-templates/:templateId/questions/:questionId`
- `GET/POST /api/audit-instances`, `GET/PUT/DELETE /api/audit-instances/:id`
- `GET/POST /api/audit-instances/:auditId/questions`, `PUT/DELETE /api/audit-instances/:auditId/questions/:questionId`
- `GET/PUT /api/audit-instances/:auditId/questions/:questionId/compliance`
- `GET /api/audit-instances/:auditId/progress`

---

## NEXT TASK: Integrate Audit Templates into Organization Tree

**Goal:** Move audit templates under departments in the OrganizationView tree:
```
Company
  └── Department
        └── Audit Template (NEW LEVEL)
```

### Required Changes

#### 1. Database (V4__template_department_fk.sql)
```sql
ALTER TABLE audit_template ADD COLUMN department_id UUID REFERENCES department(id) ON DELETE CASCADE;
CREATE INDEX idx_audit_template_department_id ON audit_template(department_id);
```

#### 2. Backend Updates
- `AuditTemplate.java` - add `departmentId` field
- `AuditTemplateRepository.java` - add `findByDepartmentId()`, update SQL
- `AuditTemplateService.java` - update methods
- `AuditTemplateApiHandler.java` - update endpoints
- `client.ts` - add `departmentId` to `AuditTemplate` interface

#### 3. Frontend Updates
- `OrganizationView.vue`:
  - Add `'template'` type to `TreeNode` interface
  - Add `departmentId` to TreeNode
  - Load templates for each department in `loadData()`
  - Add expand/collapse for departments
  - Add template CRUD within tree (create, edit, delete buttons)
  - Click template name to open editor

#### 4. Consider
- Remove or repurpose `AuditTemplateListView.vue`
- Keep `AuditTemplateEditorView.vue` for editing questions (navigate from tree)

---

## Recent Changes Completed

### Removed Unused Columns (V3 migration):
- `company.active`
- `department.active`
- `audit_template.description`, `version`, `active`
- `template_question.required`
- `audit_question.required`

### UI Changes:
- Delete buttons grey when audits exist (with tooltip showing count)
- Tooltip directive registered globally in `main.ts`
- Template description removed from list and editor
- OrganizationView converted to tree structure (Company → Department)
- Progress computed from root questions
- Parent questions show aggregated compliance state
- Compliance not editable for parent questions (computed from children)
