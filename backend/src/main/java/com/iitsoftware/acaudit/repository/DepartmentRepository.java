package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.Department;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class DepartmentRepository {

    private final Pool pool;

    public DepartmentRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<Department>> findByCompanyId(UUID companyId, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, company_id, name, description, metadata, created_at, updated_at
            FROM department
            WHERE company_id = $1
            ORDER BY name
            LIMIT $2 OFFSET $3
            """)
            .execute(Tuple.of(companyId, limit, offset))
            .map(rows -> {
                List<Department> departments = new ArrayList<>();
                for (Row row : rows) {
                    departments.add(mapRow(row));
                }
                return departments;
            });
    }

    public Future<List<Department>> findByCompanyIdActive(UUID companyId, int limit, int offset) {
        // No longer filtering by active - return all
        return findByCompanyId(companyId, limit, offset);
    }

    public Future<Department> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, company_id, name, description, metadata, created_at, updated_at
            FROM department WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<Department> save(Department department) {
        UUID id = department.id() != null ? department.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO department (id, company_id, name, description, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                company_id = EXCLUDED.company_id,
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, company_id, name, description, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                department.companyId(),
                department.name(),
                department.description(),
                department.metadata() != null ? department.metadata().encode() : "{}",
                department.createdAt() != null ? department.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM department WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Long> countByCompanyId(UUID companyId) {
        return pool.preparedQuery("SELECT COUNT(*) FROM department WHERE company_id = $1")
            .execute(Tuple.of(companyId))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private Department mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        return new Department(
            row.getUUID("id"),
            row.getUUID("company_id"),
            row.getString("name"),
            row.getString("description"),
            metadata,
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
