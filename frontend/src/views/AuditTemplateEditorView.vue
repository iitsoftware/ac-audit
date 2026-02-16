<template>
  <div>
    <HeaderComponent />
    <EditorComponent />
    <FooterComponent />
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import HeaderComponent from '@/components/AuditTemplate/HeaderComponent.vue';
import EditorComponent from '@/components/AuditTemplate/EditorComponent.vue';
import FooterComponent from '@/components/AuditTemplate/FooterComponent.vue';

export default defineComponent({
  components: {
    HeaderComponent,
    EditorComponent,
    FooterComponent
  }
});
</script>
