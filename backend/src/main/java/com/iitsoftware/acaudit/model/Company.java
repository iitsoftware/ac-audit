package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record Company(
    UUID id,
    String name,
    String description,
    JsonObject metadata,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id != null ? id.toString() : null)
            .put("name", name)
            .put("description", description)
            .put("metadata", metadata)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static Company fromJson(JsonObject json) {
        return new Company(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("name"),
            json.getString("description"),
            json.getJsonObject("metadata", new JsonObject()),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
