<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SubTabs from '@/components/common/SubTabs.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const route = useRoute()

// V1.7：每 tab 挂页面级权限串，按「命中任一」过滤
// V1.14：顺序：维保总览/保养计划/日常点检/一级保养/二级保养/定期检查/维修工单/设备培训/标准文件配置；删除「我的待办」
// V1.41：删除「统计报表」tab（reports/ReportView/专属接口/权限 mt.reports.view 一并移除）
const tabs = [
  { key: 'dashboard', label: '维保总览', route: '/maintenance/dashboard', perms: ['mt.main.view'] },
  { key: 'plans', label: '保养计划', route: '/maintenance/plans', perms: ['mt.plans.view', 'mt.plans.edit'] },
  { key: 'daily-check', label: '日常点检', route: '/maintenance/daily-check', perms: ['mt.dailycheck.view', 'mt.dailycheck.execute'] },
  // V1.5：一级/二级保养任务列表 tab（对应级别已排期任务）
  { key: 'level1', label: '一级保养', route: '/maintenance/level1', perms: ['mt.level1.view', 'mt.level1.execute'] },
  { key: 'level2', label: '二级保养', route: '/maintenance/level2', perms: ['mt.level2.view', 'mt.level2.execute'] },
  // V1.17：设备润滑任务列表 tab（05 设备润滑标准，镜像二级保养步骤）
  { key: 'lubrication', label: '设备润滑', route: '/maintenance/lubrication', perms: ['mt.lubrication.view', 'mt.lubrication.execute'] },
  { key: 'inspection', label: '定期检查', route: '/maintenance/inspection', perms: ['mt.inspection.view', 'mt.inspection.execute'] },
  { key: 'repair', label: '维修工单', route: '/maintenance/repair', perms: ['mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch', 'mt.repair.repair', 'mt.repair.accept', 'mt.repair.approve'] },
  { key: 'training', label: '设备培训', route: '/maintenance/training', perms: ['mt.training.view', 'mt.training.edit'] },
  { key: 'file-config', label: '标准文件配置', route: '/maintenance/file-config', perms: ['mt.stdconfig.view', 'mt.stdconfig.edit'] },
  // V1.49 拆为「车间分配/维保分配」两 tab → V1.50 合并回「设备分配」单 tab：页内 车间/维保 两个子 tab（AssignView/MtAssignView 嵌套 SubTabs），权限=两体系并集
  // V1.51 修复：routes 配置两路由（车间/维保子 tab 目标），切「维保」子 tab 后主菜单仍保持「设备分配」选中（不会跑到「维保总览」）
  { key: 'assign', label: '设备分配', route: '/maintenance/assign', routes: ['/maintenance/assign', '/maintenance/assign-mt'], perms: ['mt.assign.view', 'mt.assign.edit', 'mt.assignmt.view', 'mt.assignmt.edit'] }
]

const visibleTabs = computed(() => tabs.filter(t => authStore.hasAnyPermission(t.perms)))
// V1.57：按月模型下编辑未来月不影响当前月执行，「修改中」锁/到期横幅已删除
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <SubTabs :tabs="visibleTabs" />
    <div class="flex-1 flex flex-col min-h-0">
      <router-view />
    </div>
  </div>
</template>
