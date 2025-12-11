<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { activityApi, type UserActivity, type UserActivityCreate } from '@/api/client'

const toast = useToast()
const activities = ref<UserActivity[]>([])
const loading = ref(true)
const showDialog = ref(false)

const newActivity = ref<UserActivityCreate>({
  userId: '',
  userName: '',
  activityType: 'ACTION',
  description: ''
})

const activityTypes = [
  { label: 'Login', value: 'LOGIN' },
  { label: 'Logout', value: 'LOGOUT' },
  { label: 'Page View', value: 'PAGE_VIEW' },
  { label: 'Action', value: 'ACTION' },
  { label: 'API Call', value: 'API_CALL' },
  { label: 'Error', value: 'ERROR' }
]

const loadActivities = async () => {
  loading.value = true
  try {
    const response = await activityApi.list(100, 0)
    activities.value = response.data.data || []
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load activities', life: 3000 })
  } finally {
    loading.value = false
  }
}

const createActivity = async () => {
  try {
    await activityApi.create(newActivity.value)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Activity logged', life: 3000 })
    showDialog.value = false
    resetForm()
    await loadActivities()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to log activity', life: 3000 })
  }
}

const resetForm = () => {
  newActivity.value = {
    userId: '',
    userName: '',
    activityType: 'ACTION',
    description: ''
  }
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString()
}

const getActivityTypeClass = (type: string) => {
  switch (type) {
    case 'LOGIN': return 'bg-green-100 text-green-700'
    case 'LOGOUT': return 'bg-gray-100 text-gray-700'
    case 'PAGE_VIEW': return 'bg-blue-100 text-blue-700'
    case 'ACTION': return 'bg-purple-100 text-purple-700'
    case 'API_CALL': return 'bg-cyan-100 text-cyan-700'
    case 'ERROR': return 'bg-red-100 text-red-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

onMounted(loadActivities)
</script>

<template>
  <div class="user-activity">
    <div class="flex justify-content-between align-items-center mb-4">
      <h1 class="text-3xl font-bold m-0">User Activity</h1>
      <Button label="Log Activity" icon="pi pi-plus" @click="showDialog = true" />
    </div>

    <DataTable
      :value="activities"
      :loading="loading"
      paginator
      :rows="10"
      :rowsPerPageOptions="[10, 25, 50]"
      stripedRows
      class="p-datatable-sm"
    >
      <Column field="userName" header="User" sortable></Column>
      <Column field="activityType" header="Type" sortable>
        <template #body="{ data }">
          <span class="badge" :class="getActivityTypeClass(data.activityType)">
            {{ data.activityType.replace('_', ' ') }}
          </span>
        </template>
      </Column>
      <Column field="description" header="Description"></Column>
      <Column field="ipAddress" header="IP Address"></Column>
      <Column field="userAgent" header="User Agent">
        <template #body="{ data }">
          <span class="text-sm text-500" :title="data.userAgent">
            {{ data.userAgent?.substring(0, 30) }}{{ data.userAgent?.length > 30 ? '...' : '' }}
          </span>
        </template>
      </Column>
      <Column field="createdAt" header="Date" sortable>
        <template #body="{ data }">
          {{ formatDate(data.createdAt) }}
        </template>
      </Column>
    </DataTable>

    <Dialog
      v-model:visible="showDialog"
      header="Log Activity"
      :style="{ width: '500px' }"
      modal
    >
      <div class="flex flex-column gap-3">
        <div class="field">
          <label for="userId">User ID</label>
          <InputText id="userId" v-model="newActivity.userId" class="w-full" />
        </div>
        <div class="field">
          <label for="userName">User Name</label>
          <InputText id="userName" v-model="newActivity.userName" class="w-full" />
        </div>
        <div class="field">
          <label for="activityType">Activity Type</label>
          <Dropdown
            id="activityType"
            v-model="newActivity.activityType"
            :options="activityTypes"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>
        <div class="field">
          <label for="description">Description</label>
          <Textarea id="description" v-model="newActivity.description" class="w-full" rows="3" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showDialog = false" />
        <Button label="Log" @click="createActivity" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.badge {
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
