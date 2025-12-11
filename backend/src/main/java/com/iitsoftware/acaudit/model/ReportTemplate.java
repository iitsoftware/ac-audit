package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ReportTemplate(
    UUID id,
    String name,
    String description,
    ReportType type,
    JsonObject config,
    boolean active,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public enum ReportType {
        AUDIT_SUMMARY, COMPLIANCE_STATUS, USER_ACTIVITY, CUSTOM
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id.toString())
            .put("name", name)
            .put("description", description)
            .put("type", type.name())
            .put("config", config)
            .put("active", active)
            .put("createdAt", createdAt.toString())
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static ReportTemplate fromJson(JsonObject json) {
        return new ReportTemplate(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : UUID.randomUUID(),
            json.getString("name"),
            json.getString("description"),
            ReportType.valueOf(json.getString("type", "CUSTOM")),
            json.getJsonObject("config", new JsonObject()),
            json.getBoolean("active", true),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : OffsetDateTime.now(),
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
