<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { auditTemplateApi, type AuditTemplate, type AuditTemplateCreate } from '@/api/client'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Card from 'primevue/card'
import { useToast } from 'primevue/usetoast'

const router = useRouter()
const toast = useToast()

const templates = ref<AuditTemplate[]>([])
const dialogVisible = ref(false)
const templateForm = ref<AuditTemplateCreate>({ name: '' })

const loadTemplates = async () => {
  try {
    const response = await auditTemplateApi.list()
    templates.value = response.data
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load templates', life: 3000 })
  }
}

const openNewTemplateDialog = () => {
  templateForm.value = { name: '' }
  dialogVisible.value = true
}

const createTemplate = async () => {
  try {
    const response = await auditTemplateApi.create(templateForm.value)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Template created', life: 3000 })
    dialogVisible.value = false
    router.push({ name: 'audit-template-editor', params: { id: response.data.id } })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to create template', life: 3000 })
  }
}

const editTemplate = (template: AuditTemplate) => {
  router.push({ name: 'audit-template-editor', params: { id: template.id } })
}

const deleteTemplate = async (template: AuditTemplate) => {
  if (!confirm(`Delete template "${template.name}"?`)) return
  try {
    await auditTemplateApi.delete(template.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Template deleted', life: 3000 })
    loadTemplates()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete template', life: 3000 })
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<template>
  <Card>
    <template #title>
      <div class="flex justify-content-between align-items-center">
        <span>Audit Templates</span>
        <Button icon="pi pi-plus" label="New Template" @click="openNewTemplateDialog" />
      </div>
    </template>
    <template #content>
      <DataTable :value="templates" responsiveLayout="scroll" stripedRows>
        <Column field="name" header="Name" sortable>
          <template #body="{ data }">
            <span class="cursor-pointer hover:text-primary" @click="editTemplate(data)">{{ data.name }}</span>
          </template>
        </Column>
        <Column header="Actions" style="width: 80px">
          <template #body="{ data }">
            <Button icon="pi pi-trash" text rounded severity="danger" @click="deleteTemplate(data)" />
          </template>
        </Column>
      </DataTable>
    </template>
  </Card>

  <Dialog v-model:visible="dialogVisible" header="New Audit Template" modal style="width: 450px">
    <div class="flex flex-column gap-3">
      <div class="flex flex-column gap-2">
        <label for="template-name">Name</label>
        <InputText id="template-name" v-model="templateForm.name" />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="dialogVisible = false" />
      <Button label="Create" @click="createTemplate" />
    </template>
  </Dialog>
</template>
