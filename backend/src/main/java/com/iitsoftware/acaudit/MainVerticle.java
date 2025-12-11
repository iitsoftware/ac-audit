package com.iitsoftware.acaudit;

import com.iitsoftware.acaudit.api.AuditApiHandler;
import com.iitsoftware.acaudit.api.AuditInstanceApiHandler;
import com.iitsoftware.acaudit.api.AuditTemplateApiHandler;
import com.iitsoftware.acaudit.api.ComplianceApiHandler;
import com.iitsoftware.acaudit.api.OrganizationApiHandler;
import com.iitsoftware.acaudit.api.ReportApiHandler;
import com.iitsoftware.acaudit.api.UserActivityApiHandler;
import com.iitsoftware.acaudit.config.DatabaseConfig;
import com.iitsoftware.acaudit.repository.AuditInstanceRepository;
import com.iitsoftware.acaudit.repository.AuditQuestionRepository;
import com.iitsoftware.acaudit.repository.AuditRepository;
import com.iitsoftware.acaudit.repository.AuditTemplateRepository;
import com.iitsoftware.acaudit.repository.CompanyRepository;
import com.iitsoftware.acaudit.repository.ComplianceRepository;
import com.iitsoftware.acaudit.repository.DepartmentRepository;
import com.iitsoftware.acaudit.repository.QuestionComplianceStateRepository;
import com.iitsoftware.acaudit.repository.ReportRepository;
import com.iitsoftware.acaudit.repository.TemplateQuestionRepository;
import com.iitsoftware.acaudit.repository.UserActivityRepository;
import com.iitsoftware.acaudit.service.AuditInstanceService;
import com.iitsoftware.acaudit.service.AuditService;
import com.iitsoftware.acaudit.service.AuditTemplateService;
import com.iitsoftware.acaudit.service.ComplianceService;
import com.iitsoftware.acaudit.service.OrganizationService;
import com.iitsoftware.acaudit.service.ReportService;
import com.iitsoftware.acaudit.service.UserActivityService;
import io.vertx.config.ConfigRetriever;
import io.vertx.config.ConfigRetrieverOptions;
import io.vertx.config.ConfigStoreOptions;
import io.vertx.core.AbstractVerticle;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.handler.BodyHandler;
import io.vertx.ext.web.handler.CorsHandler;
import io.vertx.sqlclient.Pool;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Set;

public class MainVerticle extends AbstractVerticle {

    private static final Logger logger = LoggerFactory.getLogger(MainVerticle.class);
    private static final String CONFIG_PATH = "../config/config.json";

    private Pool pool;

    @Override
    public void start(Promise<Void> startPromise) {
        loadConfig()
            .onSuccess(config -> {
                logger.info("Configuration loaded from {}", CONFIG_PATH);
                initializeApplication(config, startPromise);
            })
            .onFailure(err -> {
                logger.error("Failed to load configuration", err);
                startPromise.fail(err);
            });
    }

    private Future<JsonObject> loadConfig() {
        ConfigStoreOptions fileStore = new ConfigStoreOptions()
            .setType("file")
            .setFormat("json")
            .setConfig(new JsonObject().put("path", CONFIG_PATH));

        ConfigRetrieverOptions options = new ConfigRetrieverOptions()
            .addStore(fileStore);

        ConfigRetriever retriever = ConfigRetriever.create(vertx, options);
        return retriever.getConfig();
    }

    private void initializeApplication(JsonObject config, Promise<Void> startPromise) {
        JsonObject http = config.getJsonObject("http", new JsonObject());
        int port = http.getInteger("port", 8080);

        // Initialize database
        DatabaseConfig dbConfig = new DatabaseConfig(vertx, config);

        dbConfig.initializeDatabase()
            .compose(v -> dbConfig.createPool())
            .onSuccess(p -> {
                this.pool = p;

                // Create repositories
                AuditRepository auditRepo = new AuditRepository(pool);
                ComplianceRepository complianceRepo = new ComplianceRepository(pool);
                ReportRepository reportRepo = new ReportRepository(pool);
                UserActivityRepository activityRepo = new UserActivityRepository(pool);

                // New hierarchical audit repositories
                CompanyRepository companyRepo = new CompanyRepository(pool);
                DepartmentRepository departmentRepo = new DepartmentRepository(pool);
                AuditTemplateRepository templateRepo = new AuditTemplateRepository(pool);
                TemplateQuestionRepository templateQuestionRepo = new TemplateQuestionRepository(pool);
                AuditInstanceRepository instanceRepo = new AuditInstanceRepository(pool);
                AuditQuestionRepository auditQuestionRepo = new AuditQuestionRepository(pool);
                QuestionComplianceStateRepository stateRepo = new QuestionComplianceStateRepository(pool);

                // Create services
                AuditService auditService = new AuditService(auditRepo);
                ComplianceService complianceService = new ComplianceService(complianceRepo);
                ReportService reportService = new ReportService(reportRepo, auditRepo, complianceRepo, activityRepo);
                UserActivityService activityService = new UserActivityService(activityRepo);

                // New hierarchical audit services
                OrganizationService organizationService = new OrganizationService(companyRepo, departmentRepo, instanceRepo);
                AuditTemplateService templateService = new AuditTemplateService(templateRepo, templateQuestionRepo);
                AuditInstanceService instanceService = new AuditInstanceService(instanceRepo, auditQuestionRepo, templateQuestionRepo, stateRepo);

                // Create API handlers
                AuditApiHandler auditHandler = new AuditApiHandler(auditService);
                ComplianceApiHandler complianceHandler = new ComplianceApiHandler(complianceService);
                ReportApiHandler reportHandler = new ReportApiHandler(reportService);
                UserActivityApiHandler activityHandler = new UserActivityApiHandler(activityService);

                // New hierarchical audit handlers
                OrganizationApiHandler orgHandler = new OrganizationApiHandler(organizationService);
                AuditTemplateApiHandler templateHandler = new AuditTemplateApiHandler(templateService);
                AuditInstanceApiHandler instanceHandler = new AuditInstanceApiHandler(instanceService);

                // Setup router
                Router router = createRouter(auditHandler, complianceHandler, reportHandler, activityHandler,
                    orgHandler, templateHandler, instanceHandler);

                // Start HTTP server
                vertx.createHttpServer()
                    .requestHandler(router)
                    .listen(port)
                    .onSuccess(server -> {
                        logger.info("AC Audit server started on port {}", port);
                        startPromise.complete();
                    })
                    .onFailure(startPromise::fail);
            })
            .onFailure(err -> {
                logger.error("Failed to initialize database", err);
                startPromise.fail(err);
            });
    }

    private Router createRouter(AuditApiHandler auditHandler,
                                ComplianceApiHandler complianceHandler,
                                ReportApiHandler reportHandler,
                                UserActivityApiHandler activityHandler,
                                OrganizationApiHandler orgHandler,
                                AuditTemplateApiHandler templateHandler,
                                AuditInstanceApiHandler instanceHandler) {
        Router router = Router.router(vertx);

        // CORS handler
        router.route().handler(CorsHandler.create()
            .addRelativeOrigin(".*")
            .allowedMethods(Set.of(
                HttpMethod.GET,
                HttpMethod.POST,
                HttpMethod.PUT,
                HttpMethod.DELETE,
                HttpMethod.OPTIONS
            ))
            .allowedHeaders(Set.of("Content-Type", "Authorization")));

        // Body handler
        router.route().handler(BodyHandler.create());

        // Health check
        router.get("/health").handler(ctx ->
            ctx.response()
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("status", "UP").encode())
        );

        // API routes
        Router apiRouter = Router.router(vertx);

        // Audit routes (legacy)
        apiRouter.get("/audits").handler(auditHandler::list);
        apiRouter.get("/audits/:id").handler(auditHandler::getById);
        apiRouter.post("/audits").handler(auditHandler::create);

        // Compliance routes
        apiRouter.get("/compliance/rules").handler(complianceHandler::listRules);
        apiRouter.get("/compliance/rules/:id").handler(complianceHandler::getRuleById);
        apiRouter.post("/compliance/rules").handler(complianceHandler::createRule);
        apiRouter.put("/compliance/rules/:id").handler(complianceHandler::updateRule);
        apiRouter.delete("/compliance/rules/:id").handler(complianceHandler::deleteRule);
        apiRouter.get("/compliance/status").handler(complianceHandler::listStatus);
        apiRouter.get("/compliance/status/:entityType/:entityId").handler(complianceHandler::getEntityStatus);

        // Report routes
        apiRouter.get("/reports/templates").handler(reportHandler::listTemplates);
        apiRouter.post("/reports/generate").handler(reportHandler::generate);
        apiRouter.get("/reports/export/:format").handler(reportHandler::export);

        // User activity routes
        apiRouter.get("/activities").handler(activityHandler::list);
        apiRouter.get("/activities/:id").handler(activityHandler::getById);
        apiRouter.post("/activities").handler(activityHandler::create);

        // Organization routes (Company & Department)
        apiRouter.get("/companies").handler(orgHandler::listCompanies);
        apiRouter.get("/companies/:id").handler(orgHandler::getCompanyById);
        apiRouter.post("/companies").handler(orgHandler::createCompany);
        apiRouter.put("/companies/:id").handler(orgHandler::updateCompany);
        apiRouter.delete("/companies/:id").handler(orgHandler::deleteCompany);
        apiRouter.get("/companies/:companyId/departments").handler(orgHandler::listDepartments);
        apiRouter.post("/companies/:companyId/departments").handler(orgHandler::createDepartment);
        apiRouter.get("/departments/:id").handler(orgHandler::getDepartmentById);
        apiRouter.put("/departments/:id").handler(orgHandler::updateDepartment);
        apiRouter.delete("/departments/:id").handler(orgHandler::deleteDepartment);
        apiRouter.get("/organization/hierarchy").handler(orgHandler::getFullHierarchy);

        // Audit Template routes
        apiRouter.get("/audit-templates").handler(templateHandler::list);
        apiRouter.get("/audit-templates/:id").handler(templateHandler::getById);
        apiRouter.post("/audit-templates").handler(templateHandler::create);
        apiRouter.put("/audit-templates/:id").handler(templateHandler::update);
        apiRouter.delete("/audit-templates/:id").handler(templateHandler::delete);
        apiRouter.get("/audit-templates/:templateId/questions").handler(templateHandler::getQuestions);
        apiRouter.post("/audit-templates/:templateId/questions").handler(templateHandler::addQuestion);
        apiRouter.put("/audit-templates/:templateId/questions/:questionId").handler(templateHandler::updateQuestion);
        apiRouter.delete("/audit-templates/:templateId/questions/:questionId").handler(templateHandler::deleteQuestion);
        apiRouter.post("/audit-templates/:templateId/questions/reorder").handler(templateHandler::reorderQuestions);

        // Audit Instance routes
        apiRouter.get("/audit-instances").handler(instanceHandler::list);
        apiRouter.get("/audit-instances/:id").handler(instanceHandler::getById);
        apiRouter.post("/audit-instances").handler(instanceHandler::create);
        apiRouter.put("/audit-instances/:id").handler(instanceHandler::update);
        apiRouter.put("/audit-instances/:id/status").handler(instanceHandler::updateStatus);
        apiRouter.delete("/audit-instances/:id").handler(instanceHandler::delete);
        apiRouter.post("/audit-instances/:auditId/questions").handler(instanceHandler::addQuestion);
        apiRouter.put("/audit-instances/:auditId/questions/:questionId").handler(instanceHandler::updateQuestion);
        apiRouter.delete("/audit-instances/:auditId/questions/:questionId").handler(instanceHandler::deleteQuestion);
        apiRouter.put("/audit-instances/:auditId/questions/:questionId/compliance").handler(instanceHandler::updateCompliance);
        apiRouter.get("/audit-instances/:auditId/progress").handler(instanceHandler::getProgress);

        router.route("/api/*").subRouter(apiRouter);

        return router;
    }

    @Override
    public void stop(Promise<Void> stopPromise) {
        if (pool != null) {
            pool.close()
                .onComplete(ar -> stopPromise.complete());
        } else {
            stopPromise.complete();
        }
    }
}
