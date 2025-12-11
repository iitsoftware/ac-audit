-- Hierarchical Audit System Schema
-- Company -> Department -> Audit -> Question -> SubQuestion -> ComplianceState

-- Drop views first
DROP VIEW IF EXISTS audit_question_hierarchy CASCADE;
DROP VIEW IF EXISTS template_question_hierarchy CASCADE;

-- Drop tables if exist (in reverse dependency order)
DROP TABLE IF EXISTS question_compliance_state CASCADE;
DROP TABLE IF EXISTS audit_question CASCADE;
DROP TABLE IF EXISTS audit_instance CASCADE;
DROP TABLE IF EXISTS template_question CASCADE;
DROP TABLE IF EXISTS audit_template CASCADE;
DROP TABLE IF EXISTS department CASCADE;
DROP TABLE IF EXISTS company CASCADE;

-- Company table (top-level organizational unit)
CREATE TABLE company (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_company_name ON company(name);

-- Department table (belongs to company)
CREATE TABLE department (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_department_company_id ON department(company_id);
CREATE INDEX idx_department_name ON department(name);

-- Audit Template table (reusable question sets)
CREATE TABLE audit_template (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_audit_template_name ON audit_template(name);

-- Template Question table (hierarchical compliance questions for templates)
-- parent_id allows arbitrary depth of sub-questions
CREATE TABLE template_question (
    id UUID PRIMARY KEY,
    template_id UUID NOT NULL REFERENCES audit_template(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES template_question(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_template_question_template_id ON template_question(template_id);
CREATE INDEX idx_template_question_parent_id ON template_question(parent_id);
CREATE INDEX idx_template_question_sort_order ON template_question(template_id, sort_order);

-- Audit Instance table (specific audit assigned to a department)
CREATE TABLE audit_instance (
    id UUID PRIMARY KEY,
    department_id UUID NOT NULL REFERENCES department(id) ON DELETE CASCADE,
    template_id UUID REFERENCES audit_template(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    due_date DATE,
    completed_at TIMESTAMP WITH TIME ZONE,
    assigned_to VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_audit_instance_department_id ON audit_instance(department_id);
CREATE INDEX idx_audit_instance_template_id ON audit_instance(template_id);
CREATE INDEX idx_audit_instance_status ON audit_instance(status);
CREATE INDEX idx_audit_instance_due_date ON audit_instance(due_date);

-- Audit Question table (compliance questions within an audit instance)
-- Can be copied from template or custom; hierarchical via parent_id
CREATE TABLE audit_question (
    id UUID PRIMARY KEY,
    audit_id UUID NOT NULL REFERENCES audit_instance(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES audit_question(id) ON DELETE CASCADE,
    template_question_id UUID REFERENCES template_question(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_audit_question_audit_id ON audit_question(audit_id);
CREATE INDEX idx_audit_question_parent_id ON audit_question(parent_id);
CREATE INDEX idx_audit_question_template_question_id ON audit_question(template_question_id);
CREATE INDEX idx_audit_question_sort_order ON audit_question(audit_id, sort_order);

-- Question Compliance State table (compliance state per audit question)
-- A question is either open or closed. If closed, it has a result (COMPLIANT or NON_COMPLIANT).
-- If non-compliant, it may have an outcome (LEVEL_1, LEVEL_2, RECOMMENDATION).
CREATE TABLE question_compliance_state (
    id UUID PRIMARY KEY,
    audit_question_id UUID NOT NULL REFERENCES audit_question(id) ON DELETE CASCADE,
    closed BOOLEAN NOT NULL DEFAULT false,
    closed_at TIMESTAMP WITH TIME ZONE,
    result VARCHAR(20),  -- COMPLIANT, NON_COMPLIANT (only when closed=true)
    outcome VARCHAR(20), -- LEVEL_1, LEVEL_2, RECOMMENDATION (only when result=NON_COMPLIANT)
    notes TEXT,
    evidence_urls JSONB DEFAULT '[]',
    evaluated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_question_compliance_state UNIQUE (audit_question_id),
    CONSTRAINT chk_result_when_closed CHECK (closed = false OR result IS NOT NULL),
    CONSTRAINT chk_outcome_when_non_compliant CHECK (result != 'NON_COMPLIANT' OR outcome IS NOT NULL)
);

CREATE INDEX idx_question_compliance_state_audit_question_id ON question_compliance_state(audit_question_id);
CREATE INDEX idx_question_compliance_state_closed ON question_compliance_state(closed);
CREATE INDEX idx_question_compliance_state_result ON question_compliance_state(result);

-- Helper view to get hierarchical paths for template questions
CREATE OR REPLACE VIEW template_question_hierarchy AS
WITH RECURSIVE question_tree AS (
    SELECT
        q.id,
        q.template_id,
        q.parent_id,
        q.question_text,
        q.sort_order,
        1 as depth,
        ARRAY[q.sort_order] as path,
        q.question_text as full_path
    FROM template_question q
    WHERE q.parent_id IS NULL

    UNION ALL

    SELECT
        q.id,
        q.template_id,
        q.parent_id,
        q.question_text,
        q.sort_order,
        qt.depth + 1,
        qt.path || q.sort_order,
        qt.full_path || ' > ' || q.question_text
    FROM template_question q
    INNER JOIN question_tree qt ON q.parent_id = qt.id
)
SELECT * FROM question_tree;

-- Helper view to get hierarchical paths for audit questions
CREATE OR REPLACE VIEW audit_question_hierarchy AS
WITH RECURSIVE question_tree AS (
    SELECT
        q.id,
        q.audit_id,
        q.parent_id,
        q.question_text,
        q.sort_order,
        1 as depth,
        ARRAY[q.sort_order] as path,
        q.question_text as full_path
    FROM audit_question q
    WHERE q.parent_id IS NULL

    UNION ALL

    SELECT
        q.id,
        q.audit_id,
        q.parent_id,
        q.question_text,
        q.sort_order,
        qt.depth + 1,
        qt.path || q.sort_order,
        qt.full_path || ' > ' || q.question_text
    FROM audit_question q
    INNER JOIN question_tree qt ON q.parent_id = qt.id
)
SELECT * FROM question_tree;
