package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.UserActivity;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class UserActivityRepository {

    private final Pool pool;

    public UserActivityRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<UserActivity>> findAll(int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, user_id, user_name, activity_type, description,
                   ip_address, user_agent, session_id, metadata, created_at
            FROM user_activity
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """)
            .execute(Tuple.of(limit, offset))
            .map(rows -> {
                List<UserActivity> activities = new ArrayList<>();
                for (Row row : rows) {
                    activities.add(mapRow(row));
                }
                return activities;
            });
    }

    public Future<UserActivity> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, user_id, user_name, activity_type, description,
                   ip_address, user_agent, session_id, metadata, created_at
            FROM user_activity WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<List<UserActivity>> findByUserId(String userId, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, user_id, user_name, activity_type, description,
                   ip_address, user_agent, session_id, metadata, created_at
            FROM user_activity
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """)
            .execute(Tuple.of(userId, limit, offset))
            .map(rows -> {
                List<UserActivity> activities = new ArrayList<>();
                for (Row row : rows) {
                    activities.add(mapRow(row));
                }
                return activities;
            });
    }

    public Future<List<UserActivity>> findByDateRange(OffsetDateTime from, OffsetDateTime to, int limit, int offset) {
        return pool.preparedQuery("""
            SELECT id, user_id, user_name, activity_type, description,
                   ip_address, user_agent, session_id, metadata, created_at
            FROM user_activity
            WHERE created_at BETWEEN $1 AND $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            """)
            .execute(Tuple.of(from, to, limit, offset))
            .map(rows -> {
                List<UserActivity> activities = new ArrayList<>();
                for (Row row : rows) {
                    activities.add(mapRow(row));
                }
                return activities;
            });
    }

    public Future<UserActivity> save(UserActivity activity) {
        UUID id = activity.id() != null ? activity.id() : UUID.randomUUID();
        return pool.preparedQuery("""
            INSERT INTO user_activity (id, user_id, user_name, activity_type, description,
                                       ip_address, user_agent, session_id, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, user_id, user_name, activity_type, description,
                      ip_address, user_agent, session_id, metadata, created_at
            """)
            .execute(Tuple.of(
                id,
                activity.userId(),
                activity.userName(),
                activity.activityType().name(),
                activity.description(),
                activity.ipAddress(),
                activity.userAgent(),
                activity.sessionId(),
                activity.metadata() != null ? activity.metadata().encode() : null,
                OffsetDateTime.now()
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Long> count() {
        return pool.query("SELECT COUNT(*) FROM user_activity")
            .execute()
            .map(rows -> rows.iterator().next().getLong(0));
    }

    public Future<Long> countByActivityType(UserActivity.ActivityType type) {
        return pool.preparedQuery("SELECT COUNT(*) FROM user_activity WHERE activity_type = $1")
            .execute(Tuple.of(type.name()))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private UserActivity mapRow(Row row) {
        String metadataJson = row.getString("metadata");
        return new UserActivity(
            row.getUUID("id"),
            row.getString("user_id"),
            row.getString("user_name"),
            UserActivity.ActivityType.valueOf(row.getString("activity_type")),
            row.getString("description"),
            row.getString("ip_address"),
            row.getString("user_agent"),
            row.getString("session_id"),
            metadataJson != null ? new JsonObject(metadataJson) : null,
            row.getOffsetDateTime("created_at")
        );
    }
}
