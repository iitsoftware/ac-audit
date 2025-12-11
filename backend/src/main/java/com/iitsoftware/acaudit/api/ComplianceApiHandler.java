package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.ComplianceRule;
import com.iitsoftware.acaudit.service.ComplianceService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.util.UUID;

public class ComplianceApiHandler {

    private final ComplianceService service;

    public ComplianceApiHandler(ComplianceService service) {
        this.service = service;
    }

    public void listRules(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);

        service.findAllRules(limit, offset)
            .onSuccess(rules -> {
                JsonArray result = new JsonArray();
                rules.forEach(r -> result.add(r.toJson()));
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(new JsonObject()
                        .put("data", result)
                        .put("limit", limit)
                        .put("offset", offset)
                        .encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getRuleById(RoutingContext ctx) {
        UUID id = parseUuid(ctx, "id");
        if (id == null) return;

        service.findRuleById(id)
            .onSuccess(rule -> {
                if (rule == null) {
                    ctx.response().setStatusCode(404)
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("error", "Not found").encode());
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(rule.toJson().encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void createRule(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Request body required").encode());
            return;
        }

        ComplianceRule rule = ComplianceRule.fromJson(body);

        service.createRule(rule)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateRule(RoutingContext ctx) {
        UUID id = parseUuid(ctx, "id");
        if (id == null) return;

        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Request body required").encode());
            return;
        }

        body.put("id", id.toString());
        ComplianceRule rule = ComplianceRule.fromJson(body);

        service.updateRule(rule)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void deleteRule(RoutingContext ctx) {
        UUID id = parseUuid(ctx, "id");
        if (id == null) return;

        service.deleteRule(id)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404)
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("error", "Not found").encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void listStatus(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);

        service.findAllStatus(limit, offset)
            .onSuccess(statuses -> {
                JsonArray result = new JsonArray();
                statuses.forEach(s -> result.add(s.toJson()));
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(new JsonObject()
                        .put("data", result)
                        .put("limit", limit)
                        .put("offset", offset)
                        .encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getEntityStatus(RoutingContext ctx) {
        String entityType = ctx.pathParam("entityType");
        String entityId = ctx.pathParam("entityId");

        service.findStatusByEntity(entityType, entityId)
            .onSuccess(statuses -> {
                JsonArray result = new JsonArray();
                statuses.forEach(s -> result.add(s.toJson()));
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(new JsonObject().put("data", result).encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    private UUID parseUuid(RoutingContext ctx, String paramName) {
        String value = ctx.pathParam(paramName);
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Invalid UUID").encode());
            return null;
        }
    }

    private int getIntParam(RoutingContext ctx, String name, int defaultValue) {
        String value = ctx.queryParams().get(name);
        if (value == null) return defaultValue;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    private void handleError(RoutingContext ctx, Throwable err) {
        ctx.response().setStatusCode(500)
            .putHeader("Content-Type", "application/json")
            .end(new JsonObject().put("error", err.getMessage()).encode());
    }
}
