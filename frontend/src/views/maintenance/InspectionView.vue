<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { resolveTemplate, uploadInspectionAttachment } from '@/api/maintenance'
import { fetchDevices } from '@/api/devices'
import StatusTag from '@/components/common/StatusTag.vue'
import ApprovalTimeline from '@/components/maintenance/ApprovalTimeline.vue'

const store = useMaintenanceStore()
const authStore = useAuthStore()
const toast = useToast()

// View tabs
const activeTab = ref('inspections') // 'inspections' | 'report'

// V1.36 检查列表筛选：资产类型（三级级联 大类/中类/小类）+ 检查人 + 状态 + 部门
const filterAssetType = ref([])
const filterInspector = ref('')
const filterStatus = ref('')
const filterDept = ref('')

const statusOptions = ['待提交', '待确认', '待验收', '待审核', '待归档', '已归档', '已完成']

// ===================== V1.34 定期检查「发起检查」表单（按《定期检查表单.jpg》改版） =====================
const showCreateDialog = ref(false)
const createForm = reactive({
  deviceCode: '', deviceName: '', dept: '', assetCategory: '', spec: '',
  checkType: '定期检查', checkDate: new Date().toISOString().slice(0, 10),
  inspector: authStore.userName
})
// 设备搜索（按资产编号/名称远程搜索）
const deviceOptions = ref([])
const deviceLoading = ref(false)
const selectedDevice = ref(null)
let searchTimer = null
// 06 定期检查标准模板解析结果
const safetyNotice = ref(null)          // {title, content}
const categories = ref([])              // [{seq,name,standard,checkItems?,result:'达标'|'超标'}]
const templateUnconfigured = ref(false) // 该设备小类未上传 06 → 提示 + 禁止提交
// 发现问题行（可自动增行：问题描述 + 图片 + 处理意见自由文本）
const issues = ref([])

function newIssueRow() {
  return reactive({ seq: issues.value.length + 1, desc: '', images: [], opinion: '' })
}

// 设备远程搜索（防抖）：资产编号或资产名称子串
async function searchDevice(query) {
  clearTimeout(searchTimer)
  if (!query || !query.trim()) { deviceOptions.value = []; return }
  searchTimer = setTimeout(async () => {
    deviceLoading.value = true
    try {
      const res = await fetchDevices({ keyword: query.trim(), pageSize: 20 })
      deviceOptions.value = res.data || []
    } catch (e) {
      toast.error(e.message || '设备搜索失败')
    } finally {
      deviceLoading.value = false
    }
  }, 250)
}

function onDeviceSelect(code) {
  const dev = deviceOptions.value.find(d => d.code === code)
  if (!dev) return
  selectedDevice.value = dev
  createForm.deviceName = dev.name
  createForm.dept = dev.department || ''
  createForm.assetCategory = dev.assetCategory || ''
  createForm.spec = dev.spec || ''
  loadPeriodicTemplate(dev)
}

// 选中设备后解析 06 定期检查标准模板：未配置 → 提示「没有配置定期检查文件」+ 隐藏检查项/安全告知 + 禁止提交
async function loadPeriodicTemplate(dev) {
  safetyNotice.value = null
  categories.value = []
  templateUnconfigured.value = false
  issues.value = [newIssueRow()]
  if (!dev || !dev.typeCode) {
    templateUnconfigured.value = true
    return
  }
  const res = await resolveTemplate({ typeCode: dev.typeCode, fileCode: '06' })
  const r = res.data
  if (!r || r.source === '未配置' || !r.content) {
    templateUnconfigured.value = true
    toast.error('没有配置定期检查文件（请先在标准文件配置上传 06 定期检查标准）')
    return
  }
  safetyNotice.value = r.content.safetyNotice || { title: '安全告知及注意事项', content: '' }
  categories.value = (r.content.categories || []).map(c => ({ seq: c.seq, name: c.name, standard: c.standard, checkItems: c.checkItems || [], result: '' }))
  templateUnconfigured.value = false
}

function addIssue() { issues.value.push(newIssueRow()) }
function removeIssue(idx) {
  issues.value.splice(idx, 1)
  issues.value.forEach((x, i) => { x.seq = i + 1 })
}

// 发现问题图片即时上传（磁盘落盘 uploads/，随记录保存 URL）
async function doIssueUpload(issue, options) {
  try {
    const res = await uploadInspectionAttachment(options.file)
    const data = res.data
    issue.images.push({ name: data.name, url: data.url })
    options.onSuccess(res)
  } catch (e) {
    options.onError(e)
    toast.error('图片上传失败')
  }
}
function removeImage(issue, ii) { issue.images.splice(ii, 1) }

// ===================== V1.35 定期检查审批工作流（提交→确认→验收(校核)→审核(校核)→归档） =====================
const showFlowDrawer = ref(false)
const flowRecord = ref(null)
const rejectDialog = ref(false)
const rejectReason = ref('')
const flowSubmitting = ref(false)
// V2 双 Tab：基本信息(info) / 操作记录(records)
const flowTab = ref('info')
const flowStatusMap = { '待提交': 'info', '待确认': 'warning', '待验收': 'warning', '待审核': 'warning', '待归档': 'warning', '已归档': 'success', '已完成': 'success' }

const flowCurrentStep = computed(() => flowRecord.value?.steps.find(s => s.status !== 'done') || null)
const flowDoneSteps = computed(() => flowRecord.value?.steps.filter(s => s.status === 'done') || [])
const flowArchived = computed(() => !!(flowRecord.value && !flowCurrentStep.value))

// 发起检查仅 维保人员/管理员 可见（§3.5 提交=维保人员）
const canLaunch = computed(() => {
  const uid = authStore.currentUser
  return !!(uid && (uid.roleId === 'admin' || uid.roleId === 'mtPersonnel'))
})

// 列表「处理」按钮：有审批流 + 存在待执行步骤 + 当前人是管理员或当前步角色（前端镜像 canExecuteInspectionStep）
function canProcess(row) {
  if (!row || !Array.isArray(row.steps) || !row.steps.length) return false
  const cur = row.steps.find(s => s.status !== 'done')
  if (!cur) return false
  const uid = authStore.currentUser
  return !!(uid && (uid.roleId === 'admin' || uid.roleId === cur.role))
}

function openFlow(row) {
  flowRecord.value = JSON.parse(JSON.stringify(row))
  rejectReason.value = ''
  showFlowDrawer.value = true
}

function openRejectDialog() {
  rejectReason.value = ''
  rejectDialog.value = true
}

async function doFlowAction(action) {
  if (!flowRecord.value || !flowCurrentStep.value) return
  if (action === 'reject' && !rejectReason.value.trim()) { toast.warning('请填写驳回原因'); return }
  flowSubmitting.value = true
  try {
    const stepNo = flowCurrentStep.value.seq
    await store.advanceInspectionStep(flowRecord.value.id, stepNo, {
      action,
      version: flowRecord.value.version,
      reason: action === 'reject' ? rejectReason.value.trim() : undefined
    })
    toast.success(action === 'reject' ? '已驳回退回，请重新提交' : '已通过：第' + stepNo + '步 ' + flowCurrentStep.value.name)
    rejectDialog.value = false
    showFlowDrawer.value = false
  } catch (e) {
    toast.error(e.message || '操作失败')
  } finally {
    flowSubmitting.value = false
  }
}

function openCreateDialog() {
  createForm.deviceCode = ''; createForm.deviceName = ''; createForm.dept = ''
  createForm.assetCategory = ''; createForm.spec = ''
  createForm.checkDate = new Date().toISOString().slice(0, 10)
  createForm.inspector = authStore.userName
  selectedDevice.value = null
  deviceOptions.value = []
  safetyNotice.value = null
  categories.value = []
  templateUnconfigured.value = false
  issues.value = [newIssueRow()]
  showCreateDialog.value = true
}

// 提交：设备 + 至少勾选一项检查项目结果 → 存现有检查记录列表
async function submitInspection() {
  if (!createForm.deviceCode) { toast.warning('请选择设备'); return }
  if (templateUnconfigured.value) { toast.warning('没有配置定期检查文件，无法发起检查'); return }
  if (!categories.value.some(c => c.result)) { toast.warning('请至少勾选一项检查项目结果（达标/超标）'); return }
  const filledIssues = issues.value
    .filter(i => (i.desc && i.desc.trim()) || (i.images && i.images.length) || (i.opinion && i.opinion.trim()))
    .map(i => ({ seq: i.seq, desc: i.desc, images: i.images || [], opinion: i.opinion }))
  const payload = {
    deviceCode: createForm.deviceCode,
    deviceName: createForm.deviceName,
    dept: createForm.dept,
    assetCategory: createForm.assetCategory,
    spec: createForm.spec,
    checkType: '定期检查',
    checkDate: createForm.checkDate,
    inspector: createForm.inspector || authStore.userName,
    safetyNotice: safetyNotice.value,
    categories: categories.value.map(c => ({ seq: c.seq, name: c.name, standard: c.standard, checkItems: c.checkItems, result: c.result })),
    issues: filledIssues,
    // 兼容旧列：「处理意见」= 各行处理意见拼接；「检查情况记录」= 问题描述拼接（列表未展示，透传留档）
    opinion: filledIssues.map(i => i.opinion).filter(Boolean).join('；'),
    record: filledIssues.map(i => i.desc).filter(Boolean).join('；') || '检查完成'
  }
  try {
    await store.createInspection(payload)
    toast.success('检查记录已创建')
    showCreateDialog.value = false
  } catch (e) {
    toast.error(e.message || '创建失败')
  }
}

// V1.36 检查列表筛选 computed ================================================
// 资产类型级联树：从检查记录 deviceType「大类/中类/小类」中文路径构建三级级联
// （TYPE_CODE_MAP 是编码路径且父节点无中文名，不能用字典树，PlanManagementView 同思路）
const assetTypeOptions = computed(() => {
  const map = {} // 大类 -> { 中类 -> Set(小类) }
  store.inspections.forEach(r => {
    if (!r.deviceType) return
    const parts = r.deviceType.split('/').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    const [cat, sub, leaf] = parts
    if (!map[cat]) map[cat] = {}
    if (sub) {
      if (!map[cat][sub]) map[cat][sub] = new Set()
      if (leaf) map[cat][sub].add(leaf)
    }
  })
  return Object.entries(map).map(([cat, subs]) => ({
    value: cat, label: cat,
    children: Object.entries(subs).map(([sub, leaves]) => ({
      value: sub, label: sub,
      children: [...leaves].map(l => ({ value: l, label: l }))
    }))
  }))
})

const inspectorOptions = computed(() => {
  const set = new Set()
  store.inspections.forEach(r => { if (r.inspector) set.add(r.inspector) })
  return [...set]
})

const filteredInspections = computed(() => {
  let list = store.inspections
  const prefix = filterAssetType.value.join('/')
  if (prefix) list = list.filter(r => (r.deviceType || '').startsWith(prefix))
  if (filterInspector.value) list = list.filter(r => r.inspector === filterInspector.value)
  if (filterStatus.value) list = list.filter(r => (r.status || '已完成') === filterStatus.value)
  if (filterDept.value) list = list.filter(r => r.dept === filterDept.value)
  return list
})

// 月度报表 = 当月有发现问题的定期检查记录（自然月；不含整改状态）
const monthlyMonth = ref(new Date().toISOString().slice(0, 7)) // YYYY-MM

const monthlyProblemRecords = computed(() => {
  const rows = []
  store.inspections.forEach(rec => {
    if (rec.checkType !== '定期检查') return
    if (!rec.checkDate || !String(rec.checkDate).startsWith(monthlyMonth.value)) return
    const issueList = Array.isArray(rec.issues)
      ? rec.issues
      : (rec.issues ? [{ desc: rec.issues, opinion: rec.opinion }] : [])
    const filled = issueList
      .map(iss => ({
        desc: String(iss.desc || '').trim(),
        opinion: (Array.isArray(rec.issues) ? (iss.opinion || '') : rec.opinion) || ''
      }))
      .filter(iss => iss.desc)
    if (!filled.length) return
    rows.push({
      checkId: rec.id,
      deviceCode: rec.deviceCode || '',
      deviceName: rec.deviceName,
      dept: rec.dept || '',
      checkDate: rec.checkDate,
      inspector: rec.inspector || '',
      issue: filled.map(i => i.desc).join('；'),
      opinion: filled.map(i => i.opinion).filter(Boolean).join('；'),
      issueCount: filled.length
    })
  })
  return rows
})

// ===================== V1.61：开始执行时间 / 结束时间 =====================
// 记录级 startedAt（首步提交）/ completedAt（归档）由后端写；旧记录无字段回退步骤签名时间
const fmtDT = v => (v || '').replace('T', ' ').substring(0, 16) || '—'
const inspStart = r => {
  if (r.startedAt) return fmtDT(r.startedAt)
  const s = (r.steps || []).find(s => s.status === 'done' && s.signatures?.[0]?.date)
  return s ? fmtDT(s.signatures[0].date) : '—'
}
const inspEnd = r => {
  if (r.completedAt) return fmtDT(r.completedAt)
  if (r.status !== '已归档' && r.status !== '已完成') return '—'
  const done = (r.steps || []).filter(s => s.status === 'done')
  const last = done[done.length - 1]
  return last?.signatures?.[0]?.date ? fmtDT(last.signatures[0].date) : '—'
}

onMounted(async () => {
  await store.fetchInspections()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0">
      <el-radio-group v-model="activeTab" size="small">
        <el-radio-button value="inspections">检查列表</el-radio-button>
        <el-radio-button value="report">月度报表</el-radio-button>
      </el-radio-group>
      <div class="flex-1" />
      <el-button v-if="activeTab === 'inspections' && canLaunch" type="primary" size="small" @click="openCreateDialog">发起检查</el-button>
    </div>

    <!-- Inspections List -->
    <div v-if="activeTab === 'inspections'" class="flex-1 overflow-auto p-3">
      <div class="flex items-center gap-2 mb-3">
        <!-- V1.36 资产类型三级级联筛选（大类/中类/小类，checkStrictly 可选任一层级） -->
        <el-cascader
          v-model="filterAssetType"
          :options="assetTypeOptions"
          :props="{ checkStrictly: true, expandTrigger: 'hover' }"
          size="small" style="width:220px" clearable placeholder="资产类型"
        />
        <el-select v-model="filterInspector" size="small" style="width:120px" clearable placeholder="检查人">
          <el-option v-for="n in inspectorOptions" :key="n" :label="n" :value="n" />
        </el-select>
        <el-select v-model="filterStatus" size="small" style="width:110px" clearable placeholder="状态">
          <el-option v-for="s in statusOptions" :key="s" :label="s" :value="s" />
        </el-select>
        <el-input v-model="filterDept" size="small" style="width:140px" clearable placeholder="部门" />
      </div>
      <el-table :data="filteredInspections" size="small" stripe border empty-text="暂无检查记录">
        <el-table-column label="检查编号" width="150">
          <template #default="{ row }"><span class="font-mono text-xs text-[#1192E8]">{{ row.id }}</span></template>
        </el-table-column>
        <!-- V1.61：列表加深资产编号 -->
        <el-table-column label="资产编号" width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="font-mono text-xs">{{ row.deviceCode || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="deviceName" label="设备名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="checkDate" label="检查日期" width="110" />
        <!-- V1.61：开始执行时间 / 结束时间 -->
        <el-table-column label="开始执行时间" width="150">
          <template #default="{ row }">{{ inspStart(row) }}</template>
        </el-table-column>
        <el-table-column label="结束时间" width="150">
          <template #default="{ row }">{{ inspEnd(row) }}</template>
        </el-table-column>
        <el-table-column prop="inspector" label="检查人" width="90" />
        <el-table-column label="处理意见" min-width="180" show-overflow-tooltip>
          <!-- V1.34：优先展示发现问题各行处理意见拼接，旧记录（issues 为文本）回退 opinion -->
          <template #default="{ row }">{{ (Array.isArray(row.issues) ? row.issues.map(i => i.opinion).filter(Boolean).join('；') : '') || row.opinion || '' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }"><StatusTag :status="row.status || '已完成' " /></template>
        </el-table-column>
        <!-- V1.35：审批流「处理」操作列（无 steps 旧记录/已归档 显示 —） -->
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canProcess(row)" type="primary" link size="small" @click="openFlow(row)">处理</el-button>
            <span v-else class="text-[#c0c4cc]">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 月度报表：当月有发现问题的定期检查记录（无整改状态） -->
    <div v-if="activeTab === 'report'" class="flex-1 overflow-auto p-3">
      <div class="flex items-center gap-4 mb-3">
        <span class="text-xs text-[#606266]">月份：</span>
        <el-date-picker v-model="monthlyMonth" type="month" size="small" value-format="YYYY-MM" style="width:140px" />
        <span class="bg-white border border-[#dcdfe6] rounded px-3 py-2 text-xs">有问题记录：<b class="text-[#303133]">{{ monthlyProblemRecords.length }}</b> 条</span>
      </div>

      <el-table :data="monthlyProblemRecords" size="small" stripe border empty-text="本月暂无发现问题的检查记录">
        <el-table-column prop="checkId" label="检查编号" width="150">
          <template #default="{ row }"><span class="font-mono text-xs text-[#1192E8]">{{ row.checkId }}</span></template>
        </el-table-column>
        <el-table-column label="资产编号" width="150" show-overflow-tooltip>
          <template #default="{ row }"><span class="font-mono text-xs">{{ row.deviceCode || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="deviceName" label="设备名称" min-width="130" show-overflow-tooltip />
        <el-table-column prop="dept" label="使用部门" width="110" />
        <el-table-column prop="checkDate" label="检查日期" width="105" />
        <el-table-column prop="inspector" label="检查人" width="90" />
        <el-table-column label="问题数" width="80" align="center">
          <template #default="{ row }">{{ row.issueCount }}</template>
        </el-table-column>
        <el-table-column prop="issue" label="发现问题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="opinion" label="处理意见" min-width="160" show-overflow-tooltip />
      </el-table>
    </div>

    <!-- Create Inspection Dialog（V1.34 按《定期检查表单.jpg》改版） -->
    <el-dialog v-model="showCreateDialog" title="发起检查" width="680px" top="6vh">
      <el-form label-width="110px" size="small">
        <!-- ① 设备信息：搜索资产编号/资产名称自动带出 -->
        <div class="bg-[#f5f7fa] p-2 mb-2 rounded text-xs">设备信息</div>
        <el-form-item label="资产编号/名称" required>
          <el-select
            v-model="createForm.deviceCode"
            filterable remote
            :remote-method="searchDevice"
            :loading="deviceLoading"
            placeholder="输入资产编号或资产名称搜索"
            style="width:100%"
            @change="onDeviceSelect"
          >
            <el-option v-for="d in deviceOptions" :key="d.code" :value="d.code" :label="d.name + '（' + d.code + '）'" />
          </el-select>
        </el-form-item>
        <div v-if="selectedDevice" class="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3 px-1 text-xs">
          <div class="flex items-center gap-2"><span class="text-[#909399] shrink-0">资产名称</span><b class="truncate">{{ selectedDevice.name }}</b></div>
          <div class="flex items-center gap-2"><span class="text-[#909399] shrink-0">使用部门</span><b class="truncate">{{ selectedDevice.department || '—' }}</b></div>
          <div class="flex items-center gap-2"><span class="text-[#909399] shrink-0">资产分类</span><b class="truncate">{{ selectedDevice.assetCategory || '—' }}</b></div>
          <div class="flex items-center gap-2"><span class="text-[#909399] shrink-0">规格型号</span><b class="truncate">{{ selectedDevice.spec || '—' }}</b></div>
        </div>

        <!-- 未配置 06 提示 -->
        <div v-if="templateUnconfigured" class="mb-3">
          <el-alert type="error" :closable="false" show-icon title="没有配置定期检查文件" description="请先在「标准文件配置」为该设备小类上传 06 定期检查标准文件" />
        </div>

        <!-- ② 安全告知及注意事项（来自 06 模板） -->
        <div v-if="safetyNotice" class="mb-3 p-2 rounded border border-orange-200 bg-orange-50">
          <div class="text-xs font-semibold text-orange-600 mb-1">{{ safetyNotice.title || '安全告知及注意事项' }}</div>
          <div class="text-xs text-[#7a5b2a] whitespace-pre-line">{{ safetyNotice.content }}</div>
        </div>

        <!-- ③ 检查项目表（来自 06 模板，达标/超标两列打勾） -->
        <div v-if="categories.length">
          <div class="bg-[#f5f7fa] p-2 mb-2 rounded text-xs">检查项目</div>
          <el-table :data="categories" size="small" border max-height="280">
            <el-table-column prop="seq" label="序号" width="55" align="center" />
            <el-table-column prop="name" label="检查项目" min-width="110" show-overflow-tooltip />
            <el-table-column prop="standard" label="合格标准" min-width="150" show-overflow-tooltip />
            <el-table-column label="达标" width="70" align="center">
              <template #default="{ row }"><el-radio v-model="row.result" value="达标" /></template>
            </el-table-column>
            <el-table-column label="超标" width="70" align="center">
              <template #default="{ row }"><el-radio v-model="row.result" value="超标" /></template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ④ 发现问题：可自动增行（问题描述 + 图片 + 处理意见自由文本） -->
        <div class="mt-3">
          <div class="flex items-center justify-between bg-[#f5f7fa] p-2 mb-2 rounded text-xs">
            <span>发现问题</span>
            <el-button size="small" type="primary" link @click="addIssue">＋ 添加问题</el-button>
          </div>
          <div v-for="(issue, idx) in issues" :key="idx" class="border border-[#dcdfe6] rounded p-2 mb-2">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-[#909399]">问题 {{ issue.seq }}</span>
              <el-button v-if="issues.length > 1" size="small" type="danger" link @click="removeIssue(idx)">删除</el-button>
            </div>
            <el-input v-model="issue.desc" type="textarea" :rows="2" maxlength="300" show-word-limit placeholder="问题描述" />
            <div class="flex items-center gap-3 mt-2">
              <el-upload :show-file-list="false" :http-request="(opts) => doIssueUpload(issue, opts)" accept="image/*" multiple :limit="9">
                <el-button size="small">上传图片</el-button>
              </el-upload>
              <span v-if="issue.images.length" class="text-xs text-[#909399]">{{ issue.images.length }} 张已上传</span>
            </div>
            <div v-if="issue.images.length" class="flex flex-wrap gap-2 mt-2">
              <div v-for="(img, ii) in issue.images" :key="ii" class="relative">
                <el-image
                  :src="img.url"
                  :preview-src-list="issue.images.map(i => i.url)"
                  :initial-index="ii"
                  fit="cover"
                  style="width:64px;height:64px;border-radius:4px;border:1px solid #e4e7ed"
                />
                <div class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#f56c6c] text-white text-xs leading-4 text-center cursor-pointer select-none" @click="removeImage(issue, ii)">×</div>
              </div>
            </div>
            <div class="mt-2">
              <el-input v-model="issue.opinion" placeholder="处理意见（自由填写）" />
            </div>
          </div>
        </div>

        <!-- 检查信息 -->
        <div class="bg-[#f5f7fa] p-2 mb-2 rounded text-xs">检查信息</div>
        <el-form-item label="检查日期" required>
          <el-input v-model="createForm.checkDate" type="date" style="width:200px" />
        </el-form-item>
        <el-form-item label="检查人" required>
          <el-input v-model="createForm.inspector" style="width:200px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!createForm.deviceCode || templateUnconfigured" @click="submitInspection">提交</el-button>
      </template>
    </el-dialog>

    <!-- ===================== V1.35 定期检查审批工作流抽屉（处理：提交→确认→验收→审核→归档） ===================== -->
    <el-drawer v-model="showFlowDrawer" :title="'处理：' + (flowRecord?.deviceName || '') + '（定期检查）'" size="680px" destroy-on-close>
      <!-- V2 双 Tab：基本信息 / 操作记录 -->
      <el-tabs v-if="flowRecord" v-model="flowTab" class="flow-tabs">
        <el-tab-pane label="基本信息" name="info">
          <div class="text-sm space-y-4">
            <!-- 基础信息块（检查编号 + 设备信息 + 检查人 + 状态） -->
            <div class="border border-[#dcdfe6] rounded-md p-3 text-xs text-[#303133]">
              <div class="flex items-center gap-1 mb-2">
                <span class="inline-block w-[2px] h-3 bg-[#1192E8] rounded"></span>
                <span class="font-semibold text-[#303133]">基础信息</span>
              </div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>检查编号：<b class="font-mono text-[#1192E8]">{{ flowRecord.id }}</b></span>
                <span>设备名称：<b>{{ flowRecord.deviceName }}</b></span>
                <span>使用部门：<b>{{ flowRecord.dept || '—' }}</b></span>
                <span>资产分类：<b>{{ flowRecord.assetCategory || '—' }}</b></span>
                <span>规格型号：<b>{{ flowRecord.spec || '—' }}</b></span>
                <span>检查人：<b>{{ flowRecord.inspector || '—' }}</b></span>
              </div>
              <div class="mt-1">状态：<el-tag size="small" :type="flowStatusMap[flowRecord.status] || 'info'">{{ flowRecord.status }}</el-tag></div>
            </div>

        <!-- 已提交步骤累积展示：当前提交界面上方按序堆叠全部已提交步骤的表单内容（无标题；V1.40 纯审批步无内容不渲染边框，避免空框） -->
        <template v-for="s in flowDoneSteps" :key="s.seq">
        <div v-if="s.seq === 1" class="border border-[#e4e7ed] rounded-md p-2 mb-2">

          <!-- step1 提交：安全告知 + 检查项目表 + 发现问题（全部只读） -->
          <template v-if="s.seq === 1">
            <div v-if="flowRecord.safetyNotice && (flowRecord.safetyNotice.title || flowRecord.safetyNotice.content)" class="border border-orange-200 bg-orange-50 rounded p-2 mb-2">
              <div class="text-xs font-semibold text-orange-600 mb-1">{{ flowRecord.safetyNotice.title || '安全告知及注意事项' }}</div>
              <div v-if="flowRecord.safetyNotice.content" class="text-xs whitespace-pre-line text-[#7a5b2a]">{{ flowRecord.safetyNotice.content }}</div>
            </div>
            <div v-if="flowRecord.categories?.length" class="mb-2">
              <el-table :data="flowRecord.categories" size="small" border max-height="320">
                <el-table-column prop="seq" label="序号" width="55" align="center" />
                <el-table-column prop="name" label="检查项目" min-width="110" show-overflow-tooltip />
                <el-table-column prop="standard" label="合格标准" min-width="150" show-overflow-tooltip />
                <el-table-column label="结果" width="90" align="center">
                  <template #default="{ row }">
                    <el-tag :type="row.result === '超标' ? 'danger' : 'success'" size="small">{{ row.result || '—' }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div v-if="flowRecord.issues?.length" class="mb-2">
              <div class="text-xs font-semibold text-[#606266] mb-1">发现问题（{{ flowRecord.issues.length }}）</div>
              <div v-for="(iss, ii) in flowRecord.issues" :key="ii" class="border border-[#dcdfe6] rounded p-2 mb-1 text-xs">
                <div class="mb-1">问题{{ iss.seq }}：<span class="whitespace-pre-line">{{ iss.desc || '—' }}</span></div>
                <div v-if="iss.images?.length" class="flex flex-wrap gap-2 my-1">
                  <el-image v-for="(img, jj) in iss.images" :key="jj" :src="img.url"
                    :preview-src-list="iss.images.map(x => x.url)" :initial-index="jj"
                    fit="cover" class="rounded border border-[#e4e7ed]" style="width:64px;height:64px" />
                </div>
                <div v-if="iss.opinion" class="text-[#606266]">处理意见：{{ iss.opinion }}</div>
              </div>
            </div>
          </template>

        </div>
        </template>

        </div>
      </el-tab-pane>
      <!-- 操作记录：审批时间线 -->
      <el-tab-pane label="操作记录" name="records">
        <ApprovalTimeline :steps="flowRecord.steps" :reject-log="flowRecord.rejectLog" />
      </el-tab-pane>
    </el-tabs>

      <!-- 底部固定操作区（V1.25 模式：不随内容滚动） -->
      <template #footer>
        <div v-if="flowRecord" class="flex items-center">
          <span v-if="flowArchived" class="text-green-600 text-sm font-semibold">本单已归档 ✅</span>
          <div v-else class="flex gap-2 ml-auto">
            <template v-if="flowCurrentStep.seq === 1">
              <el-button type="primary" size="small" :loading="flowSubmitting" @click="doFlowAction('approve')">重新提交</el-button>
            </template>
            <template v-else-if="flowCurrentStep.action === '归档'">
              <el-button type="primary" size="small" :loading="flowSubmitting" @click="doFlowAction('approve')">归档</el-button>
            </template>
            <template v-else>
              <el-button type="warning" size="small" :loading="flowSubmitting" @click="openRejectDialog">驳回退回</el-button>
              <el-button type="primary" size="small" :loading="flowSubmitting" @click="doFlowAction('approve')">通过</el-button>
            </template>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 驳回原因弹窗 -->
    <el-dialog v-model="rejectDialog" title="驳回退回" width="420px">
      <div class="text-sm text-[#606266] mb-2">请填写驳回原因，将退回「提交」步重新提交。</div>
      <el-input v-model="rejectReason" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="驳回原因（必填）" />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="warning" @click="doFlowAction('reject')">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* V2 双 Tab：激活条蓝色（对齐参考图 #0066CC，项目蓝 #1192E8） */
.flow-tabs { --el-tabs-header-height: 40px; }
.flow-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.flow-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background-color: #dcdfe6; }
.flow-tabs :deep(.el-tabs__active-bar) { background-color: #1192E8; height: 2px; }
.flow-tabs :deep(.el-tabs__item) { font-size: 14px; padding: 0 24px; height: 40px; line-height: 40px; }
.flow-tabs :deep(.el-tabs__item.is-active) { color: #1192E8; font-weight: 600; }
.flow-tabs :deep(.el-tabs__item:hover) { color: #1192E8; }
</style>
