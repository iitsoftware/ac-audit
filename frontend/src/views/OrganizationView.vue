<template>
  <div>
    <OrganizationList :organizations="organizations" />
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from 'vue';
import OrganizationList from '@/components/OrganizationList.vue';

export default defineComponent({
  components: {
    OrganizationList
  },
  setup() {
    const organizations = ref([]);

    onMounted(async () => {
      // Fetch organizations data and manage state efficiently
      organizations.value = await fetchOrganizations();
    });

    async function fetchOrganizations() {
      // Implement optimized API call
      const response = await fetch('/api/organizations');
      return response.json();
    }

    return { organizations };
  }
});
</script>
