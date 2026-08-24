<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import StatusTag from '@/components/common/StatusTag.vue'
import V2PlanDrawer from '@/components/maintenance/V2PlanDrawer.vue'
import { fetchRepairOrders, createRepairOrder, fetchWorkOrders } from '@/api/maintenance'

const devicesStore = useDevicesStore()
const authStore = useAuthStore()
const toast = useToast()

// ===================== 状态 =====================
const loading = ref(false)
const v2Orders = ref([])   // V2 维修工单（6步）
const legacyOrders = ref([]) // 旧 workOrders（非白名单双轨只读）

const filterStatus = ref('')
const filterUrgency = ref('')
const keyword = ref('')

const drawerRef = ref(null)
const drawerPlanId = ref('')

// 新建报修（V1.37 按《设备报修第一步.jpg》：设备信息块 + 故障情况/维修需求描述 + 紧急程度选中 + 报修人=当前登录人）
const showCreate = ref(false)
const createForm = reactive({
  deviceCode: '', deviceName: '', faultDesc: '', urgency: '普通', reporterName: '',
})
const urgencyOptions = ['普通', '紧急']
const statusOptions = ['', '待执行', '进行中', '待验收', '已完成', '已超期']

// V1.17：移除 08 设备维保门禁 —— 维修走独立流程，任何设备均可发起；安全交底改为手工填写
const selectedDeviceInfo = ref(null)   // 当前选中设备对象

async function onDeviceChange(code) {
  createForm.deviceCode = code || ''
  selectedDeviceInfo.value = devicesStore.list.find(d => d.code === code) || null
  createForm.deviceName = selectedDeviceInfo.value?.name || ''
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
  return list
})

function currentStepName(o) {
  if (!o._v2) return o.status
  const cur = o.steps?.find(s => s.status !== 'done')
  return cur ? `第${cur.seq}步·${cur.name}` : '已归档'
}
function orderId(o) { return o._v2 ? o.id : o.id }
function isEmergency(o) {
  return o._v2 ? !!o.repairData?.emergency : o.urgency === '紧急'
}
function faultDesc(o) {
  return o._v2 ? (o.repairData?.faultDesc || '') : (o.faultDesc || '')
}
function createdAt(o) {
  return o._v2 ? (o.createdAt || '').replace('T', ' ').substring(0, 16) : (o.createdAt || '').replace('T', ' ').substring(0, 16)
}
function fmtDateTime(val) { return (val || '').replace('T', ' ').substring(0, 16) }

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

async function submitCreate() {
  if (!createForm.deviceCode || !createForm.faultDesc) {
    toast.warning('请填写必填项：设备、故障情况')
    return
  }
  try {
    // V1.37：报修人=当前登录人（disabled 只读）；reporterPersonnelId 走后端 curPersonnelId 兜底
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
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0">
      <el-input v-model="keyword" placeholder="工单号/设备编码/名称" size="small" style="width:200px" clearable />
      <el-select v-model="filterStatus" placeholder="全部状态" size="small" style="width:120px" clearable>
        <el-option v-for="s in statusOptions.filter(Boolean)" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="filterUrgency" placeholder="紧急程度" size="small" style="width:110px" clearable>
        <el-option v-for="u in urgencyOptions" :key="u" :label="u" :value="u" />
      </el-select>
      <div class="flex-1" />
      <span class="text-xs text-[#909399]">所有设备均可发起维修（独立流程，不受标准文件限制）· 紧急维修可先施工 24h 内补流程（超时红标）</span>
      <el-button type="primary" size="small" @click="showCreate = true">新建报修</el-button>
      <el-button size="small" @click="load">刷新</el-button>
    </div>

    <!-- 工单列表 -->
    <div class="flex-1 overflow-auto p-3" v-loading="loading">
      <el-table :data="orders" size="small" stripe border empty-text="暂无维修工单">
        <el-table-column label="工单号" width="170">
          <template #default="{ row }">
            <span class="text-[#1192E8] cursor-pointer" @click="row._v2 && openPlan(row)">{{ orderId(row) }}</span>
            <el-tag v-if="row._v2" type="primary" size="small" effect="plain" class="ml-1">V2</el-tag>
            <el-tag v-else type="info" size="small" effect="plain" class="ml-1">旧</el-tag>
            <el-tag v-if="isEmergency(row)" type="danger" size="small" class="ml-1">紧急</el-tag>
            <el-tag v-if="row.flowTimeout" type="danger" size="small" effect="dark" class="ml-1">24h超时</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deviceCode" label="设备编码" width="200" show-overflow-tooltip />
        <el-table-column prop="deviceName" label="设备名称" min-width="130" show-overflow-tooltip />
        <el-table-column label="故障描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ faultDesc(row) }}</template>
        </el-table-column>
        <el-table-column label="当前步骤/状态" width="140">
          <template #default="{ row }">{{ currentStepName(row) }}</template>
        </el-table-column>
        <el-table-column label="报修时间" width="140">
          <template #default="{ row }">{{ createdAt(row) }}</template>
        </el-table-column>
        <!-- V1.61：维修开始/结束时间 = 完工提交手工录入的 repairData.startTime/endTime（旧单无 → —） -->
        <el-table-column label="维修开始时间" width="140">
          <template #default="{ row }">{{ fmtDateTime(row.repairData?.startTime) || '—' }}</template>
        </el-table-column>
        <el-table-column label="维修结束时间" width="140">
          <template #default="{ row }">{{ fmtDateTime(row.repairData?.endTime) || '—' }}</template>
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

    <!-- 新建报修抽屉（V1.38 按《设备报修第一步.jpg》：设备信息块 + 故障情况/维修需求描述 + 紧急程度选中 + 报修人=当前登录人） -->
    <el-drawer v-model="showCreate" title="新建报修（V2 6步流程）" size="520px">
      <div class="bg-[#e8f4fd] p-2 mb-3 rounded text-xs text-[#606266]">📋 报修(自动完成) → 指派(含安全审核) → 接单(施工准备) → 完工提交 → 完工确认 → 完工审核(通过即归档)</div>
      <el-form label-width="120px" size="small">
        <el-form-item label="设备" required>
          <el-select v-model="createForm.deviceCode" filterable size="small" style="width:100%" placeholder="搜索设备编码/名称" @change="onDeviceChange">
            <el-option v-for="d in devicesStore.list" :key="d.code" :label="`${d.name}（${d.code}）`" :value="d.code" />
          </el-select>
        </el-form-item>
        <!-- 设备信息块（资产编号/名称/使用部门/分类/规格型号，选中设备后展示） -->
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
