<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useToast } from '@/composables/useToast'
import V2PlanDrawer from '@/components/maintenance/V2PlanDrawer.vue'
import { fetchV2Plans } from '@/api/maintenance'

// V1.5：一级/二级保养任务列表（对应级别已排期任务，按月+车间筛选，点行打开 V2PlanDrawer 执行）
// V1.56：月度报表回退——一/二级/润滑非每日检查（一个月几次），不再对齐日常点检网格，改回 V1.31/V1.32 月度汇总 KPI + 明细表，按年月+车间取数
const route = useRoute()
const devicesStore = useDevicesStore()
const toast = useToast()

// 级别由路由 meta 决定（level1=一级保养 / level2=二级保养 / lubrication=设备润滑）
const level = computed(() => route.meta.level || 'level1')
const levelLabel = computed(() => ({ level1: '一级保养', level2: '二级保养', lubrication: '设备润滑' }[level.value] || '一级保养'))

// 顶部筛选：年份+月份（默认当月）+车间（默认全部车间，前端按设备本地过滤）
const selectedYear = ref(new Date().getFullYear())
const selectedMonth = ref(new Date().getMonth() + 1)
const selectedWorkshop = ref('')
// V1.31：页内子标签（保养列表 / 月度报表），仿日常点检 今日/月度 切换
const activeTab = ref('tasks') // 'tasks' | 'report'

const years = [2025, 2026, 2027]
const months = Array.from({ length: 12 }, (_, i) => i + 1)

// 车间列表 / 设备归属（来自设备台账，同源）
const workshopOptions = computed(() => {
  const set = new Set()
  devicesStore.list.forEach(d => d.workshop && set.add(d.workshop))
  return Array.from(set).sort()
})
const deviceMap = computed(() => {
  const m = {}
  devicesStore.list.forEach(d => { m[d.code] = d })
  return m
})

// ===================== V1.62：资产类型（大类/中类/小类路径）反查 + 三级级联树（列表列/筛选） =====================
const deviceTypeOf = row => deviceMap.value[row.deviceCode]?.type || '—'
const assetTypeOptions = computed(() => {
  const tree = {}
  devicesStore.list.forEach(d => {
    (d.type || '').split('/').filter(Boolean).reduce((n, s) => n[s] || (n[s] = {}), tree)
  })
  const toOpts = obj => Object.keys(obj).map(k => {
    const c = toOpts(obj[k])
    return { label: k, value: k, ...(c.length ? { children: c } : {}) }
  })
  return toOpts(tree)
})
const kwFilter = ref('')
const typeFilter = ref([])

// 任务列表：按 级别+年份+月份 从后端取，车间前端本地过滤
const loading = ref(false)
const tasks = ref([])
async function loadTasks() {
  loading.value = true
  try {
    const res = await fetchV2Plans({ projectType: level.value, year: selectedYear.value, month: selectedMonth.value })
    tasks.value = res.data || []
  } catch (e) {
    toast.error(e.message || '加载失败')
    tasks.value = []
  } finally { loading.value = false }
}
const filteredTasks = computed(() => {
  if (!selectedWorkshop.value) return tasks.value
  return tasks.value.filter(t => deviceMap.value[t.deviceCode]?.workshop === selectedWorkshop.value)
})

// V1.32：状态筛选（仅作用于保养列表，月度报表不受影响——否则筛到「已归档」后报表完成率恒 100% 失真）
// V1.62：列表统一筛选——车间（filteredTasks）→ 搜索（名称/编号）→ 资产类型级联 → 状态
const statusFilter = ref('') // '' = 全部
const statusOptions = ['待执行', '进行中', '已超期', '已归档', '已顺延', '已作废']
const listRows = computed(() => {
  let list = filteredTasks.value
  const k = kwFilter.value.trim()
  if (k) list = list.filter(t => (t.deviceCode || '').includes(k) || (t.deviceName || '').includes(k))
  if (typeFilter.value.length) {
    const pre = typeFilter.value.join('/')
    list = list.filter(t => deviceTypeOf(t).startsWith(pre))
  }
  if (statusFilter.value) list = list.filter(t => t.status === statusFilter.value)
  return list
})

// 状态配色（局部 map，不动共享 StatusTag）
const statusType = { 待执行: 'warning', 进行中: 'primary', 已超期: 'danger', 已归档: 'success', 已顺延: 'info', 已作废: 'info' }

// ===================== V1.60：开始执行时间 / 结束时间 =====================
// 计划级 startedAt（首次提交）/ completedAt（归档）由后端 advanceStep 写入；旧单无字段回退步骤签名时间
const fmtDT = v => (v || '').replace('T', ' ').substring(0, 16) || '—'
const planStart = p => {
  if (p.startedAt) return fmtDT(p.startedAt)
  const s = (p.steps || []).find(s => s.status === 'done' && s.signatures?.[0]?.date)
  return s ? fmtDT(s.signatures[0].date) : '—'
}
const planEnd = p => {
  if (p.completedAt) return fmtDT(p.completedAt)
  if (p.status !== '已归档') return '—'
  const done = (p.steps || []).filter(s => s.status === 'done')
  const last = done[done.length - 1]
  return last?.signatures?.[0]?.date ? fmtDT(last.signatures[0].date) : '—'
}

function currentStepText(row) {
  const s = row.steps?.find(x => x.status !== 'done')
  return s ? `第${s.seq}步 · ${s.name}` : '—'
}
function workshopOf(row) { return deviceMap.value[row.deviceCode]?.workshop || '—' }

const drawerRef = ref(null)
function onDone() { loadTasks() }

watch([selectedYear, selectedMonth, selectedWorkshop], loadTasks)
// V1.5：level1/level2 共用本组件，切 tab 时 Vue Router 复用实例（onMounted 不重触发）→ 必须监听 level 变化重新加载
watch(level, loadTasks)

// ===================== V1.31/V1.32 月度报表：月度汇总 KPI + 明细表（V1.56 回退，不再对齐日常点检） =====================
// 一/二级/润滑非每日检查（一个月几次），按 年月+车间 聚合 `filteredTasks`；明细表每行一张保养单含 保养项完成率
// V1.32：KPI 去「已顺延」「作废」两卡，剩 计划数/已归档/待执行/进行中/已超期 5 卡 + 完成率圆环
const reportSummary = computed(() => {
  const list = filteredTasks.value
  const done = list.filter(t => t.status === '已归档').length
  const pending = list.filter(t => t.status === '待执行').length
  const doing = list.filter(t => t.status === '进行中').length
  const overdue = list.filter(t => t.status === '已超期').length
  const rate = list.length ? Number((done / list.length * 100).toFixed(1)) : 0
  return { total: list.length, done, pending, doing, overdue, rate }
})
const rateColor = computed(() => reportSummary.value.rate >= 100 ? '#67c23a' : reportSummary.value.rate >= 60 ? '#e6a23c' : '#f56c6c')
// 保养项完成率（V1.29 checked 数据源；items 无 → null 显 —）
function itemRate(row) {
  const items = row.items || []
  if (!items.length) return null
  const checked = items.filter(i => i.checked).length
  return { total: items.length, checked, rate: Number((checked / items.length * 100).toFixed(1)) }
}

onMounted(async () => {
  if (!devicesStore.list.length) await devicesStore.fetchList({ pageSize: 5000 })
  await loadTasks()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- 顶部筛选 -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0 flex-wrap">
      <span class="text-sm font-semibold">{{ levelLabel }}</span>
      <el-radio-group v-model="activeTab" size="small">
        <el-radio-button value="tasks">保养列表</el-radio-button>
        <el-radio-button value="report">月度报表</el-radio-button>
      </el-radio-group>
      <!-- 年月+车间 两 tab 共用（月度报表按 年月+车间 聚合，V1.56 回退） -->
      <el-select v-model="selectedYear" size="small" style="width:100px">
        <el-option v-for="y in years" :key="y" :label="String(y)" :value="y" />
      </el-select>
      <el-select v-model="selectedMonth" size="small" style="width:90px">
        <el-option v-for="m in months" :key="m" :label="m + '月'" :value="m" />
      </el-select>
      <!-- V1.62：统一筛选（搜索/资产类型级联，仅列表显示，与状态筛选同） -->
      <el-input v-if="activeTab === 'tasks'" v-model="kwFilter" size="small" style="width:180px" clearable placeholder="资产名称/编号" />
      <el-cascader v-if="activeTab === 'tasks'" v-model="typeFilter" :options="assetTypeOptions" size="small" clearable placeholder="资产类型" :props="{ checkStrictly: true }" style="width:180px" />
      <el-select v-model="selectedWorkshop" size="small" style="width:200px" filterable clearable placeholder="全部车间">
        <el-option v-for="w in workshopOptions" :key="w" :label="w" :value="w" />
      </el-select>
      <!-- 状态筛选仅列表（V1.32：仅过滤列表，月度报表不受影响） -->
      <el-select v-if="activeTab === 'tasks'" v-model="statusFilter" size="small" style="width:120px" clearable placeholder="全部状态">
        <el-option v-for="s in statusOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <div class="flex-1" />
      <span v-if="activeTab === 'tasks'" class="text-xs text-[#909399]">该列表展示「保养计划」中已排期（勾选月份→保存生成）的{{ levelLabel }}任务</span>
      <el-button v-if="activeTab === 'tasks'" size="small" @click="loadTasks">刷新</el-button>
    </div>

    <!-- 保养列表（V1.32：去统计卡，仅保留 状态筛选；列表由 listRows 驱动） -->
    <template v-if="activeTab === 'tasks'">
    <div class="flex-1 overflow-auto p-3">
      <el-table v-loading="loading" :data="listRows" size="small" border stripe>
        <el-table-column label="设备编号" width="190">
          <template #default="{ row }">
            <span class="font-mono text-[#1192E8]">{{ row.deviceCode }}</span>
          </template>
        </el-table-column>
        <el-table-column label="设备名称" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.deviceName || '—' }}</template>
        </el-table-column>
        <!-- V1.62：加 资产类型/使用部门/规格型号 列，删「车间」列（移至筛选） -->
        <el-table-column label="资产类型" width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ deviceTypeOf(row) }}</template>
        </el-table-column>
        <el-table-column label="资产类别" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.assetClass || '—' }}</template>
        </el-table-column>
        <el-table-column label="使用部门" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.dept || '—' }}</template>
        </el-table-column>
        <el-table-column label="规格型号" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.spec || '—' }}</template>
        </el-table-column>
        <el-table-column label="开始执行时间" width="150">
          <template #default="{ row }">{{ planStart(row) }}</template>
        </el-table-column>
        <el-table-column label="结束执行时间" width="150">
          <template #default="{ row }">{{ planEnd(row) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType[row.status] || 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="drawerRef?.open(row.id)">处理</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="py-6 text-[#909399]">
            {{ statusFilter ? `「${statusFilter}」状态` : (selectedWorkshop ? `「${selectedWorkshop}」` : '') }}{{ statusFilter ? '下' : '' }}{{ selectedYear }}年{{ selectedMonth }}月暂无{{ statusFilter ? '' : '已排期的' }}{{ levelLabel }}任务——{{ statusFilter ? '可切换其他状态查看' : '可在「保养计划」对应 tab 勾选月份生成' }}
          </div>
        </template>
      </el-table>
    </div>
    </template>

    <!-- 月度报表（V1.56 回退：月度汇总 KPI + 明细表，不再对齐日常点检网格；取数按 年月+车间） -->
    <template v-else>
      <div class="flex-1 flex flex-col min-h-0 overflow-auto">
        <!-- 月度汇总 KPI：计划数/已归档/待执行/进行中/已超期 5 卡 + 完成率圆环 -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-3">
          <div class="stat-card">
            <div class="stat-value" style="color:#409eff">{{ reportSummary.total }}</div>
            <div class="stat-label">计划数</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#67c23a">{{ reportSummary.done }}</div>
            <div class="stat-label">已归档</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#e6a23c">{{ reportSummary.pending }}</div>
            <div class="stat-label">待执行</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#409eff">{{ reportSummary.doing }}</div>
            <div class="stat-label">进行中</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:#f56c6c">{{ reportSummary.overdue }}</div>
            <div class="stat-label">已超期</div>
          </div>
          <div class="stat-card flex items-center justify-between">
            <div>
              <div class="stat-value" :style="{ color: rateColor }">{{ reportSummary.rate }}%</div>
              <div class="stat-label">完成率</div>
            </div>
            <el-progress type="circle" :percentage="reportSummary.rate" :width="52" :stroke-width="6" :color="rateColor" />
          </div>
        </div>
        <!-- 明细表：每行一张保养单，含 保养项完成率（:data 用 filteredTasks，不受状态筛选影响） -->
        <div class="px-3 pb-3">
          <el-table :data="filteredTasks" size="small" border stripe>
            <el-table-column label="计划日期" width="110">
              <template #default="{ row }">{{ row.planDate || '—' }}</template>
            </el-table-column>
            <el-table-column label="设备编号" width="190">
              <template #default="{ row }">
                <span class="font-mono text-[#1192E8]">{{ row.deviceCode }}</span>
              </template>
            </el-table-column>
            <el-table-column label="设备名称" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.deviceName || '—' }}</template>
            </el-table-column>
            <el-table-column label="资产类别" width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.assetClass || '—' }}</template>
            </el-table-column>
            <el-table-column label="车间" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ workshopOf(row) }}</template>
            </el-table-column>
            <el-table-column label="当前步骤" min-width="140">
              <template #default="{ row }">{{ currentStepText(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType[row.status] || 'info'">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="保养项完成率" min-width="180">
              <template #default="{ row }">
                <template v-if="itemRate(row)">
                  <el-progress :percentage="itemRate(row).rate" :stroke-width="8" style="width:140px;display:inline-block;vertical-align:middle;margin-right:8px;" />
                  <span class="text-xs text-[#909399]">{{ itemRate(row).checked }}/{{ itemRate(row).total }}</span>
                </template>
                <span v-else class="text-xs text-[#909399]">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="drawerRef?.open(row.id)">处理</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="py-6 text-[#909399]">{{ selectedYear }}年{{ selectedMonth }}月暂无{{ levelLabel }}计划——可在「保养计划」对应 tab 勾选月份生成</div>
            </template>
          </el-table>
        </div>
      </div>
    </template>

    <V2PlanDrawer ref="drawerRef" @done="onDone" />
  </div>
</template>

<style scoped>
.stat-card { background:#fff; border-left:3px solid #409eff; border-radius:4px; padding:10px 12px; box-shadow:0 1px 2px rgba(0,0,0,.06); }
.stat-value { font-size:24px; font-weight:700; line-height:1.2; }
.stat-label { font-size:12px; color:#606266; margin-top:2px; }
</style>
