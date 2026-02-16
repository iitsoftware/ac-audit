<template>
  <div>
    <!-- Existing template code -->
    <OrganizationList :organizations="filteredOrganizations" />
  </div>
</template>

<script>
import { defineComponent, computed } from 'vue';
import OrganizationList from '../components/OrganizationList.vue';

export default defineComponent({
  components: {
    OrganizationList
  },
  props: {
    organizations: Array
  },
  setup(props) {
    const filteredOrganizations = computed(() => {
      // Implement optimized filtering logic
      return props.organizations.filter(org => org.active);
    });

    return {
      filteredOrganizations
    };
  }
});
</script>

<style scoped>
/* Existing styles */
</style>
