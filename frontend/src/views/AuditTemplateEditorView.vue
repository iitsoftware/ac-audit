<template>
  <div>
    <!-- Existing template code -->
    <HeaderComponent />
    <ContentComponent />
    <FooterComponent />
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import HeaderComponent from '../components/HeaderComponent.vue';
import ContentComponent from '../components/ContentComponent.vue';
import FooterComponent from '../components/FooterComponent.vue';

export default defineComponent({
  components: {
    HeaderComponent,
    ContentComponent,
    FooterComponent
  }
});
</script>

<style scoped>
/* Existing styles */
</style>
