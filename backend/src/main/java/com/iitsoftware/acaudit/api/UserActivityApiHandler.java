package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.UserActivity;
import com.iitsoftware.acaudit.service.UserActivityService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.util.UUID;

public class UserActivityApiHandler {

    private final UserActivityService service;

    public UserActivityApiHandler(UserActivityService service) {
        this.service = service;
    }

    public void list(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);

        service.findAll(limit, offset)
            .onSuccess(activities -> {
                JsonArray result = new JsonArray();
                activities.forEach(a -> result.add(a.toJson()));
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

    public void getById(RoutingContext ctx) {
        String idParam = ctx.pathParam("id");
        UUID id;
        try {
            id = UUID.fromString(idParam);
        } catch (IllegalArgumentException e) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Invalid UUID").encode());
            return;
        }

        service.findById(id)
            .onSuccess(activity -> {
                if (activity == null) {
                    ctx.response().setStatusCode(404)
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("error", "Not found").encode());
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(activity.toJson().encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void create(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Request body required").encode());
            return;
        }

        // Add IP address and user agent from request
        if (ctx.request().remoteAddress() != null) {
            body.put("ipAddress", ctx.request().remoteAddress().host());
        }
        body.put("userAgent", ctx.request().getHeader("User-Agent"));

        UserActivity activity = UserActivity.fromJson(body);

        service.create(activity)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
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
