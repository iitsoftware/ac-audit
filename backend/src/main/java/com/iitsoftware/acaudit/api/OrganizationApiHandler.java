package com.iitsoftware.acaudit.api;

import com.iitsoftware.acaudit.model.Company;
import com.iitsoftware.acaudit.model.Department;
import com.iitsoftware.acaudit.service.OrganizationService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

public class OrganizationApiHandler {

    private static final Logger logger = LoggerFactory.getLogger(OrganizationApiHandler.class);

    private final OrganizationService organizationService;

    public OrganizationApiHandler(OrganizationService organizationService) {
        this.organizationService = organizationService;
    }

    // Company endpoints

    public void listCompanies(RoutingContext ctx) {
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);
        boolean activeOnly = getBooleanParam(ctx, "activeOnly", false);

        var future = activeOnly
            ? organizationService.findAllActiveCompaniesWithAuditCounts(limit, offset)
            : organizationService.findAllCompaniesWithAuditCounts(limit, offset);

        future
            .onSuccess(result -> {
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(result.encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getCompanyById(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        organizationService.findCompanyById(id)
            .onSuccess(company -> {
                if (company == null) {
                    ctx.response().setStatusCode(404).end();
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(company.toJson().encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getCompanyWithDepartments(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        organizationService.getCompanyWithDepartments(id)
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

    public void createCompany(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        Company company = Company.fromJson(body);

        organizationService.createCompany(company)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateCompany(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("id", id.toString());
        Company company = Company.fromJson(body);

        organizationService.updateCompany(company)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void deleteCompany(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        organizationService.deleteCompany(id)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404).end();
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    // Department endpoints

    public void listDepartments(RoutingContext ctx) {
        UUID companyId = UUID.fromString(ctx.pathParam("companyId"));
        int limit = getIntParam(ctx, "limit", 50);
        int offset = getIntParam(ctx, "offset", 0);
        boolean activeOnly = getBooleanParam(ctx, "activeOnly", false);

        var future = activeOnly
            ? organizationService.findActiveDepartmentsByCompanyIdWithAuditCounts(companyId, limit, offset)
            : organizationService.findDepartmentsByCompanyIdWithAuditCounts(companyId, limit, offset);

        future
            .onSuccess(result -> {
                ctx.response()
                    .putHeader("Content-Type", "application/json")
                    .end(result.encode());
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void getDepartmentById(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        organizationService.findDepartmentById(id)
            .onSuccess(department -> {
                if (department == null) {
                    ctx.response().setStatusCode(404).end();
                } else {
                    ctx.response()
                        .putHeader("Content-Type", "application/json")
                        .end(department.toJson().encode());
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    public void createDepartment(RoutingContext ctx) {
        UUID companyId = UUID.fromString(ctx.pathParam("companyId"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("companyId", companyId.toString());
        Department department = Department.fromJson(body);

        organizationService.createDepartment(department)
            .onSuccess(created -> ctx.response()
                .setStatusCode(201)
                .putHeader("Content-Type", "application/json")
                .end(created.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void updateDepartment(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));
        JsonObject body = ctx.body().asJsonObject();
        body.put("id", id.toString());
        Department department = Department.fromJson(body);

        organizationService.updateDepartment(department)
            .onSuccess(updated -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(updated.toJson().encode()))
            .onFailure(err -> handleError(ctx, err));
    }

    public void deleteDepartment(RoutingContext ctx) {
        UUID id = UUID.fromString(ctx.pathParam("id"));

        organizationService.deleteDepartment(id)
            .onSuccess(deleted -> {
                if (deleted) {
                    ctx.response().setStatusCode(204).end();
                } else {
                    ctx.response().setStatusCode(404).end();
                }
            })
            .onFailure(err -> handleError(ctx, err));
    }

    // Hierarchy endpoint

    public void getFullHierarchy(RoutingContext ctx) {
        organizationService.getFullHierarchy()
            .onSuccess(hierarchy -> ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(hierarchy.encode()))
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
        logger.error("API error", err);
        ctx.response()
            .setStatusCode(500)
            .putHeader("Content-Type", "application/json")
            .end(new JsonObject().put("error", err.getMessage()).encode());
    }
}
