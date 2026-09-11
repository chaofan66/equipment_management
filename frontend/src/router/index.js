import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/m/:code',
    name: 'mobile-device',
    component: () => import('@/views/mobile/MobileDeviceView.vue'),
    meta: { title: '设备信息', mobile: true }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: '设备总览', tab: 'dashboard' }
  },
  {
    path: '/ledger',
    name: 'ledger',
    component: () => import('@/views/LedgerView.vue'),
    meta: { title: '资产台账', tab: 'ledger' }
  },
  {
    path: '/maintenance',
    name: 'maintenance',
    component: () => import('@/views/maintenance/MaintenanceView.vue'),
    redirect: '/maintenance/dashboard',
    meta: { title: '维保管理', tab: 'maintenance' },
    children: [
      {
        path: 'dashboard',
        name: 'maintenance-dashboard',
        component: () => import('@/views/maintenance/MaintenanceDashboard.vue'),
        meta: { title: '维保总览' }
      },
      {
        path: 'plans',
        name: 'maintenance-plans',
        component: () => import('@/views/maintenance/PlanManagementView.vue'),
        meta: { title: '保养计划' }
      },
      {
        path: 'daily-check',
        name: 'maintenance-daily-check',
        component: () => import('@/views/maintenance/DailyCheckView.vue'),
        meta: { title: '日常点检' }
      },
      // V1.5：一级/二级保养任务列表（按级别已排期任务，共用 LevelTaskView，级别取 meta.level）
      {
        path: 'level1',
        name: 'maintenance-level1',
        component: () => import('@/views/maintenance/LevelTaskView.vue'),
        meta: { title: '一级保养', level: 'level1' }
      },
      {
        path: 'level2',
        name: 'maintenance-level2',
        component: () => import('@/views/maintenance/LevelTaskView.vue'),
        meta: { title: '二级保养', level: 'level2' }
      },
      // V1.17：设备润滑任务列表（05 设备润滑标准，镜像二级保养）
      {
        path: 'lubrication',
        name: 'maintenance-lubrication',
        component: () => import('@/views/maintenance/LevelTaskView.vue'),
        meta: { title: '设备润滑', level: 'lubrication' }
      },
      {
        path: 'inspection',
        name: 'maintenance-inspection',
        component: () => import('@/views/maintenance/InspectionView.vue'),
        meta: { title: '定期检查' }
      },
      {
        path: 'repair',
        name: 'maintenance-repair',
        component: () => import('@/views/maintenance/RepairView.vue'),
        meta: { title: '维修工单' }
      },
      {
        path: 'training',
        name: 'maintenance-training',
        component: () => import('@/views/maintenance/TrainingView.vue'),
        meta: { title: '设备培训' }
      },
      {
        path: 'file-config',
        name: 'maintenance-file-config',
        component: () => import('@/views/maintenance/FileConfigView.vue'),
        meta: { title: '标准文件配置' }
      },
      // V1.46 设备分配 → V1.49 拆「车间分配/维保分配」→ V1.50 合并「设备分配」：两路由保留（页内子 tab 目标），标题统一「设备分配」
      {
        path: 'assign',
        name: 'maintenance-assign',
        component: () => import('@/views/maintenance/AssignView.vue'),
        meta: { title: '设备分配' }
      },
      {
        path: 'assign-mt',
        name: 'maintenance-assign-mt',
        component: () => import('@/views/maintenance/MtAssignView.vue'),
        meta: { title: '设备分配' }
      }
    ]
  },
  {
    path: '/approval',
    name: 'approval',
    component: () => import('@/views/approval/ApprovalView.vue'),
    redirect: '/approval/my-applications',
    meta: { title: '流转审批', tab: 'approval' },
    children: [
      {
        path: 'my-applications',
        name: 'approval-my',
        component: () => import('@/views/approval/MyApplicationsView.vue'),
        meta: { title: '我的申请' }
      },
      {
        path: 'pending',
        name: 'approval-pending',
        component: () => import('@/views/approval/PendingApprovalView.vue'),
        meta: { title: '待我审批' }
      }
    ]
  },
  {
    path: '/config',
    name: 'config',
    component: () => import('@/views/config/ConfigView.vue'),
    redirect: '/config/dict',
    meta: { title: '系统配置', tab: 'config' },
    children: [
      {
        path: 'dict',
        name: 'config-dict',
        component: () => import('@/views/config/DictConfigView.vue'),
        meta: { title: '数据字典' }
      },
      {
        path: 'params',
        name: 'config-params',
        component: () => import('@/views/config/ParamsConfigView.vue'),
        meta: { title: '业务参数' }
      },
      {
        path: 'roles',
        name: 'config-roles',
        component: () => import('@/views/config/RoleConfigView.vue'),
        meta: { title: '角色管理' }
      },
      {
        path: 'asset-types',
        name: 'config-asset-types',
        component: () => import('@/views/config/AssetTypeConfigView.vue'),
        meta: { title: '资产类型' }
      },
      {
        path: 'dept-workshop',
        name: 'config-dept-workshop',
        component: () => import('@/views/config/DeptWorkshopConfigView.vue'),
        meta: { title: '部门车间' }
      },
      {
        path: 'personnel',
        name: 'config-personnel',
        component: () => import('@/views/config/PersonnelView.vue'),
        meta: { title: '人员管理' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
