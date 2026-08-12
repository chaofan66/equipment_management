<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const props = defineProps({
  tabs: { type: Array, required: true }
  // tabs: [{ key: 'plans', label: '保养计划', route: '/maintenance/plans' }]
})

const router = useRouter()
const route = useRoute()

const activeName = computed(() => {
  // V1.51：支持 tab 项 routes 数组（任一匹配即选中，兼容原单值 route），解决「设备分配」页内子 tab 切换后主菜单选中态丢失
  const match = props.tabs.find(t => {
    const routes = t.routes || [t.route]
    return routes.some(r => route.path === r || route.path.startsWith(r + '/'))
  })
  return match?.key || props.tabs[0]?.key || ''
})

function onTabClick(tab) {
  router.push(tab.route)
}
</script>

<template>
  <el-tabs
    :model-value="activeName"
    size="small"
    class="sub-tabs"
    @tab-click="(pane) => onTabClick(props.tabs.find(t => t.key === pane.paneName))"
  >
    <el-tab-pane
      v-for="tab in tabs"
      :key="tab.key"
      :label="tab.label"
      :name="tab.key"
    />
  </el-tabs>
</template>

<style scoped>
.sub-tabs {
  --el-tabs-header-height: 32px;
  background: #F3F3F5;
}
.sub-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
  padding: 0 12px;
  border-bottom: 1px solid #dcdfe6;
}
.sub-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}
</style>
