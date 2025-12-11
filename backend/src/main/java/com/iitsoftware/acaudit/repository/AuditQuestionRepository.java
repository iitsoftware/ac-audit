package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.AuditQuestion;
import com.iitsoftware.acaudit.model.TemplateQuestion;
import io.vertx.core.Future;
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

public class AuditQuestionRepository {

    private final Pool pool;

    public AuditQuestionRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<AuditQuestion>> findByAuditId(UUID auditId) {
        return pool.preparedQuery("""
            SELECT id, audit_id, parent_id, template_question_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM audit_question
            WHERE audit_id = $1
            ORDER BY sort_order
            """)
            .execute(Tuple.of(auditId))
            .map(rows -> {
                List<AuditQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<List<AuditQuestion>> findRootQuestions(UUID auditId) {
        return pool.preparedQuery("""
            SELECT id, audit_id, parent_id, template_question_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM audit_question
            WHERE audit_id = $1 AND parent_id IS NULL
            ORDER BY sort_order
            """)
            .execute(Tuple.of(auditId))
            .map(rows -> {
                List<AuditQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<List<AuditQuestion>> findChildren(UUID parentId) {
        return pool.preparedQuery("""
            SELECT id, audit_id, parent_id, template_question_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM audit_question
            WHERE parent_id = $1
            ORDER BY sort_order
            """)
            .execute(Tuple.of(parentId))
            .map(rows -> {
                List<AuditQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<AuditQuestion> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, audit_id, parent_id, template_question_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM audit_question WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<AuditQuestion> save(AuditQuestion question) {
        UUID id = question.id() != null ? question.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO audit_question (id, audit_id, parent_id, template_question_id, question_text,
                   description, sort_order, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                audit_id = EXCLUDED.audit_id,
                parent_id = EXCLUDED.parent_id,
                template_question_id = EXCLUDED.template_question_id,
                question_text = EXCLUDED.question_text,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, audit_id, parent_id, template_question_id, question_text, description,
                      sort_order, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                question.auditId(),
                question.parentId(),
                question.templateQuestionId(),
                question.questionText(),
                question.description(),
                question.sortOrder(),
                question.metadata() != null ? question.metadata().encode() : "{}",
                question.createdAt() != null ? question.createdAt() : now,
                now
            ))
            .map(rows -> mapRow(rows.iterator().next()));
    }

    public Future<Boolean> delete(UUID id) {
        return pool.preparedQuery("DELETE FROM audit_question WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Void> deleteByAuditId(UUID auditId) {
        return pool.preparedQuery("DELETE FROM audit_question WHERE audit_id = $1")
            .execute(Tuple.of(auditId))
            .mapEmpty();
    }

    public Future<Integer> getNextSortOrder(UUID auditId, UUID parentId) {
        String sql = parentId == null
            ? "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM audit_question WHERE audit_id = $1 AND parent_id IS NULL"
            : "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM audit_question WHERE audit_id = $1 AND parent_id = $2";

        Tuple params = parentId == null ? Tuple.of(auditId) : Tuple.of(auditId, parentId);

        return pool.preparedQuery(sql)
            .execute(params)
            .map(rows -> rows.iterator().next().getInteger(0));
    }

    /**
     * Copy all questions from a template to an audit instance.
     * Maintains the parent-child hierarchy by mapping old IDs to new IDs.
     * Questions are inserted in order: parents first, then children (topological sort).
     */
    public Future<Void> copyFromTemplate(UUID auditId, List<TemplateQuestion> templateQuestions) {
        if (templateQuestions.isEmpty()) {
            return Future.succeededFuture();
        }

        // Map old template question IDs to new audit question IDs
        Map<UUID, UUID> idMapping = new HashMap<>();
        for (TemplateQuestion tq : templateQuestions) {
            idMapping.put(tq.id(), UUID.randomUUID());
        }

        // Sort questions: parents before children (topological sort)
        List<TemplateQuestion> sortedQuestions = new ArrayList<>();
        Map<UUID, TemplateQuestion> questionMap = new HashMap<>();
        for (TemplateQuestion tq : templateQuestions) {
            questionMap.put(tq.id(), tq);
        }

        // First add all root questions (no parent)
        for (TemplateQuestion tq : templateQuestions) {
            if (tq.parentId() == null) {
                sortedQuestions.add(tq);
            }
        }

        // Then add children level by level
        int processed = sortedQuestions.size();
        while (processed < templateQuestions.size()) {
            List<TemplateQuestion> nextLevel = new ArrayList<>();
            for (TemplateQuestion tq : templateQuestions) {
                if (tq.parentId() != null && !sortedQuestions.contains(tq)) {
                    // Check if parent is already in sorted list
                    boolean parentAdded = sortedQuestions.stream()
                        .anyMatch(q -> q.id().equals(tq.parentId()));
                    if (parentAdded) {
                        nextLevel.add(tq);
                    }
                }
            }
            sortedQuestions.addAll(nextLevel);
            processed = sortedQuestions.size();
            if (nextLevel.isEmpty() && processed < templateQuestions.size()) {
                // Prevent infinite loop - add remaining questions
                for (TemplateQuestion tq : templateQuestions) {
                    if (!sortedQuestions.contains(tq)) {
                        sortedQuestions.add(tq);
                    }
                }
                break;
            }
        }

        OffsetDateTime now = OffsetDateTime.now();

        // Insert sequentially to maintain FK integrity
        Future<Void> chain = Future.succeededFuture();
        for (TemplateQuestion tq : sortedQuestions) {
            UUID newId = idMapping.get(tq.id());
            UUID newParentId = tq.parentId() != null ? idMapping.get(tq.parentId()) : null;

            chain = chain.compose(v -> pool.preparedQuery("""
                INSERT INTO audit_question (id, audit_id, parent_id, template_question_id, question_text,
                       description, sort_order, metadata, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """)
                .execute(Tuple.of(
                    newId,
                    auditId,
                    newParentId,
                    tq.id(),
                    tq.questionText(),
                    tq.description(),
                    tq.sortOrder(),
                    tq.metadata() != null ? tq.metadata().encode() : "{}",
                    now,
                    now
                ))
                .mapEmpty());
        }

        return chain;
    }

    public Future<Long> countByAuditId(UUID auditId) {
        return pool.preparedQuery("SELECT COUNT(*) FROM audit_question WHERE audit_id = $1")
            .execute(Tuple.of(auditId))
            .map(rows -> rows.iterator().next().getLong(0));
    }

    private AuditQuestion mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        return new AuditQuestion(
            row.getUUID("id"),
            row.getUUID("audit_id"),
            row.getUUID("parent_id"),
            row.getUUID("template_question_id"),
            row.getString("question_text"),
            row.getString("description"),
            row.getInteger("sort_order"),
            metadata,
            row.getOffsetDateTime("created_at"),
            row.getOffsetDateTime("updated_at")
        );
    }

    private JsonObject getJsonObjectField(Row row, String column) {
        Object value = row.getValue(column);
        if (value == null) {
            return new JsonObject();
        }
        if (value instanceof JsonObject) {
            return (JsonObject) value;
        }
        if (value instanceof String) {
            return new JsonObject((String) value);
        }
        return new JsonObject();
    }
}
