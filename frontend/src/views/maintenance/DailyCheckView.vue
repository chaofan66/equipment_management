<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useToast } from '@/composables/useToast'
import V2PlanDrawer from '@/components/maintenance/V2PlanDrawer.vue'
import { fetchV2Plans, fetchDailyCheckReport, generateV2Daily } from '@/api/maintenance'

const devicesStore = useDevicesStore()
const toast = useToast()

// ===================== V1.57：月度报表取数周期 = 标准文件配置该月整月 =====================
// 废弃 26→25 跨月周期；取数周期 = 所选设备 02 模板【目标月整月】（后端权威，无起止日期选择），列头跟随 report.periodDays
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth() + 1) // 1-based（总体 KPI + 月度报表用）
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
// V1.62b：点检列表按【日】选择（日期选择器）；月度报表按【月】选择（月份选择器）
const listDate = ref(todayStr.value)   // 点检列表所选日期（YYYY-MM-DD，默认今日）
const reportMonth = computed({         // 月度报表所选月（YYYY-MM，同步 currentYear/currentMonth）
  get: () => `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}`,
  set: v => { if (v) { const [y, m] = v.split('-'); currentYear.value = +y; currentMonth.value = +m } },
})

// 网格列头 = report.periodDays（后端 YYYY-MM-DD 数组），label = {月}/{日}
const reportDays = computed(() => (report.value?.periodDays || []).map(ds => {
  const p = ds.split('-')
  return { key: ds, label: `${Number(p[1])}/${Number(p[2])}` }
}))

// ===================== 状态 =====================
const loading = ref(false)
const todayChecks = ref([])    // 今日点检单（fetchV2Plans date=today）
const report = ref(null)       // 单设备月报（fetchDailyCheckReport）
const reportPlans = ref([])    // 周期内该设备全部点检单（构建点检项×日网格）
const selectedDevice = ref('')
const activeTab = ref('today') // 'today' | 'report'

// 状态配色（V1.30：今日点检列表「状态」列按状态着色；局部 map，不动共享 StatusTag）
const statusType = { 待执行: 'warning', 进行中: 'primary', 已超期: 'danger', 已归档: 'success', 已过期: 'info' }
const isPastListDate = computed(() => listDate.value < todayStr.value)

// 列表展示态：过去日期且未归档完成 → 已过期（后端仍保留 待执行/已超期）
function displayStatus(row) {
  if (isPastListDate.value && row.status !== '已归档' && row.status !== '进行中') return '已过期'
  return row.status
}

// 班前/班后：过去日期一律不可操作；当日「待执行/进行中」可操作
function canOperatePlan(row) {
  if (isPastListDate.value) return false
  if (row.status === '已归档') return false
  return true
}

// 当日已归档：可点「详情」只读查看
function canViewDetail(row) {
  return !isPastListDate.value && row.status === '已归档'
}

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

// ===================== V1.62：点检列表统一筛选（搜索/资产类型级联/车间/状态，纯前端内存过滤） =====================
// 资产类型（大类/中类/小类路径）与车间不在 plan 上，经 deviceMap 反查台账 device（对齐 LevelTaskView）
const deviceMap = computed(() => {
  const m = {}
  devicesStore.list.forEach(d => { m[d.code] = d })
  return m
})
const deviceTypeOf = row => deviceMap.value[row.deviceCode]?.type || '—'
const workshopOf = row => deviceMap.value[row.deviceCode]?.workshop || '—'
const workshopOptions = computed(() => {
  const set = new Set()
  devicesStore.list.forEach(d => d.workshop && set.add(d.workshop))
  return Array.from(set).sort()
})
// 资产类型三级级联树（从台账 type 中文路径去重构建，段数 1~3；参考定期检查/台账级联模式）
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
const workshopFilter = ref('')
const statusFilter = ref('')
const filteredChecks = computed(() => {
  let list = todayChecks.value
  const k = kwFilter.value.trim()
  if (k) list = list.filter(p => (p.deviceCode || '').includes(k) || (p.deviceName || '').includes(k))
  if (typeFilter.value.length) {
    const pre = typeFilter.value.join('/')
    list = list.filter(p => deviceTypeOf(p).startsWith(pre))
  }
  if (workshopFilter.value) list = list.filter(p => workshopOf(p) === workshopFilter.value)
  if (statusFilter.value === '已过期') list = list.filter(p => displayStatus(p) === '已过期')
  else if (statusFilter.value) list = list.filter(p => p.status === statusFilter.value)
  return list
})

const drawerRef = ref(null)
const drawerPlanId = ref('')

// ===================== 设备下拉（全量：今日已生成点检单的设备，去重） =====================
// V1.1 全量设备生效（去白名单）：设备源 = 当日配 02 模板且惰性生成出单的设备
const checkDevices = computed(() => {
  const seen = new Set()
  const out = []
  todayChecks.value.forEach(p => {
    if (seen.has(p.deviceCode)) return
    seen.add(p.deviceCode)
    out.push({ code: p.deviceCode, name: p.deviceName })
  })
  return out
})

// ===================== V1.62b：月度报表月份驱动报表；点检列表按所选日期拉取 =====================
watch([currentYear, currentMonth], () => { loadReport() })
watch(listDate, () => loadTodayChecks())

// ===================== 点检列表（V1.62b：按所选日期拉取，日期选择器可查历史某天） =====================
async function loadTodayChecks() {
  try {
    const res = await fetchV2Plans({ projectType: 'daily_check', date: listDate.value })
    todayChecks.value = res.data || []
    // 默认选中第一台（全量设备）
    if (!selectedDevice.value && checkDevices.value.length) selectedDevice.value = checkDevices.value[0].code
  } catch (e) { toast.error(e.message) }
}

// 补生成所选日期点检（惰性生成，§5.3(4)）
async function genToday() {
  try {
    const res = await generateV2Daily({ date: listDate.value })
    toast.success(`已生成 ${listDate.value} 点检 ${res.data?.generated || 0} 张`)
    await loadTodayChecks()
  } catch (e) { toast.error(e.message) }
}

// ===================== 单设备月度报表（V1.57：取数周期 = 02 模板该月整月） =====================
async function loadReport() {
  if (!selectedDevice.value) { report.value = null; reportPlans.value = []; return }
  loading.value = true
  try {
    const [repRes, plansRes] = await Promise.all([
      fetchDailyCheckReport({ deviceCode: selectedDevice.value, year: currentYear.value, month: currentMonth.value }),
      fetchV2Plans({ projectType: 'daily_check', deviceCode: selectedDevice.value }),
    ])
    report.value = repRes.data
    // 周期内过滤（report.periodDays 为后端权威；模板不生效 → report=null）
    const days = report.value?.periodDays
    if (days?.length) {
      const start = days[0], end = days[days.length - 1]
      reportPlans.value = (plansRes.data || []).filter(p => p.planDate >= start && p.planDate <= end)
    } else {
      reportPlans.value = []
    }
  } catch (e) { toast.error(e.message) }
  finally { loading.value = false }
}

// 点检项×日网格（§5.6 报表1：网格 = 点检项×日）
// V1.18：02 单槽（仅班前 items）→ 网格仅班前检查项；班后为固定台时表单（台时行独立）
const gridItems = computed(() => {
  const map = new Map()
  reportPlans.value.forEach(p => {
    (p.items || []).forEach(it => { if (!map.has('b' + it.seq)) map.set('b' + it.seq, { key: 'b' + it.seq, seq: it.seq, project: it.project, content: it.content }) })
  })
  return Array.from(map.values()).sort((x, y) => x.seq - y.seq)
})
const planByDate = computed(() => {
  const m = new Map()
  reportPlans.value.forEach(p => m.set(p.planDate, p))
  return m
})
// V1.19 表头对齐：月度报表网格列头读单上 labels（上传 Excel 真实列名）；V1.26 无 labels 时表头留空（无回退硬编码）
const reportLabels = computed(() => reportPlans.value[0]?.labels || {})

function cellState(dayKey, item) {
  const p = planByDate.value.get(dayKey)
  if (!p) return ''
  if (p.status !== '已归档') return 'todo'
  const it = (p.items || []).find(i => i.seq === item.seq)
  return it?.state || ''
}
// 台时行
function afterShiftValue(dayKey, field) {
  const p = planByDate.value.get(dayKey)
  if (!p?.afterShift) return ''
  const v = p.afterShift[field]
  return v === '' || v === null || v === undefined ? '' : v
}
// 日状态：已归档/缺检/在途
function dayStatus(dayKey) {
  const p = planByDate.value.get(dayKey)
  if (p && p.status === '已归档') return 'done'
  if (report.value?.missedDays?.includes(dayKey)) return 'miss'
  if (p) return 'todo'
  return ''
}

// 设备月报 KPI（标题卡）
const deviceKpis = computed(() => [
  { label: '设备完好率', value: report.value?.availability ?? '—', unit: '%', color: '#67c23a' },
  { label: '设备利用率', value: report.value?.utilization ?? '—', unit: '%', color: '#1192E8' },
  { label: '设备故障率', value: report.value?.faultRate ?? '—', unit: '%', color: '#f56c6c' },
  { label: '计划停运率', value: report.value?.plannedStopRate ?? '—', unit: '%', color: '#e6a23c' },
])

function openPlan(plan) {
  if (!canOperatePlan(plan) && !canViewDetail(plan)) return
  drawerPlanId.value = plan.id
  drawerRef.value?.open(plan.id)
}
function onDone() { loadTodayChecks(); loadReport() }

watch(selectedDevice, () => loadReport())

onMounted(async () => {
  await Promise.all([devicesStore.fetchList({ pageSize: 5000 }), loadTodayChecks()])
  if (selectedDevice.value) await loadReport()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Toolbar（V1.57：废弃月份导航；月度报表取数周期=该月整月） -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0 flex-wrap">
      <el-radio-group v-model="activeTab" size="small">
        <el-radio-button value="today">点检列表</el-radio-button>
        <el-radio-button value="report">月度报表</el-radio-button>
      </el-radio-group>
      <!-- V1.62b：点检列表按【日】选择（日期选择器）；月度报表按【月】选择（月份选择器，只能选月） -->
      <el-date-picker v-if="activeTab === 'today'" v-model="listDate" type="date" value-format="YYYY-MM-DD" size="small" placeholder="选择日期" style="width:150px" />
      <el-date-picker v-if="activeTab === 'report'" v-model="reportMonth" type="month" value-format="YYYY-MM" size="small" placeholder="选择月份" style="width:120px" />
      <!-- V1.62：点检列表统一筛选（搜索/资产类型级联/车间/状态） -->
      <div v-if="activeTab === 'today'" class="flex items-center gap-2">
        <el-input v-model="kwFilter" size="small" style="width:180px" clearable placeholder="资产名称/编号" />
        <el-cascader v-model="typeFilter" :options="assetTypeOptions" size="small" clearable placeholder="资产类型" :props="{ checkStrictly: true }" style="width:180px" />
        <el-select v-model="workshopFilter" size="small" style="width:200px" filterable clearable placeholder="全部车间">
          <el-option v-for="w in workshopOptions" :key="w" :label="w" :value="w" />
        </el-select>
        <el-select v-model="statusFilter" size="small" style="width:110px" clearable placeholder="全部状态">
          <el-option v-for="s in ['待执行', '进行中', '已超期', '已归档', '已过期']" :key="s" :label="s" :value="s" />
        </el-select>
      </div>
      <div class="flex-1" />
      <el-select v-if="activeTab === 'report'" v-model="selectedDevice" size="small" filterable style="width:200px" placeholder="选择设备">
        <el-option v-for="d in checkDevices" :key="d.code" :label="`${d.name}（${d.code}）`" :value="d.code" />
      </el-select>
      <el-button size="small" @click="genToday">补生成</el-button>
      <span class="text-xs text-[#909399]">全量设备（配 02 点检标准即每天出单）· 日常点检按日历日逐日生成 · 班前检查 + 班后固定表单（台时）· 点检列表按日期选择查看某天 · 月度报表取数周期=所选月整月</span>
    </div>

    <div class="flex flex-1 min-h-0">
      <!-- V1.62：点检列表（按所选年/月，可切换历史月） -->
      <div v-if="activeTab === 'today'" v-loading="loading" class="flex-1 overflow-auto p-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs font-semibold text-[#606266]">{{ listDate }} 点检列表 · 共 {{ filteredChecks.length }} 台</span>
          <div class="flex-1" />
          <span class="text-xs text-[#909399]">过去日期：未完成显示「已过期」且不可操作；当日「进行中」可继续，「已归档」可点详情查阅</span>
        </div>
        <el-table :data="filteredChecks" size="small" border stripe empty-text="该日期暂无点检单（可点击「补生成」）">
          <!-- V1.60：点检编号列暂隐藏（保留代码，后续可恢复显示） -->
          <el-table-column v-if="false" label="点检编号" width="230">
            <template #default="{ row }"><span class="font-mono text-xs text-[#1192E8]">{{ row.checkNo || row.id }}</span></template>
          </el-table-column>
          <el-table-column prop="deviceCode" label="设备编号" width="185">
            <template #default="{ row }"><span class="font-mono text-[#1192E8]">{{ row.deviceCode }}</span></template>
          </el-table-column>
          <el-table-column prop="deviceName" label="设备名称" min-width="150" show-overflow-tooltip />
          <!-- V1.62：资产类型（大类/中类/小类路径，经 deviceMap 反查台账） -->
          <el-table-column label="资产类型" width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ deviceTypeOf(row) }}</template>
          </el-table-column>
          <el-table-column prop="assetClass" label="资产类别" width="90" />
          <el-table-column prop="dept" label="使用部门" width="100" show-overflow-tooltip />
          <el-table-column prop="spec" label="规格型号" min-width="150" show-overflow-tooltip />
          <el-table-column label="开始执行时间" width="150">
            <template #default="{ row }">{{ planStart(row) }}</template>
          </el-table-column>
          <el-table-column label="结束执行时间" width="150">
            <template #default="{ row }">{{ planEnd(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag size="small" :type="statusType[displayStatus(row)] || 'info'">{{ displayStatus(row) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canOperatePlan(row)" type="primary" link size="small" @click="openPlan(row)">班前/班后</el-button>
              <el-button v-else-if="canViewDetail(row)" type="primary" link size="small" @click="openPlan(row)">详情</el-button>
              <span v-else class="text-xs text-[#c0c4cc]">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 月度报表：点检项×日 网格（§5.6 报表1；V1.57 取数周期=该月整月） -->
      <div v-if="activeTab === 'report'" v-loading="loading" class="flex-1 overflow-auto">
        <div v-if="!selectedDevice" class="flex items-center justify-center h-full text-[#909399] text-sm">请选择设备查看月度点检报表</div>
        <div v-else-if="!report" class="flex items-center justify-center h-full text-[#f56c6c] text-sm">该设备当月未配置点检标准文件，标准不生效，请先在标准文件配置中为该月设置</div>
        <template v-else>
          <!-- 设备 KPI 摘要 -->
          <div class="flex items-center gap-4 px-3 py-2 bg-[#fafafa] border-b text-xs">
            <span class="font-mono text-[#1192E8] font-semibold">{{ report.deviceName }}（{{ report.deviceCode }}）</span>
            <el-tag size="small" type="info">取数周期 {{ report.period }} · {{ report.daysInPeriod }} 天</el-tag>
            <el-tag size="small" type="success">已点检 {{ report.checkDays }} 天 · 完成率 {{ report.checkCompletion }}%</el-tag>
            <el-tag v-if="report.missedDays?.length" size="small" type="danger">缺检 {{ report.missedDays.length }} 天</el-tag>
            <el-tag size="small" type="info">占用台时 {{ (report.runHours||0)+(report.faultStopHours||0)+(report.planStopHours||0) }}h（运行+故障+计划）</el-tag>
            <div class="flex-1" />
            <span v-for="k in deviceKpis" :key="k.label" class="flex items-center gap-1">
              <span class="text-[#909399]">{{ k.label }}</span>
              <b :style="{ color: k.color }">{{ k.value }}%</b>
            </span>
          </div>
          <!-- 台时汇总 -->
          <div class="flex items-center gap-5 px-3 py-1.5 bg-white border-b text-xs text-[#606266]">
            <span>运行台时：<b class="text-[#1192E8]">{{ report.runHours }}h</b></span>
            <span>故障停台：<b class="text-[#f56c6c]">{{ report.faultStopHours }}h</b></span>
            <span>计划停台：<b class="text-[#909399]">{{ report.planStopHours }}h</b></span>
            <span>完好天数：<b class="text-[#67c23a]">{{ report.healthyDays }}</b> / {{ report.daysInPeriod }}</span>
          </div>

          <!-- 网格 -->
          <div class="report-grid-wrapper p-2">
            <table class="report-grid">
              <thead>
                <tr>
                  <th class="col-seq">序号</th>
                  <th class="col-proj">{{ reportLabels.item }}</th>
                  <th class="col-content">{{ reportLabels.content }}</th>
                  <th v-for="d in reportDays" :key="d.key" class="col-day" :class="{ 'is-today': d.key === todayStr }">{{ d.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in gridItems" :key="item.key">
                  <td class="text-center text-xs text-[#909399]">{{ item.seq }}</td>
                  <td class="text-xs">{{ item.project }}</td>
                  <td class="text-xs">{{ item.content }}</td>
                  <td v-for="d in reportDays" :key="d.key" class="text-center text-xs"
                    :class="{ 'cell-normal': cellState(d.key, item) === '正常', 'cell-abnormal': cellState(d.key, item) === '异常', 'cell-na': cellState(d.key, item) === '停工', 'cell-todo': cellState(d.key, item) === 'todo' }">
                    {{ { '正常': '√', '异常': '×', '停工': '停', todo: '□', '': '' }[cellState(d.key, item)] }}
                  </td>
                </tr>
                <!-- 台时行 -->
                <tr>
                  <td class="text-center text-xs text-[#909399]">台</td>
                  <td class="text-xs" colspan="2">运行台时(h)</td>
                  <td v-for="d in reportDays" :key="d.key" class="text-center text-xs cell-runtime">{{ afterShiftValue(d.key, 'runHours') }}</td>
                </tr>
                <tr>
                  <td class="text-center text-xs text-[#909399]">故</td>
                  <td class="text-xs" colspan="2">故障停台(h)</td>
                  <td v-for="d in reportDays" :key="d.key" class="text-center text-xs cell-runtime" :class="{ 'cell-abnormal': afterShiftValue(d.key, 'faultStopHours') > 0 }">{{ afterShiftValue(d.key, 'faultStopHours') }}</td>
                </tr>
                <!-- 日状态行 -->
                <tr>
                  <td class="text-center text-xs text-[#909399]">态</td>
                  <td class="text-xs" colspan="2">日状态</td>
                  <td v-for="d in reportDays" :key="d.key" class="text-center text-xs"
                    :class="{ 'cell-done': dayStatus(d.key) === 'done', 'cell-miss': dayStatus(d.key) === 'miss', 'cell-todo': dayStatus(d.key) === 'todo' }">
                    {{ { done: '✓', miss: '缺', todo: '在途', '': '' }[dayStatus(d.key)] }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- 图例 -->
          <div class="flex items-center gap-4 px-3 py-2 text-xs text-[#909399] border-t bg-white">
            <span>图例：</span>
            <span class="legend legend-normal">√ 正常</span>
            <span class="legend legend-abnormal">× 异常</span>
            <span class="legend legend-na">停 停工</span>
            <span class="legend legend-miss">缺 缺检</span>
            <span class="legend legend-todo">□ 在途</span>
            <span class="ml-auto">取数周期 = 标准文件配置该月整月 · 检查项为班前区 · 台时随班后固定表单录入（§5.9(3)）</span>
          </div>
        </template>
      </div>
    </div>

    <V2PlanDrawer ref="drawerRef" :plan-id="drawerPlanId" @done="onDone" />
  </div>
</template>

<style scoped>
.report-grid-wrapper { overflow: auto; max-height: calc(100vh - 280px); }
.report-grid { border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.report-grid th, .report-grid td { border: 1px solid #dcdfe6; padding: 3px 6px; height: 26px; }
.report-grid th { background: #f5f7fa; font-weight: 600; color: #606266; position: sticky; top: 0; z-index: 1; }
.col-seq { width: 42px; text-align: center; }
.col-proj { width: 80px; }
.col-content { min-width: 220px; }
.col-day { width: 40px; text-align: center; font-size: 10px; }
.col-day.is-today { background: #f0f9ff; box-shadow: inset 0 0 0 1px #1192E8; }
.cell-normal { background: #f0fff0; color: #67c23a; font-weight: bold; }
.cell-abnormal { background: #fef0f0; color: #f56c6c; font-weight: bold; }
.cell-na { background: #f4f4f5; color: #c0c4cc; }
.cell-todo { background: #fffbe6; color: #e6a23c; }
.cell-runtime { min-width: 46px; color: #606266; }
.cell-done { background: #f0fff0; color: #67c23a; font-weight: bold; }
.cell-miss { background: #fef0f0; color: #f56c6c; font-weight: bold; }
.legend { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 2px; }
.legend-normal { background: #f0fff0; color: #67c23a; }
.legend-abnormal { background: #fef0f0; color: #f56c6c; }
.legend-na { background: #f4f4f5; color: #c0c4cc; }
.legend-miss { background: #fef0f0; color: #f56c6c; }
.legend-todo { background: #fffbe6; color: #e6a23c; }
</style>
