package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AuditTemplate(
    UUID id,
    String name,
    JsonObject metadata,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id != null ? id.toString() : null)
            .put("name", name)
            .put("metadata", metadata)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static AuditTemplate fromJson(JsonObject json) {
        return new AuditTemplate(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("name"),
            json.getJsonObject("metadata", new JsonObject()),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
