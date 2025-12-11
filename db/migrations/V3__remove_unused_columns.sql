-- Remove unused columns from UI

-- Company: remove active
DROP INDEX IF EXISTS idx_company_active;
ALTER TABLE company DROP COLUMN IF EXISTS active;

-- Department: remove active
DROP INDEX IF EXISTS idx_department_active;
ALTER TABLE department DROP COLUMN IF EXISTS active;

-- Audit Template: remove description, version, active
DROP INDEX IF EXISTS idx_audit_template_active;
ALTER TABLE audit_template DROP COLUMN IF EXISTS description;
ALTER TABLE audit_template DROP COLUMN IF EXISTS version;
ALTER TABLE audit_template DROP COLUMN IF EXISTS active;

-- Template Question: remove required
ALTER TABLE template_question DROP COLUMN IF EXISTS required;

-- Audit Question: remove required
ALTER TABLE audit_question DROP COLUMN IF EXISTS required;
