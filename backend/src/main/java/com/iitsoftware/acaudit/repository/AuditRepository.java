package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.AuditEntry;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class AuditRepository {

    private final Pool pool;

    public AuditRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<AuditEntry>> findAll(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, entity_type, entity_id, action, user_id, user_name,
                   before_value, after_value, description, ip_address, created_at
            FROM audit_entry
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<AuditEntry> entries = new ArrayList<>();
                for (Row row : rows) {
                    entries.add(mapRow(row));
                }
                return entries;
            });
    }

    public Future<AuditEntry> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, entity_type, entity_id, action, user_id, user_name,
                   before_value, after_value, description, ip_address, created_at
            FROM audit_entry WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<List<AuditEntry>> findByEntityType(String entityType, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, entity_type, entity_id, action, user_id, user_name,
                   before_value, after_value, description, ip_address, created_at
            FROM audit_entry
            WHERE entity_type = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """)
            .execute(Tuple.of(entityType, limit, offset))
            .map(rows -> {
                List<AuditEntry> entries = new ArrayList<>();
                for (Row row : rows) {
                    entries.add(mapRow(row));
                }
                return entries;
            });
    }

    public Future<List<AuditEntry>> findByDateRange(OffsetDateTime from, OffsetDateTime to, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, entity_type, entity_id, action, user_id, user_name,
                   before_value, after_value, description, ip_address, created_at
            FROM audit_entry
            WHERE created_at BETWEEN $1 AND $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            """)
            .execute(Tuple.of(from, to, limit, offset))
            .map(rows -> {
                List<AuditEntry> entries = new ArrayList<>();
                for (Row row : rows) {
                    entries.add(mapRow(row));
                }
                return entries;
            });
    }

    public Future<AuditEntry> save(AuditEntry entry) {
        UUID id = entry.id() != null ? entry.id() : UUID.randomUUID();
        return pool.preparedQuery("""
            INSERT INTO audit_entry (id, entity_type, entity_id, action, user_id, user_name,
                                     before_value, after_value, description, ip_address, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, entity_type, entity_id, action, user_id, user_name,
                      before_value, after_value, description, ip_address, created_at
            """)
            .execute(Tuple.of(
                id,
                entry.entityType(),
                entry.entityId(),
                entry.action().name(),
                entry.userId(),
                entry.userName(),
                entry.beforeValue() != null ? entry.beforeValue().encode() : null,
                entry.afterValue() != null ? entry.afterValue().encode() : null,
                entry.description(),
                entry.ipAddress(),
                OffsetDateTime.now()
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Long> count() {
        return pool.query("SELECT COUNT(*) FROM audit_entry")
            .execute()
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private AuditEntry mapRow(Row row) {
        String beforeJson = row.getString("before_value");
        String afterJson = row.getString("after_value");
        return new AuditEntry(
            row.getUUID("id"),
            row.getString("entity_type"),
            row.getString("entity_id"),
            AuditEntry.AuditAction.valueOf(row.getString("action")),
            row.getString("user_id"),
            row.getString("user_name"),
            beforeJson != null ? new JsonObject(beforeJson) : null,
            afterJson != null ? new JsonObject(afterJson) : null,
            row.getString("description"),
            row.getString("ip_address"),
            row.getOffsetDateTime("created_at")
        );
    }
}
