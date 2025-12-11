package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.QuestionComplianceState;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class QuestionComplianceStateRepository {

    private final Pool pool;

    public QuestionComplianceStateRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<QuestionComplianceState> findByQuestionId(UUID auditQuestionId) {
        return pool.preparedQuery("""
            SELECT id, audit_question_id, closed, closed_at, result, outcome, notes, evidence_urls,
                   evaluated_by, created_at, updated_at
            FROM question_compliance_state
            WHERE audit_question_id = $1
            """)
            .execute(Tuple.of(auditQuestionId))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<List<QuestionComplianceState>> findByAuditId(UUID auditId) {
        return pool.preparedQuery("""
            SELECT qcs.id, qcs.audit_question_id, qcs.closed, qcs.closed_at, qcs.result, qcs.outcome,
                   qcs.notes, qcs.evidence_urls, qcs.evaluated_by, qcs.created_at, qcs.updated_at
            FROM question_compliance_state qcs
            INNER JOIN audit_question aq ON qcs.audit_question_id = aq.id
            WHERE aq.audit_id = $1
            """)
            .execute(Tuple.of(auditId))
            .map(rows -> {
                List<QuestionComplianceState> states = new ArrayList<>();
                for (Row row : rows) {
                    states.add(mapRow(row));
                }
                return states;
            });
    }

    public Future<Map<UUID, QuestionComplianceState>> findByAuditIdAsMap(UUID auditId) {
        return findByAuditId(auditId).map(states -> {
            Map<UUID, QuestionComplianceState> map = new HashMap<>();
            for (QuestionComplianceState state : states) {
                map.put(state.auditQuestionId(), state);
            }
            return map;
        });
    }

    public Future<QuestionComplianceState> save(QuestionComplianceState state) {
        UUID id = state.id() != null ? state.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        // Auto-set closedAt when closing
        OffsetDateTime closedAt = state.closed() && state.closedAt() == null ? now : state.closedAt();

        return pool.preparedQuery("""
            INSERT INTO question_compliance_state (id, audit_question_id, closed, closed_at, result, outcome,
                   notes, evidence_urls, evaluated_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (audit_question_id) DO UPDATE SET
                closed = EXCLUDED.closed,
                closed_at = EXCLUDED.closed_at,
                result = EXCLUDED.result,
                outcome = EXCLUDED.outcome,
                notes = EXCLUDED.notes,
                evidence_urls = EXCLUDED.evidence_urls,
                evaluated_by = EXCLUDED.evaluated_by,
                updated_at = EXCLUDED.updated_at
            RETURNING id, audit_question_id, closed, closed_at, result, outcome, notes, evidence_urls,
                      evaluated_by, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                state.auditQuestionId(),
                state.closed(),
                closedAt,
                state.result() != null ? state.result().name() : null,
                state.outcome() != null ? state.outcome().name() : null,
                state.notes(),
                state.evidenceUrls() != null ? state.evidenceUrls().encode() : "[]",
                state.evaluatedBy(),
                state.createdAt() != null ? state.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM question_compliance_state WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<JsonObject> countByStatusForAudit(UUID auditId) {
        return pool.preparedQuery("""
            SELECT
                COUNT(*) FILTER (WHERE qcs.closed = true AND qcs.result = 'COMPLIANT') as compliant,
                COUNT(*) FILTER (WHERE qcs.closed = true AND qcs.result = 'NON_COMPLIANT') as non_compliant,
                COUNT(*) FILTER (WHERE qcs.closed = false OR qcs.closed IS NULL) as open,
                COUNT(*) as total
            FROM audit_question aq
            LEFT JOIN question_compliance_state qcs ON aq.id = qcs.audit_question_id
            WHERE aq.audit_id = $1
            """)
            .execute(Tuple.of(auditId))
            .map(rows -> {
                Row row = rows.iterator().next();
                return new JsonObject()
                    .put("compliant", row.getLong("compliant"))
                    .put("nonCompliant", row.getLong("non_compliant"))
                    .put("open", row.getLong("open"))
                    .put("total", row.getLong("total"));
            });
    }

    /**
     * Create initial open compliance states for all questions in an audit
     */
    public Future<Void> createInitialStatesForAudit(UUID auditId) {
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO question_compliance_state (id, audit_question_id, closed, created_at, updated_at)
            SELECT gen_random_uuid(), aq.id, false, $2, $2
            FROM audit_question aq
            WHERE aq.audit_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM question_compliance_state qcs WHERE qcs.audit_question_id = aq.id
            )
            """)
            .execute(Tuple.of(auditId, now))
            .mapEmpty();
    }

    private QuestionComplianceState mapRow(Row row) {
        JsonArray evidenceUrls = getJsonArrayField(row, "evidence_urls");
        String resultStr = row.getString("result");
        String outcomeStr = row.getString("outcome");
        return new QuestionComplianceState(
            row.getUUID("id"),
            row.getUUID("audit_question_id"),
            row.getBoolean("closed") != null && row.getBoolean("closed"),
            row.getOffsetDateTime("closed_at"),
            resultStr != null ? QuestionComplianceState.Result.valueOf(resultStr) : null,
            outcomeStr != null ? QuestionComplianceState.Outcome.valueOf(outcomeStr) : null,
            row.getString("notes"),
            evidenceUrls,
            row.getString("evaluated_by"),
            row.getOffsetDateTime("created_at"),
            row.getOffsetDateTime("updated_at")
        );
    }

    private JsonArray getJsonArrayField(Row row, String column) {
        Object value = row.getValue(column);
        if (value == null) {
            return new JsonArray();
        }
        if (value instanceof JsonArray) {
            return (JsonArray) value;
        }
        if (value instanceof String) {
            return new JsonArray((String) value);
        }
        return new JsonArray();
    }
}
