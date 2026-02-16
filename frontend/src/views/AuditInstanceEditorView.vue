<template>
  <div>
    <!-- Lazy load components to improve performance -->
    <Suspense>
      <template #default>
        <AuditDetails v-if="showDetails" />
      </template>
      <template #fallback>
        <LoadingSpinner />
      </template>
    </Suspense>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue';
import AuditDetails from '@/components/AuditDetails.vue';
import LoadingSpinner from '@/components/LoadingSpinner.vue';

export default defineComponent({
  components: {
    AuditDetails,
    LoadingSpinner
  },
  setup() {
    const showDetails = ref(false);

    // Logic to determine when to show details
    // This could be based on user interaction or data availability
    setTimeout(() => {
      showDetails.value = true;
    }, 1000);

    return { showDetails };
  }
});
</script>
