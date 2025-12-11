package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.AuditInstance;
import com.iitsoftware.acaudit.model.AuditQuestion;
import com.iitsoftware.acaudit.model.QuestionComplianceState;
import com.iitsoftware.acaudit.model.TemplateQuestion;
import com.iitsoftware.acaudit.repository.AuditInstanceRepository;
import com.iitsoftware.acaudit.repository.AuditQuestionRepository;
import com.iitsoftware.acaudit.repository.QuestionComplianceStateRepository;
import com.iitsoftware.acaudit.repository.TemplateQuestionRepository;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class AuditInstanceService {

    private final AuditInstanceRepository instanceRepository;
    private final AuditQuestionRepository questionRepository;
    private final TemplateQuestionRepository templateQuestionRepository;
    private final QuestionComplianceStateRepository stateRepository;

    public AuditInstanceService(AuditInstanceRepository instanceRepository,
                                AuditQuestionRepository questionRepository,
                                TemplateQuestionRepository templateQuestionRepository,
                                QuestionComplianceStateRepository stateRepository) {
        this.instanceRepository = instanceRepository;
        this.questionRepository = questionRepository;
        this.templateQuestionRepository = templateQuestionRepository;
        this.stateRepository = stateRepository;
    }

    // Audit Instance operations

    public Future<List<AuditInstance>> findAll(int limit, int offset) {
        return instanceRepository.findAll(limit, offset);
    }

    public Future<List<AuditInstance>> findByDepartmentId(UUID departmentId, int limit, int offset) {
        return instanceRepository.findByDepartmentId(departmentId, limit, offset);
    }

    public Future<List<AuditInstance>> findByStatus(AuditInstance.AuditStatus status, int limit, int offset) {
        return instanceRepository.findByStatus(status, limit, offset);
    }

    public Future<AuditInstance> findById(UUID id) {
        return instanceRepository.findById(id);
    }

    public Future<AuditInstance> updateInstance(AuditInstance instance) {
        return instanceRepository.save(instance);
    }

    public Future<Void> updateStatus(UUID id, AuditInstance.AuditStatus status) {
        return instanceRepository.updateStatus(id, status);
    }

    public Future<Boolean> deleteInstance(UUID id) {
        return instanceRepository.delete(id);
    }

    /**
     * Create a blank audit without a template
     */
    public Future<AuditInstance> createBlankAudit(AuditInstance instance) {
        return instanceRepository.save(instance);
    }

    /**
     * Create an audit from a template - copies all template questions
     */
    public Future<AuditInstance> createFromTemplate(AuditInstance instance) {
        if (instance.templateId() == null) {
            return instanceRepository.save(instance);
        }

        return instanceRepository.save(instance)
            .compose(savedInstance ->
                templateQuestionRepository.findByTemplateId(instance.templateId())
                    .compose(templateQuestions ->
                        questionRepository.copyFromTemplate(savedInstance.id(), templateQuestions)
                    )
                    .compose(v -> stateRepository.createInitialStatesForAudit(savedInstance.id()))
                    .map(v -> savedInstance)
            );
    }

    // Question operations

    public Future<List<AuditQuestion>> findQuestionsByAuditId(UUID auditId) {
        return questionRepository.findByAuditId(auditId);
    }

    public Future<AuditQuestion> findQuestionById(UUID id) {
        return questionRepository.findById(id);
    }

    public Future<AuditQuestion> addCustomQuestion(AuditQuestion question) {
        // Auto-assign sort order if not specified
        if (question.sortOrder() == 0) {
            return questionRepository.getNextSortOrder(question.auditId(), question.parentId())
                .compose(nextOrder -> {
                    AuditQuestion withOrder = new AuditQuestion(
                        question.id(),
                        question.auditId(),
                        question.parentId(),
                        question.templateQuestionId(),
                        question.questionText(),
                        question.description(),
                        nextOrder,
                        question.metadata(),
                        question.createdAt(),
                        question.updatedAt()
                    );
                    return questionRepository.save(withOrder)
                        .compose(savedQuestion ->
                            stateRepository.save(new QuestionComplianceState(
                                null,
                                savedQuestion.id(),
                                false, // closed
                                null,  // closedAt
                                null,  // result
                                null,  // outcome
                                null,  // notes
                                null,  // evidenceUrls
                                null,  // evaluatedBy
                                null,  // createdAt
                                null   // updatedAt
                            )).map(state -> savedQuestion)
                        );
                });
        }
        return questionRepository.save(question)
            .compose(savedQuestion ->
                stateRepository.save(new QuestionComplianceState(
                    null,
                    savedQuestion.id(),
                    false, // closed
                    null,  // closedAt
                    null,  // result
                    null,  // outcome
                    null,  // notes
                    null,  // evidenceUrls
                    null,  // evaluatedBy
                    null,  // createdAt
                    null   // updatedAt
                )).map(state -> savedQuestion)
            );
    }

    public Future<AuditQuestion> updateQuestion(AuditQuestion question) {
        return questionRepository.save(question);
    }

    public Future<Boolean> deleteQuestion(UUID id) {
        return questionRepository.delete(id);
    }

    // Compliance state operations

    public Future<QuestionComplianceState> updateComplianceState(QuestionComplianceState state) {
        return stateRepository.save(state);
    }

    public Future<QuestionComplianceState> getComplianceStateByQuestionId(UUID questionId) {
        return stateRepository.findByQuestionId(questionId);
    }

    // Combined operations

    /**
     * Get audit with all questions organized as a tree and compliance states.
     * Computes audit status and compliance state based on questions.
     */
    public Future<JsonObject> getAuditWithDetails(UUID auditId) {
        return Future.all(
            instanceRepository.findById(auditId),
            questionRepository.findByAuditId(auditId),
            stateRepository.findByAuditIdAsMap(auditId)
        ).map(cf -> {
            AuditInstance instance = cf.resultAt(0);
            List<AuditQuestion> questions = cf.resultAt(1);
            Map<UUID, QuestionComplianceState> statesMap = cf.resultAt(2);

            if (instance == null) {
                return null;
            }

            // Build question tree with aggregated compliance
            JsonArray questionsTree = buildQuestionTree(questions, statesMap);

            // Compute audit status and compliance state
            AuditStatusInfo statusInfo = computeAuditStatus(questions, statesMap);

            return instance.toJson()
                .put("questions", questionsTree)
                .put("status", statusInfo.status.name())
                .put("complianceState", statusInfo.complianceState != null ? statusInfo.complianceState.name() : null);
        });
    }

    /**
     * Get audit progress summary.
     * Progress is computed from root questions (top-level questions) only.
     * A root question is closed when all its descendants are closed.
     */
    public Future<JsonObject> getAuditProgress(UUID auditId) {
        return Future.all(
            instanceRepository.findById(auditId),
            questionRepository.findByAuditId(auditId),
            stateRepository.findByAuditIdAsMap(auditId)
        ).map(cf -> {
            AuditInstance instance = cf.resultAt(0);
            List<AuditQuestion> questions = cf.resultAt(1);
            Map<UUID, QuestionComplianceState> statesMap = cf.resultAt(2);

            if (instance == null) {
                return null;
            }

            // Build the question tree to get aggregated states
            JsonArray questionsTree = buildQuestionTree(questions, statesMap);

            // Count root questions only
            long total = questionsTree.size();
            long closed = 0;
            long compliant = 0;
            long nonCompliant = 0;
            long open = 0;

            for (int i = 0; i < questionsTree.size(); i++) {
                JsonObject rootQuestion = questionsTree.getJsonObject(i);
                JsonObject state = rootQuestion.getJsonObject("complianceState");

                if (state != null && state.getBoolean("closed", false)) {
                    closed++;
                    String result = state.getString("result");
                    if ("COMPLIANT".equals(result)) {
                        compliant++;
                    } else {
                        nonCompliant++;
                    }
                } else {
                    open++;
                }
            }

            AuditStatusInfo statusInfo = computeAuditStatus(questions, statesMap);
            double progressPercent = total > 0 ? (closed * 100.0) / total : 0;

            return new JsonObject()
                .put("auditId", auditId.toString())
                .put("auditName", instance.name())
                .put("status", statusInfo.status.name())
                .put("complianceState", statusInfo.complianceState != null ? statusInfo.complianceState.name() : null)
                .put("counts", new JsonObject()
                    .put("compliant", compliant)
                    .put("nonCompliant", nonCompliant)
                    .put("open", open)
                    .put("total", total))
                .put("progressPercent", Math.round(progressPercent * 100) / 100.0);
        });
    }

    /**
     * Compute audit status based on root question states.
     * - OPEN: no root questions closed
     * - IN_PROGRESS: at least 1 root question closed but not all
     * - CLOSED: all root questions closed
     *
     * Compliance state (only when CLOSED):
     * - COMPLIANT: all root questions compliant
     * - NON_COMPLIANT: at least 1 finding
     */
    private AuditStatusInfo computeAuditStatus(List<AuditQuestion> questions,
                                                Map<UUID, QuestionComplianceState> statesMap) {
        if (questions.isEmpty()) {
            return new AuditStatusInfo(AuditInstance.AuditStatus.OPEN, null);
        }

        // Build question tree to get aggregated states for root questions
        JsonArray questionsTree = buildQuestionTree(questions, statesMap);

        int totalRoots = questionsTree.size();
        int closedRoots = 0;
        boolean hasNonCompliant = false;

        for (int i = 0; i < questionsTree.size(); i++) {
            JsonObject rootQuestion = questionsTree.getJsonObject(i);
            JsonObject state = rootQuestion.getJsonObject("complianceState");

            if (state != null && state.getBoolean("closed", false)) {
                closedRoots++;
                String result = state.getString("result");
                if ("NON_COMPLIANT".equals(result)) {
                    hasNonCompliant = true;
                }
            }
        }

        if (totalRoots == 0) {
            return new AuditStatusInfo(AuditInstance.AuditStatus.OPEN, null);
        }

        if (closedRoots == 0) {
            return new AuditStatusInfo(AuditInstance.AuditStatus.OPEN, null);
        } else if (closedRoots < totalRoots) {
            return new AuditStatusInfo(AuditInstance.AuditStatus.IN_PROGRESS, null);
        } else {
            // All closed
            AuditInstance.ComplianceState compliance = hasNonCompliant
                ? AuditInstance.ComplianceState.NON_COMPLIANT
                : AuditInstance.ComplianceState.COMPLIANT;
            return new AuditStatusInfo(AuditInstance.AuditStatus.CLOSED, compliance);
        }
    }

    private record AuditStatusInfo(AuditInstance.AuditStatus status, AuditInstance.ComplianceState complianceState) {}

    private Map<UUID, List<AuditQuestion>> buildChildrenMap(List<AuditQuestion> questions) {
        Map<UUID, List<AuditQuestion>> childrenMap = new HashMap<>();
        for (AuditQuestion q : questions) {
            if (q.parentId() != null) {
                childrenMap.computeIfAbsent(q.parentId(), k -> new ArrayList<>()).add(q);
            }
        }
        return childrenMap;
    }

    /**
     * Build a nested tree structure from a flat list of questions with compliance states
     */
    private JsonArray buildQuestionTree(List<AuditQuestion> questions, Map<UUID, QuestionComplianceState> statesMap) {
        // Group questions by parent ID
        Map<UUID, List<AuditQuestion>> childrenMap = new HashMap<>();
        List<AuditQuestion> rootQuestions = new ArrayList<>();

        for (AuditQuestion q : questions) {
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
        for (AuditQuestion root : rootQuestions) {
            result.add(buildQuestionNode(root, childrenMap, statesMap));
        }
        return result;
    }

    /**
     * Build a question node with aggregated compliance state.
     * For leaf questions: use actual compliance state
     * For parent questions: aggregate from children
     *   - All children compliant -> COMPLIANT
     *   - At least one non-compliant -> NON_COMPLIANT
     *   - Not all children closed -> still open
     */
    private JsonObject buildQuestionNode(AuditQuestion question,
                                         Map<UUID, List<AuditQuestion>> childrenMap,
                                         Map<UUID, QuestionComplianceState> statesMap) {
        JsonObject node = question.toJson();

        List<AuditQuestion> children = childrenMap.get(question.id());
        boolean hasChildren = children != null && !children.isEmpty();

        if (hasChildren) {
            // Sort children by sort order
            children.sort((a, b) -> Integer.compare(a.sortOrder(), b.sortOrder()));

            JsonArray childrenArray = new JsonArray();
            for (AuditQuestion child : children) {
                childrenArray.add(buildQuestionNode(child, childrenMap, statesMap));
            }
            node.put("children", childrenArray);

            // Compute aggregated compliance state from children
            JsonObject aggregatedState = computeAggregatedComplianceState(childrenArray);
            node.put("complianceState", aggregatedState);
        } else {
            node.put("children", new JsonArray());

            // Leaf question: use actual compliance state
            QuestionComplianceState state = statesMap.get(question.id());
            if (state != null) {
                node.put("complianceState", state.toJson());
            }
        }

        return node;
    }

    /**
     * Compute aggregated compliance state from children.
     * - If all children closed and compliant -> COMPLIANT
     * - If any child non-compliant -> NON_COMPLIANT (aggregate worst outcome)
     * - If not all children closed -> open
     */
    private JsonObject computeAggregatedComplianceState(JsonArray children) {
        int totalLeaves = 0;
        int closedLeaves = 0;
        boolean hasNonCompliant = false;
        String worstOutcome = null;

        for (int i = 0; i < children.size(); i++) {
            JsonObject child = children.getJsonObject(i);
            JsonObject childState = child.getJsonObject("complianceState");
            JsonArray grandchildren = child.getJsonArray("children");

            // If child has children, it's already aggregated
            // Otherwise, it's a leaf
            if (grandchildren == null || grandchildren.isEmpty()) {
                totalLeaves++;
                if (childState != null && childState.getBoolean("closed", false)) {
                    closedLeaves++;
                    String result = childState.getString("result");
                    if ("NON_COMPLIANT".equals(result)) {
                        hasNonCompliant = true;
                        String outcome = childState.getString("outcome");
                        worstOutcome = getWorstOutcome(worstOutcome, outcome);
                    }
                }
            } else {
                // Child is a parent with aggregated state
                if (childState != null) {
                    // Recursively count from aggregated state
                    Boolean childClosed = childState.getBoolean("closed");
                    if (childClosed != null && childClosed) {
                        String result = childState.getString("result");
                        if ("NON_COMPLIANT".equals(result)) {
                            hasNonCompliant = true;
                            String outcome = childState.getString("outcome");
                            worstOutcome = getWorstOutcome(worstOutcome, outcome);
                        }
                    }
                    // Add leaf counts from aggregated
                    Integer childTotal = childState.getInteger("totalLeaves", 0);
                    Integer childClosed2 = childState.getInteger("closedLeaves", 0);
                    totalLeaves += childTotal;
                    closedLeaves += childClosed2;
                }
            }
        }

        JsonObject aggregated = new JsonObject()
            .put("totalLeaves", totalLeaves)
            .put("closedLeaves", closedLeaves);

        if (totalLeaves == 0) {
            aggregated.put("closed", false);
        } else if (closedLeaves < totalLeaves) {
            aggregated.put("closed", false);
        } else {
            // All closed
            aggregated.put("closed", true);
            if (hasNonCompliant) {
                aggregated.put("result", "NON_COMPLIANT");
                aggregated.put("outcome", worstOutcome);
            } else {
                aggregated.put("result", "COMPLIANT");
            }
        }

        return aggregated;
    }

    /**
     * Determine worst outcome: LEVEL_1 > LEVEL_2 > RECOMMENDATION
     */
    private String getWorstOutcome(String current, String newOutcome) {
        if (current == null) return newOutcome;
        if (newOutcome == null) return current;

        int currentRank = outcomeRank(current);
        int newRank = outcomeRank(newOutcome);
        return currentRank >= newRank ? current : newOutcome;
    }

    private int outcomeRank(String outcome) {
        return switch (outcome) {
            case "LEVEL_1" -> 3;
            case "LEVEL_2" -> 2;
            case "RECOMMENDATION" -> 1;
            default -> 0;
        };
    }
}
