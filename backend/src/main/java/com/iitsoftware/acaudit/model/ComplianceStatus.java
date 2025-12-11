package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record ComplianceStatus(
    UUID id,
    UUID ruleId,
    String entityType,
    String entityId,
    Status status,
    String details,
    OffsetDateTime checkedAt,
    OffsetDateTime createdAt
) {
    public enum Status {
        COMPLIANT, NON_COMPLIANT, PENDING, NOT_APPLICABLE
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id.toString())
            .put("ruleId", ruleId.toString())
            .put("entityType", entityType)
            .put("entityId", entityId)
            .put("status", status.name())
            .put("details", details)
            .put("checkedAt", checkedAt != null ? checkedAt.toString() : null)
            .put("createdAt", createdAt.toString());
    }

    public static ComplianceStatus fromJson(JsonObject json) {
        return new ComplianceStatus(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : UUID.randomUUID(),
            UUID.fromString(json.getString("ruleId")),
            json.getString("entityType"),
            json.getString("entityId"),
            Status.valueOf(json.getString("status", "PENDING")),
            json.getString("details"),
            json.getString("checkedAt") != null ? OffsetDateTime.parse(json.getString("checkedAt")) : null,
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : OffsetDateTime.now()
        );
    }
}
