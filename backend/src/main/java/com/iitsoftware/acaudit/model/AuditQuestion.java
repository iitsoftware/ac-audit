package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AuditQuestion(
    UUID id,
    UUID auditId,
    UUID parentId,
    UUID templateQuestionId,
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
            .put("auditId", auditId != null ? auditId.toString() : null)
            .put("parentId", parentId != null ? parentId.toString() : null)
            .put("templateQuestionId", templateQuestionId != null ? templateQuestionId.toString() : null)
            .put("questionText", questionText)
            .put("description", description)
            .put("sortOrder", sortOrder)
            .put("metadata", metadata)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static AuditQuestion fromJson(JsonObject json) {
        return new AuditQuestion(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("auditId") != null ? UUID.fromString(json.getString("auditId")) : null,
            json.getString("parentId") != null ? UUID.fromString(json.getString("parentId")) : null,
            json.getString("templateQuestionId") != null ? UUID.fromString(json.getString("templateQuestionId")) : null,
            json.getString("questionText"),
            json.getString("description"),
            json.getInteger("sortOrder", 0),
            json.getJsonObject("metadata", new JsonObject()),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
