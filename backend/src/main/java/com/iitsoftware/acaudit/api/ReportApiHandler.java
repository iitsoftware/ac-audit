package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.ReportTemplate;
import com.iitsoftware.acaudit.service.ReportService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;

public class ReportApiHandler {

    private final ReportService service;

    public ReportApiHandler(ReportService service) {
        this.service = service;
    }

    public void listTemplates(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);

        service.findAllTemplates(limit, offset)
            .onSuccess(templates -> {
                JsonArray result = new JsonArray();
                templates.forEach(t -> result.add(t.toJson()));
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

    public void generate(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            body = new JsonObject();
        }

        String typeStr = body.getString("type", "AUDIT_SUMMARY");
        ReportTemplate.ReportType type;
        try {
            type = ReportTemplate.ReportType.valueOf(typeStr);
        } catch (IllegalArgumentException e) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Invalid report type").encode());
            return;
        }

        // Default date range: last 30 days
        OffsetDateTime to = OffsetDateTime.now();
        OffsetDateTime from = to.minus(30, ChronoUnit.DAYS);

        if (body.getString("from") != null) {
            from = OffsetDateTime.parse(body.getString("from"));
        }
        if (body.getString("to") != null) {
            to = OffsetDateTime.parse(body.getString("to"));
        }

        service.generate(type, from, to)
            .onSuccess(report -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(report.encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void export(RoutingContext ctx) {
        String format = ctx.pathParam("format");
        JsonObject body = ctx.body().asJsonObject();

        if (body == null) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Report data required").encode());
            return;
        }

        if ("csv".equalsIgnoreCase(format)) {
            service.exportToCsv(body)
                .onSuccess(csv -> ctx.response()
                    .putHeader("Content-Type", "text/csv")
                    .putHeader("Content-Disposition", "attachment; filename=\"report.csv\"")
                    .end(csv))
                .onFailure(err -> handleError(ctx, err));
        } else if ("json".equalsIgnoreCase(format)) {
            ctx.response()
                .putHeader("Content-Type", "application/json")
                .putHeader("Content-Disposition", "attachment; filename=\"report.json\"")
                .end(body.encodePrettily());
        } else {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Unsupported format. Use 'csv' or 'json'").encode());
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
