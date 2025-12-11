package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AuditEntry(
    UUID id,
    String entityType,
    String entityId,
    AuditAction action,
    String userId,
    String userName,
    JsonObject beforeValue,
    JsonObject afterValue,
    String description,
    String ipAddress,
    OffsetDateTime createdAt
) {
    public enum AuditAction {
        CREATE, UPDATE, DELETE
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id.toString())
            .put("entityType", entityType)
            .put("entityId", entityId)
            .put("action", action.name())
            .put("userId", userId)
            .put("userName", userName)
            .put("beforeValue", beforeValue)
            .put("afterValue", afterValue)
            .put("description", description)
            .put("ipAddress", ipAddress)
            .put("createdAt", createdAt.toString());
    }

    public static AuditEntry fromJson(JsonObject json) {
        return new AuditEntry(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : UUID.randomUUID(),
            json.getString("entityType"),
            json.getString("entityId"),
            AuditAction.valueOf(json.getString("action", "CREATE")),
            json.getString("userId"),
            json.getString("userName"),
            json.getJsonObject("beforeValue"),
            json.getJsonObject("afterValue"),
            json.getString("description"),
            json.getString("ipAddress"),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : OffsetDateTime.now()
        );
    }
}
