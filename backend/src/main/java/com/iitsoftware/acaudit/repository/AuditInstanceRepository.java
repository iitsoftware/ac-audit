package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.AuditInstance;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class AuditInstanceRepository {

    private final Pool pool;

    public AuditInstanceRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<AuditInstance>> findAll(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, department_id, template_id, name, description, status, due_date,
                   completed_at, assigned_to, metadata, created_at, updated_at
            FROM audit_instance
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<AuditInstance> instances = new ArrayList<>();
                for (Row row : rows) {
                    instances.add(mapRow(row));
                }
                return instances;
            });
    }

    public Future<List<AuditInstance>> findByDepartmentId(UUID departmentId, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, department_id, template_id, name, description, status, due_date,
                   completed_at, assigned_to, metadata, created_at, updated_at
            FROM audit_instance
            WHERE department_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """)
            .execute(Tuple.of(departmentId, limit, offset))
            .map(rows -> {
                List<AuditInstance> instances = new ArrayList<>();
                for (Row row : rows) {
                    instances.add(mapRow(row));
                }
                return instances;
            });
    }

    public Future<List<AuditInstance>> findByStatus(AuditInstance.AuditStatus status, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, department_id, template_id, name, description, status, due_date,
                   completed_at, assigned_to, metadata, created_at, updated_at
            FROM audit_instance
            WHERE status = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """)
            .execute(Tuple.of(status.name(), limit, offset))
            .map(rows -> {
                List<AuditInstance> instances = new ArrayList<>();
                for (Row row : rows) {
                    instances.add(mapRow(row));
                }
                return instances;
            });
    }

    public Future<AuditInstance> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, department_id, template_id, name, description, status, due_date,
                   completed_at, assigned_to, metadata, created_at, updated_at
            FROM audit_instance WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<AuditInstance> save(AuditInstance instance) {
        UUID id = instance.id() != null ? instance.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO audit_instance (id, department_id, template_id, name, description, status,
                   due_date, completed_at, assigned_to, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
                department_id = EXCLUDED.department_id,
                template_id = EXCLUDED.template_id,
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                status = EXCLUDED.status,
                due_date = EXCLUDED.due_date,
                completed_at = EXCLUDED.completed_at,
                assigned_to = EXCLUDED.assigned_to,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, department_id, template_id, name, description, status, due_date,
                      completed_at, assigned_to, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                instance.departmentId(),
                instance.templateId(),
                instance.name(),
                instance.description(),
                instance.status() != null ? instance.status().name() : "OPEN",
                instance.dueDate(),
                instance.completedAt(),
                instance.assignedTo(),
                instance.metadata() != null ? instance.metadata().encode() : "{}",
                instance.createdAt() != null ? instance.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Void> updateStatus(UUID id, AuditInstance.AuditStatus status) {
        OffsetDateTime completedAt = status == AuditInstance.AuditStatus.CLOSED ? OffsetDateTime.now() : null;
        return pool.preparedQuery("""
            UPDATE audit_instance SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4
            """)
            .execute(Tuple.of(status.name(), completedAt, OffsetDateTime.now(), id))
            .mapEmpty();
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM audit_instance WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Long> count() {
        return pool.query("SELECT COUNT(*) FROM audit_instance")
            .execute()
            .map(rows -> rows.iterator().next().getLong(0));
    }

    public Future<Long> countByDepartmentId(UUID departmentId) {
        return pool.preparedQuery("SELECT COUNT(*) FROM audit_instance WHERE department_id = $1")
            .execute(Tuple.of(departmentId))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    public Future<Long> countByCompanyId(UUID companyId) {
        return pool.preparedQuery("""
            SELECT COUNT(*) FROM audit_instance ai
            JOIN department d ON ai.department_id = d.id
            WHERE d.company_id = $1
            """)
            .execute(Tuple.of(companyId))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private AuditInstance mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        String status = row.getString("status");
        LocalDate dueDate = row.getLocalDate("due_date");
        return new AuditInstance(
            row.getUUID("id"),
            row.getUUID("department_id"),
            row.getUUID("template_id"),
            row.getString("name"),
            row.getString("description"),
            status != null ? AuditInstance.AuditStatus.valueOf(status) : AuditInstance.AuditStatus.OPEN,
            dueDate,
            row.getOffsetDateTime("completed_at"),
            row.getString("assigned_to"),
            metadata != null ? metadata : new JsonObject(),
            row.getOffsetDateTime("created_at"),
            row.getOffsetDateTime("updated_at")
        );
    }

    private JsonObject getJsonObjectField(Row row, String column) {
        Object value = row.getValue(column);
        if (value == null) {
            return new JsonObject();
        }
        if (value instanceof JsonObject) {
            return (JsonObject) value;
        }
        if (value instanceof String) {
            return new JsonObject((String) value);
        }
        return new JsonObject();
    }
}
