package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ComplianceRule(
    UUID id,
    String name,
    String description,
    String entityType,
    JsonObject criteria,
    boolean active,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id.toString())
            .put("name", name)
            .put("description", description)
            .put("entityType", entityType)
            .put("criteria", criteria)
            .put("active", active)
            .put("createdAt", createdAt.toString())
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static ComplianceRule fromJson(JsonObject json) {
        return new ComplianceRule(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : UUID.randomUUID(),
            json.getString("name"),
            json.getString("description"),
            json.getString("entityType"),
            json.getJsonObject("criteria", new JsonObject()),
            json.getBoolean("active", true),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : OffsetDateTime.now(),
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
