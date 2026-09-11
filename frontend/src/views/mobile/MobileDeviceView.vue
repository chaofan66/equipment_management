<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { fetchDeviceByCode } from '@/api/devices'
import StatusTag from '@/components/common/StatusTag.vue'
import iconDailyCheck from '@/assets/images/mt/daily-check.png'
import iconLevel1 from '@/assets/images/mt/level1.png'
import iconLevel2 from '@/assets/images/mt/level2.png'
import iconLubrication from '@/assets/images/mt/lubrication.png'
import iconInspection from '@/assets/images/mt/inspection.png'
import iconRepair from '@/assets/images/mt/repair.png'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const device = ref(null)
const errorMsg = ref('')

/** 与资产台账列表字段一致（按分组） */
const fieldGroups = [
  {
    title: '基本信息',
    fields: [
      { label: '资产编码', key: 'code' },
      { label: '资产名称', key: 'name' },
      { label: '规格/型号', key: 'spec' },
      { label: '资产类别编码', key: 'typeCode' },
      { label: '资产类别', key: 'type' },
      { label: '资产分类', key: 'assetCategory' },
      { label: '数量', key: 'qty' },
      { label: '计量单位', key: 'unit' },
      { label: '资产状况', key: 'status', type: 'status' },
    ],
  },
  {
    title: '配置信息',
    fields: [
      { label: '取得方式', key: 'acquisitionMethod' },
      { label: '投用日期', key: 'purchaseDate' },
      { label: '供应商', key: 'supplier' },
      { label: '合同编号', key: 'contractNo' },
      { label: '价值类型', key: 'valueType' },
      { label: '资产原值', key: 'value', type: 'money' },
    ],
  },
  {
    title: '财务信息',
    fields: [
      { label: '入账状态', key: 'bookingStatus', type: 'status' },
      { label: '折旧状态', key: 'depreciationStatus', type: 'status' },
      { label: '折旧方法', key: 'depreciationMethod' },
      { label: '使用月限', key: 'useMonths' },
      { label: '计提月份', key: 'accrualMonths' },
      { label: '资产净值', key: 'netValue', type: 'money' },
      { label: '入账日期', key: 'bookingDate' },
      { label: '记账凭证号', key: 'voucherNo' },
    ],
  },
  {
    title: '归属信息',
    fields: [
      { label: '归属单位', key: 'ownershipUnit' },
      { label: '管理部门编码', key: 'manageDeptCode' },
      { label: '管理部门', key: 'manageDept' },
      { label: '使用部门编码', key: 'useDeptCode' },
      { label: '使用部门', key: 'department' },
      { label: '使用人', key: 'person' },
      { label: '存放地点', key: 'area' },
      { label: '管理编号', key: 'manageNo' },
    ],
  },
  {
    title: '附属信息',
    fields: [
      { label: '出厂编号', key: 'factoryNo' },
      { label: '项目号', key: 'projectNo' },
      { label: '备注', key: 'remark' },
    ],
  },
]

const shortcuts = [
  {
    key: 'daily-check',
    label: '日常点检',
    desc: '班前班后',
    route: '/maintenance/daily-check',
    perms: ['mt.dailycheck.view', 'mt.dailycheck.execute'],
    icon: iconDailyCheck,
  },
  {
    key: 'level1',
    label: '一级保养',
    desc: '计划保养',
    route: '/maintenance/level1',
    perms: ['mt.level1.view', 'mt.level1.execute'],
    icon: iconLevel1,
  },
  {
    key: 'level2',
    label: '二级保养',
    desc: '深度保养',
    route: '/maintenance/level2',
    perms: ['mt.level2.view', 'mt.level2.execute'],
    icon: iconLevel2,
  },
  {
    key: 'lubrication',
    label: '润滑保养',
    desc: '润滑执行',
    route: '/maintenance/lubrication',
    perms: ['mt.lubrication.view', 'mt.lubrication.execute'],
    icon: iconLubrication,
  },
  {
    key: 'inspection',
    label: '定期检查',
    desc: '专项检查',
    route: '/maintenance/inspection',
    perms: ['mt.inspection.view', 'mt.inspection.execute'],
    icon: iconInspection,
  },
  {
    key: 'repair',
    label: '维修工单',
    desc: '报修处理',
    route: '/maintenance/repair',
    perms: ['mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch'],
    icon: iconRepair,
  },
]

const visibleShortcuts = computed(() =>
  shortcuts.filter(s => authStore.hasAnyPermission(s.perms)),
)

const roleLabel = computed(() => authStore.currentUser?.role?.name || '')

function formatMoney(val) {
  if (val === null || val === undefined || val === '') return '—'
  const n = Number(val)
  if (Number.isNaN(n)) return String(val)
  return n.toLocaleString('zh-CN')
}

function displayValue(field) {
  if (!device.value) return '—'
  const raw = device.value[field.key]
  if (field.type === 'money') return formatMoney(raw)
  if (raw === null || raw === undefined || raw === '') return '—'
  return raw
}

async function loadDevice() {
  const code = String(route.params.code || '').trim()
  if (!code) {
    errorMsg.value = '缺少资产编号'
    device.value = null
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    if (!authStore.loaded) await authStore.fetchCurrentUser()
    const res = await fetchDeviceByCode(code)
    device.value = res.data || null
    if (!device.value) errorMsg.value = '未找到该设备'
  } catch (e) {
    device.value = null
    errorMsg.value = e.response?.data?.error || e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function goShortcut(s) {
  if (!device.value?.code) return
  router.push({
    path: s.route,
    query: { deviceCode: device.value.code },
  })
}

watch(() => route.params.code, () => loadDevice())
onMounted(loadDevice)
</script>

<template>
  <div class="m-page" v-loading="loading">
    <div v-if="errorMsg" class="m-state">
      <div class="m-state-icon">!</div>
      <div class="m-state-title">无法打开设备</div>
      <div class="m-state-msg">{{ errorMsg }}</div>
      <button type="button" class="m-primary-btn" @click="loadDevice">重新加载</button>
    </div>

    <template v-else-if="device">
      <header class="m-hero">
        <div class="m-hero-bg" aria-hidden="true" />
        <div class="m-hero-body">
          <div class="m-hero-top">
            <span class="m-chip">设备档案</span>
            <StatusTag v-if="device.status" :status="device.status" />
          </div>
          <h1 class="m-hero-name">{{ device.name || '未命名设备' }}</h1>
          <p class="m-hero-code">{{ device.code }}</p>
          <div class="m-hero-meta">
            <span v-if="device.department" class="m-meta-pill">{{ device.department }}</span>
            <span v-if="device.area" class="m-meta-pill m-meta-pill--ghost">{{ device.area }}</span>
          </div>
        </div>
      </header>

      <div class="m-body">
        <!-- 台账全部分组字段 -->
        <section
          v-for="group in fieldGroups"
          :key="group.title"
          class="m-panel"
        >
          <div class="m-panel-head">
            <h2 class="m-panel-title">{{ group.title }}</h2>
          </div>
          <div class="m-kv">
            <div v-for="f in group.fields" :key="f.key" class="m-kv-row">
              <span class="m-kv-k">{{ f.label }}</span>
              <span class="m-kv-v">
                <StatusTag v-if="f.type === 'status'" :status="device[f.key]" />
                <template v-else>{{ displayValue(f) }}</template>
              </span>
            </div>
          </div>
        </section>

        <!-- 维保快捷入口 -->
        <section class="m-panel m-panel--actions">
          <div class="m-panel-head">
            <h2 class="m-panel-title">维保快捷入口</h2>
            <span v-if="roleLabel" class="m-role">{{ roleLabel }}</span>
          </div>

          <div v-if="!visibleShortcuts.length" class="m-empty">
            <p>当前角色暂无可操作的维保入口</p>
          </div>

          <div v-else class="m-grid">
            <button
              v-for="s in visibleShortcuts"
              :key="s.key"
              type="button"
              class="m-action"
              @click="goShortcut(s)"
            >
              <span class="m-action-icon" aria-hidden="true">
                <img :src="s.icon" :alt="s.label" />
              </span>
              <span class="m-action-text">
                <span class="m-action-label">{{ s.label }}</span>
                <span class="m-action-desc">{{ s.desc }}</span>
              </span>
              <span class="m-action-arrow" aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.m-page {
  min-height: 100%;
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(17, 146, 232, 0.12), transparent 55%),
    radial-gradient(90% 60% at 100% 10%, rgba(15, 118, 110, 0.08), transparent 50%),
    #eef2f6;
  box-sizing: border-box;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
}

.m-hero {
  position: relative;
  color: #fff;
  overflow: hidden;
}
.m-hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, #0b6cb3 0%, #1192E8 48%, #0f766e 120%);
}
.m-hero-bg::after {
  content: '';
  position: absolute;
  right: -20%;
  top: -30%;
  width: 70%;
  height: 120%;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
}
.m-hero-body {
  position: relative;
  z-index: 1;
  padding: 18px 16px 22px;
}
.m-hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.m-chip {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.28);
}
.m-hero-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
}
.m-hero-code {
  margin: 8px 0 0;
  font-size: 13px;
  opacity: 0.92;
  font-variant-numeric: tabular-nums;
}
.m-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.m-meta-pill {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.95);
  color: #0b6cb3;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.m-meta-pill--ghost {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.28);
}

.m-body {
  margin-top: -10px;
  padding: 0 12px;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.m-panel {
  background: #fff;
  border-radius: 14px;
  padding: 14px 14px 6px;
  box-shadow: 0 8px 24px rgba(15, 40, 70, 0.06);
}
.m-panel--actions {
  padding-bottom: 14px;
}
.m-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.m-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}
.m-role {
  font-size: 11px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 3px 8px;
  border-radius: 999px;
}

.m-kv-row {
  display: flex;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 13px;
  line-height: 1.4;
  align-items: flex-start;
}
.m-kv-row:last-child {
  border-bottom: none;
}
.m-kv-k {
  width: 92px;
  flex-shrink: 0;
  color: #94a3b8;
}
.m-kv-v {
  flex: 1;
  min-width: 0;
  color: #1f2937;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
  display: flex;
  justify-content: flex-end;
}

.m-empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 20px 8px;
}

.m-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.m-action {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 12px 12px 10px;
  border: 1px solid #e8eef5;
  border-radius: 12px;
  background: #f8fafc;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.m-action:active {
  transform: scale(0.985);
  background: #fff;
}
.m-action-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: #f1f5f9;
  overflow: hidden;
}
.m-action-icon img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  display: block;
}
.m-action-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-action-label {
  font-size: 15px;
  font-weight: 650;
  color: #111827;
}
.m-action-desc {
  font-size: 12px;
  color: #94a3b8;
}
.m-action-arrow {
  color: #cbd5e1;
  font-size: 22px;
  line-height: 1;
}

.m-state {
  margin: 48px 16px;
  text-align: center;
  padding: 28px 20px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(15, 40, 70, 0.06);
}
.m-state-icon {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: #fee2e2;
  color: #e11d48;
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-state-title {
  font-size: 16px;
  font-weight: 700;
  color: #1f2937;
}
.m-state-msg {
  margin: 8px 0 18px;
  font-size: 13px;
  color: #94a3b8;
}
.m-primary-btn {
  border: none;
  background: #1192E8;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 22px;
  border-radius: 10px;
  cursor: pointer;
}
</style>
