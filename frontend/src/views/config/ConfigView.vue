<script setup>
import { computed } from 'vue'
import SubTabs from '@/components/common/SubTabs.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

// V1.7：每 tab 挂页面级权限串，按「命中任一」过滤
const tabs = [
  { key: 'dict', label: '数据字典', route: '/config/dict', perms: ['config.dict.view', 'config.dict.edit'] },
  { key: 'asset-types', label: '资产类型', route: '/config/asset-types', perms: ['config.assettypes.view', 'config.assettypes.edit'] },
  { key: 'dept-workshop', label: '部门车间', route: '/config/dept-workshop', perms: ['config.deptws.view', 'config.deptws.edit'] },
  { key: 'params', label: '业务参数', route: '/config/params', perms: ['config.params.view', 'config.params.edit'] },
  { key: 'roles', label: '角色管理', route: '/config/roles', perms: ['config.roles.view', 'config.roles.edit'] },
  { key: 'personnel', label: '人员管理', route: '/config/personnel', perms: ['config.personnel.view', 'config.personnel.edit'] }
]

const visibleTabs = computed(() => tabs.filter(t => authStore.hasAnyPermission(t.perms)))
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <SubTabs :tabs="visibleTabs" />
    <div class="flex-1 flex flex-col min-h-0">
      <router-view />
    </div>
  </div>
</template>
