<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import StatusTag from '@/components/common/StatusTag.vue'
import V2PlanDrawer from '@/components/maintenance/V2PlanDrawer.vue'
import { fetchRepairOrders, createRepairOrder, fetchWorkOrders, exportRepairOrdersReport } from '@/api/maintenance'

const devicesStore = useDevicesStore()
const authStore = useAuthStore()
const toast = useToast()

// ===================== 状态 =====================
const loading = ref(false)
const exporting = ref(false)
const v2Orders = ref([])   // V2 维修工单（6步）
const legacyOrders = ref([]) // 旧 workOrders（非白名单双轨只读）

const filterStatus = ref('')
const filterUrgency = ref('')
const keyword = ref('')

// 报表时间段 [start, end]；选中后列表按完成时间同步筛选（仅已归档）
const reportRange = ref(null)

const drawerRef = ref(null)
const drawerPlanId = ref('')

const showCreate = ref(false)
const createForm = reactive({
  deviceCode: '', deviceName: '', faultDesc: '', urgency: '普通', reporterName: '',
})
const urgencyOptions = ['普通', '紧急']
const statusOptions = ['', '待执行', '进行中', '待验收', '已完成', '已超期', '已归档']

const selectedDeviceInfo = ref(null)

async function onDeviceChange(code) {
  createForm.deviceCode = code || ''
  selectedDeviceInfo.value = devicesStore.list.find(d => d.code === code) || null
  createForm.deviceName = selectedDeviceInfo.value?.name || ''
}

function completionDateOf(o) {
  const raw = o.repairData?.endTime || o.completedAt || ''
  const d = String(raw).replace('T', ' ').substring(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
}

const orders = computed(() => {
  let list = [
    ...v2Orders.value.map(o => ({ ...o, _v2: true })),
    ...legacyOrders.value.map(o => ({ ...o, _v2: false })),
  ]
  if (filterStatus.value) list = list.filter(o => o.status === filterStatus.value)
  if (filterUrgency.value) list = list.filter(o => o.urgency === filterUrgency.value || (o.repairData?.urgency === filterUrgency.value))
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(o => (o.id || '').toLowerCase().includes(kw) || (o.deviceCode || '').includes(kw) || (o.deviceName || '').toLowerCase().includes(kw))
  }
  // 选了时间段：与报表一致，只展示该区间内已归档（按完成日）
  const range = reportRange.value
  if (Array.isArray(range) && range[0] && range[1]) {
    const [start, end] = range
    list = list.filter(o => {
      if (o.status !== '已归档') return false
      const cd = completionDateOf(o)
      return cd && cd >= start && cd <= end
    })
  }
  return list
})

function orderId(o) { return o.id }
function isEmergency(o) {
  return o._v2 ? !!o.repairData?.emergency : o.urgency === '紧急'
}
function fmtDateTime(val) { return (val || '').replace('T', ' ').substring(0, 16) }

function stopHours(row) {
  const rd = row.repairData || {}
  if (Number(rd.faultStopHours || 0)) return Number(rd.faultStopHours)
  if (rd.startTime && rd.endTime) {
    const s = new Date(String(rd.startTime).replace(' ', 'T'))
    const e = new Date(String(rd.endTime).replace(' ', 'T'))
    if (!isNaN(s) && !isNaN(e) && e > s) return Number(((e - s) / 3600000).toFixed(2))
  }
  return ''
}

function formatTicket(t) {
  if (!t) return '—'
  const no = (t.no || '').trim()
  const type = (t.type || '').trim()
  const content = (t.content || '').trim()
  if (!no && !type && !content) return '—'
  if (type || content) {
    const mid = type && content ? `${type}：${content}` : (type || content)
    return no ? `${no}（${mid}）` : mid
  }
  return no
}

function ticketAt(row, i) {
  const list = row.repairData?.dangerTickets
  if (!Array.isArray(list) || !list[i]) return '—'
  return formatTicket(list[i])
}

function deptOf(row) {
  if (row.dept) return row.dept
  const d = devicesStore.list.find(x => x.code === row.deviceCode)
  return d?.department || '—'
}

function assetClassOf(row) {
  if (row.assetClass) return row.assetClass
  const d = devicesStore.list.find(x => x.code === row.deviceCode)
  return d?.assetCategory || d?.type || '—'
}

function specOf(row) {
  if (row.spec) return row.spec
  const d = devicesStore.list.find(x => x.code === row.deviceCode)
  return d?.spec || '—'
}

async function load() {
  loading.value = true
  try {
    const [v2, legacy] = await Promise.all([
      fetchRepairOrders(),
      fetchWorkOrders().catch(() => ({ data: [] })),
    ])
    v2Orders.value = v2.data || []
    legacyOrders.value = legacy.data || []
  } catch (e) { toast.error(e.message) }
  finally { loading.value = false }
}

async function downloadReport() {
  const range = reportRange.value
  if (!Array.isArray(range) || !range[0] || !range[1]) {
    toast.warning('请选择时间段')
    return
  }
  const [start, end] = range
  exporting.value = true
  try {
    const blob = await exportRepairOrdersReport({ start, end })
    // 拦截器在错误时抛错；成功时可能是 Blob，或误把 JSON 错误包成 Blob
    if (blob instanceof Blob && blob.type && blob.type.includes('application/json')) {
      const text = await blob.text()
      let msg = '下载失败'
      try { msg = JSON.parse(text).error || msg } catch (_) { /* ignore */ }
      throw new Error(msg)
    }
    const fname = `设备维修记录_${String(start).replace(/-/g, '')}_${String(end).replace(/-/g, '')}.xlsx`
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]))
    const a = document.createElement('a')
    a.href = url
    a.download = fname
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('报表已下载')
  } catch (e) {
    toast.error(e.message || '下载失败')
  } finally {
    exporting.value = false
  }
}

async function submitCreate() {
  if (!createForm.deviceCode || !createForm.faultDesc) {
    toast.warning('请填写必填项：设备、故障情况')
    return
  }
  try {
    const cu = authStore.currentUser
    await createRepairOrder({
      deviceCode: createForm.deviceCode,
      faultDesc: createForm.faultDesc,
      urgency: createForm.urgency,
      emergency: createForm.urgency === '紧急',
      reporterName: cu?.name || '',
      reporterPersonnelId: cu?.personnelId || '',
    })
    toast.success('报修单已提交，待维保主管指派')
    showCreate.value = false
    Object.assign(createForm, { deviceCode: '', deviceName: '', faultDesc: '', urgency: '普通' })
    selectedDeviceInfo.value = null
    await load()
  } catch (e) { toast.error(e.response?.data?.error || e.message || '提交失败') }
}

function openPlan(plan) {
  drawerPlanId.value = plan.id
  drawerRef.value?.open(plan.id)
}
function onDone() { load() }

onMounted(async () => {
  await Promise.all([devicesStore.fetchList({ pageSize: 5000 }), load()])
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0">
      <el-input v-model="keyword" placeholder="工单号/设备编码/名称" size="small" style="width:200px" clearable />
      <el-select v-model="filterStatus" placeholder="全部状态" size="small" style="width:120px" clearable>
        <el-option v-for="s in statusOptions.filter(Boolean)" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="filterUrgency" placeholder="紧急程度" size="small" style="width:110px" clearable>
        <el-option v-for="u in urgencyOptions" :key="u" :label="u" :value="u" />
      </el-select>

      <el-divider direction="vertical" />
      <span class="text-xs text-[#606266] shrink-0">完成时间</span>
      <el-date-picker
        v-model="reportRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        size="small"
        style="width:260px"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        clearable
      />
      <el-button type="success" size="small" :loading="exporting" @click="downloadReport">下载报表</el-button>

      <div class="flex-1" />
      <el-button type="primary" size="small" @click="showCreate = true">新建报修</el-button>
      <el-button size="small" @click="load">刷新</el-button>
    </div>

    <!-- 工单列表（对齐《设备维修记录》样表分组列） -->
    <div class="flex-1 overflow-auto p-3" v-loading="loading">
      <el-table :data="orders" size="small" stripe border :empty-text="reportRange?.[0] ? '该时间段内无已完成维修工单' : '暂无维修工单'" style="min-width: 1600px">
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="设备维保工单号" width="170" fixed="left">
          <template #default="{ row }">
            <span class="text-[#1192E8] cursor-pointer" @click="row._v2 && openPlan(row)">{{ orderId(row) }}</span>
            <el-tag v-if="isEmergency(row)" type="danger" size="small" class="ml-1">紧急</el-tag>
            <el-tag v-if="row.flowTimeout" type="danger" size="small" effect="dark" class="ml-1">24h超时</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deviceCode" label="资产编号" width="180" show-overflow-tooltip />
        <el-table-column prop="deviceName" label="资产名称" min-width="120" show-overflow-tooltip />
        <el-table-column label="规格型号" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ specOf(row) }}</template>
        </el-table-column>
        <el-table-column label="使用部门" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ deptOf(row) }}</template>
        </el-table-column>
        <el-table-column label="资产分类" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ assetClassOf(row) }}</template>
        </el-table-column>

        <el-table-column label="停台统计" align="center">
          <el-table-column label="开始时间" width="140">
            <template #default="{ row }">{{ fmtDateTime(row.repairData?.startTime) || '—' }}</template>
          </el-table-column>
          <el-table-column label="结束时间" width="140">
            <template #default="{ row }">{{ fmtDateTime(row.repairData?.endTime) || '—' }}</template>
          </el-table-column>
          <el-table-column label="停台时间" width="90" align="center">
            <template #default="{ row }">{{ stopHours(row) === '' ? '—' : stopHours(row) }}</template>
          </el-table-column>
          <el-table-column label="停台类型" width="90">
            <template #default="{ row }">{{ row.repairData?.stopType || '—' }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="修理情况" align="center">
          <el-table-column label="维修内容" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.repairData?.repairContent || '—' }}</template>
          </el-table-column>
          <el-table-column label="更换备件" width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.repairData?.spareParts || '—' }}</template>
          </el-table-column>
          <el-table-column label="故障原因" width="100" show-overflow-tooltip>
            <template #default="{ row }">{{ row.repairData?.faultReason || '—' }}</template>
          </el-table-column>
          <el-table-column label="维保人员" width="90">
            <template #default="{ row }">{{ row.repairData?.assigneeName || '—' }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="安保情况" align="center">
          <el-table-column label="安全交底内容" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.repairData?.safetyBriefing || '—' }}</template>
          </el-table-column>
          <el-table-column label="危险作业票1" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ ticketAt(row, 0) }}</template>
          </el-table-column>
          <el-table-column label="危险作业票2" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ ticketAt(row, 1) }}</template>
          </el-table-column>
          <el-table-column label="危险作业票3" width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ ticketAt(row, 2) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="备注" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.repairData?.abnormalDesc || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row._v2" type="primary" link size="small" @click="openPlan(row)">处理/查看</el-button>
            <el-button v-else link size="small" disabled>旧单只读</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="showCreate" title="新建报修（V2 6步流程）" size="520px">
      <div class="bg-[#e8f4fd] p-2 mb-3 rounded text-xs text-[#606266]">📋 报修(自动完成) → 指派(含安全审核) → 接单(施工准备) → 完工提交 → 完工确认 → 完工审核(通过即归档)</div>
      <el-form label-width="120px" size="small">
        <el-form-item label="设备" required>
          <el-select v-model="createForm.deviceCode" filterable size="small" style="width:100%" placeholder="搜索设备编码/名称" @change="onDeviceChange">
            <el-option v-for="d in devicesStore.list" :key="d.code" :label="`${d.name}（${d.code}）`" :value="d.code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedDeviceInfo" label="设备信息">
          <div class="border border-[#dcdfe6] rounded-md p-2 text-xs text-[#303133] w-full grid grid-cols-2 gap-x-4 gap-y-1">
            <span>资产编号：<b class="font-mono text-[#1192E8]">{{ selectedDeviceInfo.code }}</b></span>
            <span>资产名称：<b>{{ selectedDeviceInfo.name }}</b></span>
            <span>使用部门：<b>{{ selectedDeviceInfo.department || '—' }}</b></span>
            <span>资产分类：<b>{{ selectedDeviceInfo.type || '—' }}</b></span>
            <span class="col-span-2">规格型号：<b>{{ selectedDeviceInfo.spec || '—' }}</b></span>
          </div>
        </el-form-item>
        <el-form-item label="故障情况/维修需求描述" required>
          <el-input v-model="createForm.faultDesc" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="描述故障现象 / 维修需求" />
        </el-form-item>
        <el-form-item label="紧急程度">
          <el-select v-model="createForm.urgency" size="small" style="width:100%">
            <el-option v-for="u in urgencyOptions" :key="u" :label="u + (u === '紧急' ? '（可先施工，24h内补流程）' : '')" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="报修人">
          <el-input :model-value="(authStore.currentUser?.name || '') + (authStore.currentUser?.id ? '（' + authStore.currentUser.id + '）' : '')" disabled />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitCreate">提交报修</el-button>
          <el-button @click="showCreate = false">取消</el-button>
        </el-form-item>
      </el-form>
    </el-drawer>

    <V2PlanDrawer ref="drawerRef" :plan-id="drawerPlanId" @done="onDone" />
  </div>
</template>
