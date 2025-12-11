package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.ReportTemplate;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class ReportRepository {

    private final Pool pool;

    public ReportRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<ReportTemplate>> findAllTemplates(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, name, description, type, config, active, created_at, updated_at
            FROM report_template
            WHERE active = true
            ORDER BY name
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<ReportTemplate> templates = new ArrayList<>();
                for (Row row : rows) {
                    templates.add(mapRow(row));
                }
                return templates;
            });
    }

    public Future<ReportTemplate> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, name, description, type, config, active, created_at, updated_at
            FROM report_template WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<ReportTemplate> findByType(ReportTemplate.ReportType type) {
        return pool.preparedQuery("""
            SELECT id, name, description, type, config, active, created_at, updated_at
            FROM report_template WHERE type = $1 AND active = true
            LIMIT 1
            """)
            .execute(Tuple.of(type.name()))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<ReportTemplate> save(ReportTemplate template) {
        UUID id = template.id() != null ? template.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO report_template (id, name, description, type, config, active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                type = EXCLUDED.type,
                config = EXCLUDED.config,
                active = EXCLUDED.active,
                updated_at = EXCLUDED.updated_at
            RETURNING id, name, description, type, config, active, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                template.name(),
                template.description(),
                template.type().name(),
                template.config() != null ? template.config().encode() : "{}",
                template.active(),
                template.createdAt() != null ? template.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    private ReportTemplate mapRow(Row row) {
        String configJson = row.getString("config");
        return new ReportTemplate(
            row.getUUID("id"),
            row.getString("name"),
            row.getString("description"),
            ReportTemplate.ReportType.valueOf(row.getString("type")),
            configJson != null ? new JsonObject(configJson) : new JsonObject(),
            row.getBoolean("active"),
            row.getOffsetDateTime("created_at"),
            row.getOffsetDateTime("updated_at")
        );
    }
}
