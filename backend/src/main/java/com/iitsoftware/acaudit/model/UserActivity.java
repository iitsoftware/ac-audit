package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record UserActivity(
    UUID id,
    String userId,
    String userName,
    ActivityType activityType,
    String description,
    String ipAddress,
    String userAgent,
    String sessionId,
    JsonObject metadata,
    OffsetDateTime createdAt
) {
    public enum ActivityType {
        LOGIN, LOGOUT, PAGE_VIEW, ACTION, API_CALL, ERROR
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id.toString())
            .put("userId", userId)
            .put("userName", userName)
            .put("activityType", activityType.name())
            .put("description", description)
            .put("ipAddress", ipAddress)
            .put("userAgent", userAgent)
            .put("sessionId", sessionId)
            .put("metadata", metadata)
            .put("createdAt", createdAt.toString());
    }

    public static UserActivity fromJson(JsonObject json) {
        return new UserActivity(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : UUID.randomUUID(),
            json.getString("userId"),
            json.getString("userName"),
            ActivityType.valueOf(json.getString("activityType", "ACTION")),
            json.getString("description"),
            json.getString("ipAddress"),
            json.getString("userAgent"),
            json.getString("sessionId"),
            json.getJsonObject("metadata"),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : OffsetDateTime.now()
        );
    }
}
