package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.AuditTemplate;
import com.iitsoftware.acaudit.model.TemplateQuestion;
import com.iitsoftware.acaudit.repository.AuditTemplateRepository;
import com.iitsoftware.acaudit.repository.TemplateQuestionRepository;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class AuditTemplateService {

    private final AuditTemplateRepository templateRepository;
    private final TemplateQuestionRepository questionRepository;

    public AuditTemplateService(AuditTemplateRepository templateRepository,
                                TemplateQuestionRepository questionRepository) {
        this.templateRepository = templateRepository;
        this.questionRepository = questionRepository;
    }

    // Template operations

    public Future<List<AuditTemplate>> findAllTemplates(int limit, int offset) {
        return templateRepository.findAll(limit, offset);
    }

    public Future<List<AuditTemplate>> findAllActiveTemplates(int limit, int offset) {
        return templateRepository.findAllActive(limit, offset);
    }

    public Future<AuditTemplate> findTemplateById(UUID id) {
        return templateRepository.findById(id);
    }

    public Future<AuditTemplate> createTemplate(AuditTemplate template) {
        return templateRepository.save(template);
    }

    public Future<AuditTemplate> updateTemplate(AuditTemplate template) {
        return templateRepository.save(template);
    }

    public Future<Boolean> deleteTemplate(UUID id) {
        return templateRepository.delete(id);
    }

    // Question operations

    public Future<List<TemplateQuestion>> findQuestionsByTemplateId(UUID templateId) {
        return questionRepository.findByTemplateId(templateId);
    }

    public Future<TemplateQuestion> findQuestionById(UUID id) {
        return questionRepository.findById(id);
    }

    public Future<TemplateQuestion> addQuestion(TemplateQuestion question) {
        // Auto-assign sort order if not specified
        if (question.sortOrder() == 0) {
            return questionRepository.getNextSortOrder(question.templateId(), question.parentId())
                .compose(nextOrder -> {
                    TemplateQuestion withOrder = new TemplateQuestion(
                        question.id(),
                        question.templateId(),
                        question.parentId(),
                        question.questionText(),
                        question.description(),
                        nextOrder,
                        question.metadata(),
                        question.createdAt(),
                        question.updatedAt()
                    );
                    return questionRepository.save(withOrder);
                });
        }
        return questionRepository.save(question);
    }

    public Future<TemplateQuestion> updateQuestion(TemplateQuestion question) {
        return questionRepository.save(question);
    }

    public Future<Boolean> deleteQuestion(UUID id) {
        return questionRepository.delete(id);
    }

    public Future<Void> moveQuestion(UUID questionId, UUID newParentId, int newSortOrder) {
        return questionRepository.updateParentAndSortOrder(questionId, newParentId, newSortOrder);
    }

    // Template with questions

    /**
     * Get template with all questions organized as a tree
     */
    public Future<JsonObject> getTemplateWithQuestions(UUID templateId) {
        return Future.all(
            templateRepository.findById(templateId),
            questionRepository.findByTemplateId(templateId)
        ).map(cf -> {
            AuditTemplate template = cf.resultAt(0);
            List<TemplateQuestion> questions = cf.resultAt(1);

            if (template == null) {
                return null;
            }

            JsonArray questionsTree = buildQuestionTree(questions);
            return template.toJson().put("questions", questionsTree);
        });
    }

    /**
     * Build a nested tree structure from a flat list of questions
     */
    public JsonArray buildQuestionTree(List<TemplateQuestion> questions) {
        // Group questions by parent ID
        Map<UUID, List<TemplateQuestion>> childrenMap = new HashMap<>();
        List<TemplateQuestion> rootQuestions = new ArrayList<>();

        for (TemplateQuestion q : questions) {
            if (q.parentId() == null) {
                rootQuestions.add(q);
            } else {
                childrenMap.computeIfAbsent(q.parentId(), k -> new ArrayList<>()).add(q);
            }
        }

        // Sort root questions by sort order
        rootQuestions.sort((a, b) -> Integer.compare(a.sortOrder(), b.sortOrder()));

        // Recursively build tree
        JsonArray result = new JsonArray();
        for (TemplateQuestion root : rootQuestions) {
            result.add(buildQuestionNode(root, childrenMap));
        }
        return result;
    }

    private JsonObject buildQuestionNode(TemplateQuestion question, Map<UUID, List<TemplateQuestion>> childrenMap) {
        JsonObject node = question.toJson();

        List<TemplateQuestion> children = childrenMap.get(question.id());
        if (children != null && !children.isEmpty()) {
            // Sort children by sort order
            children.sort((a, b) -> Integer.compare(a.sortOrder(), b.sortOrder()));

            JsonArray childrenArray = new JsonArray();
            for (TemplateQuestion child : children) {
                childrenArray.add(buildQuestionNode(child, childrenMap));
            }
            node.put("children", childrenArray);
        } else {
            node.put("children", new JsonArray());
        }

        return node;
    }

    /**
     * Reorder questions - accepts a list of {id, parentId, sortOrder}
     */
    public Future<Void> reorderQuestions(List<JsonObject> orderItems) {
        List<Future<Void>> futures = new ArrayList<>();

        for (JsonObject item : orderItems) {
            UUID id = UUID.fromString(item.getString("id"));
            UUID parentId = item.getString("parentId") != null
                ? UUID.fromString(item.getString("parentId"))
                : null;
            int sortOrder = item.getInteger("sortOrder", 0);

            futures.add(questionRepository.updateParentAndSortOrder(id, parentId, sortOrder));
        }

        return Future.all(futures).mapEmpty();
    }
}
