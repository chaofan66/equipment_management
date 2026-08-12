<script setup>
// V1.50 设备分配「车间」子 tab：嵌套 SubTabs（车间/维保，按权限过滤）+ 车间分配网格 scope='ws'
import SubTabs from '@/components/common/SubTabs.vue'
import AssignmentGrid from './AssignmentGrid.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const subTabs = [
  { key: 'ws', label: '车间', route: '/maintenance/assign', perms: ['mt.assign.view', 'mt.assign.edit'] },
  { key: 'mt', label: '维保', route: '/maintenance/assign-mt', perms: ['mt.assignmt.view', 'mt.assignmt.edit'] },
].filter(t => authStore.hasAnyPermission(t.perms))
</script>

<template>
  <div class="flex flex-col h-full">
    <SubTabs :tabs="subTabs" />
    <div class="flex-1 min-h-0">
      <AssignmentGrid scope="ws" />
    </div>
  </div>
</template>
