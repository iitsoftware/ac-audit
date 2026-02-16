<template>
  <ul>
    <li v-for="organization in organizations" :key="organization.id">
      {{ organization.name }}
    </li>
  </ul>
</template>

<script>
export default {
  props: {
    organizations: {
      type: Array,
      required: true
    }
  }
};
</script>
