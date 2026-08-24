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

// ---- KPI 四率（overview.kpi，置顶环形图） ----
const kpiCards = computed(() => [
  { title: '设备完好率', value: kpi.value.availability ?? '—', sub: `${kpi.value.totalDevices ?? 0} 台设备参与点检`, color: '#67c23a', path: '/maintenance/daily-check' },
  { title: '设备利用率', value: kpi.value.utilization ?? '—', sub: `运行 ${kpi.value.runHours ?? 0}h / 占用 ${kpi.value.occupiedHours ?? ((kpi.value.runHours||0)+(kpi.value.faultStopHours||0)+(kpi.value.planStopHours||0))}h`, color: '#409eff', path: '/maintenance/daily-check' },
  { title: '设备故障率', value: kpi.value.faultRate ?? '—', sub: `故障停台 ${kpi.value.faultStopHours ?? 0}h`, color: '#f56c6c', path: '/maintenance/repair' },
  { title: '计划停运率', value: kpi.value.plannedStopRate ?? '—', sub: `计划停台 ${kpi.value.planStopHours ?? 0}h`, color: '#e6a23c', path: '/maintenance/daily-check' },
])

// ---- 业务统计卡：按模块进度（总数 / 已完成 / 未完成）----
const emptyProgress = () => ({ total: 0, done: 0, pending: 0 })
const progressOf = (mod) => {
  const p = mod || emptyProgress()
  return { total: p.total || 0, done: p.done || 0, pending: p.pending || 0 }
}
const maintDetail = computed(() => {
  const d = stats.value.maintenance?.detail || {}
  const fmt = (key, label) => {
    const x = progressOf(d[key])
    return `${label} ${x.done}/${x.total}`
  }
  return [fmt('level1', '一级'), fmt('level2', '二级'), fmt('lubrication', '润滑')].join(' · ')
})
const statCards = computed(() => {
  const daily = progressOf(stats.value.dailyCheckToday)
  const maint = progressOf(stats.value.maintenance)
  const insp = progressOf(stats.value.inspection)
  const repair = progressOf(stats.value.repair)
  const missed = stats.value.missedCheckDays || 0
  const emergency = stats.value.emergencyRepairTimeout || 0
  return [
    {
      title: '今日点检',
      ...daily,
      sub: missed ? `本月缺检 ${missed} 次` : '班前 / 班后',
      path: '/maintenance/daily-check',
      color: '#73b9ff',
    },
    {
      title: '本月保养',
      ...maint,
      sub: maintDetail.value,
      path: '/maintenance/level1',
      color: '#409eff',
    },
    {
      title: '本月检查',
      ...insp,
      sub: '定期检查',
      path: '/maintenance/inspection',
      color: '#e6a23c',
    },
    {
      title: '本月维修',
      ...repair,
      sub: emergency ? `紧急超时 ${emergency} 单` : '维修工单',
      path: '/maintenance/repair',
      color: '#f56c6c',
    },
  ]
})

// ---- 日历 ----
const calendarDays = computed(() => {
  const y = calendarYear.value
  const m = calendarMonth.value - 1
  const firstDay = new Date(y, m, 1).getDay() || 7
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

// ---- 超期统计 ----
const overduePlan = computed(() => (overview.value.overdueList && overview.value.overdueList.plan) || [])
function overduePlanPath(item) {
  if (item.type === '检查') return '/maintenance/inspection'
  return '/maintenance/level1'
}

// ---- TOP5 ----
const topDepts = computed(() => overview.value.topDepts || [])
const topMax = computed(() => topDepts.value[0]?.count || 1)

// ---- 月度趋势（柱高按全局最大值缩放，tooltip 显示真实百分比） ----
const TREND_METRICS = [
  { key: 'availability', label: '完好率', color: '#409eff' },
  { key: 'utilization', label: '利用率', color: '#67c23a' },
  { key: 'faultRate', label: '故障率', color: '#f56c6c' },
  { key: 'plannedStopRate', label: '计划停运率', color: '#e6a23c' },
]
const trendMax = computed(() => {
  let max = 100
  ;(overview.value.trend || []).forEach(t => {
    TREND_METRICS.forEach(mc => { max = Math.max(max, Number(t[mc.key]) || 0) })
  })
  return max
})
const trend = computed(() => (overview.value.trend || []).map(t => ({
  label: `${t.month}月`,
  bars: TREND_METRICS.map(mc => {
    const raw = Number(t[mc.key]) || 0
    return { ...mc, raw, value: trendMax.value > 0 ? (raw / trendMax.value) * 100 : 0 }
  }),
})))

const categoryDistribution = computed(() => overview.value.categoryDistribution || [])

const weekDays = ['一', '二', '三', '四', '五', '六', '日']

function goTo(path) {
  if (path) router.push(path)
}

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
function eventStyle(ev) {
  const style = { background: eventColor(ev) }
  if (ev.status === '已超期') style.boxShadow = 'inset 0 0 0 2px #f56c6c'
  return style
}

onMounted(loadOverview)
</script>

<template>
  <div v-loading="loading" class="flex-1 overflow-auto p-4 bg-[#f5f7fa]">
    <!-- Row1: 业务统计卡（按模块：总数 / 已完成 / 未完成） -->
    <div class="flex gap-3 mb-4">
      <div v-for="card in statCards" :key="card.title" class="flex-1 min-w-0">
        <el-card shadow="hover" class="stat-card cursor-pointer" :style="{ borderLeftColor: card.color }" @click="goTo(card.path)">
          <div class="stat-label" :style="{ color: card.color }">{{ card.title }}</div>
          <div class="stat-metrics">
            <div class="stat-metric">
              <div class="stat-metric-value" style="color:#303133">{{ card.total }}</div>
              <div class="stat-metric-label">总数</div>
            </div>
            <div class="stat-metric">
              <div class="stat-metric-value" style="color:#67c23a">{{ card.done }}</div>
              <div class="stat-metric-label">已完成</div>
            </div>
            <div class="stat-metric">
              <div class="stat-metric-value" style="color:#e6a23c">{{ card.pending }}</div>
              <div class="stat-metric-label">未完成</div>
            </div>
          </div>
          <div class="stat-desc">{{ card.sub }}</div>
        </el-card>
      </div>
    </div>

    <!-- Row2: KPI 四率 -->
    <el-row :gutter="16" class="mb-4">
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

    <!-- Row3: 日历 + 超期统计/TOP5 -->
    <el-row :gutter="16" class="mb-4">
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
                        :style="eventStyle(ev)">
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
            <span class="text-[#f56c6c]">红框=已超期</span>
          </div>
        </el-card>
      </el-col>

      <el-col :span="10">
        <div class="flex flex-col gap-3 h-full">
          <el-card shadow="never" class="flex-card flex-1">
            <template #header>
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold">⏰ 超期统计</span>
              </div>
            </template>
            <div v-if="!overduePlan.length" class="flex-1 flex items-center justify-center text-xs text-[#909399]">暂无超期任务 ✓</div>
            <div v-else class="flex flex-col flex-1">
              <div v-for="item in overduePlan" :key="'p-' + item.deviceCode + item.planDate + item.type"
                class="flex items-center gap-2 py-1 text-xs cursor-pointer hover:bg-[#f5f7fa]" @click="goTo(overduePlanPath(item))">
                <StatusTag status="已超期" />
                <el-tag size="small" type="info" effect="plain">{{ item.type }}</el-tag>
                <span class="flex-1 truncate">{{ item.deviceName }}</span>
                <span class="text-[#909399] shrink-0">{{ item.planDate }}</span>
                <span class="text-red-500 font-semibold shrink-0">超期 {{ item.overdueDays }}天</span>
              </div>
            </div>
          </el-card>

          <el-card shadow="never" class="flex-card flex-1">
            <template #header>
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold">维保工作量 TOP5</span>
                <span class="text-xs text-[#909399]">不含日常点检</span>
              </div>
            </template>
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
      <el-col :span="14">
        <el-card shadow="never" class="flex-card h-full">
          <template #header><span class="text-sm font-semibold">月度趋势（近 6 个月）</span></template>
          <div v-if="!trend.length" class="flex-1 flex items-center justify-center text-xs text-[#909399]">暂无数据</div>
          <div v-else class="flex flex-col flex-1 min-h-0">
            <div class="trend-chart">
              <div v-for="(t, ti) in trend" :key="ti" class="trend-group">
                <div class="trend-bars">
                  <div v-for="bar in t.bars" :key="bar.key" class="trend-col" :title="`${bar.label} ${bar.raw}%`">
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
              <span class="text-[#c0c4cc]">| 柱高按最大值 {{ trendMax }}% 缩放，悬停看真实值</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card shadow="never" class="mb-3">
          <template #header><span class="text-sm font-semibold">保养完成率（当月）</span></template>
          <div class="flex items-center justify-center gap-6 py-2">
            <el-progress type="dashboard" :percentage="Math.round(completionRate.rate)"
              :format="() => `${completionRate.done}/${completionRate.total}`" color="#67c23a" :width="120" />
            <div class="text-xs text-[#909399] leading-relaxed">
              <div>已归档：<span class="text-[#303133] font-semibold">{{ completionRate.done }}</span> 单</div>
              <div>计划总数：<span class="text-[#303133] font-semibold">{{ completionRate.total }}</span> 单</div>
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
  </div>
</template>

<style scoped>
.stat-card { border-left: 3px solid #409eff; transition: transform 0.15s; }
.stat-card:hover { transform: translateY(-2px); }
.stat-label { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 8px; }
.stat-metrics { display: flex; align-items: flex-end; gap: 8px; }
.stat-metric { flex: 1; min-width: 0; text-align: center; }
.stat-metric-value { font-size: 24px; font-weight: 700; line-height: 1.2; }
.stat-metric-label { font-size: 11px; color: #909399; margin-top: 2px; }
.stat-desc { font-size: 11px; color: #909399; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.kpi-chart-card { transition: transform 0.15s; }
.kpi-chart-card:hover { transform: translateY(-2px); }

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

.trend-chart { display: flex; align-items: flex-end; gap: 16px; flex: 1; min-height: 180px; padding: 0 8px; }
.trend-group { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; }
.trend-bars { display: flex; align-items: flex-end; gap: 3px; height: 100%; width: 100%; justify-content: center; }
.trend-col { display: flex; align-items: flex-end; height: 100%; }
.trend-bar { width: 7px; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s; }
.trend-label { font-size: 11px; color: #909399; margin-top: 6px; }
</style>
