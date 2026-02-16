<template>
  <div>
    <TemplateHeader />
    <TemplateBody />
    <TemplateFooter />
  </div>
</template>

<script>
import { defineComponent } from 'vue';
import TemplateHeader from '@/components/TemplateHeader.vue';
import TemplateBody from '@/components/TemplateBody.vue';
import TemplateFooter from '@/components/TemplateFooter.vue';

export default defineComponent({
  components: {
    TemplateHeader,
    TemplateBody,
    TemplateFooter
  }
});
</script>
