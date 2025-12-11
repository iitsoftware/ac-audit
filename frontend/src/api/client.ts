import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

// Audit API
export const auditApi = {
  list: (limit = 50, offset = 0) =>
    apiClient.get(`/audits?limit=${limit}&offset=${offset}`),
  getById: (id: string) =>
    apiClient.get(`/audits/${id}`),
  create: (data: AuditEntryCreate) =>
    apiClient.post('/audits', data)
}

// Compliance API
export const complianceApi = {
  listRules: (limit = 50, offset = 0) =>
    apiClient.get(`/compliance/rules?limit=${limit}&offset=${offset}`),
  getRuleById: (id: string) =>
    apiClient.get(`/compliance/rules/${id}`),
  createRule: (data: ComplianceRuleCreate) =>
    apiClient.post('/compliance/rules', data),
  updateRule: (id: string, data: ComplianceRuleCreate) =>
    apiClient.put(`/compliance/rules/${id}`, data),
  deleteRule: (id: string) =>
    apiClient.delete(`/compliance/rules/${id}`),
  listStatus: (limit = 50, offset = 0) =>
    apiClient.get(`/compliance/status?limit=${limit}&offset=${offset}`),
  getEntityStatus: (entityType: string, entityId: string) =>
    apiClient.get(`/compliance/status/${entityType}/${entityId}`)
}

// Report API
export const reportApi = {
  listTemplates: (limit = 50, offset = 0) =>
    apiClient.get(`/reports/templates?limit=${limit}&offset=${offset}`),
  generate: (type: string, from?: string, to?: string) =>
    apiClient.post('/reports/generate', { type, from, to }),
  exportCsv: (data: object) =>
    apiClient.post('/reports/export/csv', data, { responseType: 'blob' }),
  exportJson: (data: object) =>
    apiClient.post('/reports/export/json', data, { responseType: 'blob' })
}

// User Activity API
export const activityApi = {
  list: (limit = 50, offset = 0) =>
    apiClient.get(`/activities?limit=${limit}&offset=${offset}`),
  getById: (id: string) =>
    apiClient.get(`/activities/${id}`),
  create: (data: UserActivityCreate) =>
    apiClient.post('/activities', data)
}

// Organization API (Company & Department)
export const organizationApi = {
  listCompanies: (limit = 50, offset = 0, activeOnly = false) =>
    apiClient.get(`/companies?limit=${limit}&offset=${offset}&activeOnly=${activeOnly}`),
  getCompany: (id: string) =>
    apiClient.get(`/companies/${id}`),
  createCompany: (data: CompanyCreate) =>
    apiClient.post('/companies', data),
  updateCompany: (id: string, data: CompanyCreate) =>
    apiClient.put(`/companies/${id}`, data),
  deleteCompany: (id: string) =>
    apiClient.delete(`/companies/${id}`),
  listDepartments: (companyId: string, limit = 50, offset = 0, activeOnly = false) =>
    apiClient.get(`/companies/${companyId}/departments?limit=${limit}&offset=${offset}&activeOnly=${activeOnly}`),
  getDepartment: (id: string) =>
    apiClient.get(`/departments/${id}`),
  createDepartment: (companyId: string, data: DepartmentCreate) =>
    apiClient.post(`/companies/${companyId}/departments`, data),
  updateDepartment: (id: string, data: DepartmentCreate) =>
    apiClient.put(`/departments/${id}`, data),
  deleteDepartment: (id: string) =>
    apiClient.delete(`/departments/${id}`),
  getFullHierarchy: () =>
    apiClient.get('/organization/hierarchy')
}

// Audit Template API
export const auditTemplateApi = {
  list: (limit = 50, offset = 0, activeOnly = false) =>
    apiClient.get(`/audit-templates?limit=${limit}&offset=${offset}&activeOnly=${activeOnly}`),
  getById: (id: string) =>
    apiClient.get(`/audit-templates/${id}`),
  create: (data: AuditTemplateCreate) =>
    apiClient.post('/audit-templates', data),
  update: (id: string, data: AuditTemplateCreate) =>
    apiClient.put(`/audit-templates/${id}`, data),
  delete: (id: string) =>
    apiClient.delete(`/audit-templates/${id}`),
  getQuestions: (templateId: string) =>
    apiClient.get(`/audit-templates/${templateId}/questions`),
  addQuestion: (templateId: string, data: TemplateQuestionCreate) =>
    apiClient.post(`/audit-templates/${templateId}/questions`, data),
  updateQuestion: (templateId: string, questionId: string, data: TemplateQuestionCreate) =>
    apiClient.put(`/audit-templates/${templateId}/questions/${questionId}`, data),
  deleteQuestion: (templateId: string, questionId: string) =>
    apiClient.delete(`/audit-templates/${templateId}/questions/${questionId}`),
  reorderQuestions: (templateId: string, items: QuestionOrderItem[]) =>
    apiClient.post(`/audit-templates/${templateId}/questions/reorder`, items)
}

// Audit Instance API
export const auditInstanceApi = {
  list: (params?: { departmentId?: string; status?: string; limit?: number; offset?: number }) =>
    apiClient.get('/audit-instances', { params }),
  getById: (id: string) =>
    apiClient.get(`/audit-instances/${id}`),
  create: (data: AuditInstanceCreate) =>
    apiClient.post('/audit-instances', data),
  update: (id: string, data: AuditInstanceUpdate) =>
    apiClient.put(`/audit-instances/${id}`, data),
  updateStatus: (id: string, status: AuditStatus) =>
    apiClient.put(`/audit-instances/${id}/status`, { status }),
  delete: (id: string) =>
    apiClient.delete(`/audit-instances/${id}`),
  addQuestion: (auditId: string, data: AuditQuestionCreate) =>
    apiClient.post(`/audit-instances/${auditId}/questions`, data),
  updateQuestion: (auditId: string, questionId: string, data: AuditQuestionCreate) =>
    apiClient.put(`/audit-instances/${auditId}/questions/${questionId}`, data),
  deleteQuestion: (auditId: string, questionId: string) =>
    apiClient.delete(`/audit-instances/${auditId}/questions/${questionId}`),
  updateCompliance: (auditId: string, questionId: string, data: QuestionComplianceStateUpdate) =>
    apiClient.put(`/audit-instances/${auditId}/questions/${questionId}/compliance`, data),
  getProgress: (auditId: string) =>
    apiClient.get(`/audit-instances/${auditId}/progress`)
}

// Types
export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  userId: string
  userName: string
  beforeValue: object | null
  afterValue: object | null
  description: string
  ipAddress: string
  createdAt: string
}

export interface AuditEntryCreate {
  entityType: string
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  userId: string
  userName: string
  beforeValue?: object
  afterValue?: object
  description?: string
}

export interface ComplianceRule {
  id: string
  name: string
  description: string
  entityType: string
  criteria: object
  active: boolean
  createdAt: string
  updatedAt: string | null
}

export interface ComplianceRuleCreate {
  name: string
  description: string
  entityType: string
  criteria: object
  active?: boolean
}

export interface ComplianceStatus {
  id: string
  ruleId: string
  entityType: string
  entityId: string
  status: 'COMPLIANT' | 'NON_COMPLIANT' | 'PENDING' | 'NOT_APPLICABLE'
  details: string
  checkedAt: string | null
  createdAt: string
}

export interface UserActivity {
  id: string
  userId: string
  userName: string
  activityType: 'LOGIN' | 'LOGOUT' | 'PAGE_VIEW' | 'ACTION' | 'API_CALL' | 'ERROR'
  description: string
  ipAddress: string
  userAgent: string
  sessionId: string
  metadata: object | null
  createdAt: string
}

export interface UserActivityCreate {
  userId: string
  userName: string
  activityType: 'LOGIN' | 'LOGOUT' | 'PAGE_VIEW' | 'ACTION' | 'API_CALL' | 'ERROR'
  description: string
  sessionId?: string
  metadata?: object
}

// Company types
export interface Company {
  id: string
  name: string
  description: string | null
  metadata: object
  createdAt: string
  updatedAt: string | null
  auditCount?: number
}

export interface CompanyCreate {
  name: string
  description?: string
  metadata?: object
}

// Department types
export interface Department {
  id: string
  companyId: string
  name: string
  description: string | null
  metadata: object
  createdAt: string
  updatedAt: string | null
  auditCount?: number
}

export interface DepartmentCreate {
  name: string
  description?: string
  metadata?: object
}

// Audit Template types
export interface AuditTemplate {
  id: string
  name: string
  metadata: object
  createdAt: string
  updatedAt: string | null
  questions?: TemplateQuestion[]
}

export interface AuditTemplateCreate {
  name: string
  metadata?: object
}

// Template Question types
export interface TemplateQuestion {
  id: string
  templateId: string
  parentId: string | null
  questionText: string
  description: string | null
  sortOrder: number
  metadata: object
  createdAt: string
  updatedAt: string | null
  children?: TemplateQuestion[]
}

export interface TemplateQuestionCreate {
  parentId?: string | null
  questionText: string
  description?: string
  sortOrder?: number
  metadata?: object
}

export interface QuestionOrderItem {
  id: string
  parentId: string | null
  sortOrder: number
}

// Audit Instance types
export type AuditStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED'
export type AuditComplianceState = 'COMPLIANT' | 'NON_COMPLIANT'

export interface AuditInstance {
  id: string
  departmentId: string
  templateId: string | null
  name: string
  description: string | null
  status: AuditStatus
  complianceState: AuditComplianceState | null
  dueDate: string | null
  completedAt: string | null
  assignedTo: string | null
  metadata: object
  createdAt: string
  updatedAt: string | null
  questions?: AuditQuestion[]
}

export interface AuditInstanceCreate {
  departmentId: string
  templateId?: string | null
  name: string
  description?: string
  dueDate?: string | null
  assignedTo?: string | null
  metadata?: object
}

export interface AuditInstanceUpdate {
  departmentId?: string
  name?: string
  description?: string
  dueDate?: string | null
  assignedTo?: string | null
  metadata?: object
}

// Audit Question types
export interface AuditQuestion {
  id: string
  auditId: string
  parentId: string | null
  templateQuestionId: string | null
  questionText: string
  description: string | null
  sortOrder: number
  metadata: object
  createdAt: string
  updatedAt: string | null
  children?: AuditQuestion[]
  complianceState?: QuestionComplianceState
}

export interface AuditQuestionCreate {
  parentId?: string | null
  questionText: string
  description?: string
  sortOrder?: number
  metadata?: object
}

// Question Compliance State types
export type ComplianceResult = 'COMPLIANT' | 'NON_COMPLIANT'
export type ComplianceOutcome = 'LEVEL_1' | 'LEVEL_2' | 'RECOMMENDATION'

export interface QuestionComplianceState {
  id: string
  auditQuestionId: string
  closed: boolean
  closedAt: string | null
  result: ComplianceResult | null
  outcome: ComplianceOutcome | null
  notes: string | null
  evidenceUrls: string[]
  evaluatedBy: string | null
  createdAt: string
  updatedAt: string | null
  // Aggregated fields for parent questions
  totalLeaves?: number
  closedLeaves?: number
}

export interface QuestionComplianceStateUpdate {
  closed: boolean
  result?: ComplianceResult | null
  outcome?: ComplianceOutcome | null
  notes?: string | null
  evidenceUrls?: string[]
  evaluatedBy?: string | null
}

// Audit Progress types
export interface AuditProgress {
  auditId: string
  auditName: string
  status: AuditStatus
  complianceState: AuditComplianceState | null
  counts: {
    compliant: number
    nonCompliant: number
    open: number
    total: number
  }
  progressPercent: number
}

export default apiClient
