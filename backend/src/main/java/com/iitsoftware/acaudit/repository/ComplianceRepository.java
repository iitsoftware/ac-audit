package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.ComplianceRule;
import com.iitsoftware.acaudit.model.ComplianceStatus;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class ComplianceRepository {

    private final Pool pool;

    public ComplianceRepository(Pool pool) {
        this.pool = pool;
    }

    // Rule operations
    public Future<List<ComplianceRule>> findAllRules(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, name, description, entity_type, criteria, active, created_at, updated_at
            FROM compliance_rule
            ORDER BY name
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<ComplianceRule> rules = new ArrayList<>();
                for (Row row : rows) {
                    rules.add(mapRuleRow(row));
                }
                return rules;
            });
    }

    public Future<ComplianceRule> findRuleById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, name, description, entity_type, criteria, active, created_at, updated_at
            FROM compliance_rule WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRuleRow(rows.iterator().next());
            });
    }

    public Future<ComplianceRule> saveRule(ComplianceRule rule) {
        UUID id = rule.id() != null ? rule.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO compliance_rule (id, name, description, entity_type, criteria, active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                entity_type = EXCLUDED.entity_type,
                criteria = EXCLUDED.criteria,
                active = EXCLUDED.active,
                updated_at = EXCLUDED.updated_at
            RETURNING id, name, description, entity_type, criteria, active, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                rule.name(),
                rule.description(),
                rule.entityType(),
                rule.criteria() != null ? rule.criteria().encode() : "{}",
                rule.active(),
                rule.createdAt() != null ? rule.createdAt() : now,
                now
            ))
            .map(rows -> mapRuleRow(rows.iterator().next()));
    }

    public Future<Boolean> deleteRule(UUID id) {
        return pool.preparedQuery("DELETE FROM compliance_rule WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    // Status operations
    public Future<List<ComplianceStatus>> findAllStatus(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, rule_id, entity_type, entity_id, status, details, checked_at, created_at
            FROM compliance_status
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<ComplianceStatus> statuses = new ArrayList<>();
                for (Row row : rows) {
                    statuses.add(mapStatusRow(row));
                }
                return statuses;
            });
    }

    public Future<List<ComplianceStatus>> findStatusByEntity(String entityType, String entityId) {
        return pool.preparedQuery("""
            SELECT id, rule_id, entity_type, entity_id, status, details, checked_at, created_at
            FROM compliance_status
            WHERE entity_type = $1 AND entity_id = $2
            ORDER BY created_at DESC
            """)
            .execute(Tuple.of(entityType, entityId))
            .map(rows -> {
                List<ComplianceStatus> statuses = new ArrayList<>();
                for (Row row : rows) {
                    statuses.add(mapStatusRow(row));
                }
                return statuses;
            });
    }

    public Future<ComplianceStatus> saveStatus(ComplianceStatus status) {
        UUID id = status.id() != null ? status.id() : UUID.randomUUID();
        return pool.preparedQuery("""
            INSERT INTO compliance_status (id, rule_id, entity_type, entity_id, status, details, checked_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (rule_id, entity_type, entity_id) DO UPDATE SET
                status = EXCLUDED.status,
                details = EXCLUDED.details,
                checked_at = EXCLUDED.checked_at
            RETURNING id, rule_id, entity_type, entity_id, status, details, checked_at, created_at
            """)
            .execute(Tuple.of(
                id,
                status.ruleId(),
                status.entityType(),
                status.entityId(),
                status.status().name(),
                status.details(),
                OffsetDateTime.now(),
                status.createdAt() != null ? status.createdAt() : OffsetDateTime.now()
            ))
            .map(rows -> mapStatusRow(rows.iterator().next()));
    }

    public Future<Long> countByStatus(ComplianceStatus.Status status) {
        return pool.preparedQuery("SELECT COUNT(*) FROM compliance_status WHERE status = $1")
            .execute(Tuple.of(status.name()))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private ComplianceRule mapRuleRow(Row row) {
        String criteriaJson = row.getString("criteria");
        return new ComplianceRule(
            row.getUUID("id"),
            row.getString("name"),
            row.getString("description"),
            row.getString("entity_type"),
            criteriaJson != null ? new JsonObject(criteriaJson) : new JsonObject(),
            row.getBoolean("active"),
            row.getOffsetDateTime("created_at"),
            row.getOffsetDateTime("updated_at")
        );
    }

    private ComplianceStatus mapStatusRow(Row row) {
        return new ComplianceStatus(
            row.getUUID("id"),
            row.getUUID("rule_id"),
            row.getString("entity_type"),
            row.getString("entity_id"),
            ComplianceStatus.Status.valueOf(row.getString("status")),
            row.getString("details"),
            row.getOffsetDateTime("checked_at"),
            row.getOffsetDateTime("created_at")
        );
    }
}
