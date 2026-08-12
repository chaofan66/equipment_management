<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useToast } from '@/composables/useToast'
import StatusTag from '@/components/common/StatusTag.vue'
import ApprovalTimeline from '@/components/maintenance/ApprovalTimeline.vue'
import {
  fetchTrainingRecords, createTrainingRecord, advanceTrainingRecord
} from '@/api/maintenance'

const devicesStore = useDevicesStore()
const toast = useToast()
const loading = ref(false)
const records = ref([])
const showCreate = ref(false)
const showDetail = ref(false)
const current = ref(null)
// V2 双 Tab：基本信息(info) / 操作记录(records)
const detailTab = ref('info')

// V1.17：培训内容固定复用「01 安全操作规程」（删独立 07 设备培训标准）
const form = reactive({
  title: '', contentId: '01', trainingDate: new Date().toISOString().slice(0, 10),
  deviceCodes: [], participants: []
})
const personnelOptions = ref([])

const projectNames = { training: '设备培训' }

async function load() {
  loading.value = true
  try {
    const res = await fetchTrainingRecords()
    records.value = res.data || []
  } finally { loading.value = false }
}

async function loadPersonnel() {
  // 人员候选直接取人员列表（后端 options 接口）
  const opts = await import('@/api/maintenance').then(m => m.fetchRoleOptions())
  personnelOptions.value = opts.data.personnel || []
}

async function openCreate() {
  showCreate.value = true
  Object.assign(form, { title: '设备安全操作规程培训', contentId: '01', trainingDate: new Date().toISOString().slice(0, 10), deviceCodes: [], participants: [] })
}

async function submitCreate() {
  if (!form.title || !form.deviceCodes.length) {
    return toast.warning('请填写培训主题并选择参训设备')
  }
  try {
    await createTrainingRecord(form)
    toast.success('培训活动已创建')
    showCreate.value = false
    load()
  } catch (e) { toast.error(e.message) }
}

async function openDetail(rec) {
  current.value = rec
  showDetail.value = true
}

async function advance(action = 'submit') {
  if (!current.value) return
  try {
    await advanceTrainingRecord(current.value.id, { personnelId: 'p001', action })
    toast.success('已提交')
    showDetail.value = false
    load()
  } catch (e) { toast.error(e.message) }
}

const currentStep = (rec) => rec?.steps?.find(s => s.status !== 'done')

onMounted(async () => {
  await Promise.all([load(), loadPersonnel(), devicesStore.fetchList({ pageSize: 5000 })])
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0">
      <span class="text-sm font-semibold">设备培训（按培训活动粒度，§5.3(5)）</span>
      <div class="flex-1" />
      <el-button type="primary" size="small" @click="openCreate">发起培训活动</el-button>
    </div>
    <div class="flex-1 overflow-auto p-3">
      <el-table :data="records" size="small" border stripe empty-text="暂无培训活动">
        <el-table-column prop="id" label="活动编号" width="150">
          <template #default="{ row }"><span class="text-[#1192E8]">{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column prop="title" label="培训主题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="trainingDate" label="培训日期" width="110" />
        <el-table-column label="覆盖设备" width="200">
          <template #default="{ row }">
            <span>{{ row.deviceCodes.length }} 台</span>
            <el-tooltip :content="row.deviceCodes.join('、')"><el-tag size="small" class="ml-1">查看</el-tag></el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="参训人数" width="90">
          <template #default="{ row }">{{ row.participants?.length || 0 }} 人</template>
        </el-table-column>
        <el-table-column label="当前步骤" width="130">
          <template #default="{ row }">{{ currentStep(row) ? '第' + currentStep(row).seq + '步·' + currentStep(row).name : '已归档' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }"><el-button type="primary" link size="small" @click="openDetail(row)">处理</el-button></template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 发起培训 -->
    <el-dialog v-model="showCreate" title="发起培训活动（内容复用安全操作规程）" width="600px">
      <el-form label-width="110px" size="small">
        <el-form-item label="培训主题" required>
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="培训日期" required>
          <el-input v-model="form.trainingDate" type="date" />
        </el-form-item>
        <el-form-item label="内容模板">
          <el-tag size="small" type="success">01 安全操作规程</el-tag>
          <span class="text-xs text-[#909399] ml-2">培训内容固定复用安全操作规程（V1.17）</span>
        </el-form-item>
        <el-form-item label="参训设备" required>
          <el-select v-model="form.deviceCodes" multiple filterable size="small" style="width:100%" placeholder="多选设备（试点白名单）">
            <el-option v-for="d in devicesStore.list.filter(x => (x.code || '').startsWith('161502'))" :key="d.code" :label="d.name + ' (' + d.code + ')'" :value="d.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="参训人员">
          <el-select v-model="form.participants" multiple filterable size="small" style="width:100%">
            <el-option v-for="p in personnelOptions" :key="p.id" :label="p.name + ' (' + p.employeeId + ')'" :value="p.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 培训详情 -->
    <el-drawer v-model="showDetail" :title="current?.title || '培训活动'" size="560px">
      <!-- V2 双 Tab：基本信息 / 操作记录 -->
      <el-tabs v-if="current" v-model="detailTab" class="training-tabs">
        <el-tab-pane label="基本信息" name="info">
          <div class="text-sm space-y-4">
            <!-- 基础信息块（活动信息 + 状态） -->
            <div class="border border-[#dcdfe6] rounded-md p-3 text-xs text-[#303133]">
              <div class="flex items-center gap-1 mb-2">
                <span class="inline-block w-[2px] h-3 bg-[#1192E8] rounded"></span>
                <span class="font-semibold text-[#303133]">基础信息</span>
              </div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>活动编号：<b class="font-mono text-[#1192E8]">{{ current.id }}</b></span>
                <span>培训主题：<b>{{ current.title }}</b></span>
                <span>培训日期：<b>{{ current.trainingDate || '—' }}</b></span>
                <span>覆盖设备：<b>{{ current.deviceCodes.length }} 台</b></span>
                <span>参训人数：<b>{{ current.participants?.length || 0 }} 人</b></span>
                <span v-if="current.status">状态：<el-tag size="small" :type="current.status === '已归档' ? 'success' : 'info'">{{ current.status }}</el-tag></span>
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold text-[#606266] mb-1">参训设备（{{ current.deviceCodes.length }} 台）</div>
              <div class="flex flex-wrap gap-1">
                <el-tag v-for="c in current.deviceCodes" :key="c" size="small" effect="plain">{{ c }}</el-tag>
              </div>
            </div>
            <div>
              <div class="text-xs font-semibold text-[#606266] mb-1">参训人员（{{ current.participants?.length || 0 }} 人）</div>
              <div class="flex flex-wrap gap-1">
                <el-tag v-for="p in current.participants" :key="p" size="small">{{ personnelOptions.find(x => x.id === p)?.name || p }}</el-tag>
              </div>
            </div>
            <div v-if="current.content">
              <div class="text-xs font-semibold text-[#606266] mb-1">培训内容（安全操作规程）</div>
              <div v-for="sec in current.content.safetyProcedure?.sections || []" :key="sec.seq" class="mb-2 bg-[#fafafa] p-2 rounded">
                <div class="text-xs font-semibold">{{ sec.seq }}. {{ sec.title }}</div>
                <div v-for="c in sec.clauses" :key="c" class="text-xs text-[#606266]">· {{ c }}</div>
              </div>
            </div>
            <div class="border-t pt-3 flex gap-2">
              <el-button type="primary" size="small" @click="advance('submit')">提交本步（{{ currentStep(current)?.name }}）</el-button>
            </div>
          </div>
        </el-tab-pane>
        <!-- 操作记录：审批时间线 -->
        <el-tab-pane label="操作记录" name="records">
          <ApprovalTimeline :steps="current.steps" />
        </el-tab-pane>
      </el-tabs>
    </el-drawer>
  </div>
</template>

<style scoped>
/* V2 双 Tab：激活条蓝色（对齐参考图 #0066CC，项目蓝 #1192E8） */
.training-tabs { --el-tabs-header-height: 40px; }
.training-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.training-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background-color: #dcdfe6; }
.training-tabs :deep(.el-tabs__active-bar) { background-color: #1192E8; height: 2px; }
.training-tabs :deep(.el-tabs__item) { font-size: 14px; padding: 0 24px; height: 40px; line-height: 40px; }
.training-tabs :deep(.el-tabs__item.is-active) { color: #1192E8; font-weight: 600; }
.training-tabs :deep(.el-tabs__item:hover) { color: #1192E8; }
</style>
