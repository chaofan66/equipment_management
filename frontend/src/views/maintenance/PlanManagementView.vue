<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useToast } from '@/composables/useToast'
import V2PlanDrawer from '@/components/maintenance/V2PlanDrawer.vue'
import { createV2PlansBatch, fetchV2PlanGrid } from '@/api/maintenance'

const devicesStore = useDevicesStore()
const toast = useToast()

const levelTab = ref('level1') // 'level1'(一级保养计划) | 'level2'(二级保养计划) | 'lubrication'(润滑计划)，级别由 tab 决定
// V1.17：级别名称/标签色 3 档（润滑镜像二级保养，05 设备润滑标准）
const levelLabels = { level1: '一级保养', level2: '二级保养', lubrication: '设备润滑' }
const levelTagType = { level1: 'success', level2: 'primary', lubrication: 'warning' }
// V1.17：空态文案按 tab 级别（润滑 → 05 设备润滑标准）
const emptyGridText = computed(() => {
  const tpl = levelTab.value === 'level1' ? '一级保养(03)' : levelTab.value === 'level2' ? '二级保养(04)' : '设备润滑(05)'
  const cat = categoryFilter.value
  return cat?.length ? `该车间「${cat.join(' / ')}」暂无配${tpl}标准的设备` : `该车间暂无配${tpl}标准的设备`
})
const selectedYear = ref(new Date().getFullYear())
const selectedWorkshop = ref('') // 车间必选（按车间管理）

// V1.4：资产类别筛选（大类/中类/小类级联，车间内收窄）＋一键整类排期
const categoryFilter = ref([]) // 如 ['起重设备','起重机'] 或 ['起重设备','起重机','通用桥式起重机']，空=不过滤
const cascaderProps = { checkStrictly: true, expandTrigger: 'hover' } // 固定引用：避免每次渲染新建对象致 cascader 重初始化回写 undefined
const batchDialogVisible = ref(false)
const batchMonths = ref([])

// 网格状态：rows(服务端行) / draft(勾选草稿) / baseline(加载快照)
const gridLoading = ref(false)
const saving = ref(false)
const rows = ref([])
const draft = ref({})     // { deviceCode: { m: true|false } }
const baseline = ref({})  // { deviceCode: { m: true|false } }

const drawerRef = ref(null)

const months = Array.from({ length: 12 }, (_, i) => i + 1)

// 车间列表（来自设备台账，去重）
const workshopOptions = computed(() => {
  const set = new Set()
  devicesStore.list.forEach(d => d.workshop && set.add(d.workshop))
  return Array.from(set).sort()
})

// 设备台账基础/归属信息数据源（网格列：全量设备按编码取，与资产台账同源）
const deviceMap = computed(() => {
  const m = {}
  devicesStore.list.forEach(d => { m[d.code] = d })
  return m
})
function deviceField(row, key) {
  const d = deviceMap.value[row.deviceCode]
  return d && d[key] !== undefined && d[key] !== null ? String(d[key]) : ''
}

// V1.4：资产类别筛选选项——当前车间设备的 type（"大类/中类/小类"）去重构建级联树（type 段数 1~3 可变）
const categoryOptions = computed(() => {
  const root = {}
  devicesStore.list.forEach(d => {
    if (selectedWorkshop.value && d.workshop !== selectedWorkshop.value) return
    const segs = String(d.type || '').split('/').map(s => s.trim()).filter(Boolean)
    if (!segs.length) return
    let node = root
    segs.forEach(seg => {
      if (!node[seg]) node[seg] = { label: seg, value: seg, children: {} }
      node = node[seg].children
    })
  })
  const toArr = obj => Object.values(obj).map(n => {
    const children = toArr(n.children)
    const item = { label: n.label, value: n.value }
    if (children.length) item.children = children
    return item
  })
  return toArr(root)
})
// V1.4：资产类别筛选（前端本地过滤）——设备 type 分段逐段前缀匹配所选 path
const filteredRows = computed(() => {
  const path = categoryFilter.value
  if (!path || !path.length) return rows.value
  return rows.value.filter(r => {
    const d = deviceMap.value[r.deviceCode]
    if (!d || !d.type) return false
    const segs = String(d.type).split('/').map(s => s.trim()).filter(Boolean)
    return path.every((p, i) => segs[i] === p)
  })
})
function onCategoryChange() { gridPage.value = 1 }

// ===================== 计划网格列定义（两层表头，源对齐 Excel《设备台账-1615-试验版-保养设置》设备台账 sheet；按需求去掉配置信息/财务信息/附属信息，职责信息不含） =====================
const MONTH_WIDTH = 46
const LEVEL_WIDTH = 80
const gridGroups = [
  {
    name: '基本信息',
    cols: [
      { key: 'index', label: '序号', width: 50, align: 'center' },
      { key: 'code', label: '资产编码', width: 150, mono: true },
      { key: 'name', label: '资产名称', width: 140 },
      { key: 'spec', label: '规格/型号', width: 110 },
      { key: 'type', label: '资产类别', width: 120 },
      { key: 'assetCategory', label: '资产分类', width: 70, align: 'center' },
      { key: 'qty', label: '数量', width: 50, align: 'center' },
      { key: 'unit', label: '计量单位', width: 70, align: 'center' },
      { key: 'status', label: '资产状况', width: 76, align: 'center' },
    ],
  },
  {
    name: '归属信息',
    cols: [
      { key: 'ownershipUnit', label: '归属单位', width: 170 },
      { key: 'department', label: '使用部门', width: 100 },
      { key: 'area', label: '存放地点', width: 130 },
      { key: 'manageNo', label: '管理编号', width: 110, mono: true },
    ],
  },
]
// 固定「保养计划」列组：返回该列 sticky right 偏移（级别列固定在最右月之后，最右的 12月 right:0）
function planColRight(key) {
  if (key === 'level') return MONTH_WIDTH * months.length
  return (months.length - key) * MONTH_WIDTH
}
const flatCols = gridGroups.flatMap(g => g.cols)
const gridTotalWidth = gridGroups.reduce((a, g) => a + g.cols.reduce((b, c) => b + c.width, 0), 0) + LEVEL_WIDTH + MONTH_WIDTH * months.length
// 通用台账字段单元格文本/提示
function cellText(row, c, i) {
  if (c.key === 'index') return (gridPage.value - 1) * gridPageSize.value + i + 1
  if (c.key === 'code') return row.deviceCode
  if (c.key === 'name') return row.deviceName
  return deviceField(row, c.key)
}
function cellTitle(row, c, i) {
  const v = String(cellText(row, c, i) ?? '')
  return v.length > 16 ? v : ''
}

// ===================== 计划网格分页（客户端分页；draft/baseline 保持全量，翻页不丢勾选） =====================
const gridPage = ref(1)
const gridPageSize = ref(20)
const gridTotal = computed(() => filteredRows.value.length)
const pagedRows = computed(() => {
  const start = (gridPage.value - 1) * gridPageSize.value
  return filteredRows.value.slice(start, start + gridPageSize.value)
})
function onGridPageChange(p) { gridPage.value = p }
function onGridSizeChange(s) { gridPage.value = 1; gridPageSize.value = s }

// V1.15：固定「保养计划」列组左侧投影——仅横向滚动（内容重叠）时显示
const gridScroller = ref(null)
const gridScrolled = ref(false)
function onGridScroll(e) { gridScrolled.value = (e.target?.scrollLeft ?? 0) > 0 }

// ===================== 计划网格（§5.3(3) V1.3 设备×12月 可勾选网格，级别由 tab 决定） =====================
async function loadGrid() {
  if (!selectedWorkshop.value) { rows.value = []; draft.value = {}; baseline.value = {}; return }
  gridPage.value = 1 // 车间/年份/tab 变化或保存刷新 → 回到第 1 页
  gridLoading.value = true
  try {
    const res = await fetchV2PlanGrid({ workshop: selectedWorkshop.value, year: selectedYear.value, level: levelTab.value })
    rows.value = res.data?.rows || []
    draft.value = {}
    baseline.value = {}
    rows.value.forEach(r => {
      const d = {}
      Object.keys(r.months || {}).forEach(m => { d[Number(m)] = true })
      draft.value[r.deviceCode] = { ...d }
      baseline.value[r.deviceCode] = { ...d }
    })
  } finally {
    gridLoading.value = false
    gridScrolled.value = (gridScroller.value?.scrollLeft ?? 0) > 0
  }
}

function isChecked(row, m) { return !!draft.value[row.deviceCode]?.[m] }
// V1.3：勾选仅确定保养月份，超期/作废逻辑不实现 → 已有保养单的月份锁定（不可勾选/取消）
function toggleMonth(row, m, checked) {
  if (!row.level) return
  if (planAt(row, m)) return
  if (!draft.value[row.deviceCode]) draft.value[row.deviceCode] = {}
  draft.value[row.deviceCode][m] = checked
}

// 该月已有（未作废）保养单
function planAt(row, m) { return row.months?.[m] || null }

// V1.4：过去的月份置灰不可勾选/点击（当月及以后仍可排；早于今年的年份全年置灰）
function isPastMonth(m) {
  const curY = new Date().getFullYear()
  if (selectedYear.value < curY) return true
  if (selectedYear.value > curY) return false
  return m < new Date().getMonth() + 1
}
// V1.4：状态配色（已归档=绿 / 已超期=红 / 待执行·进行中=蓝 / 新勾选=浅蓝），过去空月置灰不可点
function cellClass(row, m) {
  const plan = planAt(row, m)
  const checked = isChecked(row, m)
  if (!row.level) return 'cell-empty cell-disabled'
  if (plan && checked) {
    if (plan.status === '已归档') return 'cell-done'
    if (plan.status === '已超期') return 'cell-overdue'
    return 'cell-planned'
  }
  if (!plan && checked) return 'cell-checked'      // 新勾选 → 将生成
  if (isPastMonth(m)) return 'cell-past'           // 过去空月置灰
  return 'cell-empty'
}

// 点已有保养单的格子 → 打开处理抽屉（V1.4：过去的月份不可点击，含既有单）
function onCellClick(row, m) {
  if (isPastMonth(m)) return
  const plan = planAt(row, m)
  if (plan) drawerRef.value?.open(plan.planId)
}
function onDone() { loadGrid() }

// 草稿相对快照是否有变更
const gridDirty = computed(() => {
  for (const r of rows.value) {
    const cur = draft.value[r.deviceCode] || {}
    const base = baseline.value[r.deviceCode] || {}
    for (const m of months) { if (!!cur[m] !== !!base[m]) return true }
  }
  return false
})

// 保存：勾选月份按 tab 级别生成（§5.3(3) V1.3）；本次仅生成、不作废（超期/作废逻辑不实现）
async function saveGrid() {
  const added = []
  rows.value.forEach(r => {
    const cur = draft.value[r.deviceCode] || {}
    const base = baseline.value[r.deviceCode] || {}
    const addM = months.filter(m => cur[m] && !base[m])
    if (addM.length) added.push({ deviceCode: r.deviceCode, months: addM })
  })
  if (!added.length) { toast.info('无变更'); return }
  saving.value = true
  try {
    const payload = { workshop: selectedWorkshop.value, year: selectedYear.value, level: levelTab.value, items: added }
    const res = await createV2PlansBatch(payload)
    toast.success(res.data?.message || '已保存')
    await loadGrid()
  } catch (e) {
    toast.error(e.response?.data?.error || e.message || '保存失败')
    await loadGrid() // 刷新到服务端状态，避免脏基线
  } finally { saving.value = false }
}

function refresh() { loadGrid() }

// V1.4：一键整类排期——对当前筛选类别（车间内、配当前 tab 标准）全部设备批量勾选所选月份
function openBatchDialog() {
  batchMonths.value = []
  batchDialogVisible.value = true
}
function onBatchMonthToggle(m, checked) {
  const i = batchMonths.value.indexOf(m)
  if (checked && i < 0) batchMonths.value.push(m)
  if (!checked && i >= 0) batchMonths.value.splice(i, 1)
}
function applyBatchSchedule() {
  const sel = batchMonths.value.filter(m => !isPastMonth(m))
  if (!sel.length) { toast.info('请先选择要排期的月份'); return }
  let deviceCount = 0
  let monthCount = 0
  filteredRows.value.forEach(r => {
    if (!r.level) return
    let touched = false
    sel.forEach(m => {
      if (planAt(r, m)) return                       // 已有保养单的月份锁定
      if (!draft.value[r.deviceCode]) draft.value[r.deviceCode] = {}
      if (draft.value[r.deviceCode][m]) return
      draft.value[r.deviceCode][m] = true
      monthCount++
      touched = true
    })
    if (touched) deviceCount++
  })
  batchDialogVisible.value = false
  batchMonths.value = []
  toast.success(`已为 ${deviceCount} 台设备的 ${monthCount} 个月份勾选（已有保养单/过去月份自动跳过）`)
}

// 车间/年份/tab 变化 → 网格重载（loadGrid 重建 draft/baseline，切 tab 不残留上 tab 勾选）
watch([selectedYear, selectedWorkshop, levelTab], loadGrid)
// 切换车间 → 重置类别筛选（级联选项按车间构建）
watch(selectedWorkshop, () => { categoryFilter.value = [] })
// 防御：cascader 偶发回写 null/undefined 时归一为空数组（避免 categoryFilter.length 崩溃）
watch(categoryFilter, v => { if (v == null || !Array.isArray(v)) categoryFilter.value = [] })

onMounted(async () => {
  await devicesStore.fetchList({ pageSize: 5000 })
  if (!selectedWorkshop.value && workshopOptions.value.length) selectedWorkshop.value = workshopOptions.value[0]
  await loadGrid()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0 flex-wrap">
      <el-radio-group v-model="levelTab" size="small">
        <el-radio-button value="level1">一级保养计划</el-radio-button>
        <el-radio-button value="level2">二级保养计划</el-radio-button>
        <el-radio-button value="lubrication">润滑计划</el-radio-button>
      </el-radio-group>
      <el-select v-model="selectedYear" size="small" style="width:100px">
        <el-option v-for="y in [2025,2026,2027]" :key="y" :label="String(y)" :value="y" />
      </el-select>
      <el-select v-model="selectedWorkshop" size="small" style="width:200px" filterable placeholder="选择车间">
        <el-option v-for="w in workshopOptions" :key="w" :label="w" :value="w" />
      </el-select>
      <el-cascader
        v-model="categoryFilter"
        :options="categoryOptions"
        :props="cascaderProps"
        placeholder="资产类别筛选"
        clearable filterable size="small" style="width:210px"
        @change="onCategoryChange"
      />
      <div class="flex-1" />
      <span class="text-xs text-[#909399]">勾选月份=该设备该月保养1次 · 已完成=绿 / 超期未完成=红 · 过去的空月份置灰不可点</span>
      <el-button size="small" :disabled="!categoryFilter?.length" @click="openBatchDialog">批量排期</el-button>
      <el-button type="primary" size="small" :loading="saving" :disabled="!gridDirty" @click="saveGrid">保存计划</el-button>
      <el-button size="small" @click="refresh">刷新</el-button>
    </div>

    <!-- 设备×12月 可勾选网格（一级/二级保养计划 tab，级别由 tab 决定） -->
    <div class="flex flex-col flex-1 min-h-0">
      <div v-loading="gridLoading" ref="gridScroller" class="flex-1 overflow-auto" :class="{ 'plan-h-scrolled': gridScrolled }" @scroll="onGridScroll">
      <table class="plan-matrix" :style="{ minWidth: gridTotalWidth + 'px' }">
        <colgroup>
          <col v-for="c in flatCols" :key="c.key" :style="{ width: c.width + 'px' }" />
          <col :style="{ width: LEVEL_WIDTH + 'px' }" />
          <col v-for="m in months" :key="'m' + m" :style="{ width: MONTH_WIDTH + 'px' }" />
        </colgroup>
        <thead>
          <tr class="group-row">
            <th v-for="g in gridGroups" :key="g.name" :colspan="g.cols.length">{{ g.name }}</th>
            <th :colspan="1 + months.length" class="group-fixed">保养计划</th>
          </tr>
          <tr class="column-row">
            <th v-for="c in flatCols" :key="c.key" :class="{ 'text-center': c.align === 'center', 'text-right': c.align === 'right' }">{{ c.label }}</th>
            <th class="text-center fixed-right block-start" :style="{ right: planColRight('level') + 'px' }">保养级别</th>
            <th v-for="m in months" :key="m" class="text-center fixed-right" :style="{ right: planColRight(m) + 'px' }" :class="{ 'col-month-cur': m === new Date().getMonth() + 1 }">{{ m }}月</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in pagedRows" :key="row.deviceCode">
            <td v-for="c in flatCols" :key="c.key" class="text-xs" :class="{ 'text-center': c.align === 'center', 'text-right': c.align === 'right', mono: c.mono }" :title="cellTitle(row, c, i)">{{ cellText(row, c, i) }}</td>
            <!-- V1.17：后端已按 tab 级别过滤 → 行级别固定为该 tab 级别（一级绿 / 二级蓝 / 润滑橙） -->
            <td class="text-center fixed-right cell-level block-start" :style="{ right: planColRight('level') + 'px' }">
              <el-tag size="small" :type="levelTagType[row.level] || 'info'">{{ levelLabels[row.level] || '—' }}</el-tag>
            </td>
            <td v-for="m in months" :key="m" class="cell-month text-center fixed-right" :style="{ right: planColRight(m) + 'px' }" :class="cellClass(row, m)" @click="onCellClick(row, m)">
              <div class="flex items-center justify-center" @click.stop>
                <el-checkbox size="small" :model-value="isChecked(row, m)" :disabled="!row.level || !!planAt(row, m) || isPastMonth(m)" @change="v => toggleMonth(row, m, !!v)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
        <div v-if="!gridLoading && !filteredRows.length" class="text-center py-8 text-[#909399]">
          {{ emptyGridText }}
        </div>
      </div>
      <div v-if="gridTotal" class="shrink-0 flex justify-end items-center bg-white border-t border-[#dcdfe6] px-3 py-2">
        <el-pagination
          :current-page="gridPage"
          :page-size="gridPageSize"
          :total="gridTotal"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="onGridPageChange"
          @size-change="onGridSizeChange"
        />
      </div>
    </div>

    <!-- V1.4：一键整类排期弹窗（选月份→应用到整类设备草稿；过去月份禁用） -->
    <el-dialog
      v-model="batchDialogVisible"
      :title="`批量排期：${(categoryFilter || []).join(' / ') || '未选类别'}`"
      width="420px"
      append-to-body
    >
      <div class="text-xs text-[#909399] mb-3">将对当前车间「{{ selectedWorkshop }}」、该类别全部设备勾选所选月份（已有保养单/过去月份自动跳过）。</div>
      <div class="flex flex-wrap gap-2">
        <el-checkbox
          v-for="m in months" :key="m"
          :model-value="batchMonths.includes(m)"
          :disabled="isPastMonth(m)"
          @change="v => onBatchMonthToggle(m, !!v)"
        >{{ m }}月</el-checkbox>
      </div>
      <template #footer>
        <el-button size="small" @click="batchDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" @click="applyBatchSchedule">确定排期</el-button>
      </template>
    </el-dialog>

    <V2PlanDrawer ref="drawerRef" @done="onDone" />
  </div>
</template>

<style scoped>
.plan-matrix { border-collapse: separate; border-spacing: 0; font-size: 12px; width: 100%; table-layout: fixed; }
.plan-matrix th, .plan-matrix td { border: 0; border-right: 1px solid #dcdfe6; border-bottom: 1px solid #dcdfe6; padding: 4px 6px; height: 32px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 两层表头：组头行顶 0，列头行顶 32px（=行高），均 sticky */
.plan-matrix thead th { background: #f5f7fa; font-weight: 600; color: #606266; position: sticky; }
.plan-matrix thead tr.group-row th { top: 0; z-index: 2; border-top: 1px solid #dcdfe6; }
.plan-matrix thead tr.column-row th { top: 32px; z-index: 1; }
/* separate 模型补表左边框（首列） */
.plan-matrix thead th:first-child,
.plan-matrix tbody td:first-child { border-left: 1px solid #dcdfe6; }
/* 固定「保养计划」列组（级别 + 1~12月）：最右 sticky，横向滚动保持可见 */
.plan-matrix thead tr.group-row th.group-fixed { right: 0; z-index: 3; }
.plan-matrix thead tr.column-row th.fixed-right { z-index: 2; }
.plan-matrix tbody td.fixed-right { position: sticky; z-index: 1; }
.cell-level { background: #fff; }
.cell-month { cursor: pointer; transition: background 0.15s; }
.cell-month:hover { background: #ecf5ff; } .col-month-cur { background: #f0f9ff; }
.col-month:hover { background: #ecf5ff; } .col-month-cur { background: #f0f9ff; }
.cell-empty { background: #fff; }
.cell-planned { background: #ecf5ff; }          /* 已有计划（待执行/进行中） */
.cell-done { background: #e1f3d8; }             /* 已归档 → 绿 */
.cell-overdue { background: #fde2e2; }          /* 已超期未完成 → 红 */
.cell-checked { background: #e6f7ff; }          /* 新勾选 → 将生成 */
.cell-disabled { background: #fafafa; }
.cell-past { background: #f5f5f5; cursor: not-allowed; }   /* V1.4：过去空月置灰不可点 */
.cell-past:hover { background: #f5f5f5; }                   /* 压过 .cell-month:hover */
.mono { font-family: monospace; }
/* V1.15：固定「保养计划」列组左缘投影——横向滚动（内容重叠）时显示，否则无 */
.plan-matrix .group-fixed,
.plan-matrix .block-start { box-shadow: none; transition: box-shadow .15s; }
.plan-h-scrolled .plan-matrix .group-fixed,
.plan-h-scrolled .plan-matrix .block-start { box-shadow: -8px 0 8px -6px rgba(0,0,0,.3); }
</style>
