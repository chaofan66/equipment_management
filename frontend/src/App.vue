<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchPersonnel, fetchRoles } from '@/api/config'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const toast = useToast()

const tabs = [
  { key: 'dashboard', label: '设备总览', route: '/dashboard', perms: ['dashboard.view'] },
  { key: 'ledger', label: '资产台账', route: '/ledger', perms: ['ledger.view'] },
  {
    key: 'maintenance', label: '维保管理', route: '/maintenance',
    perms: ['mt.main.view', 'mt.dailycheck.view', 'mt.plans.view', 'mt.level1.view', 'mt.level2.view',
      'mt.inspection.view', 'mt.repair.view', 'mt.training.view', 'mt.stdconfig.view']
  },
  { key: 'approval', label: '流转审批', route: '/approval', perms: ['approval.view'] },
  {
    key: 'config', label: '系统配置', route: '/config',
    perms: ['config.view', 'config.dict.view', 'config.assettypes.view', 'config.deptws.view',
      'config.params.view', 'config.roles.view', 'config.personnel.view']
  }
]

const visibleTabs = computed(() => {
  return tabs.filter(t => authStore.hasAnyPermission(t.perms))
})

const activeTab = computed(() => {
  return route.meta.tab || 'dashboard'
})

function goTab(tab) {
  router.push(tab.route)
}

// ===================== 顶部右上角：人员/角色切换（V1.10） =====================
// 下拉列出全部人员（GET /config/personnel + GET /config/roles 标注系统角色标签），
// 点选即 switch-user（后端 POST /auth/switch-user 改写 CURRENT_USER）→ reload 全量重灌权限。
const personnelOptions = ref([])
const roleNameMap = ref({})
const switchLoaded = ref(false)
let switchLoading = false

const switchOptions = computed(() => {
  return personnelOptions.value
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map(p => ({ ...p, roleName: roleNameMap.value[p.roleId] || p.roleId }))
})

const currentRoleName = computed(() => authStore.currentUser?.role?.name || '')

async function loadSwitchOptions() {
  if (switchLoaded.value || switchLoading) return
  switchLoading = true
  try {
    const [per, rs] = await Promise.all([fetchPersonnel(), fetchRoles()])
    personnelOptions.value = per.data || []
    roleNameMap.value = Object.fromEntries((rs.data || []).map(r => [r.id, r.name]))
    switchLoaded.value = true
  } catch (e) {
    toast.error(e.message || '加载人员列表失败')
  } finally {
    switchLoading = false
  }
}

function onSwitchVisible(visible) {
  if (visible) loadSwitchOptions()
}

async function onSwitchUser(personnelId) {
  // 当前人员项置灰不可选，此处再兜底
  if (!personnelId || personnelId === authStore.currentUser?.personnelId) return
  try {
    await authStore.switchUser(personnelId)
    window.location.reload()
  } catch (e) {
    toast.error(e.message || '切换失败')
  }
}

onMounted(async () => {
  await authStore.fetchCurrentUser()
})
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- Header -->
    <header class="w-full bg-[#f3f3f5] border-b border-[#d5d5d7] h-12 flex items-center justify-between px-3 shrink-0">
      <div class="flex items-center">
        <button class="w-6 h-6 flex items-center justify-center mr-[22px]">
          <img src="@/assets/images/icon_菜单.png" alt="" class="w-6 h-6">
        </button>
        <div class="flex items-center h-5">
          <img src="@/assets/images/icon_logo.png" alt="Logo" class="h-5" style="width:106px">
          <span class="w-px h-3 bg-[#dcdfe6] mx-2"></span>
          <span class="text-[14px] text-[#303133] whitespace-nowrap select-none">恒力重工CIMS</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <el-dropdown trigger="click" @visible-change="onSwitchVisible" @command="onSwitchUser">
          <span
            class="text-[12px] text-[#697077] cursor-pointer outline-none"
            title="点击切换登录用户/角色"
          >{{ authStore.currentUser?.display || '恒力造船（大连）有限公司' }}<template v-if="currentRoleName"> · {{ currentRoleName }}</template></span>
          <template #dropdown>
            <el-dropdown-menu class="!max-h-[70vh] !overflow-y-auto">
              <el-dropdown-item
                v-for="p in switchOptions"
                :key="p.id"
                :command="p.id"
                :disabled="p.id === authStore.currentUser?.personnelId"
              >
                <span class="inline-flex items-center gap-1 whitespace-nowrap">
                  <span>{{ p.name }} ({{ p.employeeId }}) {{ p.dept }}</span>
                  <el-tag size="small" effect="plain">{{ p.roleName }}</el-tag>
                </span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="w-6 h-6 flex items-center justify-center">
          <img src="@/assets/images/icon_rightMenu.svg" alt="" class="w-6 h-6">
        </button>
      </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="w-full bg-[#f3f3f5] border-b border-[#dcdfe6] h-7 flex items-center px-1 shrink-0">
      <template v-for="(tab, i) in visibleTabs" :key="tab.key">
        <button
          class="text-[12px] rounded px-[20px] py-[2px] h-5 flex items-center flex-shrink-0 mr-1 tab-btn"
          :class="{ active: activeTab === tab.key }"
          :style="activeTab === tab.key ? '' : 'color:#606266'"
          @click="goTab(tab)"
        >{{ tab.label }}</button>
        <span v-if="i < visibleTabs.length - 1" class="w-px h-3 bg-[#dcdfe6] flex-shrink-0 mr-1"></span>
      </template>
    </nav>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-h-0">
      <router-view />
    </div>

    <!-- Toast/Modal handled globally by Element Plus -->
  </div>
</template>
