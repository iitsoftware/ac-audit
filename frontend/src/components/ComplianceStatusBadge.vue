<script setup lang="ts">
import { computed } from 'vue'
import Tag from 'primevue/tag'
import type { QuestionComplianceState } from '@/api/client'

const props = defineProps<{
  state: QuestionComplianceState | null | undefined
}>()

const info = computed(() => {
  if (!props.state || !props.state.closed) {
    return { label: 'Open', severity: 'secondary' }
  }
  if (props.state.result === 'COMPLIANT') {
    return { label: 'Compliant', severity: 'success' }
  }
  // Non-compliant with outcome
  const outcomeLabels: Record<string, string> = {
    'LEVEL_1': 'Level 1',
    'LEVEL_2': 'Level 2',
    'RECOMMENDATION': 'Recommendation'
  }
  const label = props.state.outcome ? outcomeLabels[props.state.outcome] : 'Non-Compliant'
  return { label, severity: 'danger' }
})
</script>

<template>
  <Tag :value="info.label" :severity="info.severity" />
</template>
