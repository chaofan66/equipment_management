<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMaintenanceStore } from '@/stores/maintenance'
import StatusTag from '@/components/common/StatusTag.vue'

const router = useRouter()
const store = useMaintenanceStore()
const loading = ref(false)
const calendarYear = ref(new Date().getFullYear())
const calendarMonth = ref(new Date().getMonth() + 1)

const overview = computed(() => store.dashboardOverview || {})
const stats = computed(() => overview.value.stats || {})
const kpi = computed(() => overview.value.kpi || {})
const completionRate = computed(() => overview.value.completionRate || { done: 0, total: 0, rate: 0 })

async function loadOverview() {
  loading.value = true
  try {
    await store.fetchDashboardOverview({ year: calendarYear.value, month: calendarMonth.value })
  } finally {
    loading.value = false
  }
}

function switchMonth(delta) {
  calendarMonth.value += delta
  if (calendarMonth.value < 1) { calendarMonth.value = 12; calendarYear.value-- }
  if (calendarMonth.value > 12) { calendarMonth.value = 1; calendarYear.value++ }
  loadOverview()
}

// ---- Row5 KPI 图表（overview.kpi，环形图） ----
const kpiCards = computed(() => [
  { title: '设备完好率', value: kpi.value.availability ?? '—', sub: `${kpi.value.totalDevices ?? 0} 台设备参与点检`, color: '#67c23a', path: '/maintenance/daily-check' },
  { title: '设备利用率', value: kpi.value.utilization ?? '—', sub: `运行 ${kpi.value.runHours ?? 0}h`, color: '#409eff', path: '/maintenance/daily-check' },
  { title: '设备故障率', value: kpi.value.faultRate ?? '—', sub: `故障停台 ${kpi.value.faultStopHours ?? 0}h`, color: '#f56c6c', path: '/maintenance/repair' },
  { title: '计划停运率', value: kpi.value.plannedStopRate ?? '—', sub: `计划停台 ${kpi.value.planStopHours ?? 0}h`, color: '#e6a23c', path: '/maintenance/daily-check' },
])

// ---- Row2 5 统计卡（overview.stats） ----
const statCards = computed(() => [
  { title: '本月待保养', value: stats.value.pendingPlans || 0, sub: '一级/二级/润滑', path: '/maintenance/plans', color: '#409eff' },
  { title: '本月待检查', value: stats.value.pendingInspections || 0, sub: '定期检查', path: '/maintenance/inspection', color: '#e6a23c' },
  { title: '待派工', value: stats.value.pendingDispatch || 0, sub: '故障报修', path: '/maintenance/repair', color: '#f56c6c' },
  { title: '超期未闭', value: stats.value.overdue || 0, sub: '计划 + 整改项', path: '/maintenance/inspection', color: '#e04040' },
  { title: '本月已完成', value: stats.value.completed || 0, sub: '保养+检查+维修', path: '', color: '#67c23a' },
])

// ---- Row3 日历 ----
const calendarDays = computed(() => {
  const y = calendarYear.value
  const m = calendarMonth.value - 1 // JS month 0-based
  const firstDay = new Date(y, m, 1).getDay() || 7 // Monday=1
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const events = overview.value.calendar || []
  const weeks = []
  let week = []
  for (let i = 1; i < firstDay; i++) week.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(calendarMonth.value).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dayEvents = events.filter(ev => (ev.date || '').substring(0, 10) === dateStr)
    week.push({ day: d, date: dateStr, events: dayEvents })
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }
  return weeks
})

// ---- Row3 超期预警（overview.overdueList） ----
const overduePlan = computed(() => (overview.value.overdueList && overview.value.overdueList.plan) || [])
const overdueRect = computed(() => (overview.value.overdueList && overview.value.overdueList.rect) || [])
function overduePlanPath(item) {
  return item.type === '检查' ? '/maintenance/inspection' : '/maintenance/plans'
}

// ---- Row3 TOP5（overview.topDepts） ----
const topDepts = computed(() => overview.value.topDepts || [])
const topMax = computed(() => topDepts.value[0]?.count || 1)

// ---- Row4 月度趋势（overview.trend，纯 CSS 分组柱状图） ----
const TREND_METRICS = [
  { key: 'availability', label: '完好率', color: '#409eff' },
  { key: 'utilization', label: '利用率', color: '#67c23a' },
  { key: 'faultRate', label: '故障率', color: '#f56c6c' },
  { key: 'plannedStopRate', label: '计划停运率', color: '#e6a23c' },
]
const trend = computed(() => (overview.value.trend || []).map(t => ({
  label: `${t.month}月`,
  bars: TREND_METRICS.map(mc => ({ ...mc, value: Math.max(0, Math.min(100, t[mc.key] ?? 0)) })),
})))

// ---- Row4 设备分类分布（overview.categoryDistribution） ----
const categoryDistribution = computed(() => overview.value.categoryDistribution || [])

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

function goTo(path) {
  if (path) router.push(path)
}

// 日历事件 6 类着色（projectType）：日常点检/一级保养/二级保养/设备润滑/定期检查/维修
const EVENT_COLORS = {
  daily_check: '#73b9ff',
  level1: '#409eff',
  level2: '#1e6fd9',
  lubrication: '#67c23a',
  periodic_inspection: '#e6a23c',
  repair: '#f56c6c',
}
function eventColor(ev) {
  return EVENT_COLORS[ev.projectType] || '#409eff'
}

onMounted(loadOverview)
</script>

<template>
  <div v-loading="loading" class="flex-1 overflow-auto p-4 bg-[#f5f7fa]">
    <!-- Row1: 5 统计卡 -->
    <div class="flex gap-4 mb-4">
      <div v-for="(card, key) in statCards" :key="key" class="flex-1">
        <el-card shadow="hover" class="stat-card cursor-pointer" :style="{ borderLeftColor: card.color }" @click="goTo(card.path)">
          <div class="stat-value" :style="{ color: card.color }">{{ card.value }}</div>
          <div class="stat-label">{{ card.title }}</div>
          <div class="stat-desc">{{ card.sub }}</div>
        </el-card>
      </div>
    </div>

    <!-- Row3: 日历 + 超期预警/TOP5 -->
    <el-row :gutter="16" class="mb-4">
      <!-- 日历 -->
      <el-col :span="14">
        <el-card shadow="never" class="calendar-card">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold">维保日历</span>
              <div class="flex items-center gap-2">
                <el-button size="small" @click="switchMonth(-1)">◀</el-button>
                <span class="text-sm">{{ calendarYear }}-{{ String(calendarMonth).padStart(2, '0') }}</span>
                <el-button size="small" @click="switchMonth(1)">▶</el-button>
              </div>
            </div>
          </template>
          <div class="calendar-watermark">{{ calendarMonth }}</div>
          <table class="calendar-table">
            <thead>
              <tr><th v-for="d in weekDays" :key="d" class="text-xs">{{ d }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(week, wi) in calendarDays" :key="wi">
                <td v-for="(day, di) in week" :key="di" class="cal-cell" :class="{ 'cal-empty': !day, 'cal-weekend': di >= 5 }">
                  <template v-if="day">
                    <div class="cal-day-num">{{ day.day }}</div>
                    <div class="cal-events">
                      <div v-for="(ev, ei) in day.events.slice(0, 2)" :key="ei"
                        class="cal-event text-xs truncate"
                        :style="{ background: eventColor(ev) }">
                        {{ ev.deviceName || ev.title || '维保' }}
                      </div>
                      <div v-if="day.events.length > 2" class="text-xs text-[#909399]">+{{ day.events.length - 2 }}</div>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="flex items-center gap-3 mt-2 text-xs text-[#909399]">
            <span>图例：</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#73b9ff"></span>日常点检</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#409eff"></span>一级保养</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#1e6fd9"></span>二级保养</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#67c23a"></span>设备润滑</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#e6a23c"></span>定期检查</span>
            <span class="flex items-center gap-1"><span class="dot" style="background:#f56c6c"></span>维修</span>
          </div>
        </el-card>
      </el-col>

      <!-- 超期预警 + TOP5（flex 撑满列高，消除列内底部空隙） -->
      <el-col :span="10">
        <div class="flex flex-col gap-3 h-full">
          <el-card shadow="never" class="flex-card flex-1">
            <template #header><span class="text-sm font-semibold">⏰ 超期预警</span></template>
            <div v-if="!overduePlan.length && !overdueRect.length" class="flex-1 flex items-center justify-center text-xs text-[#909399]">暂无超期任务 ✓</div>
            <div v-else class="flex flex-col flex-1">
              <!-- 计划超期（保养/检查） -->
              <div v-for="item in overduePlan" :key="'p-' + item.deviceCode + item.planDate"
                class="flex items-center gap-3 py-1 text-xs cursor-pointer hover:bg-[#f5f7fa]" @click="goTo(overduePlanPath(item))">
                <StatusTag status="已超期" />
                <span class="flex-1 truncate">{{ item.deviceName }}</span>
                <span class="text-[#909399]">{{ item.dept }}</span>
                <span class="text-[#909399]">{{ item.planDate }}</span>
                <span class="text-red-500 font-semibold">超期 {{ item.overdueDays }}天</span>
              </div>
              <!-- 整改超期 -->
              <div v-for="item in overdueRect" :key="'r-' + item.id"
                class="flex items-center gap-3 py-1 text-xs cursor-pointer hover:bg-[#f5f7fa]" @click="goTo('/maintenance/inspection')">
                <el-tag size="small" type="danger" effect="plain">整改</el-tag>
                <span class="flex-1 truncate">{{ item.deviceName }}</span>
                <span class="text-[#909399]">{{ item.dept }}</span>
                <span class="text-[#909399]">{{ item.deadline }}</span>
                <span class="text-red-500 font-semibold">超期 {{ item.overdueDays }}天</span>
              </div>
            </div>
          </el-card>

          <el-card shadow="never" class="flex-card flex-1">
            <template #header><span class="text-sm font-semibold">维保工作量 TOP5</span></template>
            <div v-if="!topDepts.length" class="flex-1 flex items-center justify-center text-xs text-[#909399]">暂无数据</div>
            <div v-else class="flex flex-col flex-1">
              <div v-for="(dept, i) in topDepts" :key="i" class="flex-1 flex flex-col justify-center">
                <div class="flex items-center gap-2 text-xs mb-1">
                  <span class="text-[#909399] w-5">{{ i + 1 }}</span>
                  <span class="flex-1">{{ dept.dept }}</span>
                  <span class="font-semibold">{{ dept.count }}</span>
                </div>
                <div class="bar-bg"><div class="bar-fill" :style="{ width: Math.min(100, (dept.count / topMax) * 100) + '%', background: i < 3 ? '#409eff' : '#909399' }"></div></div>
              </div>
            </div>
          </el-card>
        </div>
      </el-col>
    </el-row>

    <!-- Row4: 月度趋势 + 完成率环/分类分布 -->
    <el-row :gutter="16">
      <!-- 月度趋势（纯 CSS 分组柱状图，flex 撑满列高） -->
      <el-col :span="14">
        <el-card shadow="never" class="flex-card h-full">
          <template #header><span class="text-sm font-semibold">月度趋势（近 6 个月）</span></template>
          <div v-if="!trend.length" class="flex-1 flex items-center justify-center text-xs text-[#909399]">暂无数据</div>
          <div v-else class="flex flex-col flex-1 min-h-0">
            <div class="trend-chart">
              <div v-for="(t, ti) in trend" :key="ti" class="trend-group">
                <div class="trend-bars">
                  <div v-for="bar in t.bars" :key="bar.key" class="trend-col" :title="`${bar.label} ${bar.value}%`">
                    <div class="trend-bar" :style="{ height: bar.value + '%', background: bar.color }"></div>
                  </div>
                </div>
                <div class="trend-label">{{ t.label }}</div>
              </div>
            </div>
            <div class="flex items-center gap-3 mt-2 text-xs text-[#909399]">
              <span>图例：</span>
              <span v-for="m in TREND_METRICS" :key="m.key" class="flex items-center gap-1">
                <span class="dot" :style="{ background: m.color }"></span>{{ m.label }}
              </span>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 完成率环 + 分类分布 -->
      <el-col :span="10">
        <el-card shadow="never" class="mb-3">
          <template #header><span class="text-sm font-semibold">保养完成率（当月）</span></template>
          <div class="flex items-center justify-center gap-6 py-2">
            <el-progress type="dashboard" :percentage="Math.round(completionRate.rate)"
              :format="() => `${completionRate.done}/${completionRate.total}`" color="#67c23a" :width="120" />
            <div class="text-xs text-[#909399] leading-relaxed">
              <div>已归档：<span class="text-[#303133] font-semibold">{{ completionRate.done }}</span> 单</div>
              <div>计划总数：<span class="text-[#303133] font-semibold">{{ completionRate.total }}</span> 单</div>
              <div>含作废单</div>
            </div>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header><span class="text-sm font-semibold">设备分类分布</span></template>
          <div v-if="!categoryDistribution.length" class="text-center py-4 text-xs text-[#909399]">暂无数据</div>
          <div v-for="(c, i) in categoryDistribution" :key="i" class="mb-2">
            <div class="flex items-center gap-2 text-xs mb-1">
              <span class="flex-1 truncate">{{ c.category }}</span>
              <span class="text-[#909399]">{{ c.participating }}/{{ c.total }} 台</span>
            </div>
            <div class="bar-bg"><div class="bar-fill" :style="{ width: c.total ? Math.min(100, (c.participating / c.total) * 100) + '%' : '0%', background: '#67c23a' }"></div></div>
          </div>
          <div class="mt-2 text-xs text-[#909399]">绿色条 = 参与点检台数 / 全量台数</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Row5: KPI 图表（完好率/利用率/故障率/计划停运率，环形图） -->
    <el-row :gutter="16" class="mt-4">
      <el-col v-for="card in kpiCards" :key="card.title" :span="6">
        <el-card shadow="hover" class="kpi-chart-card cursor-pointer" @click="goTo(card.path)">
          <div class="flex flex-col items-center py-2">
            <el-progress type="dashboard"
              :percentage="Math.round(Math.min(100, Math.max(0, Number(card.value) || 0)))"
              :color="card.color" :width="120" :stroke-width="10"
              :format="() => (card.value === '—' ? '—' : card.value + '%')" />
            <div class="mt-3 text-sm font-semibold text-[#303133]">{{ card.title }}</div>
            <div class="mt-1 text-xs text-[#909399]">{{ card.sub }}</div>
            <el-tag class="mt-2" size="small" type="info" effect="plain">{{ calendarYear }}-{{ String(calendarMonth).padStart(2, '0') }}</el-tag>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.stat-card { border-left: 3px solid #409eff; transition: transform 0.15s; }
.stat-card:hover { transform: translateY(-2px); }
.stat-value { font-size: 28px; font-weight: 700; }
.stat-label { font-size: 13px; color: #606266; margin-top: 2px; }
.stat-desc { font-size: 11px; color: #909399; margin-top: 2px; }

.kpi-chart-card { transition: transform 0.15s; }
.kpi-chart-card:hover { transform: translateY(-2px); }

/* 卡片撑满所在列高（消除左右列高度不均导致的列内底部空隙） */
.flex-card { display: flex; flex-direction: column; }
.flex-card :deep(.el-card__body) { flex: 1; display: flex; flex-direction: column; min-height: 0; }

.calendar-table { border-collapse: collapse; width: 100%; }
.calendar-table th, .calendar-table td { border: 1px solid #ebeef5; }
.calendar-table th { background: #f5f7fa; padding: 4px; text-align: center; }
.cal-cell { height: 60px; vertical-align: top; padding: 2px 4px; width: 14.2%; }
.cal-empty { background: #fafafa; }
.cal-weekend .cal-day-num { color: #f56c6c; }
.cal-day-num { font-size: 11px; font-weight: 600; margin-bottom: 2px; }
.cal-events { display: flex; flex-direction: column; gap: 1px; }
.cal-event { color: #fff; padding: 0 3px; border-radius: 2px; font-size: 10px; line-height: 16px; overflow: hidden; }

.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

/* 维保日历：本月数字水印（居中浅色，不挡内容、不影响点击） */
.calendar-card :deep(.el-card__body) { position: relative; overflow: hidden; }
.calendar-watermark {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 190px;
  font-weight: 700;
  line-height: 1;
  color: rgba(64, 158, 255, 0.08);
  pointer-events: none;
  user-select: none;
}

.bar-bg { height: 6px; background: #ebeef5; border-radius: 3px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }

/* 月度趋势分组柱状图 */
.trend-chart { display: flex; align-items: flex-end; gap: 16px; flex: 1; min-height: 0; padding: 0 8px; }
.trend-group { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 100%; width: 100%; justify-content: center; }
.trend-col { display: flex; align-items: flex-end; height: 100%; }
.trend-bar { width: 7px; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s; }
.trend-label { font-size: 11px; color: #909399; margin-top: 6px; }
</style>
