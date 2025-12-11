package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.AuditInstance;
import com.iitsoftware.acaudit.model.AuditQuestion;
import com.iitsoftware.acaudit.model.QuestionComplianceState;
import com.iitsoftware.acaudit.service.AuditInstanceService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

public class AuditInstanceApiHandler {

    private static final Logger logger = LoggerFactory.getLogger(AuditInstanceApiHandler.class);

    private final AuditInstanceService instanceService;

    public AuditInstanceApiHandler(AuditInstanceService instanceService) {
        this.instanceService = instanceService;
    }

    // Audit Instance endpoints

    public void list(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);
        String departmentIdParam = ctx.request().getParam("departmentId");
        String statusParam = ctx.request().getParam("status");

        var future = departmentIdParam != null
            ? instanceService.findByDepartmentId(UUID.fromString(departmentIdParam), limit, offset)
            : statusParam != null
                ? instanceService.findByStatus(AuditInstance.AuditStatus.valueOf(statusParam), limit, offset)
                : instanceService.findAll(limit, offset);

        future
            .onSuccess(instances -> {
                JsonArray result = new JsonArray();
                instances.forEach(i -> result.add(i.toJson()));
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(result.encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getById(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        instanceService.getAuditWithDetails(id)
            .onSuccess(result -> {
                if (result == null) {
                    ctx.response().setStatusCode(404).end();
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(result.encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void create(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        AuditInstance instance = AuditInstance.fromJson(body);

        // If templateId is provided, use createFromTemplate to copy questions
        var future = instance.templateId() != null
            ? instanceService.createFromTemplate(instance)
            : instanceService.createBlankAudit(instance);

        future
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void update(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("id", id.toString());
        AuditInstance instance = AuditInstance.fromJson(body);

        instanceService.updateInstance(instance)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateStatus(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));
        JsonObject body = ctx.body().asJsonObject();
        AuditInstance.AuditStatus status = AuditInstance.AuditStatus.valueOf(body.getString("status"));

        instanceService.updateStatus(id, status)
            .onSuccess(v -> ctx.response().setStatusCode(204).end())
            .onFailure(err -> handleError(ctx, err));
    }

    public void delete(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        instanceService.deleteInstance(id)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404).end();
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    // Question endpoints

    public void addQuestion(RoutingContext ctx) {
        UUID auditId = UUID.fromString(ctx.pathParam("auditId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("auditId", auditId.toString());
        AuditQuestion question = AuditQuestion.fromJson(body);

        instanceService.addCustomQuestion(question)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateQuestion(RoutingContext ctx) {
        UUID auditId = UUID.fromString(ctx.pathParam("auditId"));
        UUID questionId = UUID.fromString(ctx.pathParam("questionId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("id", questionId.toString());
        body.put("auditId", auditId.toString());
        AuditQuestion question = AuditQuestion.fromJson(body);

        instanceService.updateQuestion(question)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void deleteQuestion(RoutingContext ctx) {
        UUID questionId = UUID.fromString(ctx.pathParam("questionId"));

        instanceService.deleteQuestion(questionId)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404).end();
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    // Compliance state endpoints

    public void updateCompliance(RoutingContext ctx) {
        UUID questionId = UUID.fromString(ctx.pathParam("questionId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("auditQuestionId", questionId.toString());
        QuestionComplianceState state = QuestionComplianceState.fromJson(body);

        instanceService.updateComplianceState(state)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void getProgress(RoutingContext ctx) {
        UUID auditId = UUID.fromString(ctx.pathParam("auditId"));

        instanceService.getAuditProgress(auditId)
            .onSuccess(progress -> {
                if (progress == null) {
                    ctx.response().setStatusCode(404).end();
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(progress.encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    // Helper methods

    private int getIntParam(RoutingContext ctx, String name, int defaultValue) {
        String value = ctx.request().getParam(name);
        if (value == null) return defaultValue;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private void handleError(RoutingContext ctx, Throwable err) {
        logger.error("API error", err);
        ctx.response()
            .setStatusCode(500)
            .putHeader("Content-Type", "application/json")
            .end(new JsonObject().put("error", err.getMessage()).encode());
    }
}
