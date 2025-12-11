<script setup lang="ts">
import { computed } from 'vue'
import type { TemplateQuestion, AuditQuestion } from '@/api/client'

type Question = TemplateQuestion | AuditQuestion

const props = defineProps<{
  question: Question
  depth?: number
}>()

const slots = defineSlots<{
  default(props: { question: Question; depth: number }): any
}>()

const currentDepth = computed(() => props.depth ?? 0)
const indentStyle = computed(() => ({
  marginLeft: `${currentDepth.value * 24}px`
}))
</script>

<template>
  <div class="question-tree-node" :style="indentStyle">
    <div class="node-content">
      <slot :question="question" :depth="currentDepth" />
    </div>
    <QuestionTreeNode
      v-for="child in (question as any).children"
      :key="child.id"
      :question="child"
      :depth="currentDepth + 1"
    >
      <template #default="slotProps">
        <slot v-bind="slotProps" />
      </template>
    </QuestionTreeNode>
  </div>
</template>

<style scoped>
.question-tree-node {
  transition: margin-left 0.2s ease;
}
</style>
