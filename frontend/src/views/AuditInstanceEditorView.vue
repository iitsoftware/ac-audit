<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auditInstanceApi, auditTemplateApi, type AuditInstance, type AuditQuestion, type AuditQuestionCreate, type QuestionComplianceStateUpdate, type ComplianceResult, type ComplianceOutcome, type AuditProgress, type AuditTemplate } from '@/api/client'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import Dropdown from 'primevue/dropdown'
import { useToast } from 'primevue/usetoast'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const auditId = computed(() => route.params.id as string)
const audit = ref<AuditInstance | null>(null)
const template = ref<AuditTemplate | null>(null)
const progress = ref<AuditProgress | null>(null)
const expandedNodes = ref<Set<string>>(new Set())

// Question dialog
const questionDialogVisible = ref(false)
const questionForm = ref<AuditQuestionCreate>({
  questionText: '',
  description: ''
})
const parentQuestionId = ref<string | null>(null)
const parentQuestionText = ref<string>('')

// Compliance dialog
const complianceDialogVisible = ref(false)
const selectedQuestion = ref<AuditQuestion | null>(null)
const complianceForm = ref<{
  closed: boolean
  result: ComplianceResult | null
  outcome: ComplianceOutcome | null
  notes: string
}>({
  closed: false,
  result: null,
  outcome: null,
  notes: ''
})

const resultOptions: { label: string; value: ComplianceResult }[] = [
  { label: 'Compliant', value: 'COMPLIANT' },
  { label: 'Non-Compliant', value: 'NON_COMPLIANT' }
]

const outcomeOptions: { label: string; value: ComplianceOutcome }[] = [
  { label: 'Level 1', value: 'LEVEL_1' },
  { label: 'Level 2', value: 'LEVEL_2' },
  { label: 'Recommendation', value: 'RECOMMENDATION' }
]

const loadAudit = async () => {
  try {
    const response = await auditInstanceApi.getById(auditId.value)
    audit.value = response.data
    // Load template if audit has one
    if (audit.value?.templateId) {
      try {
        const templateResponse = await auditTemplateApi.getById(audit.value.templateId)
        template.value = templateResponse.data
      } catch (e) {
        // Template may have been deleted
        template.value = null
      }
    }
    // Expand all nodes by default
    if (audit.value?.questions) {
      expandAllNodes(audit.value.questions)
    }
    loadProgress()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load audit', life: 3000 })
  }
}

const expandAllNodes = (qs: AuditQuestion[]) => {
  for (const q of qs) {
    if (q.children && q.children.length > 0) {
      expandedNodes.value.add(q.id)
      expandAllNodes(q.children)
    }
  }
}

const toggleNode = (id: string) => {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

const isExpanded = (id: string) => expandedNodes.value.has(id)

const hasChildren = (question: AuditQuestion) => {
  return question.children && question.children.length > 0
}

const getQuestionProgress = (question: AuditQuestion) => {
  const state = question.complianceState
  if (!state) return 0
  const total = state.totalLeaves || 0
  const closed = state.closedLeaves || 0
  return total > 0 ? (closed * 100) / total : 0
}

const loadProgress = async () => {
  try {
    const response = await auditInstanceApi.getProgress(auditId.value)
    progress.value = response.data
  } catch (error) {
    console.error('Failed to load progress')
  }
}

const openComplianceDialog = (question: AuditQuestion) => {
  if (hasChildren(question)) {
    toast.add({ severity: 'info', summary: 'Info', detail: 'Compliance state for parent questions is computed from sub-questions', life: 3000 })
    return
  }
  selectedQuestion.value = question
  const state = question.complianceState
  complianceForm.value = {
    closed: state?.closed || false,
    result: state?.result || null,
    outcome: state?.outcome || null,
    notes: state?.notes || ''
  }
  complianceDialogVisible.value = true
}

const saveComplianceState = async () => {
  if (!selectedQuestion.value) return

  // Validation
  if (complianceForm.value.closed && !complianceForm.value.result) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Please select a result when closing a question', life: 3000 })
    return
  }
  if (complianceForm.value.result === 'NON_COMPLIANT' && !complianceForm.value.outcome) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Please select an outcome for non-compliant questions', life: 3000 })
    return
  }

  try {
    const data: QuestionComplianceStateUpdate = {
      closed: complianceForm.value.closed,
      result: complianceForm.value.closed ? complianceForm.value.result : null,
      outcome: complianceForm.value.result === 'NON_COMPLIANT' ? complianceForm.value.outcome : null,
      notes: complianceForm.value.notes || null
    }
    await auditInstanceApi.updateCompliance(auditId.value, selectedQuestion.value.id, data)
    toast.add({ severity: 'success', summary: 'Updated', detail: 'Compliance state updated', life: 2000 })
    complianceDialogVisible.value = false
    loadAudit()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to update compliance state', life: 3000 })
  }
}

const getComplianceTagInfo = (question: AuditQuestion, showOutcome = true) => {
  const state = question.complianceState
  if (!state || !state.closed) {
    return { label: 'Open', severity: 'secondary', icon: 'pi pi-circle' }
  }
  if (state.result === 'COMPLIANT') {
    return { label: 'Compliant', severity: 'success', icon: 'pi pi-check-circle' }
  }
  // Non-compliant - show outcome only for leaf questions
  if (showOutcome && state.outcome) {
    const outcomeLabels: Record<string, string> = {
      'LEVEL_1': 'Level 1',
      'LEVEL_2': 'Level 2',
      'RECOMMENDATION': 'Recommendation'
    }
    return { label: outcomeLabels[state.outcome], severity: 'danger', icon: 'pi pi-times-circle' }
  }
  return { label: 'Non-Compliant', severity: 'danger', icon: 'pi pi-times-circle' }
}

const openNewQuestionDialog = (parentId: string | null = null, parentText: string = '') => {
  questionForm.value = {
    questionText: '',
    description: ''
  }
  parentQuestionId.value = parentId
  parentQuestionText.value = parentText
  questionDialogVisible.value = true
}

const addQuestion = async () => {
  if (!questionForm.value.questionText.trim()) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Question text is required', life: 3000 })
    return
  }
  try {
    const data: AuditQuestionCreate = {
      ...questionForm.value,
      parentId: parentQuestionId.value
    }
    await auditInstanceApi.addQuestion(auditId.value, data)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Question added', life: 3000 })
    questionDialogVisible.value = false
    loadAudit()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to add question', life: 3000 })
  }
}

const deleteQuestion = async (question: AuditQuestion) => {
  if (!confirm(`Delete question "${question.questionText}"?\n\nThis will also delete all sub-questions.`)) return
  try {
    await auditInstanceApi.deleteQuestion(auditId.value, question.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Question deleted', life: 3000 })
    loadAudit()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete question', life: 3000 })
  }
}

const getStatusInfo = () => {
  if (!progress.value) return { label: 'Loading...', severity: 'secondary' }

  switch (progress.value.status) {
    case 'OPEN':
      return { label: 'Open', severity: 'secondary' }
    case 'IN_PROGRESS':
      return { label: 'In Progress', severity: 'info' }
    case 'CLOSED':
      if (progress.value.complianceState === 'COMPLIANT') {
        return { label: 'Compliant', severity: 'success' }
      } else {
        return { label: 'Non-Compliant', severity: 'danger' }
      }
    default:
      return { label: progress.value.status, severity: 'secondary' }
  }
}

onMounted(() => {
  loadAudit()
})
</script>

<template>
  <div class="flex flex-column gap-3">
    <!-- Audit Info Card -->
    <Card v-if="audit" class="shadow-2">
      <template #content>
        <div class="flex align-items-center justify-content-between flex-wrap gap-3">
          <div class="flex align-items-center gap-3">
            <Button
              icon="pi pi-arrow-left"
              rounded
              text
              severity="secondary"
              @click="router.push({ name: 'audit-instances' })"
              v-tooltip.bottom="'Back to Audits'"
            />
            <div>
              <div class="flex align-items-center gap-2 flex-wrap">
                <h2 class="m-0 text-2xl font-semibold">{{ audit.name }}</h2>
                <Tag :value="getStatusInfo().label" :severity="getStatusInfo().severity" />
              </div>
              <div class="flex align-items-center gap-3 mt-2 text-500">
                <span v-if="audit.description">{{ audit.description }}</span>
                <span v-if="audit.dueDate" class="flex align-items-center gap-1">
                  <i class="pi pi-calendar"></i> Due: {{ audit.dueDate }}
                </span>
              </div>
            </div>
          </div>

          <!-- Progress Section -->
          <div v-if="progress" style="width: 200px">
            <ProgressBar :value="progress.progressPercent" :showValue="false" style="height: 10px" />
            <div class="flex justify-content-between mt-1 text-xs text-500">
              <span><i class="pi pi-check-circle text-green-500 mr-1"></i>{{ progress.counts?.compliant || 0 }}</span>
              <span><i class="pi pi-times-circle text-red-500 mr-1"></i>{{ progress.counts?.nonCompliant || 0 }}</span>
              <span><i class="pi pi-circle text-400 mr-1"></i>{{ progress.counts?.open || 0 }}</span>
            </div>
          </div>
        </div>
      </template>
    </Card>

    <!-- Questions Card -->
    <Card class="shadow-2">
      <template #content>
        <div class="flex justify-content-between align-items-center mb-4">
          <h3 class="m-0 text-xl">Audit Questions</h3>
          <Button
            icon="pi pi-plus"
            label="Add Custom Question"
            severity="secondary"
            outlined
            @click="openNewQuestionDialog(null, '')"
          />
        </div>

        <div v-if="!audit?.questions?.length" class="text-center p-6 surface-100 border-round">
          <i class="pi pi-inbox text-4xl text-400 mb-3"></i>
          <p class="text-500 m-0">No questions yet. Add custom questions or create the audit from a template.</p>
        </div>

        <!-- Question Tree -->
        <div v-else class="question-tree">
          <template v-for="question in audit.questions" :key="question.id">
            <div class="question-node">
              <!-- Question Item -->
              <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2">
                <div class="flex align-items-start gap-3">
                  <!-- Expand/Collapse Toggle -->
                  <Button
                    v-if="question.children && question.children.length > 0"
                    :icon="isExpanded(question.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                    text
                    rounded
                    size="small"
                    class="flex-shrink-0 mt-1"
                    @click="toggleNode(question.id)"
                  />
                  <div v-else class="w-2rem flex-shrink-0"></div>

                  <!-- Question Content -->
                  <div class="flex-grow-1">
                    <div class="mb-1">
                      <span
                        class="font-medium text-lg"
                        :class="{ 'cursor-pointer hover:text-primary': !hasChildren(question) }"
                        @click="!hasChildren(question) && openComplianceDialog(question)"
                      >{{ question.questionText }}</span>
                    </div>
                    <div v-if="question.description" class="text-500 text-sm mb-2">{{ question.description }}</div>
                    <div v-if="question.complianceState?.notes" class="text-600 text-sm mb-2 font-italic">{{ question.complianceState.notes }}</div>

                    <!-- Tags line -->
                    <div class="flex align-items-center justify-content-between">
                      <div class="flex align-items-center gap-2">
                        <Tag v-if="question.templateQuestionId && template" :value="template.name" severity="secondary" class="text-xs" />
                        <Tag
                          :value="getComplianceTagInfo(question, !hasChildren(question)).label"
                          :severity="getComplianceTagInfo(question, !hasChildren(question)).severity"
                          :icon="getComplianceTagInfo(question, !hasChildren(question)).icon"
                        />
                      </div>
                      <ProgressBar v-if="hasChildren(question)" :value="getQuestionProgress(question)" :showValue="false" style="width: 80px; height: 6px" />
                    </div>
                  </div>

                  <!-- Actions -->
                  <div class="flex gap-1 flex-shrink-0">
                    <Button
                      icon="pi pi-plus"
                      text
                      rounded
                      size="small"
                      severity="success"
                      v-tooltip.bottom="'Add Sub-Question'"
                      @click="openNewQuestionDialog(question.id, question.questionText)"
                    />
                    <Button
                      icon="pi pi-trash"
                      text
                      rounded
                      size="small"
                      severity="danger"
                      v-tooltip.bottom="'Delete'"
                      @click="deleteQuestion(question)"
                    />
                  </div>
                </div>
              </div>

              <!-- Children (Level 1) -->
              <div v-if="question.children && question.children.length > 0 && isExpanded(question.id)" class="children-container ml-5 pl-3 border-left-2 border-300">
                <template v-for="child in question.children" :key="child.id">
                  <div class="question-node">
                    <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2">
                      <div class="flex align-items-start gap-3">
                        <!-- Expand/Collapse Toggle -->
                        <Button
                          v-if="child.children && child.children.length > 0"
                          :icon="isExpanded(child.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                          text
                          rounded
                          size="small"
                          class="flex-shrink-0 mt-1"
                          @click="toggleNode(child.id)"
                        />
                        <div v-else class="w-2rem flex-shrink-0"></div>

                        <!-- Question Content -->
                        <div class="flex-grow-1">
                          <div class="mb-1">
                            <span
                              class="font-medium"
                              :class="{ 'cursor-pointer hover:text-primary': !hasChildren(child) }"
                              @click="!hasChildren(child) && openComplianceDialog(child)"
                            >{{ child.questionText }}</span>
                          </div>
                          <div v-if="child.description" class="text-500 text-sm mb-2">{{ child.description }}</div>
                          <div v-if="child.complianceState?.notes" class="text-600 text-sm mb-2 font-italic">{{ child.complianceState.notes }}</div>

                          <!-- Tags line -->
                          <div class="flex align-items-center justify-content-between">
                            <div class="flex align-items-center gap-2">
                              <Tag v-if="child.templateQuestionId && template" :value="template.name" severity="secondary" class="text-xs" />
                              <Tag
                                :value="getComplianceTagInfo(child, !hasChildren(child)).label"
                                :severity="getComplianceTagInfo(child, !hasChildren(child)).severity"
                                :icon="getComplianceTagInfo(child, !hasChildren(child)).icon"
                              />
                            </div>
                            <ProgressBar v-if="hasChildren(child)" :value="getQuestionProgress(child)" :showValue="false" style="width: 80px; height: 6px" />
                          </div>
                        </div>

                        <!-- Actions -->
                        <div class="flex gap-1 flex-shrink-0">
                          <Button
                            icon="pi pi-plus"
                            text
                            rounded
                            size="small"
                            severity="success"
                            v-tooltip.bottom="'Add Sub-Question'"
                            @click="openNewQuestionDialog(child.id, child.questionText)"
                          />
                          <Button
                            icon="pi pi-trash"
                            text
                            rounded
                            size="small"
                            severity="danger"
                            v-tooltip.bottom="'Delete'"
                            @click="deleteQuestion(child)"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- Children (Level 2) -->
                    <div v-if="child.children && child.children.length > 0 && isExpanded(child.id)" class="children-container ml-5 pl-3 border-left-2 border-300">
                      <template v-for="grandchild in child.children" :key="grandchild.id">
                        <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2">
                          <div class="flex align-items-start gap-3">
                            <div class="w-2rem flex-shrink-0"></div>

                            <!-- Question Content -->
                            <div class="flex-grow-1">
                              <div class="mb-1">
                                <span
                                  class="font-medium"
                                  :class="{ 'cursor-pointer hover:text-primary': !hasChildren(grandchild) }"
                                  @click="!hasChildren(grandchild) && openComplianceDialog(grandchild)"
                                >{{ grandchild.questionText }}</span>
                              </div>
                              <div v-if="grandchild.description" class="text-500 text-sm mb-2">{{ grandchild.description }}</div>
                              <div v-if="grandchild.complianceState?.notes" class="text-600 text-sm mb-2 font-italic">{{ grandchild.complianceState.notes }}</div>

                              <!-- Tags line -->
                              <div class="flex align-items-center justify-content-between">
                                <div class="flex align-items-center gap-2">
                                  <Tag v-if="grandchild.templateQuestionId && template" :value="template.name" severity="secondary" class="text-xs" />
                                  <Tag
                                    :value="getComplianceTagInfo(grandchild, !hasChildren(grandchild)).label"
                                    :severity="getComplianceTagInfo(grandchild, !hasChildren(grandchild)).severity"
                                    :icon="getComplianceTagInfo(grandchild, !hasChildren(grandchild)).icon"
                                  />
                                </div>
                                <ProgressBar v-if="hasChildren(grandchild)" :value="getQuestionProgress(grandchild)" :showValue="false" style="width: 80px; height: 6px" />
                              </div>
                            </div>

                            <!-- Actions -->
                            <div class="flex gap-1 flex-shrink-0">
                              <Button
                                icon="pi pi-plus"
                                text
                                rounded
                                size="small"
                                severity="success"
                                v-tooltip.bottom="'Add Sub-Question'"
                                @click="openNewQuestionDialog(grandchild.id, grandchild.questionText)"
                              />
                              <Button
                                icon="pi pi-trash"
                                text
                                rounded
                                size="small"
                                severity="danger"
                                v-tooltip.bottom="'Delete'"
                                @click="deleteQuestion(grandchild)"
                              />
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </template>
    </Card>
  </div>

  <!-- Question Dialog -->
  <Dialog
    v-model:visible="questionDialogVisible"
    header="Add Custom Question"
    modal
    :style="{ width: '550px' }"
    :draggable="false"
  >
    <div class="flex flex-column gap-4">
      <div v-if="parentQuestionText" class="surface-100 border-round p-3">
        <span class="text-500 text-sm">Adding sub-question to:</span>
        <p class="m-0 mt-1 font-medium">{{ parentQuestionText }}</p>
      </div>

      <div class="flex flex-column gap-2">
        <label for="question-text" class="font-medium">Question Text <span class="text-red-500">*</span></label>
        <Textarea
          id="question-text"
          v-model="questionForm.questionText"
          rows="3"
          placeholder="Enter the question text..."
          class="w-full"
          autoResize
        />
      </div>

      <div class="flex flex-column gap-2">
        <label for="question-description" class="font-medium">Description</label>
        <Textarea
          id="question-description"
          v-model="questionForm.description"
          rows="2"
          placeholder="Optional: Add additional context or instructions..."
          class="w-full"
          autoResize
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-content-end gap-2">
        <Button label="Cancel" severity="secondary" text @click="questionDialogVisible = false" />
        <Button label="Add Question" icon="pi pi-check" @click="addQuestion" />
      </div>
    </template>
  </Dialog>

  <!-- Compliance Dialog -->
  <Dialog
    v-model:visible="complianceDialogVisible"
    header="Update Compliance State"
    modal
    :style="{ width: '500px' }"
    :draggable="false"
  >
    <div class="flex flex-column gap-4">
      <div class="surface-100 border-round p-3">
        <span class="text-500 text-sm">Question:</span>
        <p class="m-0 mt-1 font-medium">{{ selectedQuestion?.questionText }}</p>
      </div>

      <div class="flex align-items-center gap-2">
        <Checkbox id="compliance-closed" v-model="complianceForm.closed" binary />
        <label for="compliance-closed" class="font-medium">Close this question</label>
      </div>

      <div v-if="complianceForm.closed" class="flex flex-column gap-2">
        <label class="font-medium">Result <span class="text-red-500">*</span></label>
        <Dropdown
          v-model="complianceForm.result"
          :options="resultOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Select result"
          class="w-full"
        />
      </div>

      <div v-if="complianceForm.closed && complianceForm.result === 'NON_COMPLIANT'" class="flex flex-column gap-2">
        <label class="font-medium">Outcome <span class="text-red-500">*</span></label>
        <Dropdown
          v-model="complianceForm.outcome"
          :options="outcomeOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Select outcome"
          class="w-full"
        />
      </div>

      <div class="flex flex-column gap-2">
        <label for="compliance-notes" class="font-medium">Notes</label>
        <Textarea
          id="compliance-notes"
          v-model="complianceForm.notes"
          rows="3"
          placeholder="Add notes..."
          class="w-full"
          autoResize
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-content-end gap-2">
        <Button label="Cancel" severity="secondary" text @click="complianceDialogVisible = false" />
        <Button label="Save" icon="pi pi-check" @click="saveComplianceState" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.question-tree {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
}

.children-container {
  margin-top: 0.5rem;
}

.question-item {
  transition: box-shadow 0.15s ease;
}

.question-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.cursor-pointer {
  cursor: pointer;
}
</style>
