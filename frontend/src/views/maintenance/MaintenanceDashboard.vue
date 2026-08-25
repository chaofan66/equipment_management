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

const monthLabel = computed(() =>
  `${calendarYear.value}-${String(calendarMonth.value).padStart(2, '0')}`
)

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

// ---- KPI 四率 ----
const kpiCards = computed(() => [
  {
    title: '设备完好率',
    value: kpi.value.availability,
    sub: `${kpi.value.totalDevices ?? 0} 台参与点检`,
    accent: '#5b8ff9',
    tint: 'kpi-card--blue',
    path: '/maintenance/daily-check',
  },
  {
    title: '设备利用率',
    value: kpi.value.utilization,
    sub: `运行 ${kpi.value.runHours ?? 0}h`,
    accent: '#5ad8a6',
    tint: 'kpi-card--teal',
    path: '/maintenance/daily-check',
  },
  {
    title: '设备故障率',
    value: kpi.value.faultRate,
    sub: `故障停台 ${kpi.value.faultStopHours ?? 0}h`,
    accent: '#f56c6c',
    tint: 'kpi-card--red',
    path: '/maintenance/repair',
  },
  {
    title: '计划停运率',
    value: kpi.value.plannedStopRate,
    sub: `计划停台 ${kpi.value.planStopHours ?? 0}h`,
    accent: '#ffbb28',
    tint: 'kpi-card--amber',
    path: '/maintenance/daily-check',
  },
])

function kpiPct(val) {
  if (val == null || val === '—') return 0
  return Math.round(Math.min(100, Math.max(0, Number(val) || 0)))
}

function kpiDisplay(val) {
  if (val == null || val === '—') return '—'
  return val
}

// ---- 业务统计卡 ----
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
      iconBg: 'linear-gradient(135deg, #6eb5ff 0%, #409eff 100%)',
    },
    {
      title: '本月保养',
      ...maint,
      sub: maintDetail.value,
      path: '/maintenance/level1',
      iconBg: 'linear-gradient(135deg, #5cdbd3 0%, #13c2c2 100%)',
    },
    {
      title: '本月检查',
      ...insp,
      sub: '定期检查',
      path: '/maintenance/inspection',
      iconBg: 'linear-gradient(135deg, #ffc069 0%, #fa8c16 100%)',
    },
    {
      title: '本月维修',
      ...repair,
      sub: emergency ? `紧急超时 ${emergency} 单` : '维修工单',
      path: '/maintenance/repair',
      iconBg: 'linear-gradient(135deg, #b37feb 0%, #722ed1 100%)',
    },
  ]
})

const pendingTotal = computed(() =>
  statCards.value.reduce((sum, c) => sum + c.pending, 0)
)

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

const overduePlan = computed(() => (overview.value.overdueList && overview.value.overdueList.plan) || [])

function overduePlanPath(item) {
  if (item.type === '检查') return '/maintenance/inspection'
  return '/maintenance/level1'
}

const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const todayStr = fmtDate(new Date())

function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const LEGEND = [
  { key: 'daily_check', label: '日常点检', color: '#73b9ff' },
  { key: 'level1', label: '一级保养', color: '#409eff' },
  { key: 'level2', label: '二级保养', color: '#1e6fd9' },
  { key: 'lubrication', label: '设备润滑', color: '#67c23a' },
  { key: 'periodic_inspection', label: '定期检查', color: '#e6a23c' },
  { key: 'repair', label: '维修', color: '#f56c6c' },
]

function goTo(path) {
  if (path) router.push(path)
}

const EVENT_COLORS = Object.fromEntries(LEGEND.map(l => [l.key, l.color]))

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
  <div v-loading="loading" class="dash-page">
    <!-- 页头 -->
    <div class="dash-header">
      <div>
        <h2 class="dash-title">维保总览</h2>
        <p class="dash-subtitle">
          {{ monthLabel }}
          <span class="dash-dot">·</span>
          {{ kpi.totalDevices ?? 0 }} 台设备参与点检
          <span class="dash-dot">·</span>
          <span :class="pendingTotal ? 'text-amber-600' : 'text-emerald-600'">
            {{ pendingTotal ? `未完成 ${pendingTotal} 项` : '任务已全部完成' }}
          </span>
        </p>
      </div>
      <div class="month-switcher">
        <button type="button" class="month-btn" @click="switchMonth(-1)">◀</button>
        <span class="month-label">{{ monthLabel }}</span>
        <button type="button" class="month-btn" @click="switchMonth(1)">▶</button>
      </div>
    </div>

    <!-- 业务统计：四模块进度 -->
    <div class="stat-panel">
      <div
        v-for="(card, idx) in statCards"
        :key="card.title"
        class="stat-section"
        :class="{ 'stat-section--border': idx > 0 }"
        @click="goTo(card.path)"
      >
        <div class="stat-section-head">
          <span class="stat-icon" :style="{ background: card.iconBg }" />
          <span class="stat-title">{{ card.title }}</span>
        </div>
        <div class="stat-primary">
          <div class="stat-primary-label">总数</div>
          <div class="stat-primary-value">{{ card.total }}</div>
        </div>
        <div class="stat-secondary">
          <div class="stat-secondary-row">
            <span class="stat-secondary-label">已完成</span>
            <span class="stat-secondary-value stat-secondary-value--done">{{ card.done }}</span>
          </div>
          <div class="stat-secondary-row">
            <span class="stat-secondary-label">未完成</span>
            <span class="stat-secondary-value stat-secondary-value--pending">{{ card.pending }}</span>
          </div>
        </div>
        <div v-if="card.sub" class="stat-footnote">{{ card.sub }}</div>
      </div>
    </div>

    <!-- KPI 四率 -->
    <div class="kpi-grid">
      <div
        v-for="card in kpiCards"
        :key="card.title"
        class="kpi-card"
        :class="card.tint"
        @click="goTo(card.path)"
      >
        <div class="kpi-card-head">
          <span class="kpi-dot" :style="{ background: card.accent }" />
          <span class="kpi-card-title">{{ card.title }}</span>
        </div>
        <div class="kpi-card-value">
          {{ kpiDisplay(card.value) }}<span v-if="card.value != null && card.value !== '—'" class="kpi-unit">%</span>
        </div>
        <div class="kpi-card-sub">{{ card.sub }}</div>
        <div class="kpi-bar">
          <div
            class="kpi-bar-fill"
            :style="{ width: kpiPct(card.value) + '%', background: card.accent }"
          />
        </div>
      </div>
    </div>

    <!-- 日历 + 超期 -->
    <div class="dash-row">
      <!-- 维保日历 -->
      <div class="dash-card dash-card--wide">
        <div class="dash-card-header">
          <div class="dash-card-title-wrap">
            <span class="dash-card-icon dash-card-icon--blue">📅</span>
            <span class="dash-card-title">维保日历</span>
          </div>
        </div>
        <div class="dash-card-body calendar-body">
          <div class="calendar-watermark">{{ calendarMonth }}</div>
          <table class="calendar-table">
            <thead>
              <tr>
                <th v-for="d in weekDays" :key="d">{{ d }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(week, wi) in calendarDays" :key="wi">
                <td
                  v-for="(day, di) in week"
                  :key="di"
                  class="cal-cell"
                  :class="{ 'cal-empty': !day, 'cal-weekend': di >= 5, 'cal-today': day && day.date === todayStr }"
                >
                  <template v-if="day">
                    <div class="cal-day-num">{{ day.day }}</div>
                    <div class="cal-events">
                      <div
                        v-for="(ev, ei) in day.events.slice(0, 2)"
                        :key="ei"
                        class="cal-event truncate"
                        :style="eventStyle(ev)"
                      >
                        {{ ev.deviceName || ev.title || '维保' }}
                      </div>
                      <div v-if="day.events.length > 2" class="cal-more">+{{ day.events.length - 2 }}</div>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="calendar-legend">
            <span
              v-for="item in LEGEND"
              :key="item.key"
              class="legend-pill"
            >
              <span class="legend-dot" :style="{ background: item.color }" />
              {{ item.label }}
            </span>
            <span class="legend-overdue">红框 = 已超期</span>
          </div>
        </div>
      </div>

      <!-- 超期统计 -->
      <div class="dash-card dash-card--narrow">
        <div class="dash-card-header">
          <div class="dash-card-title-wrap">
            <span class="dash-card-icon dash-card-icon--amber">⏰</span>
            <span class="dash-card-title">超期统计</span>
          </div>
          <span v-if="overduePlan.length" class="overdue-badge">{{ overduePlan.length }}</span>
        </div>
        <div class="dash-card-body overdue-body">
          <div v-if="!overduePlan.length" class="overdue-empty">
            <div class="overdue-empty-icon">✓</div>
            <div class="overdue-empty-text">暂无超期任务</div>
          </div>
          <div v-else class="overdue-list">
            <div
              v-for="(item, i) in overduePlan"
              :key="'p-' + item.deviceCode + item.planDate + item.type"
              class="overdue-row"
              :class="{ 'overdue-row--alt': i % 2 === 1 }"
              @click="goTo(overduePlanPath(item))"
            >
              <div class="overdue-row-top">
                <StatusTag status="已超期" />
                <el-tag size="small" type="info" effect="plain">{{ item.type }}</el-tag>
                <span class="overdue-days">超期 {{ item.overdueDays }} 天</span>
              </div>
              <div class="overdue-row-name">{{ item.deviceName }}</div>
              <div class="overdue-row-date">{{ item.planDate }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-page {
  flex: 1;
  overflow: auto;
  padding: 20px 24px 28px;
  background: #fff;
  min-height: 100%;
}

/* ---- 页头 ---- */
.dash-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 16px;
}
.dash-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: -0.3px;
}
.dash-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8c8c8c;
}
.dash-dot { margin: 0 6px; color: #d9d9d9; }

.month-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border-radius: 10px;
  padding: 4px 6px;
  border: 1px solid #ebeef5;
  flex-shrink: 0;
}
.month-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #595959;
  font-size: 12px;
  transition: background 0.15s;
}
.month-btn:hover { background: #f5f5f5; }
.month-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  padding: 0 8px;
  min-width: 80px;
  text-align: center;
}

/* ---- 业务统计面板 ---- */
.stat-panel {
  display: flex;
  background: linear-gradient(135deg, #e8f2fc 0%, #f0f6ff 40%, #fafcff 100%);
  border-radius: 14px;
  border: 1px solid #ebeef5;
  padding: 16px;
  margin-bottom: 16px;
}
.stat-section {
  flex: 1;
  min-width: 0;
  padding: 8px 20px;
  cursor: pointer;
  transition: background 0.2s;
  border-radius: 8px;
}
.stat-section:first-child { padding-left: 8px; }
.stat-section:last-child { padding-right: 8px; }
.stat-section:hover { background: rgba(255, 255, 255, 0.5); }
.stat-section--border { border-left: 1px solid rgba(91, 143, 249, 0.12); }
.stat-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}
.stat-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
}
.stat-title { font-size: 15px; font-weight: 600; color: #303133; }
.stat-primary { margin-bottom: 18px; }
.stat-primary-label { font-size: 12px; color: #8c8c8c; margin-bottom: 6px; }
.stat-primary-value {
  font-size: 28px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.2;
  letter-spacing: -0.5px;
}
.stat-secondary { display: flex; flex-direction: column; gap: 10px; }
.stat-secondary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  max-width: 140px;
}
.stat-secondary-label { color: #8c8c8c; }
.stat-secondary-value { font-weight: 600; }
.stat-secondary-value--done { color: #52c41a; }
.stat-secondary-value--pending { color: #fa8c16; }
.stat-footnote {
  margin-top: 16px;
  font-size: 11px;
  color: #bfbfbf;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- KPI 四率 ---- */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.kpi-card {
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px;
  border: 1px solid #ebeef5;
  cursor: pointer;
  transition: border-color 0.15s;
  position: relative;
  overflow: hidden;
}
.kpi-card::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.06;
  pointer-events: none;
}
.kpi-card--blue::before { background: linear-gradient(135deg, #5b8ff9, #9270ca); }
.kpi-card--teal::before { background: linear-gradient(135deg, #5ad8a6, #5b8ff9); }
.kpi-card--red::before { background: linear-gradient(135deg, #f56c6c, #ff7875); }
.kpi-card--amber::before { background: linear-gradient(135deg, #ffbb28, #ffc53d); }
.kpi-card:hover {
  border-color: #c6e2ff;
}
.kpi-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  position: relative;
}
.kpi-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.kpi-card-title {
  font-size: 13px;
  color: #8c8c8c;
  font-weight: 500;
}
.kpi-card-value {
  font-size: 32px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1.1;
  letter-spacing: -1px;
  position: relative;
}
.kpi-unit {
  font-size: 16px;
  font-weight: 600;
  margin-left: 2px;
  color: #595959;
}
.kpi-card-sub {
  font-size: 12px;
  color: #bfbfbf;
  margin-top: 6px;
  position: relative;
}
.kpi-bar {
  height: 4px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 2px;
  margin-top: 14px;
  overflow: hidden;
  position: relative;
}
.kpi-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}

/* ---- 底部双栏 ---- */
.dash-row {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 14px;
  align-items: start;
}
.dash-card {
  background: #fff;
  border-radius: 14px;
  border: 1px solid #ebeef5;
  overflow: hidden;
}
.dash-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.dash-card-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dash-card-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.dash-card-icon--blue { background: rgba(91, 143, 249, 0.12); }
.dash-card-icon--amber { background: rgba(255, 187, 40, 0.15); }
.dash-card-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.dash-card-body { padding: 16px 20px 20px; }

/* ---- 日历 ---- */
.calendar-body { position: relative; overflow: hidden; }
.calendar-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 180px;
  font-weight: 700;
  line-height: 1;
  color: rgba(91, 143, 249, 0.05);
  pointer-events: none;
  user-select: none;
}
.calendar-table {
  border-collapse: separate;
  border-spacing: 4px;
  width: 100%;
  position: relative;
}
.calendar-table th {
  font-size: 12px;
  font-weight: 500;
  color: #8c8c8c;
  padding: 4px 0 8px;
  text-align: center;
}
.cal-cell {
  height: 64px;
  vertical-align: top;
  padding: 6px 8px;
  border-radius: 8px;
  background: #fafafa;
  border: 1px solid transparent;
  box-sizing: border-box;
  transition: background 0.15s;
}
.cal-cell:not(.cal-empty):hover { background: #f0f5ff; }
.cal-empty { background: transparent; }
.cal-weekend .cal-day-num { color: #f56c6c; }
.cal-today { background: #e6f4ff !important; border: 1px solid #5b8ff9; }
.cal-day-num {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}
.cal-events { display: flex; flex-direction: column; gap: 2px; }
.cal-event {
  color: #fff;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 16px;
}
.cal-more { font-size: 10px; color: #bfbfbf; padding-left: 2px; }
.calendar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #f0f0f0;
}
.legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #8c8c8c;
  background: #fafafa;
  padding: 3px 8px;
  border-radius: 20px;
}
.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-overdue { font-size: 11px; color: #f56c6c; margin-left: auto; }

/* ---- 超期列表 ---- */
.overdue-badge {
  background: #fff1f0;
  color: #f5222d;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 20px;
}
.overdue-body { min-height: 320px; }
.overdue-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 280px;
  gap: 8px;
}
.overdue-empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f6ffed;
  color: #52c41a;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.overdue-empty-text { font-size: 13px; color: #bfbfbf; }
.overdue-list { display: flex; flex-direction: column; gap: 2px; }
.overdue-row {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.overdue-row:hover { background: #e6f4ff !important; }
.overdue-row--alt { background: #fafafa; }
.overdue-row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.overdue-days {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  color: #f5222d;
}
.overdue-row-name {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overdue-row-date { font-size: 11px; color: #bfbfbf; margin-top: 2px; }
</style>
