<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { organizationApi, type Company, type Department, type CompanyCreate, type DepartmentCreate } from '@/api/client'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Card from 'primevue/card'
import { useToast } from 'primevue/usetoast'

const toast = useToast()

interface TreeNode {
  type: 'company' | 'department'
  id: string
  name: string
  description: string | null
  companyId?: string
  auditCount: number
  children?: TreeNode[]
}

// Tree data
const treeData = ref<TreeNode[]>([])
const expandedNodes = ref<Set<string>>(new Set())

// Company dialog
const companyDialogVisible = ref(false)
const companyForm = ref<CompanyCreate>({ name: '', description: '' })
const isEditingCompany = ref(false)
const editingCompanyId = ref<string | null>(null)

// Department dialog
const departmentDialogVisible = ref(false)
const departmentForm = ref<DepartmentCreate>({ name: '', description: '' })
const isEditingDepartment = ref(false)
const editingDepartmentId = ref<string | null>(null)
const selectedCompanyId = ref<string | null>(null)

const loadData = async () => {
  try {
    const companiesResponse = await organizationApi.listCompanies()
    const companies: Company[] = companiesResponse.data

    const nodes: TreeNode[] = []
    for (const company of companies) {
      const deptResponse = await organizationApi.listDepartments(company.id)
      const departments: Department[] = deptResponse.data

      nodes.push({
        type: 'company',
        id: company.id,
        name: company.name,
        description: company.description,
        auditCount: company.auditCount || 0,
        children: departments.map(dept => ({
          type: 'department',
          id: dept.id,
          name: dept.name,
          description: dept.description,
          companyId: company.id,
          auditCount: dept.auditCount || 0
        }))
      })
    }
    treeData.value = nodes
    // Expand all by default
    nodes.forEach(n => expandedNodes.value.add(n.id))
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load data', life: 3000 })
  }
}

const toggleNode = (id: string) => {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

const isExpanded = (id: string) => expandedNodes.value.has(id)

// Company CRUD
const openNewCompanyDialog = () => {
  companyForm.value = { name: '', description: '' }
  isEditingCompany.value = false
  editingCompanyId.value = null
  companyDialogVisible.value = true
}

const openEditCompanyDialog = (node: TreeNode) => {
  companyForm.value = { name: node.name, description: node.description || '' }
  isEditingCompany.value = true
  editingCompanyId.value = node.id
  companyDialogVisible.value = true
}

const saveCompany = async () => {
  try {
    if (isEditingCompany.value && editingCompanyId.value) {
      await organizationApi.updateCompany(editingCompanyId.value, companyForm.value)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Company updated', life: 3000 })
    } else {
      await organizationApi.createCompany(companyForm.value)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Company created', life: 3000 })
    }
    companyDialogVisible.value = false
    loadData()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to save company', life: 3000 })
  }
}

const deleteCompany = async (node: TreeNode) => {
  if (!confirm(`Delete company "${node.name}"? This will also delete all departments.`)) return
  try {
    await organizationApi.deleteCompany(node.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Company deleted', life: 3000 })
    loadData()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete company', life: 3000 })
  }
}

// Department CRUD
const openNewDepartmentDialog = (companyId: string) => {
  departmentForm.value = { name: '', description: '' }
  isEditingDepartment.value = false
  editingDepartmentId.value = null
  selectedCompanyId.value = companyId
  departmentDialogVisible.value = true
}

const openEditDepartmentDialog = (node: TreeNode) => {
  departmentForm.value = { name: node.name, description: node.description || '' }
  isEditingDepartment.value = true
  editingDepartmentId.value = node.id
  selectedCompanyId.value = node.companyId || null
  departmentDialogVisible.value = true
}

const saveDepartment = async () => {
  if (!selectedCompanyId.value) return
  try {
    if (isEditingDepartment.value && editingDepartmentId.value) {
      await organizationApi.updateDepartment(editingDepartmentId.value, departmentForm.value)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Department updated', life: 3000 })
    } else {
      await organizationApi.createDepartment(selectedCompanyId.value, departmentForm.value)
      toast.add({ severity: 'success', summary: 'Success', detail: 'Department created', life: 3000 })
    }
    departmentDialogVisible.value = false
    loadData()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to save department', life: 3000 })
  }
}

const deleteDepartment = async (node: TreeNode) => {
  if (!confirm(`Delete department "${node.name}"?`)) return
  try {
    await organizationApi.deleteDepartment(node.id)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Department deleted', life: 3000 })
    loadData()
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to delete department', life: 3000 })
  }
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <Card>
    <template #title>
      <div class="flex justify-content-between align-items-center">
        <span>Companies & Departments</span>
        <Button icon="pi pi-plus" label="Add Company" @click="openNewCompanyDialog" />
      </div>
    </template>
    <template #content>
      <div v-if="treeData.length === 0" class="text-center text-500 p-4">
        No companies yet. Click "Add Company" to get started.
      </div>

      <!-- Tree Structure -->
      <div v-else class="organization-tree">
        <template v-for="company in treeData" :key="company.id">
          <div class="tree-node">
            <!-- Company Item -->
            <div class="tree-item surface-card border-1 surface-border border-round p-3 mb-2">
              <div class="flex align-items-center gap-3">
                <!-- Expand/Collapse Toggle -->
                <Button
                  v-if="company.children && company.children.length > 0"
                  :icon="isExpanded(company.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                  text
                  rounded
                  size="small"
                  class="flex-shrink-0"
                  @click="toggleNode(company.id)"
                />
                <div v-else class="w-2rem flex-shrink-0"></div>

                <!-- Company Content -->
                <div class="flex-grow-1">
                  <span class="font-semibold text-lg cursor-pointer hover:text-primary" @click="openEditCompanyDialog(company)">{{ company.name }}</span>
                  <div v-if="company.description" class="text-500 text-sm mt-1">{{ company.description }}</div>
                </div>

                <!-- Actions -->
                <div class="flex gap-1 flex-shrink-0">
                  <Button
                    icon="pi pi-plus"
                    text
                    rounded
                    size="small"
                    severity="success"
                    v-tooltip.bottom="'Add Department'"
                    @click="openNewDepartmentDialog(company.id)"
                  />
                  <span v-tooltip.bottom="company.auditCount > 0 ? `Cannot delete: ${company.auditCount} audit(s)` : 'Delete'">
                    <Button
                      icon="pi pi-trash"
                      text
                      rounded
                      size="small"
                      :severity="company.auditCount > 0 ? 'secondary' : 'danger'"
                      :disabled="company.auditCount > 0"
                      @click="deleteCompany(company)"
                    />
                  </span>
                </div>
              </div>
            </div>

            <!-- Departments (Children) -->
            <div v-if="company.children && company.children.length > 0 && isExpanded(company.id)" class="children-container ml-5 pl-3 border-left-2 border-300">
              <template v-for="dept in company.children" :key="dept.id">
                <div class="tree-item surface-card border-1 surface-border border-round p-3 mb-2">
                  <div class="flex align-items-center gap-3">
                    <div class="w-2rem flex-shrink-0"></div>

                    <!-- Department Content -->
                    <div class="flex-grow-1">
                      <span class="font-medium cursor-pointer hover:text-primary" @click="openEditDepartmentDialog(dept)">{{ dept.name }}</span>
                      <div v-if="dept.description" class="text-500 text-sm mt-1">{{ dept.description }}</div>
                    </div>

                    <!-- Actions -->
                    <div class="flex gap-1 flex-shrink-0">
                      <span v-tooltip.bottom="dept.auditCount > 0 ? `Cannot delete: ${dept.auditCount} audit(s)` : 'Delete'">
                        <Button
                          icon="pi pi-trash"
                          text
                          rounded
                          size="small"
                          :severity="dept.auditCount > 0 ? 'secondary' : 'danger'"
                          :disabled="dept.auditCount > 0"
                          @click="deleteDepartment(dept)"
                        />
                      </span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </template>
  </Card>

  <!-- Company Dialog -->
  <Dialog v-model:visible="companyDialogVisible" :header="isEditingCompany ? 'Edit Company' : 'New Company'" modal style="width: 400px">
    <div class="flex flex-column gap-3">
      <div class="flex flex-column gap-2">
        <label for="company-name">Name</label>
        <InputText id="company-name" v-model="companyForm.name" />
      </div>
      <div class="flex flex-column gap-2">
        <label for="company-description">Description</label>
        <Textarea id="company-description" v-model="companyForm.description" rows="3" />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="companyDialogVisible = false" />
      <Button label="Save" @click="saveCompany" />
    </template>
  </Dialog>

  <!-- Department Dialog -->
  <Dialog v-model:visible="departmentDialogVisible" :header="isEditingDepartment ? 'Edit Department' : 'New Department'" modal style="width: 400px">
    <div class="flex flex-column gap-3">
      <div class="flex flex-column gap-2">
        <label for="department-name">Name</label>
        <InputText id="department-name" v-model="departmentForm.name" />
      </div>
      <div class="flex flex-column gap-2">
        <label for="department-description">Description</label>
        <Textarea id="department-description" v-model="departmentForm.description" rows="3" />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="departmentDialogVisible = false" />
      <Button label="Save" @click="saveDepartment" />
    </template>
  </Dialog>
</template>

<style scoped>
.organization-tree {
  max-height: calc(100vh - 250px);
  overflow-y: auto;
}

.children-container {
  margin-top: 0.5rem;
}
</style>
