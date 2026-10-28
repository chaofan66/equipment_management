<script setup>
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SubTabs from '@/components/common/SubTabs.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const subTabs = computed(() => [
  { key: 'exam', label: '考试', route: '/maintenance/training/exam', perms: ['exam.config.view', 'exam.config.edit', 'exam.practice'] },
  { key: 'course', label: '课程', route: '/maintenance/training/course', perms: ['course.config.view', 'course.config.edit', 'course.view'] }
].filter(t => authStore.hasAnyPermission(t.perms)))

watch(subTabs, (tabs) => {
  if (!tabs.length) return
  const ok = tabs.some(t => route.path === t.route || route.path.startsWith(t.route + '/'))
  if (!ok) router.replace(tabs[0].route)
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <SubTabs :tabs="subTabs" />
    <div class="flex-1 flex flex-col min-h-0">
      <router-view />
    </div>
  </div>
</template>
