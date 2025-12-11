import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'audit-instances',
      component: () => import('@/views/AuditInstanceListView.vue')
    },
    {
      path: '/organization',
      name: 'organization',
      component: () => import('@/views/OrganizationView.vue')
    },
    {
      path: '/audit-templates',
      name: 'audit-templates',
      component: () => import('@/views/AuditTemplateListView.vue')
    },
    {
      path: '/audit-templates/:id',
      name: 'audit-template-editor',
      component: () => import('@/views/AuditTemplateEditorView.vue')
    },
    {
      path: '/audit-instances',
      name: 'audit-instances-list',
      component: () => import('@/views/AuditInstanceListView.vue')
    },
    {
      path: '/audit-instances/:id',
      name: 'audit-instance-editor',
      component: () => import('@/views/AuditInstanceEditorView.vue')
    }
  ]
})

export default router
