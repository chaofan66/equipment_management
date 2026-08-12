<script setup>
// V1.49 设备分配共享网格：prop scope='ws'（车间分配）|'mt'（维保分配），两个分配体系逻辑一致，仅配置差异。
// 车间分配：车间主任→操作主管→操作组长→操作人员 逐级分配（允许跳级、操作人员多选）；
// 维保分配：维保主任→维保主管→维保班长→维保人员 逐级分配（允许跳级、维保人员多选）。
// 后端强绑定+数据收窄（分配即权限：可见名下设备；日常点检班前/班后绑定操作人员、二级保养/设备润滑提交绑定维保班长、
//   定期检查发起绑定维保人员），前端仅做交互呈现。
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useDevicesStore } from '@/stores/devices'
import { useToast } from '@/composables/useToast'
import { fetchAssignments, fetchAssignmentCandidates, saveAssignment, batchAssign } from '@/api/maintenance'

const props = defineProps({
  // 'ws' 车间分配（默认，权限点 mt.assign.*）；'mt' 维保分配（权限点 mt.assignmt.*）
  scope: { type: String, default: 'ws' },
})
const isMt = computed(() => props.scope === 'mt')

const authStore = useAuthStore()
const devicesStore = useDevicesStore()
const toast = useToast()
const router = useRouter()

const roleId = computed(() => authStore.currentUser?.roleId || '')
// 分配操作权限（V1.46 车间 mt.assign.edit / V1.49 维保 mt.assignmt.edit）：无则只看不可改
const hasEdit = computed(() => authStore.hasPermission(isMt.value ? 'mt.assignmt.edit' : 'mt.assign.edit'))
// 可跨车间筛选（admin/车间主任/维保主任）；主管/组长/操作人员/维保各级由后端强制本人可见范围，不显示筛选
const canSelectWorkshop = computed(() => ['admin', 'workshopDirector', 'mtDirector'].includes(roleId.value))

const loading = ref(false)
const rows = ref([])          // 当前筛选下的全量行（服务端已按数据范围收窄）
const workshopFilter = ref('')
const filterAssetType = ref([])   // V1.47 资产列表筛选（大/中/小类三级级联；空数组=不过滤）
const page = ref(1)
const pageSize = ref(50)

// 车间下拉（来自当前可见分配行的 workshop 去重——数据范围已收窄，天然匹配角色可见性）
const workshopOptions = computed(() => {
  const set = new Set()
  rows.value.forEach(r => r.workshop && set.add(r.workshop))
  return Array.from(set).sort()
})
const activeWorkshop = computed(() => workshopFilter.value || (workshopOptions.value[0] || ''))

// 顶部说明文案（scope 区分；V1.50 主任级别自动带出：车间=按车间带车间主任、维保=按维护部门带室主任）
const descText = computed(() => isMt.value
  ? '设备逐级分配到人：室主任（按设备维护部门自动带出）→ 维保主管 → 维保班长 → 维保人员（允许跳级）。维保人员/班长/主管仅见「分配给自己」的设备；定期检查发起、二级保养/设备润滑提交仅被分配维保人员/班长可执行。'
  : '设备逐级分配到人：车间主任（按车间自动带出，车间=使用人）→ 主管 → 组长 → 操作人员（允许跳级）。主管/组长/操作人员仅见「分配给自己」的设备；日常点检班前/班后仅被分配操作人员可执行。')

// V1.47 资产列表筛选 =====================================================
// 资产类型级联树：从当前可见分配行的 type「大类/中类/小类」中文路径构建三级级联
// （与定期检查页「资产类型」筛选同思路；车间切换后基于新 rows 自动重建）
const assetTypeOptions = computed(() => {
  const map = {}   // 大类 -> { 中类 -> Set(小类) }
  rows.value.forEach(r => {
    if (!r.type) return
    const parts = String(r.type).split('/').map(s => s.trim()).filter(Boolean)
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
// 按选中的大/中/小类前缀过滤（选大类=该类全部；选到小类=精确小类）
const filteredRows = computed(() => {
  const prefix = filterAssetType.value.join('/')
  if (!prefix) return rows.value
  return rows.value.filter(r => String(r.type || '').startsWith(prefix))
})

// 候选人员缓存 { `${role}|${workshop}`: [{id,name,employeeId,...}] }
const candidateCache = ref({})
const candidatesLoading = ref({})   // key -> true 防并发重复请求

// 分配层级定义（key=接口 level / 后端 LEVEL_ROLES；scope 分派）
const WS_LEVEL_COLS = [
  { key: 'supervisor', label: '主管', role: 'opSupervisor' },
  { key: 'leader', label: '组长', role: 'opLeader' },
  { key: 'operator', label: '操作人员', role: 'operator' },
]
const MT_LEVEL_COLS = [
  { key: 'supervisor', label: '维保主管', role: 'mtSupervisor' },
  { key: 'leader', label: '维保班长', role: 'mtLeader' },
  { key: 'operator', label: '维保人员', role: 'mtPersonnel' },
]
const LEVEL_COLS = computed(() => isMt.value ? MT_LEVEL_COLS : WS_LEVEL_COLS)

// 当前角色可编辑的层级（允许跳级：admin/顶级主任可设任意层；主管级可设下级两层；组长级仅最下级）
const editableLevels = computed(() => {
  if (!hasEdit.value) return []
  const r = roleId.value
  if (r === 'admin' || r === 'workshopDirector' || r === 'mtDirector') return ['supervisor', 'leader', 'operator']
  if (r === 'opSupervisor' || r === 'mtSupervisor') return ['leader', 'operator']
  if (r === 'opLeader' || r === 'mtLeader') return ['operator']
  return []
})
function levelEditable(row, level) {
  return editableLevels.value.includes(level)
}

// 候选下拉（车间 scope 按设备车间过滤防跨车间错配；维保 scope 不传 workshop——维保岗位同属生产保障部且设备跨车间，传车间反而空）
async function ensureCandidates(role, workshop) {
  if (!role) return
  const ws = isMt.value ? '' : (workshop || '')
  const key = `${role}|${ws}`
  if (candidateCache.value[key] || candidatesLoading.value[key]) return
  candidatesLoading.value[key] = true
  try {
    const res = await fetchAssignmentCandidates({ role, workshop: ws || undefined, scope: props.scope })
    candidateCache.value[key] = res.data || []
  } catch (e) {
    console.error('加载候选失败', e)
  } finally {
    candidatesLoading.value[key] = false
  }
}
function candidateOptions(row, levelCol) {
  const ws = row.workshop || activeWorkshop.value
  ensureCandidates(levelCol.role, ws)
  return candidateCache.value[`${levelCol.role}|${isMt.value ? '' : ws}`] || []
}

async function loadData() {
  loading.value = true
  try {
    const params = { scope: props.scope }
    if (canSelectWorkshop.value && activeWorkshop.value) params.workshop = activeWorkshop.value
    const res = await fetchAssignments(params)
    rows.value = res.data || []
    page.value = 1
  } catch (e) {
    toast.error(e?.response?.data?.error || '加载设备分配失败')
  } finally {
    loading.value = false
  }
}

// 单台设置某级分配（V1.48：操作级支持多选传 personnelIds 数组，空数组=清空该级；其余层级仍单选）
async function onAssignChange(row, levelCol, val) {
  const level = levelCol.key
  if (level === 'operator') {
    const old = row.operatorIds || []
    const next = Array.isArray(val) ? val : (val ? [val] : [])
    if (next.length === old.length && next.every((id, i) => id === old[i])) return
    try {
      await saveAssignment(row.deviceCode, { level, personnelIds: next }, props.scope)
      row.operatorIds = next
      row.operators = next.map(id => candidateOptions(row, levelCol).find(p => p.id === id)).filter(Boolean)
      row.updatedAt = new Date().toISOString()
      toast.success(`已${next.length ? '分配' : '清空'}「${row.deviceName || row.deviceCode}」的${levelCol.label}`)
    } catch (e) {
      toast.error(e?.response?.data?.error || '分配失败')
      loadData()   // 失败回滚：重拉服务端权威数据
    }
    return
  }
  const old = row[level + 'Id']
  const val2 = val || ''
  if (val2 === (old || '')) return
  try {
    await saveAssignment(row.deviceCode, { level, personnelIds: val2 ? [val2] : [] }, props.scope)
    row[level + 'Id'] = val2 || null
    row[levelCol.key] = val2 ? candidateOptions(row, levelCol).find(p => p.id === val2) || null : null
    row.updatedAt = new Date().toISOString()
    toast.success(`已${val2 ? '分配' : '清空'}「${row.deviceName || row.deviceCode}」的${levelCol.label}`)
  } catch (e) {
    toast.error(e?.response?.data?.error || '分配失败')
    loadData()   // 失败回滚：重拉服务端权威数据
  }
}

// ===================== 批量分配 =====================
const selection = ref([])
const batchDialogVisible = ref(false)
const batchLevel = ref('operator')
const batchPersonnelId = ref('')
const batchSaving = ref(false)
// V1.49 修复：批量弹框候选须按「层级 key→角色」映射取候选（batchLevel 是 key='supervisor'/'leader'/'operator'，
// 候选角色是 mtSupervisor/mtLeader/mtPersonnel 或 opSupervisor/opLeader/operator——直接用 batchLevel 当 role
// 在 mt scope 下恒 400、ws 下 leader/supervisor 也 400，致批量下拉候选为空）
const batchCandidates = computed(() => {
  const ws = activeWorkshop.value
  if (!isMt.value && !ws) return []
  const role = LEVEL_COLS.value.find(c => c.key === batchLevel.value)?.role || batchLevel.value
  ensureCandidates(role, ws)
  return candidateCache.value[`${role}|${isMt.value ? '' : ws}`] || []
})
function resetBatchPersonnel() {
  batchPersonnelId.value = batchLevel.value === 'operator' ? [] : ''
}
function openBatch() {
  if (!selection.value.length) { toast.warning('请先勾选要分配的设备'); return }
  batchLevel.value = 'operator'
  resetBatchPersonnel()
  batchDialogVisible.value = true
}
async function applyBatch() {
  if (!selection.value.length) return
  const ids = batchLevel.value === 'operator'
    ? (Array.isArray(batchPersonnelId.value) ? batchPersonnelId.value : [])
    : (batchPersonnelId.value ? [batchPersonnelId.value] : [])
  if (!ids.length) { toast.warning('请选择分配人员'); return }
  batchSaving.value = true
  try {
    const codes = selection.value.map(r => r.deviceCode)
    await batchAssign({ deviceCodes: codes, level: batchLevel.value, personnelIds: ids }, props.scope)
    toast.success(`已批量分配 ${codes.length} 台设备的「${LEVEL_COLS.value.find(c => c.key === batchLevel.value).label}」`)
    batchDialogVisible.value = false
    selection.value = []
    loadData()
  } catch (e) {
    toast.error(e?.response?.data?.error || '批量分配失败')
  } finally {
    batchSaving.value = false
  }
}

// ===================== 分页（本地切片，4588 台也不全渲染；基于资产列表过滤后的结果） =====================
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})
function onPageChange() { /* el-pagination 自带 page 更新 */ }

// 分配状态 tag
function assignStatus(row) {
  // V1.48：操作级按 operatorIds 数组非空判断（多选任一即算已分配）
  const n = LEVEL_COLS.value.filter(c => {
    if (c.key === 'operator') return (row.operatorIds || []).length > 0
    return row[c.key + 'Id']
  }).length
  if (n === 3) return { text: '完整分配', type: 'success' }
  if (n === 0) return { text: '未分配', type: 'info' }
  return { text: '部分分配', type: 'warning' }
}

watch(activeWorkshop, () => {
  if (!canSelectWorkshop.value) return
  filterAssetType.value = []   // 换车间清空资产列表筛选（级联树基于新车间 rows 重建）
  loadData()
})

onMounted(async () => {
  // V1.50 设备分配合并单 tab：仅有一种体系权限时跳到对路子 tab（避免误落无权子 tab 显示空分配）
  const canWs = authStore.hasAnyPermission(['mt.assign.view', 'mt.assign.edit'])
  const canMt = authStore.hasAnyPermission(['mt.assignmt.view', 'mt.assignmt.edit'])
  if (isMt.value && !canMt && canWs) { router.replace('/maintenance/assign'); return }
  if (!isMt.value && !canWs && canMt) { router.replace('/maintenance/assign-mt'); return }
  await devicesStore.fetchList()
  await loadData()
  // 预载当前范围三级候选
  const ws = isMt.value ? '' : activeWorkshop.value
  if (ws !== undefined) {
    LEVEL_COLS.value.forEach(c => ensureCandidates(c.role, ws))
  }
})
</script>

<template>
  <div class="flex flex-col h-full p-4 gap-3">
    <!-- 顶部：说明文字单独一行（V1.51 不随筛选控件同行，整行展示） -->
    <div class="text-xs text-[#909399] leading-5">
      <span v-if="!hasEdit">（只读）</span>{{ descText }}
    </div>
    <!-- 筛选区：车间筛选（部门） → 资产列表筛选 → 批量分配（V1.51 顺序：车间在前、资产列表在后） -->
    <div class="flex items-center gap-3 flex-wrap">
      <el-select
        v-if="canSelectWorkshop"
        v-model="workshopFilter"
        placeholder="选择车间"
        clearable
        size="small"
        style="width: 220px"
        @change="loadData"
      >
        <el-option v-for="w in workshopOptions" :key="w" :label="w" :value="w" />
      </el-select>
      <!-- V1.47 资产列表筛选：大/中/小类三级级联（checkStrictly 可任选一级）；V1.51 移到车间（部门）筛选框之后 -->
      <el-cascader
        v-model="filterAssetType"
        :options="assetTypeOptions"
        :props="{ checkStrictly: true, expandTrigger: 'hover' }"
        placeholder="资产列表"
        clearable
        size="small"
        style="width: 220px"
        @change="page = 1"
      />
      <el-button type="primary" size="small" :disabled="!hasEdit || !editableLevels.length" @click="openBatch">
        批量分配
      </el-button>
    </div>

    <!-- 表格 -->
    <el-table
      :data="pagedRows"
      v-loading="loading"
      border
      stripe
      row-key="deviceCode"
      height="100%"
      class="flex-1"
      size="small"
      @selection-change="v => (selection = v)"
    >
      <el-table-column type="selection" width="44" align="center" />
      <el-table-column prop="deviceCode" label="资产编号" width="170" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="font-mono text-[13px]">{{ row.deviceCode }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="deviceName" label="资产名称" width="150" show-overflow-tooltip />
      <el-table-column prop="department" label="使用部门" width="110" show-overflow-tooltip />
      <el-table-column prop="assetClass" label="资产分类" width="90" align="center" />
      <el-table-column prop="spec" label="规格型号" width="120" show-overflow-tooltip />
      <el-table-column prop="workshop" label="车间" min-width="160" show-overflow-tooltip />

      <!-- V1.50 主任级别自动带出（只读）：车间=按车间带车间主任（车间=使用人）；维保=按维护部门带室主任；服务端 GET 已逐行 join row.director -->
      <el-table-column :label="isMt ? '室主任' : '车间主任'" width="100" align="center">
        <template #default="{ row }">
          <span class="text-gray-600">{{ row.director ? row.director.name : '—' }}</span>
        </template>
      </el-table-column>

      <!-- 三级分配人列（V1.48：操作级多选 el-select multiple+collapse-tags；主管/班长仍单选） -->
      <el-table-column
        v-for="lc in LEVEL_COLS"
        :key="lc.key"
        :label="lc.label"
        :width="lc.key === 'operator' ? 190 : 150"
        align="center"
      >
        <template #default="{ row }">
          <el-select
            v-if="levelEditable(row, lc.key)"
            :model-value="lc.key === 'operator' ? (row.operatorIds || []) : (row[lc.key + 'Id'] || '')"
            :multiple="lc.key === 'operator'"
            :collapse-tags="lc.key === 'operator'"
            :max-collapse-tags="1"
            :collapse-tags-tooltip="lc.key === 'operator'"
            :placeholder="'未分配'"
            clearable
            filterable
            size="small"
            style="width: 100%"
            @update:model-value="v => onAssignChange(row, lc, v)"
          >
            <el-option
              v-for="p in candidateOptions(row, lc)"
              :key="p.id"
              :label="p.name + (p.employeeId ? '（' + p.employeeId + '）' : '')"
              :value="p.id"
            />
          </el-select>
          <span v-else class="text-gray-600">
            <template v-if="lc.key === 'operator'">
              {{ (row.operators || []).map(o => o.name).join('、') || '—' }}
            </template>
            <template v-else>{{ row[lc.key] ? row[lc.key].name : '—' }}</template>
          </span>
        </template>
      </el-table-column>

      <el-table-column label="分配状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="assignStatus(row).type" size="small">{{ assignStatus(row).text }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="flex justify-end">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        :total="filteredRows.length"
        layout="total, sizes, prev, pager, next, jumper"
        small
        @current-change="onPageChange"
      />
    </div>

    <!-- 批量分配弹框 -->
    <el-dialog v-model="batchDialogVisible" title="批量分配设备" width="420px">
      <div class="text-xs text-[#909399] mb-3">
        已选 <b class="text-blue-600">{{ selection.length }}</b> 台设备，将批量设置「{{
          LEVEL_COLS.find(c => c.key === batchLevel).label
        }}」：
      </div>
      <el-form label-width="70px">
        <el-form-item label="分配层级">
          <el-select v-model="batchLevel" style="width: 100%" @change="resetBatchPersonnel">
            <el-option
              v-for="lc in LEVEL_COLS.filter(c => editableLevels.includes(c.key))"
              :key="lc.key"
              :label="lc.label"
              :value="lc.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="分配人员">
          <el-select
            v-model="batchPersonnelId"
            :multiple="batchLevel === 'operator'"
            :collapse-tags="batchLevel === 'operator'"
            :max-collapse-tags="2"
            :collapse-tags-tooltip="batchLevel === 'operator'"
            filterable
            :placeholder="batchLevel === 'operator' ? '选择人员（可多选；不选则清空）' : '选择人员（不选则清空该级）'"
            style="width: 100%"
          >
            <el-option
              v-for="p in batchCandidates"
              :key="p.id"
              :label="p.name + (p.employeeId ? '（' + p.employeeId + '）' : '')"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="batchSaving" @click="applyBatch">应用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* V1.51 表格字号与标准文件配置页一致：正文+表头 12px */
:deep(.el-table) {
  --el-table-font-size: 12px;
  --el-table-header-font-size: 12px;
}
</style>
