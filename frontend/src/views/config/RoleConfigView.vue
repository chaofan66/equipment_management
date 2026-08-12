<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useToast } from '@/composables/useToast'

// V1.9：角色管理页 = 11 系统角色（10 职责 + 系统管理员）· 系统操作权限配置（模块→页面→动作 勾选）
// 角色即职责：人员的系统角色直接决定菜单权限与维保步骤执行权限。
// 保存写 auth.ROLES（PUT /config/roles/:id）；App.vue/维保子页/系统配置子页按页面级权限过滤。
const store = useConfigStore()
const toast = useToast()

const selectedKey = ref('')
const loading = ref(false)
const saving = ref(false)

// 工作副本（勾选集合），未保存前与角色权限分离
const working = reactive({ permissions: [] })

// 角色默认权限（与 backend/src/data/auth.js ROLES 同步；admin=目录全量动态计算）
const DEFAULT_PERMISSIONS = {
  // V1.44 数据权限：车间四角色移除 ledger.view（看不到资产台账），可见数据按本人车间收窄
  // V1.45：车间四角色增加 mt.level1.view（仅查看本车间一级保养单）
  // V1.46：设备分配——operator 可查看；主管/组长/主任可查看+分配；数据范围按「分配给我」收窄（决策①）
  'operator': ['dashboard.view',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
    'mt.inspection.view', 'mt.level1.view', 'mt.assign.view'],
  'opLeader': ['dashboard.view',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
    'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch', 'mt.level1.view',
    'mt.assign.view', 'mt.assign.edit'],
  'opSupervisor': ['dashboard.view',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
    'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch',
    'mt.plans.edit', 'approval.view', 'mt.level1.view',
    'mt.assign.view', 'mt.assign.edit'],
  'workshopDirector': ['dashboard.view',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
    'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch',
    'mt.plans.edit', 'approval.view', 'approval.approve', 'mt.level1.view',
    'mt.assign.view', 'mt.assign.edit'],
  // V1.49：维保分配——mtPersonnel 可查看；班长/主管/主任可查看+分配；数据范围按「分配给我」收窄；定期检查发起/二级保养·润滑提交强绑定
  'mtPersonnel': ['dashboard.view', 'ledger.view',
    'mt.main.view', 'mt.plans.view',
    'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute',
    'mt.inspection.view', 'mt.inspection.execute',
    'mt.repair.view', 'mt.repair.report', 'mt.repair.repair', 'approval.view',
    'mt.assignmt.view'],
  'mtLeader': ['dashboard.view', 'ledger.view',
    'mt.main.view', 'mt.plans.view',
    'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute',
    'mt.inspection.view', 'mt.inspection.execute',
    'mt.repair.view', 'mt.repair.report', 'mt.repair.repair', 'approval.view',
    'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.dispatch',
    'mt.assignmt.view', 'mt.assignmt.edit'],
  'mtSupervisor': ['dashboard.view', 'ledger.view',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.plans.view', 'mt.plans.edit',
    'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute',
    'mt.inspection.view', 'mt.inspection.execute', 'mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch', 'mt.repair.repair', 'mt.repair.accept', 'mt.repair.approve',
    'mt.training.view', 'mt.stdconfig.view',
    'approval.view', 'approval.approve', 'config.view',
    'mt.assignmt.view', 'mt.assignmt.edit'],
  'mtDirector': ['dashboard.view', 'ledger.view', 'ledger.edit', 'ledger.delete',
    'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.plans.view', 'mt.plans.edit',
    'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute',
    'mt.inspection.view', 'mt.inspection.execute', 'mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch', 'mt.repair.repair', 'mt.repair.accept',
    'mt.training.view', 'mt.stdconfig.view',
    'approval.view', 'config.view', 'config.dict.view', 'config.assettypes.view', 'config.deptws.view', 'config.params.view', 'config.roles.view', 'config.personnel.view', 'config.personnel.edit',
    'mt.assignmt.view', 'mt.assignmt.edit'],
  'archiver': ['dashboard.view', 'ledger.view',
    'mt.main.view', 'mt.stdconfig.view', 'approval.view'],
  'viewer': ['dashboard.view', 'ledger.view', 'mt.main.view']
}

const ROLE_DESC = {
  admin: '系统管理员：拥有系统全部权限（42 项），可访问所有页面并对权限点做任何操作；维保步骤可全部执行。',
  operator: '操作人员：设备操作工，日常点检执行、发起报修，可查看本车间设备的一级保养单与设备分配；仅可见「分配给本人」的设备（数据权限）。',
  opLeader: '操作班长：设备所属操作班班长，含操作人员权限，另可执行定期检查、查看保养计划、维修派工、查看一级保养、分配名下设备给操作人员；仅可见本车间「分配给我」的设备。',
  opSupervisor: '操作主管：使用车间主管，含操作班长权限，另可排期保养计划、分配名下设备给组长/操作人员；仅可见本车间「分配给我」的设备。',
  workshopDirector: '车间主任：全车间统一一人，含操作主管权限，另可审批（approval.approve）、分配本车间设备给主管/组长/操作人员；仅可见本车间设备。',
  mtPersonnel: '维保人员：维修工，执行一/二级保养、定期检查、维修执行，查看保养计划与审批中心。',
  mtLeader: '维保班长：维修班组负责人，含维保人员权限，另可执行日常点检、维修派工。',
  mtSupervisor: '维保主管：维保科室负责人，含维保班长权限，另可审批维修工单、培训与标准配置。',
  mtDirector: '维保主任：维保审批最终角色，含台账编辑删除与系统配置（数据字典/资产类型/部门车间/业务参数/角色/人员）。',
  archiver: '维保归档：负责各类维保记录归档操作与标准配置查看。',
  viewer: '查看权限：仅查看设备总览、资产台账与维保总览。'
}

const selectedRole = computed(() => store.roles.find(r => r.id === selectedKey.value) || null)

// 目录扁平化辅助
function flattenCatalog(catalog) {
  const all = []
  Object.keys(catalog).forEach(mk => {
    Object.keys(catalog[mk].pages).forEach(pk => {
      Object.keys(catalog[mk].pages[pk].items).forEach(p => all.push(p))
    })
  })
  return all
}
const allPerms = computed(() => flattenCatalog(store.permissionCatalog))

function modulePerms(moduleKey) {
  const out = []
  Object.keys(store.permissionCatalog[moduleKey]?.pages || {}).forEach(pk => {
    Object.keys(store.permissionCatalog[moduleKey].pages[pk].items).forEach(p => out.push(p))
  })
  return out
}
function pagePerms(moduleKey, pageKey) {
  return Object.keys(store.permissionCatalog[moduleKey]?.pages?.[pageKey]?.items || {})
}

// 页面/模块全选状态
function pageAllState(moduleKey, pageKey) {
  const items = pagePerms(moduleKey, pageKey)
  if (!items.length) return false
  const checked = items.filter(p => working.permissions.includes(p)).length
  return checked === items.length
}
function pageIndeterminate(moduleKey, pageKey) {
  const items = pagePerms(moduleKey, pageKey)
  const checked = items.filter(p => working.permissions.includes(p)).length
  return checked > 0 && checked < items.length
}
function togglePageAll(moduleKey, pageKey, val) {
  const items = pagePerms(moduleKey, pageKey)
  if (val) {
    items.forEach(p => { if (!working.permissions.includes(p)) working.permissions.push(p) })
  } else {
    working.permissions = working.permissions.filter(p => !items.includes(p))
  }
}
function moduleAllState(moduleKey) {
  const items = modulePerms(moduleKey)
  if (!items.length) return false
  const checked = items.filter(p => working.permissions.includes(p)).length
  return checked === items.length
}
function moduleIndeterminate(moduleKey) {
  const items = modulePerms(moduleKey)
  const checked = items.filter(p => working.permissions.includes(p)).length
  return checked > 0 && checked < items.length
}
function toggleModuleAll(moduleKey, val) {
  const items = modulePerms(moduleKey)
  if (val) {
    items.forEach(p => { if (!working.permissions.includes(p)) working.permissions.push(p) })
  } else {
    working.permissions = working.permissions.filter(p => !items.includes(p))
  }
}

// 修改未保存提示
const dirty = computed(() => {
  if (!selectedRole.value) return false
  const a = [...working.permissions].sort()
  const b = [...(selectedRole.value.permissions || [])].sort()
  if (a.length !== b.length) return true
  return a.some((p, i) => p !== b[i])
})

// 已勾选计数
const checkedCount = computed(() => working.permissions.length)

function selectRole(id) {
  selectedKey.value = id
  const role = store.roles.find(r => r.id === id)
  working.permissions = [...(role?.permissions || [])]
}

function restoreDefaults() {
  if (!selectedRole.value) return
  if (selectedKey.value === 'admin') {
    working.permissions = [...allPerms.value]
  } else {
    working.permissions = [...(DEFAULT_PERMISSIONS[selectedKey.value] || [])]
  }
  toast.success('已恢复默认权限')
}

async function save() {
  if (!selectedRole.value) return
  saving.value = true
  try {
    await store.updateRole(selectedKey.value, { permissions: [...working.permissions] })
    // updateRole 已重新拉取 roles，同步 working
    working.permissions = [...(store.roles.find(r => r.id === selectedKey.value)?.permissions || [])]
    toast.success('已保存')
  } catch (e) {
    toast.error(e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([store.fetchRoles(), store.fetchPermissionCatalog()])
    if (store.roles.length) selectRole(store.roles[0].id)
  } catch (e) {
    toast.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="flex flex-1 min-h-0" v-loading="loading">
    <!-- 左：11 系统角色列表（10 职责 + 系统管理员） -->
    <div class="w-[220px] border-r border-[#dcdfe6] overflow-auto shrink-0 bg-white">
      <div class="px-3 pt-3 pb-1 text-xs font-semibold text-[#909399]">系统角色（11）</div>
      <div
        v-for="r in store.roles"
        :key="r.id"
        class="px-3 py-2.5 cursor-pointer flex items-center justify-between hover:bg-[#f5f7fa]"
        :class="selectedKey === r.id ? 'bg-[#ecf5ff] border-r-2 border-[#409eff]' : ''"
        @click="selectRole(r.id)"
      >
        <span class="text-xs" :class="selectedKey === r.id ? 'font-semibold text-[#409eff]' : ''">{{ r.name }}</span>
        <el-tag size="small" type="info" effect="plain">{{ r.id }}</el-tag>
      </div>
      <div class="px-3 py-2 text-[11px] text-[#c0c4cc] leading-relaxed">
        系统角色 = 10 职责 + 系统管理员。角色即职责：人员选择单一系统角色后，既决定菜单/页面权限，也决定维保步骤执行权限（见「人员管理」）。
      </div>
    </div>

    <!-- 右：选中角色详情 -->
    <div class="flex-1 overflow-auto p-3" v-if="selectedRole">
      <!-- 基本信息 -->
      <el-card shadow="never" class="mb-3">
        <template #header><span class="text-xs font-semibold">基本信息</span></template>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="font-semibold text-sm">{{ selectedRole.name }}</span>
          <el-tag size="small" type="primary" effect="plain">{{ selectedRole.id }}</el-tag>
          <span class="text-[#909399]">已勾选 {{ checkedCount }} / {{ allPerms.length }} 项</span>
        </div>
        <div class="mt-2 text-xs text-[#606266] leading-relaxed">{{ ROLE_DESC[selectedRole.id] || '' }}</div>
      </el-card>

      <!-- 系统操作权限 -->
      <el-card shadow="never" class="mb-3">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold">系统操作权限（模块 → 页面 → 动作）</span>
            <div class="flex items-center gap-2">
              <el-tag v-if="dirty" size="small" type="warning" effect="plain">未保存修改</el-tag>
              <el-button size="small" :disabled="!dirty" @click="restoreDefaults">恢复默认</el-button>
              <el-button type="primary" size="small" :loading="saving" :disabled="!dirty" @click="save">保存</el-button>
            </div>
          </div>
        </template>

        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="mb-3"
          title="页面级权限影响顶层导航与子页可见性；「查看」为页面访问基础，动作项（执行/编辑/审批等）按需勾选。角色即职责：本页配置的 11 个系统角色（10 职责 + 系统管理员），在「人员管理」中选定到人员后，直接决定其菜单可见性与维保步骤执行权限。"
        />

        <div
          v-for="(module, mk) in store.permissionCatalog"
          :key="mk"
          class="mb-4 pb-3 border-b border-[#ebeef5] last:border-0 last:mb-0"
        >
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-[#303133]">{{ module.name }}</span>
              <span class="text-[11px] text-[#c0c4cc]">{{ mk }}</span>
            </div>
            <el-checkbox
              size="small"
              :model-value="moduleAllState(mk)"
              :indeterminate="moduleIndeterminate(mk)"
              @change="v => toggleModuleAll(mk, !!v)"
            >全选本模块</el-checkbox>
          </div>

          <div v-for="(page, pk) in module.pages" :key="pk" class="ml-1 mb-2 pl-2 border-l-2 border-[#e4e7ed]">
            <div class="flex items-center gap-2 mb-1">
              <el-checkbox
                size="small"
                :model-value="pageAllState(mk, pk)"
                :indeterminate="pageIndeterminate(mk, pk)"
                @change="v => togglePageAll(mk, pk, !!v)"
              >
                <span class="text-xs font-semibold">{{ page.name }}</span>
              </el-checkbox>
            </div>
            <el-checkbox-group v-model="working.permissions" class="flex flex-wrap gap-x-2 gap-y-1">
              <el-checkbox v-for="(label, perm) in page.items" :key="perm" :value="perm" size="small" border>
                <span class="text-xs">{{ label }}</span>
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
        <div v-if="!Object.keys(store.permissionCatalog).length" class="text-center py-6 text-[#909399] text-xs">暂无权限目录</div>
      </el-card>
    </div>
    <div v-else class="flex-1 text-center py-8 text-[#909399]">请选择角色</div>
  </div>
</template>
