package com.iitsoftware.acaudit.repository;

import com.iitsoftware.acaudit.model.TemplateQuestion;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Row;
import io.vertx.sqlclient.Tuple;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class TemplateQuestionRepository {

    private final Pool pool;

    public TemplateQuestionRepository(Pool pool) {
        this.pool = pool;
    }

    public Future<List<TemplateQuestion>> findByTemplateId(UUID templateId) {
        return pool.preparedQuery("""
            SELECT id, template_id, parent_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM template_question
            WHERE template_id = $1
            ORDER BY sort_order
            """)
            .execute(Tuple.of(templateId))
            .map(rows -> {
                List<TemplateQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<List<TemplateQuestion>> findRootQuestions(UUID templateId) {
        return pool.preparedQuery("""
            SELECT id, template_id, parent_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM template_question
            WHERE template_id = $1 AND parent_id IS NULL
            ORDER BY sort_order
            """)
            .execute(Tuple.of(templateId))
            .map(rows -> {
                List<TemplateQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<List<TemplateQuestion>> findChildren(UUID parentId) {
        return pool.preparedQuery("""
            SELECT id, template_id, parent_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM template_question
            WHERE parent_id = $1
            ORDER BY sort_order
            """)
            .execute(Tuple.of(parentId))
            .map(rows -> {
                List<TemplateQuestion> questions = new ArrayList<>();
                for (Row row : rows) {
                    questions.add(mapRow(row));
                }
                return questions;
            });
    }

    public Future<TemplateQuestion> findById(UUID id) {
        return pool.preparedQuery("""
            SELECT id, template_id, parent_id, question_text, description,
                   sort_order, metadata, created_at, updated_at
            FROM template_question WHERE id = $1
            """)
            .execute(Tuple.of(id))
            .map(rows -> {
                if (rows.rowCount() == 0) {
                    return null;
                }
                return mapRow(rows.iterator().next());
            });
    }

    public Future<TemplateQuestion> save(TemplateQuestion question) {
        UUID id = question.id() != null ? question.id() : UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        return pool.preparedQuery("""
            INSERT INTO template_question (id, template_id, parent_id, question_text, description,
                   sort_order, metadata, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
                template_id = EXCLUDED.template_id,
                parent_id = EXCLUDED.parent_id,
                question_text = EXCLUDED.question_text,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            RETURNING id, template_id, parent_id, question_text, description,
                      sort_order, metadata, created_at, updated_at
            """)
            .execute(Tuple.of(
                id,
                question.templateId(),
                question.parentId(),
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
        return pool.preparedQuery("DELETE FROM template_question WHERE id = $1")
            .execute(Tuple.of(id))
            .map(rows -> rows.rowCount() > 0);
    }

    public Future<Integer> getNextSortOrder(UUID templateId, UUID parentId) {
        String sql = parentId == null
            ? "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM template_question WHERE template_id = $1 AND parent_id IS NULL"
            : "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM template_question WHERE template_id = $1 AND parent_id = $2";

        Tuple params = parentId == null ? Tuple.of(templateId) : Tuple.of(templateId, parentId);

        return pool.preparedQuery(sql)
            .execute(params)
            .map(rows -> rows.iterator().next().getInteger(0));
    }

    public Future<Void> updateSortOrder(UUID id, int sortOrder) {
        return pool.preparedQuery("""
            UPDATE template_question SET sort_order = $1, updated_at = $2 WHERE id = $3
            """)
            .execute(Tuple.of(sortOrder, OffsetDateTime.now(), id))
            .mapEmpty();
    }

    public Future<Void> updateParentAndSortOrder(UUID id, UUID parentId, int sortOrder) {
        return pool.preparedQuery("""
            UPDATE template_question SET parent_id = $1, sort_order = $2, updated_at = $3 WHERE id = $4
            """)
            .execute(Tuple.of(parentId, sortOrder, OffsetDateTime.now(), id))
            .mapEmpty();
    }

    private TemplateQuestion mapRow(Row row) {
        JsonObject metadata = getJsonObjectField(row, "metadata");
        return new TemplateQuestion(
            row.getUUID("id"),
            row.getUUID("template_id"),
            row.getUUID("parent_id"),
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
