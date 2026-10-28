<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { fetchTemplate, importTemplateExcel, fetchTemplateModules, deleteTemplate, copyTemplateRecord, fetchTemplateSettings, saveTemplateSettings } from '@/api/maintenance'
import TemplateEditDrawer from '@/components/maintenance/TemplateEditDrawer.vue'

const store = useDictStore()
const route = useRoute()
const toast = useToast()
const modal = useModal()

// ===================== 标准文件配置（§5.7 V1.18 固定 6 类模板） =====================
// 模板主键=(6位小类, fileCode)；固定 6 类，不可新增/删除/改编号：
//   01 安全操作规程 / 02 点检保养标准（仅班前模板上传；班后为固定表单，不设上传）/ 03 一级保养标准 / 04 二级保养标准 / 05 设备润滑标准 / 06 定期检查标准
// V1.57：02-06 按月一份标准（standardTemplates[tc][fc].records = { 'YYYY-MM': {...} }），执行期=所选自然月整月（无起止日期选择）；
//   过去月/已生成计划 → 该月记录锁定不可改（后端 today/locked 权威，前端禁用本地日期比较）；可添加未来月（复制上一年同月为基础再改，或直接上传新文件）。
//   V1.57b：本月不再恒锁——该模块从未配置过任何月份文件 → 本月可选（首次配置当月）；已配置过 → 本月锁定，只能添加未来月。
//   01 安全操作规程保持单条（无月份、无锁定、无执行期）。
// 全年执行：开启后已上传标准的模块禁用「添加月份」；解析当月无记录时回退最新已配置标准，月初自动执行。
const templateMajor = ref('')
const templateMid = ref('')
const templateSearch = ref('')
const selectedTypeCode = ref('')
const selectedTypeName = ref('')
const templateModules = ref([])   // 固定 6 行：{code,name,configured,version,records[],...}
const today = ref('')             // 服务端日期 YYYY-MM-DD（月份状态/锁定的权威依据）
const yearRoundExecution = ref(false)
const settingsDialogVisible = ref(false)
const settingsSaving = ref(false)
const settingsDraft = ref(false)
const editTarget = ref(null)      // 内容微调目标 { typeCode, fileCode, content, source, configured, month }
const editVisible = ref(false)

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
  if (yearRoundExecution.value) return '全年执行：请在最新标准记录上使用「上传替换 / 内容微调」'
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

/** 模块是否已有任意月份配置 */
function moduleConfigured(m) {
  return !!(m && (m.configured || (m.records || []).some(r => r.month && r.configured)))
}
/** 全年执行开启且该模块已有配置 → 禁用「添加月份」 */
function addMonthDisabled(m) {
  if (!yearRoundExecution.value) return false
  if (!m || m.code === '01') return true
  return moduleConfigured(m)
}
function addMonthDisabledTip(m) {
  if (!yearRoundExecution.value) return ''
  if (addMonthDisabled(m)) return '已开启全年执行：该模块已上传标准文件，每月自动沿用，无需再添加月份'
  return ''
}
/** 全年执行下未配置模块：直接上传（落到本月），不必走「添加月份」选月 */
function openYearRoundFirstUpload(m) {
  if (!m || m.code === '01') return
  if (!currentMonth.value) { toast.error('无法获取当前月份，请刷新后重试'); return }
  uploadModule.value = m
  uploadMonth.value = currentMonth.value
  uploadFile.value = null
  uploadDialogVisible.value = true
}
function onHeaderAction(m) {
  if (m.code === '01') return
  if (yearRoundExecution.value) {
    if (moduleConfigured(m)) {
      toast.error(addMonthDisabledTip(m) || '已开启全年执行，无法添加月份')
      return
    }
    openYearRoundFirstUpload(m)
    return
  }
  openAddDialog(m)
}

async function loadTemplateSettings() {
  try {
    const res = await fetchTemplateSettings()
    yearRoundExecution.value = !!res.data?.yearRoundExecution
  } catch (_) {
    yearRoundExecution.value = false
  }
}
function openSettingsDialog() {
  settingsDraft.value = yearRoundExecution.value
  settingsDialogVisible.value = true
}
async function confirmSettings() {
  settingsSaving.value = true
  try {
    const res = await saveTemplateSettings({ yearRoundExecution: !!settingsDraft.value })
    yearRoundExecution.value = !!res.data?.yearRoundExecution
    settingsDialogVisible.value = false
    toast.success(yearRoundExecution.value
      ? '已开启全年执行：已上传标准的模块将每月自动沿用，无需反复添加月份'
      : '已关闭全年执行：可继续按月添加标准文件')
    if (selectedTypeCode.value) {
      await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
    }
  } catch (e) {
    toast.error(e.response?.data?.error || e.message || '保存失败')
  } finally {
    settingsSaving.value = false
  }
}

async function selectTemplateLeaf(leaf, retries = 2) {
  selectedTypeCode.value = leaf.typeCode
  selectedTypeName.value = leaf.name
  // V1.57：状态/today 由后端返回，落盘 standardTemplates.json（仓库根、nodemon watch 树外，不触发重启）
  // → 短暂重试为防御性保障，避免「添加/删除/上传」后列表残留
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchTemplateModules(leaf.typeCode)
      templateModules.value = res.data
      today.value = res.today || ''
      if (typeof res.yearRoundExecution === 'boolean') yearRoundExecution.value = res.yearRoundExecution
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
  if (addMonthDisabled(m)) {
    toast.error(addMonthDisabledTip(m) || '已开启全年执行，无法添加月份')
    return
  }
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
      await selectTemplateLeaf({ typeCode: selectedTypeCode.value, name: selectedTypeName.value })
      // 复制后打开该月内容微调
      const rec = (templateModules.value.find(x => x.code === m.code)?.records || []).find(r => r.month === addTargetMonth.value)
      if (rec) openContentEdit(m, rec)
    } else {
      if (!addUploadFile.value) { toast.error('请选择要上传的 Excel 文件'); return }
      const res = await importTemplateExcel(selectedTypeCode.value, m.code, addUploadFile.value, addTargetMonth.value)
      toast.success(`「${m.name}」已配置到 ${addTargetMonth.value}：v${res.data.version}`)
      addDialogVisible.value = false
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
  await store.loadAll()
  await loadTemplateSettings()
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
      <el-button size="small" type="primary" @click="openSettingsDialog">设置标准文件</el-button>
      <el-tag v-if="yearRoundExecution" size="small" type="success" effect="plain">全年执行已开启</el-tag>
      <div class="flex-1" />
      <span class="text-xs text-[#909399]">模板以 6 位小类为单位，该小类下设备维保内容全部取自此模板；未配置的小类不生成对应维保单</span>
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
                <!-- 02-06：按月模式=添加月份；全年执行未配置=上传标准；全年执行已配置=置灰 -->
                <el-tooltip v-if="m.code !== '01'" :content="addMonthDisabledTip(m)" placement="top" :disabled="!addMonthDisabled(m)">
                  <span>
                    <el-button
                      size="small"
                      :type="addMonthDisabled(m) ? 'info' : 'primary'"
                      plain
                      :disabled="addMonthDisabled(m)"
                      :class="{ 'yr-add-disabled': addMonthDisabled(m) }"
                      @click="onHeaderAction(m)"
                    >{{ yearRoundExecution && !moduleConfigured(m) ? '上传标准' : '＋ 添加月份' }}</el-button>
                  </span>
                </el-tooltip>
              </div>

              <!-- 记录区：01 单记录（month=null）；02-06 月份记录列表 -->
              <div class="p-3">
                <div v-if="!m.records || !m.records.length" class="text-xs text-[#c0c4cc]">
                  <template v-if="m.code === '01'">未配置安全操作规程，请上传 Excel。</template>
                  <template v-else-if="yearRoundExecution">未配置标准文件；点击「上传标准」上传一次即可全年自动沿用，无需每月添加。</template>
                  <template v-else>未配置任何月份；点击「＋ 添加月份」配置本月（或未来月），执行期 = 所选自然月整月。</template>
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
            <template v-if="yearRoundExecution">
              当前为<b class="text-[#67c23a]">全年执行</b>：02-06 上传一次标准即可，各月初自动沿用；已上传模块「添加月份」置灰；未上传可点「上传标准」。更新内容请用「上传替换」。
            </template>
            <template v-else>
              <b class="text-[#606266]">按月执行</b>：02-06 每月一份标准，执行期=自然月整月；过去月/已生成计划，或本月且该模块已配置过 → 锁定；从未配置过的模块本月可选，也可添加未来月。可在筛选栏「设置标准文件」开启全年执行。
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- 设置标准文件：全年执行开关 -->
    <el-dialog v-model="settingsDialogVisible" title="设置标准文件" width="480px" :close-on-click-modal="false">
      <div class="space-y-4">
        <div class="text-sm text-[#606266] font-medium">标准文件执行周期</div>
        <div class="flex items-center justify-between gap-4 px-3 py-3 rounded border border-[#e4e7ed] bg-[#fafafa]">
          <div class="min-w-0">
            <div class="text-sm text-[#303133]">是否开启全年执行</div>
            <div class="text-xs text-[#909399] mt-1 leading-5">
              开启后：只要某小类模块上传过标准文件，「添加月份」将置灰不可点；未上传的仍可上传，上传完成后同样置灰。各月初对应维保项目自动按已上传标准执行，无需反复按月上传。
            </div>
          </div>
          <el-switch v-model="settingsDraft" />
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="settingsDialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="settingsSaving" @click="confirmSettings">保存</el-button>
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
          <template v-if="yearRoundExecution">
            全年执行模式：上传后各月自动沿用该标准（落档月份 <b class="font-mono">{{ uploadMonth }}</b>）
          </template>
          <template v-else>
            目标月份：<b class="font-mono">{{ uploadMonth }}</b>　执行期 = {{ uploadMonth }} 整月（自动，无需选择）
          </template>
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
/* 全年执行下已配置模块的「添加月份」更明显置灰 */
.yr-add-disabled,
.yr-add-disabled.is-disabled {
  color: #c0c4cc !important;
  background: #f5f7fa !important;
  border-color: #e4e7ed !important;
  cursor: not-allowed;
}
</style>
