package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record TemplateQuestion(
    UUID id,
    UUID templateId,
    UUID parentId,
    String questionText,
    String description,
    int sortOrder,
    JsonObject metadata,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id != null ? id.toString() : null)
            .put("templateId", templateId != null ? templateId.toString() : null)
            .put("parentId", parentId != null ? parentId.toString() : null)
            .put("questionText", questionText)
            .put("description", description)
            .put("sortOrder", sortOrder)
            .put("metadata", metadata)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static TemplateQuestion fromJson(JsonObject json) {
        return new TemplateQuestion(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("templateId") != null ? UUID.fromString(json.getString("templateId")) : null,
            json.getString("parentId") != null ? UUID.fromString(json.getString("parentId")) : null,
            json.getString("questionText"),
            json.getString("description"),
            json.getInteger("sortOrder", 0),
            json.getJsonObject("metadata", new JsonObject()),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
