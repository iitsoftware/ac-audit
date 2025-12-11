package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.AuditTemplate;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class AuditTemplateRepository {

    private final Pool pool;

    public AuditTemplateRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<AuditTemplate>> findAll(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, name, metadata, created_at, updated_at
            FROM audit_template
            ORDER BY name
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<AuditTemplate> templates = new ArrayList<>();
                for (Row row : rows) {
                    templates.add(mapRow(row));
                }
                return templates;
            });
    }

    public Future<List<AuditTemplate>> findAllActive(int limit, int offset) {
        // No longer filtering by active - return all
        return findAll(limit, offset);
    }

    public Future<AuditTemplate> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, name, metadata, created_at, updated_at
            FROM audit_template WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<AuditTemplate> save(AuditTemplate template) {
        UUID id = template.id() != null ? template.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO audit_template (id, name, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, name, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                template.name(),
                template.metadata() != null ? template.metadata().encode() : "{}",
                template.createdAt() != null ? template.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM audit_template WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Long> count() {
        return pool.query("SELECT COUNT(*) FROM audit_template")
            .execute()
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private AuditTemplate mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        return new AuditTemplate(
            row.getUUID("id"),
            row.getString("name"),
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
