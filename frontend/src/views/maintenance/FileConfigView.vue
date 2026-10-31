<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { fetchTemplate, importTemplateExcel, fetchTemplateModules, deleteTemplate, copyTemplateRecord, syncTemplateMonths } from '@/api/maintenance'
import TemplateEditDrawer from '@/components/maintenance/TemplateEditDrawer.vue'

const store = useDictStore()
const route = useRoute()
const toast = useToast()
const modal = useModal()

// ===================== 标准文件配置（§5.7 V1.18 固定 6 类模板） =====================
// 模板主键=(6位小类, fileCode)；固定 6 类，不可新增/删除/改编号：
//   01 安全操作规程 / 02 点检保养标准（仅班前模板上传；班后为固定表单，不设上传）/ 03 一级保养标准 / 04 二级保养标准 / 05 设备润滑标准 / 06 定期检查标准
// V1.57：02-06 按月一份标准；取标准严格按计划月，缺月即未配置（不做查询回退）。
//   「同步全年」：以今年已有源月复制空月至今年 12 月；「同步明年」：以今年 12 月复制到明年 1–12（均不覆盖已有）。
//   01 安全操作规程保持单条（无月份、无锁定、无执行期）。
const templateMajor = ref('')
const templateMid = ref('')
const templateSearch = ref('')
const selectedTypeCode = ref('')
const selectedTypeName = ref('')
const templateModules = ref([])   // 固定 6 行：{code,name,configured,version,records[],...}
const today = ref('')             // 服务端日期 YYYY-MM-DD（月份状态/锁定的权威依据）
const syncing = ref(false)
const syncDialogVisible = ref(false)
const syncConfirming = ref(false)
const syncPreview = ref(null)     // 后端 dryRun 结果
const syncPage = ref(1)
const syncPageSize = 20
/** 新配置了按月标准后，在「同步全年」旁提醒可同步 */
const showSyncYearHint = ref(false)
const editTarget = ref(null)      // 内容微调目标 { typeCode, fileCode, content, source, configured, month }
const editVisible = ref(false)

const SYNC_YEAR_HINT_KEY = 'cims_sync_year_hint'

function markSyncYearHint(fileCode) {
  // 01 规程不参与按月同步
  if (fileCode && fileCode !== '01') {
    showSyncYearHint.value = true
    try { sessionStorage.setItem(SYNC_YEAR_HINT_KEY, '1') } catch (_) {}
  }
}
function clearSyncYearHint() {
  showSyncYearHint.value = false
  try { sessionStorage.removeItem(SYNC_YEAR_HINT_KEY) } catch (_) {}
}
function restoreSyncYearHint() {
  try { showSyncYearHint.value = sessionStorage.getItem(SYNC_YEAR_HINT_KEY) === '1' } catch (_) {}
}

// V1.57 上传替换弹框（某月记录：目标月固定，执行期=整月，无日期区间）
const uploadDialogVisible = ref(false)
const uploadModule = ref(null)    // { code, name }
const uploadMonth = ref('')       // 目标月份 YYYY-MM（01 为空）
const uploadFile = ref(null)
const uploading = ref(false)

// V1.57 添加月份弹框（02-06）：目标月（仅未来月）+ 方式（复制上一年同月 / 直接上传新文件）
const addDialogVisible = ref(false)
const addModule = ref(null)
const addTargetMonth = ref('')
const addMode = ref('copy')       // 'copy' | 'upload'
const addSourceMonth = ref('')
const addUploadFile = ref(null)
const adding = ref(false)

const templateMajors = computed(() => Object.entries(store.deviceTypeTree || {}).map(([code, node]) => ({ code, name: node.name })))

// 当前选中大类下的中类列表
const templateMids = computed(() => {
  if (!templateMajor.value) return []
  const node = store.deviceTypeTree?.[templateMajor.value]
  return node ? Object.entries(node.children || {}).map(([code, c]) => ({ code, name: c.name })) : []
})

// 小类扁平列表（标准文件配置，按小类管理）
const templateLeaves = computed(() => {
  const leaves = []
  const walk = (node, majorCode, majorName, midCode, midName) => {
    Object.entries(node || {}).forEach(([key, val]) => {
      if (val.children) {
        if (!majorCode) walk(val.children, key, val.name, '', '')
        else walk(val.children, majorCode, majorName, key, val.name)
      } else if (val.code) {
        if (templateMajor.value && majorCode !== templateMajor.value) return
        if (templateMid.value && midCode !== templateMid.value) return
        leaves.push({ typeCode: val.code, name: val.name, majorCode, majorName, midCode, midName })
      }
    })
  }
  walk(store.deviceTypeTree || {}, '', '', '', '')
  let list = leaves
  if (templateSearch.value) {
    const s = templateSearch.value.toLowerCase()
    list = list.filter(l => l.name.toLowerCase().includes(s) || l.typeCode.includes(s))
  }
  return list
})

// ===================== V1.57 月份/锁定判定（后端 today/locked 权威） =====================
const currentMonth = computed(() => today.value ? today.value.substring(0, 7) : '')
function nextMonthStr(m) {
  const y = parseInt(m.substring(0, 4), 10)
  const mm = parseInt(m.substring(5, 7), 10)
  return mm === 12 ? (y + 1) + '-01' : m.substring(0, 5) + String(mm + 1).padStart(2, '0')
}
function prevYearSameMonth(m) { return (parseInt(m.substring(0, 4), 10) - 1) + m.substring(4) }

// 记录是否锁定（后端已算 plansExist + 月份；01 恒 false）
function recLocked(rec) { return !!(rec && rec.locked) }
function recLockTip(rec) {
  if (!rec || !rec.locked) return ''
  if (rec.status === '执行中') return '本月执行中，不可修改'
  if (rec.status === '已结束') return '该月已结束，不可修改'
  return '该月已生成维保计划，不可修改'
}
function statusTagType(rec) {
  if (rec.status === '执行中') return 'danger'
  if (rec.status === '待执行') return 'primary'
  return 'info'
}
function statusTagText(rec) {
  if (!rec.configured) return '未配置'
  return (rec.locked ? '🔒 ' : '') + rec.status
}

// 复制来源月份选项（已配置月，升序）
const addSourceOptions = computed(() =>
  (addModule.value?.records || []).filter(r => r.configured && r.month).map(r => ({ month: r.month, version: r.version }))
)
// 添加弹框已配置月份集合（禁用：已有记录须走「上传替换」更新）
const addDisabledSet = computed(() => new Set((addModule.value?.records || []).filter(r => r.month).map(r => r.month)))
// V1.57b：该模块是否已配置过任何月份文件（从未配置 → 本月可选，可首次配置当月）
const moduleHasRecords = computed(() => (addModule.value?.records || []).some(r => r.month && r.configured))

function onHeaderAction(m) {
  if (m.code === '01') return
  openAddDialog(m)
}

/** 从完整分类树取小类名（不受顶部筛选影响，保证同步弹框能显示名称） */
function typeNameOf(typeCode) {
  let found = ''
  const walk = (node) => {
    if (found || !node) return
    Object.values(node).forEach(val => {
      if (found) return
      if (val?.children) walk(val.children)
      else if (val?.code === typeCode) found = val.name || typeCode
    })
  }
  walk(store.deviceTypeTree || {})
  return found || typeCode
}

/** @returns {{ status: 'ok'|'missing', text: string }} */
function moduleWriteCell(modules, fileCode, mode) {
  const m = (modules || []).find(x => x.fileCode === fileCode)
  const ready = !!(m?.hasSource || m?.hasDecember || m?.sourceMonth)
  if (ready) return { status: 'ok', text: '可同步' }
  if (mode === 'nextYear') return { status: 'missing', text: '12月没有记录，请配置再同步' }
  return { status: 'missing', text: '没有记录，请配置再同步' }
}

/** 同步预览表格行（全年/明年同一套状态展示） */
const syncTableRows = computed(() => {
  const data = syncPreview.value
  if (!data) return []
  const items = data.scope === 'all' ? (data.items || []) : (data.typeCode ? [data] : [])
  const mode = data.mode
  return items
    .filter(item => !!item.hasAnySource)
    .map(item => ({
      typeCode: item.typeCode,
      typeName: typeNameOf(item.typeCode),
      totalWouldWrite: item.totalWouldWrite,
      allFiveReady: !!item.allFiveReady,
      m02: moduleWriteCell(item.modules, '02', mode),
      m03: moduleWriteCell(item.modules, '03', mode),
      m04: moduleWriteCell(item.modules, '04', mode),
      m05: moduleWriteCell(item.modules, '05', mode),
      m06: moduleWriteCell(item.modules, '06', mode),
    }))
})

/** 列表中每个小类都必须五标准齐套，且有可写入条数，才可点确定（全年/明年同一规则） */
const syncAllRowsReady = computed(() =>
  syncTableRows.value.length > 0 && syncTableRows.value.every(r => r.allFiveReady)
)
const syncCanConfirm = computed(() =>
  syncAllRowsReady.value && (syncPreview.value?.totalWouldWrite || 0) > 0
)

const syncTablePageRows = computed(() => {
  const start = (syncPage.value - 1) * syncPageSize
  return syncTableRows.value.slice(start, start + syncPageSize)
})

async function runSync(mode) {
  syncing.value = true
  try {
    const preview = await syncTemplateMonths({ mode, dryRun: true })
    const data = preview.data
    if (!(data.typeCount || data.typeCode) && !data.totalWouldWrite) {
      toast.info(mode === 'year' ? '没有已配置标准的小类可同步' : '没有今年 12 月已配置的小类，请先配置再同步明年')
      return
    }
    // 即使暂不可写入，也打开弹框展示各模块是否配齐（绿标可同步 / 红字待配置）
    syncPreview.value = data
    syncPage.value = 1
    syncDialogVisible.value = true
  } catch (e) {
    toast.error(e.response?.data?.error || e.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

async function confirmSyncDialog() {
  const data = syncPreview.value
  if (!data?.mode) return
  if (!syncAllRowsReady.value) {
    toast.info('须列表中每个小类的五个标准文件全部配齐后，才可确认同步')
    return
  }
  if (!(data.totalWouldWrite > 0)) {
    toast.info(data.mode === 'nextYear' ? '明年已全部同步，无需再同步' : '空月已齐，无需再同步')
    return
  }
  if (!syncCanConfirm.value) return
  syncConfirming.value = true
  try {
    const res = await syncTemplateMonths({ mode: data.mode, dryRun: false })
    syncDialogVisible.value = false
    if (data.mode === 'year') clearSyncYearHint()
    const n = res.data.readyTypeCount ?? res.data.typeCount ?? syncTableRows.value.length
    toast.success(`已同步 ${n} 个小类，写入 ${res.data.totalWritten} 条月份标准`)
    if (selectedTypeCode.value) {
      await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
    }
  } catch (e) {
    toast.error(e.response?.data?.error || e.message || '同步失败')
  } finally {
    syncConfirming.value = false
  }
}

async function selectTemplateLeaf(leaf, retries = 2) {
  selectedTypeCode.value = leaf.typeCode
  selectedTypeName.value = leaf.name
  // V1.57：状态/today 由后端返回，落盘 standardTemplates.json（仓库根、nodemon watch 树外，不触发重启）
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchTemplateModules(leaf.typeCode)
      templateModules.value = res.data
      today.value = res.today || ''
      return
    } catch (e) {
      if (i === retries) throw e
      await new Promise(r => setTimeout(r, 600))
    }
  }
}

// ===================== 上传替换（某月记录；01 无月） =====================
function openUploadReplace(m, rec) {
  if (recLocked(rec)) { toast.error(recLockTip(rec)); return }
  uploadModule.value = m
  uploadMonth.value = rec.month || ''
  uploadFile.value = null
  uploadDialogVisible.value = true
}
function onUploadFileChange(event) {
  uploadFile.value = event.target.files?.[0] || null
  event.target.value = ''
}
async function confirmUpload() {
  const m = uploadModule.value
  if (!m || !uploadFile.value) { toast.error('请选择要上传的 Excel 文件'); return }
  uploading.value = true
  try {
    const res = await importTemplateExcel(selectedTypeCode.value, m.code, uploadFile.value, uploadMonth.value)
    toast.success(`「${m.name}」已导入：${res.data.name} v${res.data.version}，编码 ${res.data.stdCode}`)
    uploadDialogVisible.value = false
    markSyncYearHint(m.code)
    await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '导入失败'
    toast.error(msg)
    if (e.response?.status === 403) { uploadDialogVisible.value = false }
  } finally {
    uploading.value = false
  }
}

// ===================== 添加月份（02-06）：复制上一年同月 / 直接上传新文件 =====================
function openAddDialog(m) {
  addModule.value = m
  // V1.57b：该模块从未配置过任何月份 → 默认目标=本月（首次配置当月）；已配置过 → 默认下月
  const neverCfg = !(m.records || []).some(r => r.month && r.configured)
  const target = currentMonth.value ? (neverCfg ? currentMonth.value : nextMonthStr(currentMonth.value)) : ''
  addTargetMonth.value = target
  const opts = addSourceOptions.value
  const py = target ? prevYearSameMonth(target) : ''
  // 复制源默认 = 上一年同月（若已配置），否则最近已配置月；无已配置月 → 默认直接上传
  const def = opts.find(o => o.month === py) || opts[opts.length - 1]
  addSourceMonth.value = def ? def.month : ''
  addMode.value = opts.length ? 'copy' : 'upload'
  addUploadFile.value = null
  addDialogVisible.value = true
}
function addDisabledDate(t) {
  const v = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
  if (!currentMonth.value) return false
  if (v < currentMonth.value) return true                       // 过去月已结束
  if (v === currentMonth.value) return moduleHasRecords.value   // 本月：仅该模块已配置过文件才禁用（从未配置 → 可选）
  return addDisabledSet.value.has(v)                             // 未来月：已配置 → 用「上传替换」更新
}
function onAddUploadChange(event) {
  addUploadFile.value = event.target.files?.[0] || null
  event.target.value = ''
}
async function confirmAdd() {
  const m = addModule.value
  if (!m || !addTargetMonth.value) { toast.error('请选择目标月份'); return }
  adding.value = true
  try {
    if (addMode.value === 'copy') {
      if (!addSourceMonth.value) { toast.error('无已配置月份可作为复制源，请改用「直接上传新文件」'); return }
      const res = await copyTemplateRecord(selectedTypeCode.value, m.code, addSourceMonth.value, addTargetMonth.value)
      toast.success(`已从 ${res.data.fromMonth} 复制到 ${res.data.toMonth}（v${res.data.version}），可在此基础上修改`)
      addDialogVisible.value = false
      markSyncYearHint(m.code)
      await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
      // 复制后打开该月内容微调
      const rec = (templateModules.value.find(x => x.code === m.code)?.records || []).find(r => r.month === addTargetMonth.value)
      if (rec) openContentEdit(m, rec)
    } else {
      if (!addUploadFile.value) { toast.error('请选择要上传的 Excel 文件'); return }
      const res = await importTemplateExcel(selectedTypeCode.value, m.code, addUploadFile.value, addTargetMonth.value)
      toast.success(`「${m.name}」已配置到 ${addTargetMonth.value}：v${res.data.version}`)
      addDialogVisible.value = false
      markSyncYearHint(m.code)
      await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
    }
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '添加失败'
    toast.error(msg)
  } finally {
    adding.value = false
  }
}

// ===================== 内容微调（01-06 结构化编辑；02 编辑即班前 items） =====================
async function openContentEdit(m, rec) {
  if (recLocked(rec)) { toast.error(recLockTip(rec)); return }
  const month = rec?.month || ''
  const res = await fetchTemplate(selectedTypeCode.value, m.code, month)
  const d = res.data
  editTarget.value = {
    typeCode: d.typeCode, fileCode: d.fileCode, content: d.resolved?.content, source: d.resolved?.source || '未配置', configured: d.configured,
    month: d.month || '',
  }
  editVisible.value = true
}
async function onTemplateSaved() {
  markSyncYearHint(editTarget.value?.fileCode)
  // 重新加载模块清单，刷新配置状态/版本/锁定
  if (selectedTypeCode.value) await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
}

// ===================== 删除某月记录（02-06 未来月；01 无删除） =====================
async function removeRecord(m, rec) {
  if (recLocked(rec)) { toast.error(recLockTip(rec)); return }
  const month = rec.month
  try {
    await modal.confirm(`确定删除 ${month} 月份「${m.name}」标准文件？该月将回退为未配置，不再生成对应维保单。`)
  } catch (_) { return }
  try {
    await deleteTemplate(selectedTypeCode.value, m.code, month)
    toast.success(`已删除 ${month} 月份记录`)
    await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
  } catch (e) {
    const msg = e.response?.data?.error || e.message || '删除失败'
    toast.error(msg)
  }
}

watch([templateMajor, templateMid], () => {
  selectedTypeCode.value = ''
  templateModules.value = []
})

onMounted(async () => {
  restoreSyncYearHint()
  await store.loadAll()
  // V1.53：横幅「修改」跳转带 typeCode 参数 → 自动选中该小类（V1.57 横幅已删，参数保留兜底）
  const qType = route.query.typeCode
  if (qType && templateLeaves.value.length) {
    const leaf = templateLeaves.value.find(l => l.typeCode === qType)
    if (leaf) await selectTemplateLeaf(leaf)
  }
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- 筛选栏 -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0">
      <el-select v-model="templateMajor" size="small" style="width:160px" clearable placeholder="全部大类">
        <el-option v-for="m in templateMajors" :key="m.code" :label="`${m.code} ${m.name}`" :value="m.code" />
      </el-select>
      <el-select v-model="templateMid" size="small" style="width:160px" clearable placeholder="全部中类">
        <el-option v-for="m in templateMids" :key="m.code" :label="`${m.code} ${m.name}`" :value="m.code" />
      </el-select>
      <el-input v-model="templateSearch" size="small" placeholder="搜索小类名称/编码" style="width:200px" clearable />
      <span class="text-xs text-[#909399]">{{ templateLeaves.length }} 个小类</span>
      <el-badge :is-dot="showSyncYearHint" :hidden="!showSyncYearHint" class="sync-year-badge">
        <el-button
          size="small"
          type="primary"
          :disabled="syncing"
          :loading="syncing"
          @click="runSync('year')"
        >同步全年</el-button>
      </el-badge>
      <el-button
        size="small"
        :disabled="syncing"
        :loading="syncing"
        @click="runSync('nextYear')"
      >同步明年</el-button>
      <el-tag
        v-if="showSyncYearHint"
        type="warning"
        size="small"
        effect="light"
        class="sync-year-hint"
        closable
        @close="clearSyncYearHint"
      >有新标准，可进行全年同步</el-tag>
      <div class="flex-1" />
      <span class="text-xs text-[#909399]">「同步全年 / 同步明年」扫描全部已配置小类自动补齐空月，无需先筛选；取标准仍按计划月精确匹配</span>
    </div>

    <div class="flex flex-1 min-h-0">
      <!-- 左侧小类列表 -->
      <div class="w-64 border-r border-[#dcdfe6] flex flex-col shrink-0">
        <div class="px-3 py-2 text-xs font-semibold text-[#606266] bg-[#fafafa] border-b border-[#dcdfe6] shrink-0">
          小类列表
        </div>
        <div class="flex-1 overflow-auto p-2">
          <div
            v-for="leaf in templateLeaves"
            :key="leaf.typeCode"
            class="px-2 py-1.5 rounded cursor-pointer text-xs mb-0.5"
            :class="selectedTypeCode === leaf.typeCode ? 'bg-[#ecf5ff] text-[#1192E8] font-semibold' : 'hover:bg-[#f5f7fa]'"
            @click="selectTemplateLeaf(leaf)"
          >
            <div class="flex items-center gap-1">
              <span>{{ leaf.name }}</span>
            </div>
            <div class="text-[#c0c4cc]">{{ leaf.typeCode }}</div>
          </div>
        </div>
      </div>

      <!-- 右侧固定 6 类模板卡片 -->
      <div class="flex-1 overflow-auto p-3">
        <div v-if="!selectedTypeCode" class="text-xs text-[#909399] mt-4">← 从左侧选择小类，配置其固定 6 类标准文件（上传 Excel / 内容微调）</div>
        <template v-else>
          <div class="text-sm font-semibold mb-3 flex items-center">
            {{ selectedTypeName }}
            <el-tag size="small" type="success" class="ml-2">{{ selectedTypeCode }}</el-tag>
            <span class="text-xs text-[#909399] font-normal ml-2">标准文件编码 = 小类编码 + 模块编号，上传文件后自动生成；固定 6 类不可新增/删除</span>
          </div>

          <div class="space-y-3">
            <div v-for="m in templateModules" :key="m.code" class="border border-[#dcdfe6] rounded bg-white overflow-hidden">
              <!-- 卡片头：编号 + 名称 + 标准文件编码 + 版本（02-06 右侧「添加月份」） -->
              <div class="flex items-center gap-2 px-3 py-2 bg-[#fafafa] border-b border-[#dcdfe6]">
                <el-tag size="small" :type="m.configured ? 'success' : 'info'">{{ m.code }}</el-tag>
                <span class="text-sm font-medium">{{ m.name }}</span>
                <span v-if="m.stdCode" class="font-mono text-xs text-[#909399]">{{ m.stdCode }}</span>
                <span v-else class="text-xs text-[#c0c4cc]">编码未生成</span>
                <el-tag size="small" :type="m.configured ? 'success' : 'info'" class="ml-1">
                  {{ m.configured ? '已配置 v' + m.version : '未配置' }}
                </el-tag>
                <div class="flex-1" />
                <!-- 02-06：添加月份 -->
                <el-button v-if="m.code !== '01'" size="small" type="primary" plain @click="onHeaderAction(m)">＋ 添加月份</el-button>
              </div>

              <!-- 记录区：01 单记录（month=null）；02-06 月份记录列表 -->
              <div class="p-3">
                <div v-if="!m.records || !m.records.length" class="text-xs text-[#c0c4cc]">
                  <template v-if="m.code === '01'">未配置安全操作规程，请上传 Excel。</template>
                  <template v-else>未配置任何月份；点击「＋ 添加月份」配置本月（或未来月）。配好后可用顶部「同步全年」把已配置小类空月补齐到 12 月。</template>
                </div>
                <div v-else class="border border-[#e4e7ed] rounded">
                  <div
                    v-for="(rec, ri) in m.records"
                    :key="rec.month || '_'"
                    class="flex items-center gap-3 px-3 py-2"
                    :class="ri > 0 ? 'border-t border-[#f0f2f5]' : ''"
                  >
                    <el-tag v-if="m.code !== '01'" size="small" :type="statusTagType(rec)" class="w-16 justify-center">{{ statusTagText(rec) }}</el-tag>
                    <span class="font-mono text-sm w-24">{{ rec.month || '—' }}</span>
                    <span class="text-xs text-[#909399] shrink-0">v{{ rec.version }}</span>
                    <span v-if="rec.fileName" class="text-xs text-[#909399] truncate max-w-[180px]">📎 {{ rec.fileName }}</span>
                    <span v-else class="text-xs text-[#c0c4cc] shrink-0">未上传文件</span>
                    <span v-if="rec.updatedAt" class="text-xs text-[#c0c4cc] shrink-0">{{ rec.updatedAt }}</span>
                    <div class="flex-1" />
                    <el-tooltip :content="recLockTip(rec)" placement="top" :disabled="!recLocked(rec)">
                      <el-button size="small" :disabled="recLocked(rec) || uploading" @click="openUploadReplace(m, rec)">{{ rec.configured ? '上传替换' : '上传' }}</el-button>
                    </el-tooltip>
                    <el-tooltip v-if="m.code !== '01'" :content="recLockTip(rec)" placement="top" :disabled="!recLocked(rec)">
                      <el-button size="small" link type="primary" :disabled="recLocked(rec)" @click="openContentEdit(m, rec)">内容微调</el-button>
                    </el-tooltip>
                    <el-tooltip v-if="m.code !== '01'" :content="recLockTip(rec)" placement="top" :disabled="!recLocked(rec)">
                      <el-button size="small" link type="danger" :disabled="recLocked(rec)" @click="removeRecord(m, rec)">删除</el-button>
                    </el-tooltip>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="text-xs text-[#909399] mt-3 leading-5">
            固定 6 类模板（不可新增/删除）：01 安全操作规程 / 02 点检保养标准（<b class="text-[#606266]">班前模板上传</b>；班后为固定表单）/ 03 一级保养标准 / 04 二级保养标准 / 05 设备润滑标准 / 06 定期检查标准。
            <b class="text-[#606266]">按月取标准</b>：计划月无记录即提示未配置。
            <b class="text-[#606266]">同步全年</b>：无需筛选，扫描全部已配置小类，按各模块源月把空月复制到今年 12 月；
            <b class="text-[#606266]">同步明年</b>：扫描全部小类，用今年 12 月复制到明年 1–12。均不覆盖已有月。
          </div>
        </template>
      </div>
    </div>

    <!-- 同步全年 / 同步明年：表格预览（每页 20 条） -->
    <el-dialog
      v-model="syncDialogVisible"
      :title="syncPreview?.mode === 'nextYear' ? '同步明年' : '同步全年'"
      width="960px"
      :close-on-click-modal="false"
    >
      <el-table :data="syncTablePageRows" border size="small" max-height="420" class="w-full sync-preview-table">
        <el-table-column prop="typeName" label="小类名称" min-width="120" fixed show-overflow-tooltip />
        <el-table-column
          v-for="col in [
            { key: 'm02', label: '点检保养标准' },
            { key: 'm03', label: '一级保养标准' },
            { key: 'm04', label: '二级保养标准' },
            { key: 'm05', label: '设备润滑标准' },
            { key: 'm06', label: '定期检查标准' },
          ]"
          :key="col.key"
          :label="col.label"
          min-width="150"
        >
          <template #default="{ row }">
            <el-tag v-if="row[col.key]?.status === 'ok'" type="success" size="small" effect="light">{{ row[col.key].text }}</el-tag>
            <span v-else-if="row[col.key]?.status === 'missing'" class="sync-cell-missing">{{ row[col.key].text }}</span>
            <span v-else class="text-[#606266]">{{ row[col.key]?.text || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <div class="text-xs text-[#606266] leading-5">
          共将新增 <b>{{ syncPreview?.totalWouldWrite || 0 }}</b> 条（齐套小类 {{ syncPreview?.readyTypeCount || 0 }} / {{ syncTableRows.length }}）。
          须列表中每个小类的五个标准全部配齐后才可确认同步
          <template v-if="syncPreview?.mode === 'nextYear'">（明年：须各有今年 12 月）</template>
          <template v-else>（全年：须各有可用源月）</template>。
          <span v-if="!syncAllRowsReady" class="text-[#f56c6c]">当前有未齐套小类，确定已禁用。</span>
        </div>
        <el-pagination
          v-model:current-page="syncPage"
          :page-size="syncPageSize"
          :total="syncTableRows.length"
          layout="total, prev, pager, next"
          small
          background
        />
      </div>
      <template #footer>
        <el-button size="small" @click="syncDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="syncConfirming" :disabled="!syncCanConfirm" @click="confirmSyncDialog">确定</el-button>
      </template>
    </el-dialog>

    <!-- V1.57 上传替换弹框：目标月固定，执行期=整月（无日期区间） -->
    <el-dialog v-model="uploadDialogVisible" title="上传标准文件" width="480px" :close-on-click-modal="false">
      <div v-if="uploadModule" class="space-y-4">
        <div class="text-xs text-[#909399]">
          当前模块：<b class="text-[#606266]">{{ uploadModule.code }} {{ uploadModule.name }}</b>（小类 {{ selectedTypeCode }} {{ selectedTypeName }}）
        </div>
        <div v-if="uploadModule.code === '01'" class="text-xs text-[#606266] leading-5">
          考核题库：工作表里要有「单选题库」「多选题库」「填空题库」「问答题库」，上传后出现在考试配置。安全操作规程正文仍用「序号 / 条款」。
        </div>
        <div v-else-if="uploadMonth" class="text-xs text-[#606266]">
          目标月份：<b class="font-mono">{{ uploadMonth }}</b>　执行期 = {{ uploadMonth }} 整月（自动，无需选择）
        </div>
        <div class="flex items-center gap-3">
          <el-button size="small" @click="$refs.uploadInput?.click()">选择文件</el-button>
          <span v-if="uploadFile" class="text-xs text-[#606266]">📎 {{ uploadFile.name }}</span>
          <span v-else class="text-xs text-[#c0c4cc]">未选择 .xlsx 文件</span>
          <input ref="uploadInput" type="file" class="hidden" accept=".xlsx" @change="onUploadFileChange" />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="uploadDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="uploading" @click="confirmUpload">确认上传</el-button>
      </template>
    </el-dialog>

    <!-- V1.57 添加月份弹框：目标月（仅未来月）+ 复制上一年同月 / 直接上传新文件 -->
    <el-dialog v-model="addDialogVisible" title="添加月份" width="520px" :close-on-click-modal="false">
      <div v-if="addModule" class="space-y-4">
        <div class="text-xs text-[#909399]">
          模块：<b class="text-[#606266]">{{ addModule.code }} {{ addModule.name }}</b>（小类 {{ selectedTypeCode }} {{ selectedTypeName }}）—— 每月一份标准，执行期 = 所选自然月整月
        </div>
        <div>
          <div class="text-xs text-[#606266] mb-1">目标月份（过去月已结束；本月仅当该模块从未配置过文件时可选；已配置月份请用「上传替换」更新）</div>
          <el-date-picker
            v-model="addTargetMonth"
            type="month"
            value-format="YYYY-MM"
            :disabled-date="addDisabledDate"
            placeholder="选择目标月份"
            style="width:100%"
          />
        </div>
        <div>
          <div class="text-xs text-[#606266] mb-1">添加方式</div>
          <el-radio-group v-model="addMode">
            <el-radio value="copy">复制上一年同月（可在此基础上修改）</el-radio>
            <el-radio value="upload">直接上传新文件</el-radio>
          </el-radio-group>
        </div>
        <div v-if="addMode === 'copy'">
          <div class="text-xs text-[#606266] mb-1">复制来源月份（默认 = 上一年同月，若该月未配置则取最近已配置月）</div>
          <el-select v-model="addSourceMonth" size="small" style="width:100%" placeholder="选择复制来源月份">
            <el-option v-for="o in addSourceOptions" :key="o.month" :label="o.month + '（已配置 v' + o.version + '）'" :value="o.month" />
          </el-select>
          <div v-if="!addSourceOptions.length" class="text-xs text-[#e6a23c] mt-1">该模块还没有任何已配置月份，请改用「直接上传新文件」</div>
        </div>
        <div v-else>
          <div class="flex items-center gap-3">
            <el-button size="small" @click="$refs.addUploadInput?.click()">选择文件</el-button>
            <span v-if="addUploadFile" class="text-xs text-[#606266]">📎 {{ addUploadFile.name }}</span>
            <span v-else class="text-xs text-[#c0c4cc]">未选择 .xlsx 文件</span>
            <input ref="addUploadInput" type="file" class="hidden" accept=".xlsx" @change="onAddUploadChange" />
          </div>
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="addDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="adding" @click="confirmAdd">确认</el-button>
      </template>
    </el-dialog>

    <!-- 模板编辑抽屉（内容微调：01-06 结构化编辑；02 编辑即班前 items；V1.57 执行期=整月只读） -->
    <TemplateEditDrawer
      v-model:visible="editVisible"
      :type-code="editTarget?.typeCode"
      :file-code="editTarget?.fileCode"
      :content="editTarget?.content"
      :source="editTarget?.source"
      :configured="editTarget?.configured"
      :month="editTarget?.month"
      @saved="onTemplateSaved"
    />
  </div>
</template>

<style scoped>
.sync-cell-missing {
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.4;
}
.sync-year-badge {
  vertical-align: middle;
}
.sync-year-badge :deep(.el-badge__content.is-dot) {
  right: 6px;
  top: 4px;
}
.sync-year-hint {
  margin-left: 2px;
}
</style>
