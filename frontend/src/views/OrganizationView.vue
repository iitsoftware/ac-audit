<template>
  <div>
    <OrganizationList :organizations="organizations" />
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from 'vue';
import OrganizationList from '@/components/Organization/OrganizationList.vue';

export default defineComponent({
  components: {
    OrganizationList
  },
  setup() {
    const organizations = ref([]);

    onMounted(async () => {
      // Fetch organizations and manage state efficiently
      organizations.value = await fetchOrganizations();
    });

    async function fetchOrganizations() {
      // Simulate API call
      return [
        { id: 1, name: 'Organization A' },
        { id: 2, name: 'Organization B' }
      ];
    }

    return {
      organizations
    };
  }
});
</script>
