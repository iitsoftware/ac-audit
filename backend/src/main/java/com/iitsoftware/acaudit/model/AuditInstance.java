package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonObject;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

public record AuditInstance(
    UUID id,
    UUID departmentId,
    UUID templateId,
    String name,
    String description,
    AuditStatus status,
    LocalDate dueDate,
    OffsetDateTime completedAt,
    String assignedTo,
    JsonObject metadata,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public enum AuditStatus {
        OPEN, IN_PROGRESS, CLOSED
    }

    public enum ComplianceState {
        COMPLIANT, NON_COMPLIANT
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id != null ? id.toString() : null)
            .put("departmentId", departmentId != null ? departmentId.toString() : null)
            .put("templateId", templateId != null ? templateId.toString() : null)
            .put("name", name)
            .put("description", description)
            .put("status", status != null ? status.name() : null)
            .put("dueDate", dueDate != null ? dueDate.toString() : null)
            .put("completedAt", completedAt != null ? completedAt.toString() : null)
            .put("assignedTo", assignedTo)
            .put("metadata", metadata)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static AuditInstance fromJson(JsonObject json) {
        return new AuditInstance(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("departmentId") != null ? UUID.fromString(json.getString("departmentId")) : null,
            json.getString("templateId") != null ? UUID.fromString(json.getString("templateId")) : null,
            json.getString("name"),
            json.getString("description"),
            json.getString("status") != null ? AuditStatus.valueOf(json.getString("status")) : AuditStatus.OPEN,
            json.getString("dueDate") != null ? LocalDate.parse(json.getString("dueDate")) : null,
            json.getString("completedAt") != null ? OffsetDateTime.parse(json.getString("completedAt")) : null,
            json.getString("assignedTo"),
            json.getJsonObject("metadata", new JsonObject()),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
