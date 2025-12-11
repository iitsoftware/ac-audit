-- AC Audit Initial Schema

-- Drop tables if exist (in reverse dependency order)
DROP TABLE IF EXISTS compliance_status CASCADE;
DROP TABLE IF EXISTS compliance_rule CASCADE;
DROP TABLE IF EXISTS user_activity CASCADE;
DROP TABLE IF EXISTS report_template CASCADE;
DROP TABLE IF EXISTS audit_entry CASCADE;

-- Audit Entry table
CREATE TABLE audit_entry (
    id UUID PRIMARY KEY,
    entity_type VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    before_value JSONB,
    after_value JSONB,
    description TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entry_entity_type ON audit_entry(entity_type);
CREATE INDEX idx_audit_entry_entity_id ON audit_entry(entity_id);
CREATE INDEX idx_audit_entry_user_id ON audit_entry(user_id);
CREATE INDEX idx_audit_entry_action ON audit_entry(action);
CREATE INDEX idx_audit_entry_created_at ON audit_entry(created_at DESC);

-- Compliance Rule table
CREATE TABLE compliance_rule (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    entity_type VARCHAR(255) NOT NULL,
    criteria JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_compliance_rule_entity_type ON compliance_rule(entity_type);
CREATE INDEX idx_compliance_rule_active ON compliance_rule(active);

-- Compliance Status table
CREATE TABLE compliance_status (
    id UUID PRIMARY KEY,
    rule_id UUID NOT NULL REFERENCES compliance_rule(id) ON DELETE CASCADE,
    entity_type VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    details TEXT,
    checked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_compliance_status_rule_entity UNIQUE (rule_id, entity_type, entity_id)
);

CREATE INDEX idx_compliance_status_entity ON compliance_status(entity_type, entity_id);
CREATE INDEX idx_compliance_status_status ON compliance_status(status);

-- User Activity table
CREATE TABLE user_activity (
    id UUID PRIMARY KEY,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    activity_type VARCHAR(50) NOT NULL,
    description TEXT,
    ip_address VARCHAR(50),
    user_agent TEXT,
    session_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX idx_user_activity_activity_type ON user_activity(activity_type);
CREATE INDEX idx_user_activity_session_id ON user_activity(session_id);
CREATE INDEX idx_user_activity_created_at ON user_activity(created_at DESC);

-- Report Template table
CREATE TABLE report_template (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_report_template_type ON report_template(type);
CREATE INDEX idx_report_template_active ON report_template(active);

-- Insert default report templates
INSERT INTO report_template (id, name, description, type, config, active, created_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Audit Summary', 'Summary of audit entries within a date range', 'AUDIT_SUMMARY', '{}', true, NOW()),
    ('00000000-0000-0000-0000-000000000002', 'Compliance Status', 'Current compliance status across all rules', 'COMPLIANCE_STATUS', '{}', true, NOW()),
    ('00000000-0000-0000-0000-000000000003', 'User Activity Report', 'User activity summary within a date range', 'USER_ACTIVITY', '{}', true, NOW());
