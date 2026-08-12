<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useDictStore } from '@/stores/dict'

const router = useRouter()
const devicesStore = useDevicesStore()
const dictStore = useDictStore()

// ---------- 顶部统计卡 ----------
const stats = computed(() => {
  const all = devicesStore.list
  return {
    total: all.length,
    inUse: all.filter(d => d.status === '在用').length,
    idle: all.filter(d => d.status === '闲置').length,
    pendingRepair: all.filter(d => d.status === '待修').length,
    scrap: all.filter(d => d.status === '报废').length
  }
})

// ---------- 设备分布总览：按大类（type 首段）统计 ----------
const STATUS_KEYS = ['在用', '封存', '闲置', '待修', '报废']

// 顶级大类列表（来自字典树，编码 00-10）
const topCategories = computed(() => {
  return Object.entries(dictStore.deviceTypeTree || {})
    .map(([code, node]) => ({ code, name: node.name || code }))
    .sort((a, b) => a.code.localeCompare(b.code))
})

const categoryStats = computed(() => {
  const byCat = new Map() // 大类名 -> { total, status }
  devicesStore.list.forEach(d => {
    const catName = d.type ? String(d.type).split('/')[0] : ''
    if (!catName) return
    if (!byCat.has(catName)) byCat.set(catName, { total: 0, status: {} })
    const entry = byCat.get(catName)
    entry.total++
    const st = d.status || '未知'
    entry.status[st] = (entry.status[st] || 0) + 1
  })

  return topCategories.value.map(c => {
    const entry = byCat.get(c.name)
    const statusMap = {}
    STATUS_KEYS.forEach(k => { statusMap[k] = entry?.status[k] || 0 })
    return {
      code: c.code,
      name: c.name,
      total: entry ? entry.total : 0,
      statusMap
    }
  })
})

// 状态胶囊配色（对齐 Figma）
function chipClass(status) {
  if (status === '在用') return 'chip-blue'
  if (status === '报废') return 'chip-red'
  return 'chip-gray'
}

// ---------- 跳转 ----------
function goLedger(filter = {}) {
  const query = {}
  if (filter.status) query.status = filter.status
  if (filter.type) query.type = filter.type
  router.push({ path: '/ledger', query })
}

onMounted(async () => {
  await Promise.all([
    devicesStore.fetchList({ pageSize: 10000 }),
    dictStore.loadAll()
  ])
})
</script>

<template>
  <div class="flex-1 overflow-auto bg-white dashboard-page">
    <div class="dashboard-body">
      <!-- 顶部统计卡 -->
      <div class="stat-row">
        <div class="stat-card" @click="goLedger()">
          <div class="stat-value stat-value-blue">{{ stats.total }}</div>
          <div class="stat-label">设备总数</div>
        </div>
        <div class="stat-card" @click="goLedger({ status: '在用' })">
          <div class="stat-value">{{ stats.inUse }}</div>
          <div class="stat-label">在用</div>
        </div>
        <div class="stat-card" @click="goLedger({ status: '闲置' })">
          <div class="stat-value">{{ stats.idle }}</div>
          <div class="stat-label">闲置</div>
        </div>
        <div class="stat-card" @click="goLedger({ status: '待修' })">
          <div class="stat-value">{{ stats.pendingRepair }}</div>
          <div class="stat-label">待修</div>
        </div>
        <div class="stat-card" @click="goLedger({ status: '报废' })">
          <div class="stat-value stat-value-red">{{ stats.scrap }}</div>
          <div class="stat-label">报废</div>
        </div>
      </div>

      <!-- 设备分布总览 -->
      <div class="dist-section">
        <div class="dist-title">设备分布总览</div>
        <div class="dist-grid">
          <div
            v-for="cat in categoryStats"
            :key="cat.code"
            class="cat-card"
            @click="goLedger({ type: cat.code })"
          >
            <div class="cat-header">
              <span class="cat-name">{{ cat.name }}</span>
              <span class="cat-total">{{ cat.total }}台</span>
            </div>
            <div class="cat-divider" />
            <div class="cat-chips">
              <span
                v-for="k in STATUS_KEYS"
                :key="k"
                class="chip"
                :class="chipClass(k)"
              >{{ k }}：{{ cat.statusMap[k] }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  background: #ffffff;
}

.dashboard-body {
  padding: 24px 15px;
}

/* ========== 顶部统计卡 ========== */
.stat-row {
  display: flex;
  gap: 17px;
}

.stat-card {
  flex: 1;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #dddfe7;
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}

.stat-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  color: #434242;
  line-height: 1;
  white-space: nowrap;
}

.stat-value-blue {
  color: #1292e9;
}

.stat-value-red {
  color: #ff453a;
}

.stat-label {
  font-size: 12px;
  color: #91939a;
}

/* ========== 设备分布总览 ========== */
.dist-section {
  margin-top: 24px;
}

.dist-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #000000;
}

.dist-title::before {
  content: '';
  display: inline-block;
  width: 2px;
  height: 12px;
  background: #1292e9;
  border-radius: 1px;
}

.dist-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-top: 13px;
}

.cat-card {
  background: #e8f4fc;
  border: 1px solid #b4d8f7;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.cat-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  border-color: #1292e9;
}

.cat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cat-name,
.cat-total {
  font-size: 20px;
  font-weight: 600;
  color: #000000;
  line-height: 1;
}

.cat-divider {
  height: 1px;
  background: #b4d8f7;
  margin: 12px 0;
}

.cat-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  font-size: 12px;
  line-height: 1;
  border-radius: 12px;
  padding: 4px 12px;
  border: 1px solid;
  white-space: nowrap;
  background: transparent;
}

.chip-blue {
  border-color: #1292e9;
  color: #1292e9;
}

.chip-gray {
  border-color: #939393;
  color: #939393;
}

.chip-red {
  border-color: #f55c5a;
  color: #f55c5a;
}
</style>
