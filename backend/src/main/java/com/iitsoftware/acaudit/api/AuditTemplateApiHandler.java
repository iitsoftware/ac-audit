package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.AuditTemplate;
import com.iitsoftware.acaudit.model.TemplateQuestion;
import com.iitsoftware.acaudit.service.AuditTemplateService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class AuditTemplateApiHandler {

    private final AuditTemplateService templateService;

    public AuditTemplateApiHandler(AuditTemplateService templateService) {
        this.templateService = templateService;
    }

    // Template endpoints

    public void list(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);
        boolean activeOnly = getBooleanParam(ctx, "activeOnly", false);

        var future = activeOnly
            ? templateService.findAllActiveTemplates(limit, offset)
            : templateService.findAllTemplates(limit, offset);

        future
            .onSuccess(templates -> {
                JsonArray result = new JsonArray();
                templates.forEach(t -> result.add(t.toJson()));
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(result.encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getById(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        templateService.getTemplateWithQuestions(id)
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
        AuditTemplate template = AuditTemplate.fromJson(body);

        templateService.createTemplate(template)
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
        AuditTemplate template = AuditTemplate.fromJson(body);

        templateService.updateTemplate(template)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void delete(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        templateService.deleteTemplate(id)
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
        UUID templateId = UUID.fromString(ctx.pathParam("templateId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("templateId", templateId.toString());
        TemplateQuestion question = TemplateQuestion.fromJson(body);

        templateService.addQuestion(question)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateQuestion(RoutingContext ctx) {
        UUID templateId = UUID.fromString(ctx.pathParam("templateId"));
        UUID questionId = UUID.fromString(ctx.pathParam("questionId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("id", questionId.toString());
        body.put("templateId", templateId.toString());
        TemplateQuestion question = TemplateQuestion.fromJson(body);

        templateService.updateQuestion(question)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void deleteQuestion(RoutingContext ctx) {
        UUID questionId = UUID.fromString(ctx.pathParam("questionId"));

        templateService.deleteQuestion(questionId)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404).end();
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void reorderQuestions(RoutingContext ctx) {
        JsonArray body = ctx.body().asJsonArray();
        List<JsonObject> orderItems = new ArrayList<>();
        for (int i = 0; i < body.size(); i++) {
            orderItems.add(body.getJsonObject(i));
        }

        templateService.reorderQuestions(orderItems)
            .onSuccess(v -> ctx.response().setStatusCode(204).end())
            .onFailure(err -> handleError(ctx, err));
    }

    public void getQuestions(RoutingContext ctx) {
        UUID templateId = UUID.fromString(ctx.pathParam("templateId"));

        templateService.findQuestionsByTemplateId(templateId)
            .onSuccess(questions -> {
                JsonArray questionsTree = templateService.buildQuestionTree(questions);
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(questionsTree.encode());
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

    private boolean getBooleanParam(RoutingContext ctx, String name, boolean defaultValue) {
        String value = ctx.request().getParam(name);
        if (value == null) return defaultValue;
        return Boolean.parseBoolean(value);
    }

    private void handleError(RoutingContext ctx, Throwable err) {
        ctx.response()
            .setStatusCode(500)
            .putHeader("Content-Type", "application/json")
            .end(new JsonObject().put("error", err.getMessage()).encode());
    }
}
