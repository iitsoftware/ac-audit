package com.iitsoftware.acaudit.model;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.UUID;

public record QuestionComplianceState(
    UUID id,
    UUID auditQuestionId,
    boolean closed,
    OffsetDateTime closedAt,
    Result result,
    Outcome outcome,
    String notes,
    JsonArray evidenceUrls,
    String evaluatedBy,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public enum Result {
        COMPLIANT, NON_COMPLIANT
    }

    public enum Outcome {
        LEVEL_1, LEVEL_2, RECOMMENDATION
    }

    public JsonObject toJson() {
        return new JsonObject()
            .put("id", id != null ? id.toString() : null)
            .put("auditQuestionId", auditQuestionId != null ? auditQuestionId.toString() : null)
            .put("closed", closed)
            .put("closedAt", closedAt != null ? closedAt.toString() : null)
            .put("result", result != null ? result.name() : null)
            .put("outcome", outcome != null ? outcome.name() : null)
            .put("notes", notes)
            .put("evidenceUrls", evidenceUrls)
            .put("evaluatedBy", evaluatedBy)
            .put("createdAt", createdAt != null ? createdAt.toString() : null)
            .put("updatedAt", updatedAt != null ? updatedAt.toString() : null);
    }

    public static QuestionComplianceState fromJson(JsonObject json) {
        return new QuestionComplianceState(
            json.getString("id") != null ? UUID.fromString(json.getString("id")) : null,
            json.getString("auditQuestionId") != null ? UUID.fromString(json.getString("auditQuestionId")) : null,
            json.getBoolean("closed", false),
            json.getString("closedAt") != null ? OffsetDateTime.parse(json.getString("closedAt")) : null,
            json.getString("result") != null ? Result.valueOf(json.getString("result")) : null,
            json.getString("outcome") != null ? Outcome.valueOf(json.getString("outcome")) : null,
            json.getString("notes"),
            json.getJsonArray("evidenceUrls", new JsonArray()),
            json.getString("evaluatedBy"),
            json.getString("createdAt") != null ? OffsetDateTime.parse(json.getString("createdAt")) : null,
            json.getString("updatedAt") != null ? OffsetDateTime.parse(json.getString("updatedAt")) : null
        );
    }
}
