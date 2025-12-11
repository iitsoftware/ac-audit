<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import Menu from 'primevue/menu'

const route = useRoute()
const router = useRouter()
const configMenu = ref()

const configMenuItems = ref([
  {
    label: 'Configuration',
    items: [
      {
        label: 'Organizations',
        icon: 'pi pi-building',
        command: () => { router.push('/organization') }
      },
      {
        label: 'Templates',
        icon: 'pi pi-file-edit',
        command: () => { router.push('/audit-templates') }
      }
    ]
  }
])

const toggleConfigMenu = (event: Event) => {
  configMenu.value.toggle(event)
}

const isConfigActive = computed(() => {
  return route.path === '/organization' || route.path.startsWith('/audit-templates')
})
</script>

<template>
  <div class="layout-wrapper">
    <Toast />
    <header class="layout-header">
      <div class="flex align-items-center">
        <span class="text-xl font-bold text-primary mr-4">AC Audit</span>
        <nav class="flex gap-2 align-items-center">
          <RouterLink
            to="/"
            class="nav-link"
            :class="{ 'nav-link-active': route.path === '/' || route.path.startsWith('/audit-instances') }"
          >
            <i class="pi pi-clipboard mr-2"></i>
            Audits
          </RouterLink>

          <!-- Configuration dropdown -->
          <div class="nav-link config-trigger" :class="{ 'nav-link-active': isConfigActive }" @click="toggleConfigMenu">
            <i class="pi pi-cog mr-2"></i>
            Configuration
            <i class="pi pi-chevron-down ml-2 text-xs"></i>
          </div>
          <Menu ref="configMenu" :model="configMenuItems" :popup="true" />
        </nav>
      </div>
    </header>
    <main class="layout-main">
      <RouterView />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  background-color: var(--surface-ground);
}

.layout-wrapper {
  min-height: 100vh;
}

.layout-header {
  background: var(--surface-card);
  padding: 1rem 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.layout-main {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.nav-link {
  text-decoration: none;
  color: var(--text-color-secondary);
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius);
  transition: all 0.2s;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.nav-link:hover {
  background: var(--surface-hover);
  color: var(--text-color);
}

.nav-link-active {
  background: var(--primary-color);
  color: var(--primary-color-text) !important;
}

.config-trigger {
  user-select: none;
}
</style>
