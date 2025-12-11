<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auditTemplateApi, type AuditTemplate, type TemplateQuestion, type TemplateQuestionCreate } from '@/api/client'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Textarea from 'primevue/textarea'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const templateId = computed(() => route.params.id as string)
const template = ref<AuditTemplate | null>(null)
const questions = ref<TemplateQuestion[]>([])
const expandedNodes = ref<Set<string>>(new Set())

// Question dialog
const questionDialogVisible = ref(false)
const questionForm = ref<TemplateQuestionCreate>({
  questionText: '',
  description: ''
})
const parentQuestionId = ref<string | null>(null)
const parentQuestionText = ref<string>('')
const isEditingQuestion = ref(false)
const editingQuestionId = ref<string | null>(null)

const loadTemplate = async () => {
  try {
    const response = await auditTemplateApi.getById(templateId.value)
    template.value = response.data
    questions.value = response.data.questions || []
    // Expand all nodes by default
    expandAllNodes(questions.value)
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load template', life: 3000 })
  }
}

const expandAllNodes = (qs: TemplateQuestion[]) => {
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

// Question CRUD
const openNewQuestionDialog = (parentId: string | null = null, parentText: string = '') => {
  questionForm.value = {
    questionText: '',
    description: ''
  }
  parentQuestionId.value = parentId
  parentQuestionText.value = parentText
  isEditingQuestion.value = false
  editingQuestionId.value = null
  questionDialogVisible.value = true
}

const openEditQuestionDialog = (question: TemplateQuestion) => {
  questionForm.value = {
    questionText: question.questionText,
    description: question.description || ''
  }
  parentQuestionId.value = question.parentId
  parentQuestionText.value = ''
  isEditingQuestion.value = true
  editingQuestionId.value = question.id
  questionDialogVisible.value = true
}

const saveQuestion = async () => {
  if (!questionForm.value.questionText.trim()) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Question text is required', life: 3000 })
    return
  }
  try {
    const data: TemplateQuestionCreate = {
      ...questionForm.value,
      parentId: parentQuestionId.value
    }

    if (isEditingQuestion.value && editingQuestionId.value) {
      await auditTemplateApi.updateQuestion(templateId.value, editingQuestionId.value, data)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Question updated', life: 3000 })
    } else {
      await auditTemplateApi.addQuestion(templateId.value, data)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Question added', life: 3000 })
    }
    questionDialogVisible.value = false
    loadTemplate()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to save question', life: 3000 })
  }
}

const deleteQuestion = async (question: TemplateQuestion) => {
  if (!confirm(`Delete question "${question.questionText}"?\n\nThis will also delete all sub-questions.`)) return
  try {
    await auditTemplateApi.deleteQuestion(templateId.value, question.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Question deleted', life: 3000 })
    loadTemplate()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete question', life: 3000 })
  }
}

onMounted(() => {
  loadTemplate()
})
</script>

<template>
  <div class="flex flex-column gap-3">
    <!-- Header Card -->
    <Card class="shadow-2">
      <template #content>
        <div class="flex align-items-center justify-content-between">
          <div class="flex align-items-center gap-3">
            <Button
              icon="pi pi-arrow-left"
              rounded
              text
              severity="secondary"
              @click="router.push({ name: 'audit-templates' })"
              v-tooltip.bottom="'Back to Templates'"
            />
            <div>
              <h2 class="m-0 text-2xl font-semibold">{{ template?.name }}</h2>
            </div>
          </div>
          <div class="flex align-items-center gap-2">
            <Tag :value="`${questions.length} questions`" severity="secondary" icon="pi pi-list" />
          </div>
        </div>
      </template>
    </Card>

    <!-- Questions Card -->
    <Card class="shadow-2">
      <template #content>
        <div class="flex justify-content-between align-items-center mb-4">
          <h3 class="m-0 text-xl">Questions</h3>
          <Button
            icon="pi pi-plus"
            label="Add Root Question"
            @click="openNewQuestionDialog(null, '')"
          />
        </div>

        <div v-if="questions.length === 0" class="text-center p-6 surface-100 border-round">
          <i class="pi pi-inbox text-4xl text-400 mb-3"></i>
          <p class="text-500 m-0">No questions yet. Click "Add Root Question" to get started.</p>
        </div>

        <!-- Question Tree -->
        <div v-else class="question-tree">
          <template v-for="question in questions" :key="question.id">
            <div class="question-node">
              <!-- Question Item -->
              <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2 hover:surface-hover transition-colors transition-duration-150">
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
                      <span class="font-medium text-lg cursor-pointer hover:text-primary" @click="openEditQuestionDialog(question)">{{ question.questionText }}</span>
                    </div>
                    <div v-if="question.description" class="text-500 text-sm mb-2">{{ question.description }}</div>
                    <div v-if="question.children && question.children.length > 0" class="text-xs text-500">
                      <i class="pi pi-sitemap mr-1"></i>{{ question.children.length }} sub-question(s)
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
                    <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2 hover:surface-hover transition-colors transition-duration-150">
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
                            <span class="font-medium cursor-pointer hover:text-primary" @click="openEditQuestionDialog(child)">{{ child.questionText }}</span>
                          </div>
                          <div v-if="child.description" class="text-500 text-sm mb-2">{{ child.description }}</div>
                          <div v-if="child.children && child.children.length > 0" class="text-xs text-500">
                            <i class="pi pi-sitemap mr-1"></i>{{ child.children.length }} sub-question(s)
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
                        <div class="question-item surface-card border-1 surface-border border-round p-3 mb-2 hover:surface-hover transition-colors transition-duration-150">
                          <div class="flex align-items-start gap-3">
                            <div class="w-2rem flex-shrink-0"></div>
                            <!-- Question Content -->
                            <div class="flex-grow-1">
                              <div class="mb-1">
                                <span class="font-medium cursor-pointer hover:text-primary" @click="openEditQuestionDialog(grandchild)">{{ grandchild.questionText }}</span>
                              </div>
                              <div v-if="grandchild.description" class="text-500 text-sm">{{ grandchild.description }}</div>
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
    :header="isEditingQuestion ? 'Edit Question' : 'Add New Question'"
    modal
    :style="{ width: '550px' }"
    :draggable="false"
  >
    <div class="flex flex-column gap-4">
      <div v-if="parentQuestionText && !isEditingQuestion" class="surface-100 border-round p-3">
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
        <Button :label="isEditingQuestion ? 'Update' : 'Add Question'" icon="pi pi-check" @click="saveQuestion" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.question-tree {
  max-height: calc(100vh - 350px);
  overflow-y: auto;
}

.children-container {
  margin-top: 0.5rem;
}

.question-item {
  cursor: default;
}

.question-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
