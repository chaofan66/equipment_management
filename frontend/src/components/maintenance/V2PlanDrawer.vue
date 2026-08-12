<script setup>
import { ref, computed, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { fetchV2Plan, advanceV2Step, uploadV2Attachment } from '@/api/maintenance'
import { fetchPersonnel } from '@/api/config'
import ApprovalTimeline from './ApprovalTimeline.vue'

const props = defineProps({ planId: { type: String, default: '' } })
const emit = defineEmits(['done'])

const toast = useToast()
const authStore = useAuthStore()
const visible = ref(false)
const plan = ref(null)
const submitting = ref(false)
// V2 双 Tab：基本信息(info) / 操作记录(records)
const activeTab = ref('info')
const statusTypeMap = { '待执行': 'warning', '进行中': '', '已超期': 'danger', '已顺延': 'info', '已作废': 'danger', '已归档': 'success' }

const projectNames = { daily_check: '日常点检', level1: '一级保养', level2: '二级保养', lubrication: '设备润滑', periodic_inspection: '定期检查', training: '设备培训', repair: '设备维修' }
const handlingOpinions = ['停机处理', '列入维修计划（建议完成时限）', '继续观察运行']
const dangerTypes = ['高处作业', '动火作业', '受限空间', '吊装作业']
// V1.37 维修完工提交（《维保完工提交内容.jpg》）下拉选项
const faultReasonOptions = ['正常磨损', '寿命到期', '意外损坏', '其他']
const stopTypeOptions = ['随机故障', '计划维修', '其他']
const testResultOptions = ['空载正常', '带载正常', '异常']
// V1.37 接单·现场施工准备 4 项勾选（《维保接单表单.jpg》）[safety4 key, 文案]
const safetyCheckLabels = [
  ['areaNotified', '已告知同区域/同轨道相关操作人员维修作业'],
  ['powerOff', '设备已完全停止运行，能量已隔离（断电/挂牌）'],
  ['warningSet', '维修区域已设置警示带/标识'],
  ['dangerWork', '高空作业、动火作业、有限空间等危险作业！'],
]
// V1.30：班前三态「正常/异常/停工」单选用「勾选」样式（绿/橙/红勾），替代原 el-radio（V1.21 已按图片称"打勾列"）
const dcStates = [
  { v: '正常', cls: 'dc-ok' },
  { v: '异常', cls: 'dc-warn' },
  { v: '停工', cls: 'dc-stop' },
]

const currentStep = computed(() => plan.value?.steps.find(s => s.status !== 'done'))
// V1.24 已提交步骤：全部按序累积展示在当前步骤录入表单上方
const doneSteps = computed(() => plan.value?.steps.filter(s => s.status === 'done') || [])
// V1.40 该已提交步骤是否有可展示内容：纯提交/纯审批步骤无表单内容，跳过外层边框容器避免空框
function hasDoneStepContent(s) {
  const pt = plan.value?.projectType
  const hasItems = !!plan.value?.items?.length
  const hasCats = !!plan.value?.categories?.length
  if (pt === 'daily_check') {
    if (s.seq === 1) return hasItems
    if (s.seq === 2) return true // 班后台时信息（afterShift 无值也显示每日运行信息）
  }
  if (['level1', 'level2', 'lubrication'].includes(pt)) return s.seq === 1 && hasItems
  if (pt === 'periodic_inspection') return s.seq === 1 && hasCats
  if (pt === 'repair') return [1, 2, 3, 4].includes(s.seq) // 报修/指派/接单/完工提交有内容，完工确认/审核纯审批
  return false
}

// V1.38 指派强绑定：维修工单 接单(seq3)/完工提交(seq4) 仅被指派的维保人员可提交（admin 除外）
const canSubmitCurrent = computed(() => {
  const p = plan.value
  if (!p || p.projectType !== 'repair') return true
  const seq = currentStep.value?.seq
  if (!(seq === 3 || seq === 4)) return true
  const cu = authStore.currentUser
  if (cu?.roleId === 'admin') return true
  const assignee = p.repairData?.assignee
  if (!assignee) return true            // 未指派（不应出现在此步）不额外禁用
  return assignee === cu?.personnelId
})
const assigneeHint = computed(() => {
  const p = plan.value
  if (!p || p.projectType !== 'repair') return ''
  const seq = currentStep.value?.seq
  if (!(seq === 3 || seq === 4)) return ''
  if (canSubmitCurrent.value) return ''
  return '本单指派给 ' + (p.repairData?.assigneeName || '指定维保人员') + ' 执行'
})
// V1.54：已超期计划锁定——月度保养（一级/二级/润滑）已超期后不可继续提交/驳回（可改期/作废，admin 可越过）
const overdueLocked = computed(() => plan.value?.status === '已超期')

// V1.37 指派步：维保人员下拉（按需拉取，不污染 config store）
const mtPersonnelList = ref([])
async function loadMtPersonnel() {
  try {
    const r = await fetchPersonnel({ role: 'mtPersonnel' })
    mtPersonnelList.value = r.data || []
  } catch (e) { toast.error(e.message) }
}
function onAssigneeChange(id) {
  const p = mtPersonnelList.value.find(x => x.id === id)
  plan.value.repairData.assigneeName = p ? p.name : ''
}

async function open(id) {
  visible.value = true
  await load(id || props.planId)
}
async function load(id) {
  try {
    const r = await fetchV2Plan(id)
    plan.value = r.data
    // V1.29 旧单迁移：一/二级保养+润滑 执行结果由 合格/不合格(result) 改「保养」勾选(checked)，在途单 result:'合格' 自动迁移为勾选
    if (['level1', 'level2', 'lubrication'].includes(r.data.projectType) && Array.isArray(r.data.items)) {
      r.data.items.forEach(i => { if (i.checked === undefined) i.checked = (i.result === '合格') })
    }
    // V1.37 维修：拉取维保人员列表供指派步选择
    if (r.data.projectType === 'repair') loadMtPersonnel()
  } catch (e) { toast.error(e.message) }
}
function close() { visible.value = false; plan.value = null }

// 班前三态 / 班后台时 / 保养结果 / 定期分类 均直接改 plan.items
async function submit(action = 'submit') {
  if (!plan.value) return
  submitting.value = true
  try {
    const stepNo = currentStep.value?.seq
    let data = {}
    if (plan.value.projectType === 'daily_check') {
      if (stepNo === 1) data.items = plan.value.items
      if (stepNo === 2) data = { afterShift: plan.value.afterShift } // V1.18 班后：固定台时表单（不再有班后检查项）
    } else if (plan.value.projectType === 'periodic_inspection' && stepNo === 1) {
      data.categories = plan.value.categories
    } else if (plan.value.projectType === 'repair') {
      // V1.38：6 步流程按步提交——seq2 指派(含安全审核) / seq3 接单(现场施工准备) / seq4 完工提交；其余步骤 data={}
      const rd = plan.value.repairData || {}
      if (stepNo === 2) {
        if (!rd.assignee) { toast.warning('请选择指派的维保人员'); return }
        data = { assignee: rd.assignee, assigneeName: rd.assigneeName }
      } else if (stepNo === 3) {
        data = { safety4: rd.safety4, dangerTickets: rd.dangerTickets, safetyBriefing: rd.safetyBriefing }
      } else if (stepNo === 4) {
        data = { startTime: rd.startTime, endTime: rd.endTime, repairContent: rd.repairContent, spareParts: rd.spareParts, faultReason: rd.faultReason, stopType: rd.stopType, testResult: rd.testResult, abnormalDesc: rd.abnormalDesc }
      }
    } else if (stepNo === 1) {
      data.items = plan.value.items
      // V1.33：第一步提交图片附件（仅 一级/二级/润滑），URL 数组快照随提交保存
      if (['level1', 'level2', 'lubrication'].includes(plan.value.projectType)) {
        data.attachments = plan.value.attachments || []
      }
    }
    await advanceV2Step(plan.value.id, stepNo, { personnelId: authStore.currentUser?.personnelId, action, version: plan.value.version, data, reason: action === 'reject' ? (plan.value._rejectReason || '驳回') : undefined })
    toast.success(action === 'reject' ? '已驳回退回' : '已提交：第' + stepNo + '步')
    visible.value = false
    emit('done')
  } catch (e) { toast.error(e.message || '操作失败') }
  finally { submitting.value = false }
}

watch(() => props.planId, (v) => { if (v && visible.value) load(v) })
defineExpose({ open, close })

// V1.33：第一步提交图片附件（仅 一级/二级/润滑）——el-upload 即时上传拿 URL，提交时随 data.attachments 保存
const attFiles = computed(() => (plan.value?.attachments || []).map((a, i) => ({ name: a.name || '图' + (i + 1), url: a.url })))
async function doAttUpload({ file, onSuccess, onError }) {
  try {
    const res = await uploadV2Attachment(plan.value.id, currentStep.value?.seq, file)
    if (!plan.value.attachments) plan.value.attachments = []
    plan.value.attachments.push({ name: res.data.name || file.name, url: res.data.url, uploadedAt: new Date().toISOString() })
    onSuccess(res.data)
  } catch (e) { onError(e); toast.error(e.message || '上传失败') }
}
function onAttRemove(file) {
  if (!plan.value?.attachments) return
  plan.value.attachments = plan.value.attachments.filter(a => a.url !== file.url)
}
function onAttPreview(file) {
  if (file.url) window.open(file.url, '_blank')
}
</script>

<template>
  <el-drawer v-model="visible" :title="'处理：' + (plan?.deviceName || '') + '（' + projectNames[plan?.projectType] + '）'" size="640px" destroy-on-close>
    <!-- V2 双 Tab：基本信息（基础信息+当前表单）/ 操作记录（审批时间线） -->
    <el-tabs v-if="plan" v-model="activeTab" class="plan-tabs">
      <el-tab-pane label="基本信息" name="info">
        <div class="text-sm space-y-4">
          <!-- 基础信息块（统一所有计划类型：设备信息 + 状态 + 附加标签） -->
          <div class="border border-[#dcdfe6] rounded-md p-3 text-xs text-[#303133]">
            <div class="flex items-center gap-1 mb-2">
              <span class="inline-block w-[2px] h-3 bg-[#1192E8] rounded"></span>
              <span class="font-semibold text-[#303133]">基础信息</span>
            </div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>资产编号：<b class="font-mono text-[#1192E8]">{{ plan.deviceCode }}</b></span>
              <span>资产名称：<b>{{ plan.deviceName }}</b></span>
              <span>使用部门：<b>{{ plan.dept || '—' }}</b></span>
              <span>资产分类：<b>{{ plan.assetClass }}</b></span>
              <span>规格型号：<b>{{ plan.spec || '—' }}</b></span>
              <span>状态：<el-tag size="small" :type="statusTypeMap[plan.status] || 'info'">{{ plan.status }}</el-tag></span>
            </div>
            <div v-if="plan.flowTimeout || plan.together || (['level1', 'level2', 'lubrication'].includes(plan.projectType) && plan.templateSource) || (plan.projectType === 'repair' && (plan.repairData?.emergency || plan.repairData?.urgency === '紧急'))" class="mt-1.5 flex items-center gap-1 flex-wrap">
              <el-tag v-if="['level1', 'level2', 'lubrication'].includes(plan.projectType) && plan.templateSource" size="small" effect="plain">模板 {{ plan.templateId }} · {{ plan.templateSource }}</el-tag>
              <el-tag v-if="plan.flowTimeout" size="small" type="danger">紧急超时</el-tag>
              <el-tag v-if="plan.together" size="small" type="warning">联合执行</el-tag>
              <el-tag v-if="plan.projectType === 'repair' && (plan.repairData?.emergency || plan.repairData?.urgency === '紧急')" size="small" type="danger">紧急</el-tag>
            </div>
          </div>

      <!-- V1.28 安全告知及注意事项（标题+文本）：执行表单顶部，02-06 五类统一（替代旧 safetyNotices 子弹） -->
      <div v-if="plan.safetyNotice && (plan.safetyNotice.title || plan.safetyNotice.content)" class="border border-orange-200 bg-orange-50 rounded-md p-2 text-xs text-[#606266]">
        <div class="text-xs font-semibold text-orange-600 mb-1">{{ plan.safetyNotice.title || '安全告知及注意事项' }}</div>
        <div v-if="plan.safetyNotice.content" class="whitespace-pre-line">{{ plan.safetyNotice.content }}</div>
      </div>

      <!-- ===== 已提交步骤累积展示：当前提交界面上方按序堆叠全部已提交步骤的表单内容（无标题；V1.40 纯提交/纯审批步无内容不渲染边框，避免空框） ===== -->
      <template v-for="s in doneSteps" :key="s.seq">
        <div v-if="hasDoneStepContent(s)" class="mb-2">

        <!-- 日常点检 step1 班前：items 三态只读表（disabled 勾选态） -->
        <div v-if="plan.projectType === 'daily_check' && s.seq === 1 && plan.items?.length" class="mb-2">
          <el-table :data="plan.items" size="small" border max-height="300">
            <el-table-column prop="seq" label="序号" width="50" />
            <el-table-column prop="project" :label="plan.labels?.item" width="90" show-overflow-tooltip />
            <el-table-column prop="content" :label="plan.labels?.content" min-width="180" show-overflow-tooltip />
            <el-table-column v-for="s in dcStates" :key="s.v" :label="s.v" width="64" align="center">
              <template #default="{ row }">
                <span class="dc-state-btn is-disabled" :class="row.state === s.v ? 'is-checked ' + s.cls : ''">
                  <span v-if="row.state === s.v" class="dc-check">✓</span>
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 日常点检 step2 班后：afterShift 台时 3 项只读文本 -->
        <div v-if="plan.projectType === 'daily_check' && s.seq === 2" class="border border-[#dcdfe6] rounded-md p-2 mb-2 text-xs text-[#303133]">
          <div class="text-xs font-semibold text-[#606266] mb-1">每日运行信息</div>
          <div class="grid grid-cols-1 gap-1">
            <span>每日运行时间：<b>{{ plan.afterShift?.runHours ?? '—' }} 小时</b></span>
            <span>故障停台时间：<b>{{ plan.afterShift?.faultStopHours ?? '—' }} 小时</b></span>
            <span>计划停台时间：<b>{{ plan.afterShift?.planStopHours ?? '—' }} 小时</b></span>
          </div>
        </div>

        <!-- level1/level2/lubrication step1：执行项只读表（V1.24 新增；V1.29 结果 合格/不合格 → 保养勾选态 disabled checkbox） -->
        <div v-if="['level1', 'level2', 'lubrication'].includes(plan.projectType) && s.seq === 1 && plan.items?.length" class="mb-2">
          <el-table :data="plan.items" size="small" border max-height="320">
            <el-table-column prop="seq" label="序号" width="50" />
            <el-table-column :label="plan.labels?.item" width="90">
              <template #default="{ row }">{{ row.category || row.project }}</template>
            </el-table-column>
            <el-table-column prop="content" :label="plan.labels?.content" min-width="170" show-overflow-tooltip />
            <el-table-column :label="plan.labels?.standard" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.standard || row.content }}</template>
            </el-table-column>
            <el-table-column label="保养" width="70" align="center">
              <template #default="{ row }"><el-checkbox :model-value="row.checked" disabled /></template>
            </el-table-column>
          </el-table>
          <!-- V1.33：第1步已提交图片附件缩略图（el-image 点击预览大图） -->
          <div v-if="s.seq === 1 && plan.attachments?.length" class="mt-2">
            <div class="text-xs font-semibold text-[#606266] mb-1">图片附件（{{ plan.attachments.length }}）</div>
            <div class="flex flex-wrap gap-2">
              <el-image v-for="(a, i) in plan.attachments" :key="a.url || i" :src="a.url"
                :preview-src-list="plan.attachments.map(x => x.url)" :initial-index="i"
                fit="cover" class="rounded border border-[#e4e7ed]" style="width:72px;height:72px" />
            </div>
          </div>
        </div>

        <!-- periodic_inspection step1：逐类只读表（V1.24 新增，达标/超标 + 问题描述 + 处理意见） -->
        <div v-if="plan.projectType === 'periodic_inspection' && s.seq === 1 && plan.categories?.length" class="mb-2">
          <el-table :data="plan.categories" size="small" border max-height="320">
            <el-table-column prop="seq" label="序号" width="50" />
            <el-table-column prop="name" :label="plan.labels?.name" width="100" />
            <el-table-column prop="standard" :label="plan.labels?.standard" min-width="150" show-overflow-tooltip />
            <el-table-column label="结果" width="100">
              <template #default="{ row }">
                <el-select :model-value="row.result" size="small" disabled><el-option value="达标" /><el-option value="超标" /></el-select>
              </template>
            </el-table-column>
            <el-table-column label="问题描述">
              <template #default="{ row }">{{ row.issue || '—' }}</template>
            </el-table-column>
            <el-table-column label="处理意见" width="180">
              <template #default="{ row }">{{ row.handlingOpinion || '—' }}</template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 维修 done seq1：报修（设备信息块 + 故障情况 + 紧急程度 + 报修人） -->
        <div v-if="plan.projectType === 'repair' && s.seq === 1" class="mb-2">
          <div class="border border-[#dcdfe6] rounded-md p-2 text-xs text-[#303133] grid grid-cols-2 gap-x-4 gap-y-1">
            <span>资产编号：<b class="font-mono text-[#1192E8]">{{ plan.deviceCode }}</b></span>
            <span>资产名称：<b>{{ plan.deviceName }}</b></span>
            <span>使用部门：<b>{{ plan.dept || '—' }}</b></span>
            <span>资产分类：<b>{{ plan.assetClass }}</b></span>
            <span>规格型号：<b>{{ plan.spec || '—' }}</b></span>
            <span>紧急程度：<el-tag :type="plan.repairData?.emergency ? 'danger' : 'info'" size="small">{{ plan.repairData?.emergency ? '紧急' : (plan.repairData?.urgency || '普通') }}</el-tag></span>
            <span class="col-span-2">故障情况/维修需求：<b>{{ plan.repairData?.faultDesc || '—' }}</b></span>
            <span v-if="s.signatures[0]" class="col-span-2">报修人：<b>{{ s.signatures[0].name }}（{{ s.signatures[0].employeeId }}）· {{ s.signatures[0].roleName }}</b> <span class="text-[#909399]">· {{ (s.signatures[0].date || '').replace('T', ' ').substring(0, 16) }}</span></span>
          </div>
        </div>

        <!-- 维修 done seq2：指派 -->
        <div v-if="plan.projectType === 'repair' && s.seq === 2" class="mb-2">
          <div class="border border-[#dcdfe6] rounded-md p-2 text-xs text-[#303133]">指派维保人员：<b>{{ plan.repairData?.assigneeName || '—' }}</b></div>
        </div>

        <!-- 维修 done seq3：接单（4 项勾选态 + 危险作业票 + 安全交底） -->
        <div v-if="plan.projectType === 'repair' && s.seq === 3" class="mb-2">
          <div class="border border-[#dcdfe6] rounded-md p-2 text-xs text-[#303133] space-y-1">
            <div v-for="[key, label] in safetyCheckLabels" :key="key" class="flex items-center gap-1">
              <span class="text-[#909399]">{{ label }}</span>
              <el-tag :type="plan.repairData?.safety4?.[key] ? 'success' : 'info'" size="small">{{ plan.repairData?.safety4?.[key] ? '✓ 已勾选' : '—' }}</el-tag>
            </div>
            <div v-if="plan.repairData?.dangerTickets?.length">危险作业票号：<span v-for="(t, i) in plan.repairData.dangerTickets" :key="i" class="mr-2">{{ t.no || '—' }}（{{ t.type || '—' }}：{{ t.content || '—' }}）</span></div>
            <div>安全交底：<b>{{ plan.repairData?.safetyBriefing || '—' }}</b></div>
          </div>
        </div>

        <!-- 维修 done seq4：完工提交（《维保完工提交内容.jpg》） -->
        <div v-if="plan.projectType === 'repair' && s.seq === 4" class="mb-2">
          <div class="border border-[#dcdfe6] rounded-md p-2 text-xs text-[#303133] grid grid-cols-2 gap-x-4 gap-y-1">
            <span>开始时间：<b>{{ plan.repairData?.startTime || '—' }}</b></span>
            <span>完成时间：<b>{{ plan.repairData?.endTime || '—' }}</b></span>
            <span>维修内容：<b>{{ plan.repairData?.repairContent || '—' }}</b></span>
            <span>更换备件：<b>{{ plan.repairData?.spareParts || '—' }}</b></span>
            <span>故障原因：<b>{{ plan.repairData?.faultReason || '—' }}</b></span>
            <span>停台类型：<b>{{ plan.repairData?.stopType || '—' }}</b></span>
            <span>试车情况：<b>{{ plan.repairData?.testResult || '—' }}</b></span>
            <span>异常描述：<b>{{ plan.repairData?.abnormalDesc || '—' }}</b></span>
          </div>
        </div>

      </div>
      </template>
      <!-- ===== 当前步骤录入表单（默认=当前进行步骤） ===== -->
      <template v-if="currentStep">
      <!-- ① 日常点检·班前检查（V1.21 按《点检标准内容.jpg》：说明1 + 序号/项目/检查保养内容 + 正常/异常/停工 三态打勾列） -->
      <div v-if="plan.projectType === 'daily_check' && currentStep?.seq === 1">
        <div class="text-xs leading-5 text-[#606266] bg-[#fdf6ec] border border-[#faecd8] rounded px-2 py-1.5 mb-2">说明1：班前检查保养在每班生产前20分钟内进行，发现异常立即报告生产保障维修人员。</div>
        <el-table :data="plan.items" size="small" border max-height="300">
          <el-table-column prop="seq" label="序号" width="50" />
          <el-table-column prop="project" :label="plan.labels?.item" width="90" show-overflow-tooltip />
          <el-table-column prop="content" :label="plan.labels?.content" min-width="180" show-overflow-tooltip />
          <el-table-column v-for="s in dcStates" :key="s.v" :label="s.v" width="64" align="center">
            <template #default="{ row }">
              <button type="button" class="dc-state-btn" :class="row.state === s.v ? 'is-checked ' + s.cls : ''" @click="row.state = s.v">
                <span v-if="row.state === s.v" class="dc-check">✓</span>
              </button>
            </template>
          </el-table-column>
        </el-table>
        <div class="text-xs text-[#909399] mt-1">任一项"异常"提交后自动生成维修工单（§3.6D）。班前异常不阻断班后提交。</div>
      </div>

      <!-- ② 日常点检·班后固定表单（V1.18：班后无检查项，仅 每日运行信息 3 项固定表单，按图设计） -->
      <div v-if="plan.projectType === 'daily_check' && currentStep?.seq === 2">
        <div class="bg-[#f0f9ff] border border-[#b8d6f3] rounded p-2 mb-3 text-xs text-[#1192E8]">说明：每日下班填写每日设备运行信息。</div>
        <div class="text-xs font-semibold text-[#606266] mb-1">每日运行信息（固定表单，§5.9(3)）</div>
        <el-form label-width="140px" size="small" style="max-width:520px">
          <el-form-item label="每日运行时间(小时)">
            <el-input-number v-model="plan.afterShift.runHours" :min="0" :max="24" :step="0.5" controls-position="right" />
          </el-form-item>
          <el-form-item label="故障停台时间(小时)">
            <el-input-number v-model="plan.afterShift.faultStopHours" :min="0" :max="24" :step="0.5" controls-position="right" />
          </el-form-item>
          <el-form-item label="计划停台时间(小时)">
            <el-input-number v-model="plan.afterShift.planStopHours" :min="0" :max="24" :step="0.5" controls-position="right" />
          </el-form-item>
        </el-form>
        <div class="text-xs text-[#909399] mt-1">班前检查任一项"异常"会在提交班前时自动生成维修工单（§3.6D），不阻断班后录入。</div>
      </div>

      <!-- ③ 保养/润滑逐项（V1.29：结果 合格/不合格 → 「保养」逐项勾选框，用户按实际勾选本次执行的保养项） -->
      <div v-if="['level1', 'level2', 'lubrication'].includes(plan.projectType) && currentStep?.seq === 1">
        <div class="text-xs font-semibold text-[#606266] mb-1">执行项（{{ plan.items?.length }} 项，逐项勾选本次实际执行的保养项）</div>
        <el-table :data="plan.items" size="small" border max-height="320">
          <el-table-column prop="seq" label="序号" width="50" />
          <el-table-column :label="plan.labels?.item" width="90">
            <template #default="{ row }">{{ row.category || row.project }}</template>
          </el-table-column>
          <el-table-column prop="content" :label="plan.labels?.content" min-width="170" show-overflow-tooltip />
          <el-table-column :label="plan.labels?.standard" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.standard || row.content }}</template>
          </el-table-column>
          <el-table-column label="保养" width="70" align="center">
            <template #default="{ row }"><el-checkbox v-model="row.checked" /></template>
          </el-table-column>
        </el-table>
        <!-- V1.33：图片附件上传区（即时上传，多张、≤20MB、上限 9 张，随本步提交保存） -->
        <div class="mt-2">
          <div class="text-xs font-semibold text-[#606266] mb-1">图片附件（可选，支持多张，随本步提交保存）</div>
          <el-upload list-type="picture-card" multiple accept="image/*" :limit="9"
            :file-list="attFiles" :http-request="doAttUpload" :on-remove="onAttRemove"
            :on-preview="onAttPreview">
            <span class="text-xs">＋ 上传图片</span>
          </el-upload>
        </div>
      </div>

      <!-- ④ 定期检查逐类 -->
      <div v-if="plan.projectType === 'periodic_inspection' && currentStep?.seq === 1">
        <div class="text-xs font-semibold text-[#606266] mb-1">定期检查（06模板，逐类 达标/超标+处理意见）</div>
        <el-table :data="plan.categories" size="small" border max-height="320">
          <el-table-column prop="seq" label="序号" width="50" />
          <el-table-column prop="name" :label="plan.labels?.name" width="100" />
          <el-table-column prop="standard" :label="plan.labels?.standard" min-width="150" show-overflow-tooltip />
          <el-table-column label="结果" width="100">
            <template #default="{ row }">
              <el-select v-model="row.result" size="small"><el-option value="达标" /><el-option value="超标" /></el-select>
            </template>
          </el-table-column>
          <el-table-column label="问题描述">
            <template #default="{ row }"><el-input v-model="row.issue" size="small" placeholder="超标时必填" /></template>
          </el-table-column>
          <el-table-column label="处理意见" width="180">
            <template #default="{ row }">
              <el-select v-model="row.handlingOpinion" size="small" clearable>
                <el-option v-for="o in handlingOpinions" :key="o" :label="o" :value="o" />
              </el-select>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- ⑤ 维修：指派步(seq2)（V1.37 维保主管把报修单指派给对应维保人员，强绑定后续 接单/完工提交） -->
      <div v-if="plan.projectType === 'repair' && currentStep?.seq === 2">
        <div class="bg-[#f0f9ff] border border-[#b8d6f3] rounded p-2 mb-3 text-xs text-[#1192E8]">指派后仅被指派的维保人员可接单并提交完工内容（他人不可操作）。</div>
        <el-form label-width="120px" size="small" style="max-width:520px">
          <el-form-item label="指派维保人员" required>
            <el-select v-model="plan.repairData.assignee" filterable size="small" style="width:100%" placeholder="选择维保人员" @change="onAssigneeChange">
              <el-option v-for="p in mtPersonnelList" :key="p.id" :label="`${p.name}（${p.employeeId}）`" :value="p.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <!-- ⑥ 维修：接单·现场施工准备(seq3)（V1.37 按《维保接单表单.jpg》：4 项勾选 + 危险作业票号 + 安全交底，提交审核） -->
      <div v-if="plan.projectType === 'repair' && currentStep?.seq === 3">
        <div class="text-xs font-semibold text-[#606266] mb-1">现场施工准备 / 安全措施（勾选确认）</div>
        <el-form label-width="120px" size="small" style="max-width:600px">
          <div class="flex flex-col gap-1 mb-2">
            <el-checkbox v-for="[key, label] in safetyCheckLabels" :key="key" v-model="plan.repairData.safety4[key]">{{ label }}</el-checkbox>
          </div>
          <el-divider />
          <el-form-item label="危险作业票号(≤4)">
            <div v-for="(t, i) in plan.repairData.dangerTickets" :key="i" class="flex items-center gap-1 mb-1">
              <el-input v-model="t.no" size="small" placeholder="票号" style="width:120px" />
              <el-select v-model="t.type" size="small" style="width:110px">
                <el-option v-for="dt in dangerTypes" :key="dt" :label="dt" :value="dt" />
              </el-select>
              <el-input v-model="t.content" size="small" placeholder="作业内容" />
              <el-button link type="danger" size="small" @click="plan.repairData.dangerTickets.splice(i,1)">删</el-button>
            </div>
            <el-button size="small" type="primary" plain :disabled="plan.repairData.dangerTickets.length >= 4" @click="plan.repairData.dangerTickets.push({ no: '', type: dangerTypes[0], content: '' })">+ 添加危险作业票</el-button>
          </el-form-item>
          <el-form-item label="安全交底">
            <el-input v-model="plan.repairData.safetyBriefing" type="textarea" :rows="2" placeholder="已了解现场风险及采取的安全措施…" />
          </el-form-item>
        </el-form>
      </div>

      <!-- ⑦ 维修：完工提交(seq4)（V1.38 按《维保完工提交内容.jpg》：时间/维修内容/备件/故障原因/停台类型/试车情况/异常描述，提交审核） -->
      <div v-if="plan.projectType === 'repair' && currentStep?.seq === 4">
        <div class="text-xs font-semibold text-[#606266] mb-1">完工提交（施工完成后填写，提交审核）</div>
        <el-form label-width="130px" size="small" style="max-width:520px">
          <el-form-item label="开始时间" required>
            <el-date-picker v-model="plan.repairData.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm" size="small" style="width:100%" placeholder="开始维修时间" />
          </el-form-item>
          <el-form-item label="完成时间" required>
            <el-date-picker v-model="plan.repairData.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm" size="small" style="width:100%" placeholder="完成维修时间" />
          </el-form-item>
          <el-form-item label="维修内容">
            <el-input v-model="plan.repairData.repairContent" type="textarea" :rows="3" placeholder="本次维修内容" />
          </el-form-item>
          <el-form-item label="更换备件">
            <el-input v-model="plan.repairData.spareParts" placeholder="如：钢丝绳×1、轴承×2" />
          </el-form-item>
          <el-form-item label="故障原因">
            <el-select v-model="plan.repairData.faultReason" size="small" style="width:100%">
              <el-option v-for="o in faultReasonOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="停台类型">
            <el-select v-model="plan.repairData.stopType" size="small" style="width:100%">
              <el-option v-for="o in stopTypeOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="试车情况">
            <el-select v-model="plan.repairData.testResult" size="small" style="width:100%">
              <el-option v-for="o in testResultOptions" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="异常描述">
            <el-input v-model="plan.repairData.abnormalDesc" type="textarea" :rows="2" placeholder="如有异常情况填写" />
          </el-form-item>
        </el-form>
      </div>
      </template>

        </div>
      </el-tab-pane>
      <!-- 操作记录：审批时间线（done 步 + 待处理 + 驳回/改期/拆分日志） -->
      <el-tab-pane label="操作记录" name="records">
        <ApprovalTimeline :steps="plan.steps" :reject-log="plan.rejectLog" :reschedule-log="plan.rescheduleLog" :split-log="plan.splitLog" />
      </el-tab-pane>
    </el-tabs>
    <!-- V1.25 提交/驳回按钮固定弹框底部（el-drawer #footer 固定区，不随内容滚动，所有计划类型统一） -->
    <template #footer>
      <div v-if="plan" class="flex items-center">
        <span v-if="!currentStep" class="text-green-600 text-sm font-semibold">本单已归档 ✅</span>
        <div v-else class="flex gap-2 ml-auto items-center">
          <span v-if="overdueLocked" class="text-xs text-[#F56C6C]">该计划已超期，无法继续操作（可改期或作废处理）</span>
          <span v-else-if="assigneeHint" class="text-xs text-[#E6A23C]">{{ assigneeHint }}</span>
          <el-button type="warning" size="small" :loading="submitting" :disabled="overdueLocked" @click="submit('reject')">驳回退回</el-button>
          <el-button type="primary" size="small" :loading="submitting" :disabled="!canSubmitCurrent || overdueLocked" @click="submit('submit')">提交本步（{{ currentStep.name }}）</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
/* V1.30：班前三态「正常/异常/停工」勾选样式（绿/橙/红勾，仍单选）——替代原 el-radio */
.dc-state-btn {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #dcdfe6; border-radius: 4px;
  background: #fff; color: #c0c4cc;
  cursor: pointer; transition: all .15s;
}
.dc-state-btn:hover { border-color: #a8abb2; }
.dc-state-btn.is-disabled { cursor: default; }
.dc-state-btn.is-disabled:hover { border-color: #dcdfe6; }
.dc-check { font-size: 14px; line-height: 1; }
.dc-state-btn.dc-ok.is-checked   { color: #67C23A; border-color: #95d475; background: #f0fff0; }
.dc-state-btn.dc-warn.is-checked { color: #E6A23C; border-color: #f3d19e; background: #fdf6ec; }
.dc-state-btn.dc-stop.is-checked { color: #F56C6C; border-color: #fab6b6; background: #fef0f0; }

/* V2 双 Tab：激活条蓝色（对齐参考图 #0066CC，项目蓝 #1192E8） */
.plan-tabs { --el-tabs-header-height: 40px; }
.plan-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.plan-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background-color: #dcdfe6; }
.plan-tabs :deep(.el-tabs__active-bar) { background-color: #1192E8; height: 2px; }
.plan-tabs :deep(.el-tabs__item) { font-size: 14px; padding: 0 24px; height: 40px; line-height: 40px; }
.plan-tabs :deep(.el-tabs__item.is-active) { color: #1192E8; font-weight: 600; }
.plan-tabs :deep(.el-tabs__item:hover) { color: #1192E8; }
</style>
