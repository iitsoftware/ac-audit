<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { auditInstanceApi, auditTemplateApi, organizationApi, type AuditInstance, type AuditTemplate, type Company, type Department, type AuditStatus, type AuditProgress } from '@/api/client'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Dropdown from 'primevue/dropdown'
import Calendar from 'primevue/calendar'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import { useToast } from 'primevue/usetoast'

const router = useRouter()
const toast = useToast()

const audits = ref<AuditInstance[]>([])
const companies = ref<Company[]>([])
const departments = ref<Department[]>([])
const templates = ref<AuditTemplate[]>([])
const auditProgressMap = ref<Record<string, AuditProgress>>({})

// Filters
const filterCompany = ref<string | null>(null)
const filterDepartment = ref<string | null>(null)
const filterStatus = ref<AuditStatus | null>(null)

// Dialog
const dialogVisible = ref(false)
const auditForm = ref({
  departmentId: '',
  templateId: null as string | null,
  name: '',
  description: '',
  dueDate: null as Date | null
})
const selectedCompanyForForm = ref<string | null>(null)
const departmentsForForm = ref<Department[]>([])

const statusOptions: { label: string; value: AuditStatus }[] = [
  { label: 'Open', value: 'OPEN' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Closed', value: 'CLOSED' }
]

const loadAudits = async () => {
  try {
    const params: any = {}
    if (filterDepartment.value) params.departmentId = filterDepartment.value

    const response = await auditInstanceApi.list(params)
    audits.value = response.data

    // Load progress for each audit
    for (const audit of audits.value) {
      try {
        const progressResponse = await auditInstanceApi.getProgress(audit.id)
        auditProgressMap.value[audit.id] = progressResponse.data
      } catch (e) {
        // ignore
      }
    }

    // Filter by status client-side (since status is computed)
    if (filterStatus.value) {
      audits.value = audits.value.filter(a => {
        const progress = auditProgressMap.value[a.id]
        return progress?.status === filterStatus.value
      })
    }
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load audits', life: 3000 })
  }
}

const loadCompanies = async () => {
  try {
    const response = await organizationApi.listCompanies(100, 0, true)
    companies.value = response.data
  } catch (error) {
    console.error('Failed to load companies')
  }
}

const loadTemplates = async () => {
  try {
    const response = await auditTemplateApi.list(100, 0, true)
    templates.value = response.data
  } catch (error) {
    console.error('Failed to load templates')
  }
}

const loadDepartmentsForFilter = async () => {
  if (!filterCompany.value) {
    departments.value = []
    filterDepartment.value = null
    return
  }
  try {
    const response = await organizationApi.listDepartments(filterCompany.value, 100, 0, true)
    departments.value = response.data
  } catch (error) {
    console.error('Failed to load departments')
  }
}

const loadDepartmentsForForm = async () => {
  if (!selectedCompanyForForm.value) {
    departmentsForForm.value = []
    auditForm.value.departmentId = ''
    return
  }
  try {
    const response = await organizationApi.listDepartments(selectedCompanyForForm.value, 100, 0, true)
    departmentsForForm.value = response.data
  } catch (error) {
    console.error('Failed to load departments')
  }
}

const openNewAuditDialog = () => {
  auditForm.value = {
    departmentId: '',
    templateId: null,
    name: '',
    description: '',
    dueDate: null
  }
  selectedCompanyForForm.value = null
  departmentsForForm.value = []
  dialogVisible.value = true
}

const createAudit = async () => {
  if (!auditForm.value.departmentId) {
    toast.add({ severity: 'warn', summary: 'Warning', detail: 'Please select a department', life: 3000 })
    return
  }
  try {
    const payload = {
      ...auditForm.value,
      dueDate: auditForm.value.dueDate?.toISOString().split('T')[0] || null
    }
    const response = await auditInstanceApi.create(payload)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Audit created', life: 3000 })
    dialogVisible.value = false
    router.push({ name: 'audit-instance-editor', params: { id: response.data.id } })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to create audit', life: 3000 })
  }
}

const openAudit = (audit: AuditInstance) => {
  router.push({ name: 'audit-instance-editor', params: { id: audit.id } })
}

const deleteAudit = async (audit: AuditInstance) => {
  if (!confirm(`Delete audit "${audit.name}"?`)) return
  try {
    await auditInstanceApi.delete(audit.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Audit deleted', life: 3000 })
    loadAudits()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete audit', life: 3000 })
  }
}

const getStatusInfo = (auditId: string) => {
  const progress = auditProgressMap.value[auditId]
  if (!progress) return { label: 'Loading...', severity: 'secondary' }

  switch (progress.status) {
    case 'OPEN':
      return { label: 'Open', severity: 'secondary' }
    case 'IN_PROGRESS':
      return { label: 'In Progress', severity: 'info' }
    case 'CLOSED':
      if (progress.complianceState === 'COMPLIANT') {
        return { label: 'Compliant', severity: 'success' }
      } else {
        return { label: 'Non-Compliant', severity: 'danger' }
      }
    default:
      return { label: progress.status, severity: 'secondary' }
  }
}

onMounted(() => {
  loadCompanies()
  loadTemplates()
  loadAudits()
})
</script>

<template>
  <Card>
    <template #title>
      <div class="flex justify-content-between align-items-center">
        <span>Audits</span>
        <Button icon="pi pi-plus" label="New Audit" @click="openNewAuditDialog" />
      </div>
    </template>
    <template #content>
      <!-- Filters -->
      <div class="flex gap-3 mb-3">
        <div class="flex flex-column gap-1">
          <label class="text-sm text-500">Company</label>
          <Dropdown v-model="filterCompany" :options="companies" optionLabel="name" optionValue="id"
            placeholder="All Companies" showClear @change="loadDepartmentsForFilter" style="width: 200px" />
        </div>
        <div class="flex flex-column gap-1">
          <label class="text-sm text-500">Department</label>
          <Dropdown v-model="filterDepartment" :options="departments" optionLabel="name" optionValue="id"
            placeholder="All Departments" showClear :disabled="!filterCompany" @change="loadAudits" style="width: 200px" />
        </div>
        <div class="flex flex-column gap-1">
          <label class="text-sm text-500">Status</label>
          <Dropdown v-model="filterStatus" :options="statusOptions" optionLabel="label" optionValue="value"
            placeholder="All Statuses" showClear @change="loadAudits" style="width: 150px" />
        </div>
      </div>

      <DataTable :value="audits" responsiveLayout="scroll" stripedRows>
        <Column field="name" header="Name" sortable>
          <template #body="{ data }">
            <span class="cursor-pointer hover:text-primary" @click="openAudit(data)">{{ data.name }}</span>
          </template>
        </Column>
        <Column header="Status" style="width: 140px">
          <template #body="{ data }">
            <Tag :value="getStatusInfo(data.id).label" :severity="getStatusInfo(data.id).severity" />
          </template>
        </Column>
        <Column header="Progress" style="width: 150px">
          <template #body="{ data }">
            <ProgressBar :value="auditProgressMap[data.id]?.progressPercent || 0" :showValue="false" style="height: 20px" />
          </template>
        </Column>
        <Column field="dueDate" header="Due Date" style="width: 120px">
          <template #body="{ data }">
            {{ data.dueDate || '-' }}
          </template>
        </Column>
        <Column header="Actions" style="width: 80px">
          <template #body="{ data }">
            <Button icon="pi pi-trash" text rounded severity="danger" @click="deleteAudit(data)" />
          </template>
        </Column>
      </DataTable>
    </template>
  </Card>

  <!-- New Audit Dialog -->
  <Dialog v-model:visible="dialogVisible" header="New Audit" modal style="width: 500px">
    <div class="flex flex-column gap-3">
      <div class="flex flex-column gap-2">
        <label for="audit-name">Name</label>
        <InputText id="audit-name" v-model="auditForm.name" />
      </div>
      <div class="flex flex-column gap-2">
        <label for="audit-description">Description</label>
        <Textarea id="audit-description" v-model="auditForm.description" rows="2" />
      </div>
      <div class="flex flex-column gap-2">
        <label>Company</label>
        <Dropdown v-model="selectedCompanyForForm" :options="companies" optionLabel="name" optionValue="id"
          placeholder="Select Company" @change="loadDepartmentsForForm" />
      </div>
      <div class="flex flex-column gap-2">
        <label>Department</label>
        <Dropdown v-model="auditForm.departmentId" :options="departmentsForForm" optionLabel="name" optionValue="id"
          placeholder="Select Department" :disabled="!selectedCompanyForForm" />
      </div>
      <div class="flex flex-column gap-2">
        <label>Template (optional)</label>
        <Dropdown v-model="auditForm.templateId" :options="templates" optionLabel="name" optionValue="id"
          placeholder="No template - blank audit" showClear />
        <small class="text-500">Selecting a template will copy its questions to the audit</small>
      </div>
      <div class="flex flex-column gap-2">
        <label>Due Date (optional)</label>
        <Calendar v-model="auditForm.dueDate" dateFormat="yy-mm-dd" showIcon />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="dialogVisible = false" />
      <Button label="Create" @click="createAudit" />
    </template>
  </Dialog>
</template>
