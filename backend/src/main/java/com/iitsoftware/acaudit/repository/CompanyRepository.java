package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.Company;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class CompanyRepository {

    private final Pool pool;

    public CompanyRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<Company>> findAll(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, name, description, metadata, created_at, updated_at
            FROM company
            ORDER BY name
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<Company> companies = new ArrayList<>();
                for (Row row : rows) {
                    companies.add(mapRow(row));
                }
                return companies;
            });
    }

    public Future<List<Company>> findAllActive(int limit, int offset) {
        // No longer filtering by active - return all
        return findAll(limit, offset);
    }

    public Future<Company> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, name, description, metadata, created_at, updated_at
            FROM company WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<Company> save(Company company) {
        UUID id = company.id() != null ? company.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO company (id, name, description, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, name, description, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                company.name(),
                company.description(),
                company.metadata() != null ? company.metadata().encode() : "{}",
                company.createdAt() != null ? company.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM company WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Long> count() {
        return pool.query("SELECT COUNT(*) FROM company")
            .execute()
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private Company mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        return new Company(
            row.getUUID("id"),
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
