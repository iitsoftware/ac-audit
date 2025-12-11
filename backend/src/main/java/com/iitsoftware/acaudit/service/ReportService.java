package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.AuditEntry;
import com.iitsoftware.acaudit.model.ComplianceStatus;
import com.iitsoftware.acaudit.model.ReportTemplate;
import com.iitsoftware.acaudit.model.UserActivity;
import com.iitsoftware.acaudit.repository.AuditRepository;
import com.iitsoftware.acaudit.repository.ComplianceRepository;
import com.iitsoftware.acaudit.repository.ReportRepository;
import com.iitsoftware.acaudit.repository.UserActivityRepository;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.time.OffsetDateTime;
import java.util.List;

public class ReportService {

    private final ReportRepository reportRepository;
    private final AuditRepository auditRepository;
    private final ComplianceRepository complianceRepository;
    private final UserActivityRepository activityRepository;

    public ReportService(ReportRepository reportRepository,
                         AuditRepository auditRepository,
                         ComplianceRepository complianceRepository,
                         UserActivityRepository activityRepository) {
        this.reportRepository = reportRepository;
        this.auditRepository = auditRepository;
        this.complianceRepository = complianceRepository;
        this.activityRepository = activityRepository;
    }

    public Future<List<ReportTemplate>> findAllTemplates(int limit, int offset) {
        return reportRepository.findAllTemplates(limit, offset);
    }

    public Future<JsonObject> generate(ReportTemplate.ReportType type, OffsetDateTime from, OffsetDateTime to) {
        return switch (type) {
            case AUDIT_SUMMARY -> generateAuditSummary(from, to);
            case COMPLIANCE_STATUS -> generateComplianceStatus();
            case USER_ACTIVITY -> generateUserActivityReport(from, to);
            case CUSTOM -> Future.succeededFuture(new JsonObject().put("error", "Custom reports require template"));
        };
    }

    private Future<JsonObject> generateAuditSummary(OffsetDateTime from, OffsetDateTime to) {
        return Future.all(
            auditRepository.findByDateRange(from, to, 1000, 0),
            auditRepository.count()
        ).map(cf -> {
            List<AuditEntry> entries = cf.resultAt(0);
            Long total = cf.resultAt(1);

            JsonArray entriesJson = new JsonArray();
            entries.forEach(e -> entriesJson.add(e.toJson()));

            // Count by action
            long creates = entries.stream().filter(e -> e.action() == AuditEntry.AuditAction.CREATE).count();
            long updates = entries.stream().filter(e -> e.action() == AuditEntry.AuditAction.UPDATE).count();
            long deletes = entries.stream().filter(e -> e.action() == AuditEntry.AuditAction.DELETE).count();

            return new JsonObject()
                .put("reportType", "AUDIT_SUMMARY")
                .put("generatedAt", OffsetDateTime.now().toString())
                .put("dateRange", new JsonObject()
                    .put("from", from.toString())
                    .put("to", to.toString()))
                .put("summary", new JsonObject()
                    .put("totalEntries", total)
                    .put("entriesInRange", entries.size())
                    .put("creates", creates)
                    .put("updates", updates)
                    .put("deletes", deletes))
                .put("entries", entriesJson);
        });
    }

    private Future<JsonObject> generateComplianceStatus() {
        return Future.all(
            complianceRepository.findAllStatus(1000, 0),
            complianceRepository.countByStatus(ComplianceStatus.Status.COMPLIANT),
            complianceRepository.countByStatus(ComplianceStatus.Status.NON_COMPLIANT),
            complianceRepository.countByStatus(ComplianceStatus.Status.PENDING)
        ).map(cf -> {
            List<ComplianceStatus> statuses = cf.resultAt(0);
            Long compliant = cf.resultAt(1);
            Long nonCompliant = cf.resultAt(2);
            Long pending = cf.resultAt(3);

            JsonArray statusesJson = new JsonArray();
            statuses.forEach(s -> statusesJson.add(s.toJson()));

            return new JsonObject()
                .put("reportType", "COMPLIANCE_STATUS")
                .put("generatedAt", OffsetDateTime.now().toString())
                .put("summary", new JsonObject()
                    .put("totalChecks", statuses.size())
                    .put("compliant", compliant)
                    .put("nonCompliant", nonCompliant)
                    .put("pending", pending)
                    .put("complianceRate", statuses.isEmpty() ? 0 :
                        (compliant * 100.0) / (compliant + nonCompliant + pending)))
                .put("statuses", statusesJson);
        });
    }

    private Future<JsonObject> generateUserActivityReport(OffsetDateTime from, OffsetDateTime to) {
        return Future.all(
            activityRepository.findByDateRange(from, to, 1000, 0),
            activityRepository.count(),
            activityRepository.countByActivityType(UserActivity.ActivityType.LOGIN),
            activityRepository.countByActivityType(UserActivity.ActivityType.LOGOUT)
        ).map(cf -> {
            List<UserActivity> activities = cf.resultAt(0);
            Long total = cf.resultAt(1);
            Long logins = cf.resultAt(2);
            Long logouts = cf.resultAt(3);

            JsonArray activitiesJson = new JsonArray();
            activities.forEach(a -> activitiesJson.add(a.toJson()));

            return new JsonObject()
                .put("reportType", "USER_ACTIVITY")
                .put("generatedAt", OffsetDateTime.now().toString())
                .put("dateRange", new JsonObject()
                    .put("from", from.toString())
                    .put("to", to.toString()))
                .put("summary", new JsonObject()
                    .put("totalActivities", total)
                    .put("activitiesInRange", activities.size())
                    .put("totalLogins", logins)
                    .put("totalLogouts", logouts))
                .put("activities", activitiesJson);
        });
    }

    public Future<String> exportToCsv(JsonObject reportData) {
        StringBuilder csv = new StringBuilder();
        String reportType = reportData.getString("reportType");

        return switch (reportType) {
            case "AUDIT_SUMMARY" -> {
                csv.append("ID,Entity Type,Entity ID,Action,User,Description,Created At\n");
                JsonArray entries = reportData.getJsonArray("entries", new JsonArray());
                for (int i = 0; i < entries.size(); i++) {
                    JsonObject entry = entries.getJsonObject(i);
                    csv.append(String.format("%s,%s,%s,%s,%s,%s,%s\n",
                        entry.getString("id"),
                        entry.getString("entityType"),
                        entry.getString("entityId"),
                        entry.getString("action"),
                        entry.getString("userName"),
                        entry.getString("description", "").replace(",", ";"),
                        entry.getString("createdAt")));
                }
                yield Future.succeededFuture(csv.toString());
            }
            case "COMPLIANCE_STATUS" -> {
                csv.append("ID,Rule ID,Entity Type,Entity ID,Status,Details,Checked At\n");
                JsonArray statuses = reportData.getJsonArray("statuses", new JsonArray());
                for (int i = 0; i < statuses.size(); i++) {
                    JsonObject status = statuses.getJsonObject(i);
                    csv.append(String.format("%s,%s,%s,%s,%s,%s,%s\n",
                        status.getString("id"),
                        status.getString("ruleId"),
                        status.getString("entityType"),
                        status.getString("entityId"),
                        status.getString("status"),
                        status.getString("details", "").replace(",", ";"),
                        status.getString("checkedAt")));
                }
                yield Future.succeededFuture(csv.toString());
            }
            case "USER_ACTIVITY" -> {
                csv.append("ID,User ID,User Name,Activity Type,Description,IP Address,Created At\n");
                JsonArray activities = reportData.getJsonArray("activities", new JsonArray());
                for (int i = 0; i < activities.size(); i++) {
                    JsonObject activity = activities.getJsonObject(i);
                    csv.append(String.format("%s,%s,%s,%s,%s,%s,%s\n",
                        activity.getString("id"),
                        activity.getString("userId"),
                        activity.getString("userName"),
                        activity.getString("activityType"),
                        activity.getString("description", "").replace(",", ";"),
                        activity.getString("ipAddress"),
                        activity.getString("createdAt")));
                }
                yield Future.succeededFuture(csv.toString());
            }
            default -> Future.succeededFuture("");
        };
    }
}
