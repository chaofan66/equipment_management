<script setup>
import { ref, computed, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { saveTemplate } from '@/api/maintenance'

// 标准文件配置内容编辑器（§5.7(6) V1.17 固定 6 类）：按 fileCode 渲染可编辑表单（sections/items/categories），
// 保存时重新编号 seq。保存 → PUT typeCode/fileCode（覆盖该小类该文件类型该月模板记录）。
// V1.18：02 点检保养标准为单槽（仅班前 items），不再分槽微调。
// V1.57：执行期 = 日历整月（month 只读展示），无起止日期选择。
const props = defineProps({
  typeCode: { type: String, default: '' },
  fileCode: { type: String, default: '' },
  content: { type: Object, default: null },      // 当前小类此文件类型该月的内容（含 status/version 与 items/points/...）
  source: { type: String, default: '' },          // 自定义 / 未配置
  configured: { type: Boolean, default: false },  // 本级是否有自定义
  month: { type: String, default: '' },           // V1.57：执行月份（YYYY-MM，02-06；01 为空）
})
const emit = defineEmits(['saved'])
const visible = defineModel('visible', { type: Boolean, default: false })

const toast = useToast()
const edit = ref({})          // 可编辑深拷贝
const saving = ref(false)
const fileCodeNames = { '01': '安全操作规程', '02': '点检保养标准', '03': '一级保养标准', '04': '二级保养标准', '05': '设备润滑标准', '06': '定期检查标准' }

const isSections = computed(() => props.fileCode === '01')
const isPeriodic = computed(() => props.fileCode === '06')
const isItems = computed(() => ['02', '03', '04', '05'].includes(props.fileCode))
const isExtra = computed(() => !['01', '02', '03', '04', '05', '06'].includes(props.fileCode))
const title = computed(() => fileCodeNames[props.fileCode] || props.fileCode)
// V1.19 表头对齐：读模板 labels（上传 Excel 真实列名）；V1.26 无 labels 时表头留空（无回退硬编码）
const labels = computed(() => props.content?.labels || {})
const itemsHeader = computed(() => {
  const item = labels.value.item || '', content = labels.value.content || '', standard = labels.value.standard || ''
  if (props.fileCode === '02') return `检查项（${item} + ${content}）`
  return `保养项（${item} + ${content} + ${standard}）`
})

function cloneContent(src) {
  const c = JSON.parse(JSON.stringify(src || {}))
  if (c.safetyProcedure?.sections) c.safetyProcedure.sections = c.safetyProcedure.sections.map(s => ({ ...s, clauses: [...(s.clauses || [])] }))
  if (Array.isArray(c.items)) c.items = c.items.map(i => ({ ...i }))
  if (Array.isArray(c.points)) c.points = c.points.map(p => ({ ...p }))
  if (Array.isArray(c.categories)) c.categories = c.categories.map(x => ({ ...x, checkItemsText: (x.checkItems || []).join('、') }))
  if (Array.isArray(c.handlingOpinions)) c.handlingOpinions = [...c.handlingOpinions]
  if (c.safetyNotice && typeof c.safetyNotice === 'object') c.safetyNotice = { ...c.safetyNotice }
  return c
}

function initEdit() {
  const c = cloneContent(props.content)
  // 空内容时初始化对应结构，保证可编辑
  if (!c || Object.keys(c).length === 0) {
    if (isSections.value) c.safetyProcedure = { sections: [{ seq: 1, title: '', clauses: [''] }] }
    else if (props.fileCode === '02') c.items = [{ seq: 1, project: '', content: '' }]
    else if (props.fileCode === '03' || props.fileCode === '05') c.items = [{ seq: 1, category: '', content: '', standard: '' }]
    else if (props.fileCode === '04') c.items = [{ seq: 1, category: '', content: '', method: '', tool: '', standard: '' }]
    else if (props.fileCode === '06') c.categories = [{ seq: 1, name: '', standard: '', checkItemsText: '' }]
  }
  // V1.28 安全告知及注意事项：02-06 五类常显可编辑（标题+文本，无文件），无内容也能手动添加；旧 safetyNotices[] 编辑时自动迁移
  if (['02', '03', '04', '05', '06'].includes(props.fileCode) && !c.safetyNotice) {
    c.safetyNotice = { title: '安全告知及注意事项', content: Array.isArray(c.safetyNotices) ? c.safetyNotices.join('\n') : '' }
  }
  edit.value = c
}

watch(() => [visible.value, props.content], () => { if (visible.value) initEdit() }, { flush: 'post' })

// 保存：重新编号 seq，checkItems 由逗号文本还原数组
function toPayload() {
  const c = JSON.parse(JSON.stringify(edit.value))
  if (c.safetyProcedure?.sections) {
    c.safetyProcedure.sections.forEach((s, i) => { s.seq = i + 1; s.clauses = (s.clauses || []).map(x => (x || '').trim()).filter(Boolean) })
    c.safetyProcedure.sections = c.safetyProcedure.sections.filter(s => (s.title || '').trim())
  }
  if (Array.isArray(c.items)) c.items.forEach((r, i) => { r.seq = i + 1; r.content = (r.content || '').trim() })
  if (Array.isArray(c.points)) c.points.forEach((r, i) => { r.seq = i + 1 })
  if (Array.isArray(c.categories)) c.categories.forEach((r, i) => { r.seq = i + 1; r.checkItems = (r.checkItemsText || '').split(/[,、]/).map(s => s.trim()).filter(Boolean); delete r.checkItemsText })
  if (Array.isArray(c.handlingOpinions)) c.handlingOpinions = c.handlingOpinions.map(x => (x || '').trim()).filter(Boolean)
  if (c.safetyNotice) { c.safetyNotice.title = (c.safetyNotice.title || '').trim(); c.safetyNotice.content = (c.safetyNotice.content || '').trim() }
  // V1.57：执行月份（02-06 目标月；01 无 month）随 PUT body 携带，后端写入该月记录
  const payload = { status: 'active', ...c }
  if (['02', '03', '04', '05', '06'].includes(props.fileCode) && props.month) payload.month = props.month
  return payload
}

function done() { visible.value = false; emit('saved') }

async function doSave(typeCode, fileCode, label) {
  saving.value = true
  try {
    const payload = toPayload()
    await saveTemplate(typeCode, fileCode, payload)
    toast.success(label + '成功')
    done()
  } catch (e) { toast.error(e.response?.data?.error || e.message || '保存失败') }
  finally { saving.value = false }
}

const addSection = () => edit.value.safetyProcedure.sections.push({ seq: edit.value.safetyProcedure.sections.length + 1, title: '', clauses: [''] })
const addOpinion = () => edit.value.handlingOpinions.push('')
const addRow = (key) => {
  const empty = { seq: edit.value[key].length + 1 }
  if (props.fileCode === '02') { empty.project = ''; empty.content = '' }
  else if (props.fileCode === '03' || props.fileCode === '05') { empty.category = ''; empty.content = ''; empty.standard = '' }
  else if (props.fileCode === '04') { empty.category = ''; empty.content = ''; empty.method = ''; empty.tool = ''; empty.standard = '' }
  else if (props.fileCode === '06') { empty.name = ''; empty.standard = ''; empty.checkItemsText = '' }
  edit.value[key].push(empty)
}
</script>

<template>
  <el-drawer :model-value="visible" :title="'编辑模板：' + title + '（' + typeCode + '）'" size="720px" destroy-on-close @update:model-value="v => (visible = v)">
    <div class="text-sm space-y-4">
      <!-- 配置状态条 -->
      <div class="flex items-center gap-2 text-xs text-[#909399]">
        <el-tag size="small" :type="source === '自定义' ? 'success' : 'info'">{{ source || '未配置' }}</el-tag>
        <span v-if="configured" class="text-[#1192E8]">已配置 v{{ content?.version || 0 }}</span>
        <span v-if="!isExtra" class="text-[#909399]">内容变更只影响新生成实例，在途单保持快照（§5.7(4)）</span>
      </div>

      <!-- ────── 执行期（V1.57：02-06 五类，执行期=日历整月，无起止日期选择，只读展示） ────── -->
      <div v-if="['02', '03', '04', '05', '06'].includes(fileCode)" class="border border-[#dcdfe6] rounded-md p-2">
        <div class="text-xs font-semibold text-[#606266] mb-1">执行期</div>
        <div class="text-sm text-[#303133]">{{ month || '—' }}（日历整月）</div>
        <div class="text-xs text-[#c0c4cc] mt-1">执行期固定为所选自然月整月，即对应月度报表的取数周期；该月已执行（本月/过去月/已生成计划）则锁定不可修改</div>
      </div>

      <!-- ────── 安全告知及注意事项（V1.28：标题 + 文件，02-06 五类统一，放顶部） ────── -->
      <!-- 守卫 edit.safetyNotice：initEdit 在 watch flush:post 才初始化，首渲染需跳过避免 TypeError -->
      <div v-if="['02', '03', '04', '05', '06'].includes(fileCode) && edit.safetyNotice" class="border border-orange-200 bg-orange-50 rounded-md p-2">
        <div class="text-xs font-semibold text-orange-600 mb-1">安全告知及注意事项</div>
        <el-input v-model="edit.safetyNotice.title" size="small" placeholder="安全告知标题（如：安全告知及注意事项，可修改）" class="mb-1" />
        <el-input v-model="edit.safetyNotice.content" type="textarea" :rows="4" size="small" placeholder="安全告知内容（多行文本；上传 Excel 主 sheet 有「安全告知及注意事项」行则自动带出，可编辑）" />
      </div>

      <!-- ────── 附加标准文件（编号非 01-06）：仅存储展示，不支持结构化微调 ────── -->
      <div v-if="isExtra">
        <el-alert type="info" :closable="false" show-icon
          :title="`该模块编号 ${fileCode} 为附加标准文件（仅存储，不参与维保生成），不支持结构化编辑。`" />
        <div class="mt-3 text-xs text-[#909399] leading-6">
          若需更新文件内容，请关闭本抽屉，在模块列表点击「编辑」重新上传 Excel 覆盖。
        </div>
      </div>

      <template v-else>
      <!-- ────── 01 安全操作规程：sections 章节式 ────── -->
      <div v-if="isSections">
        <div class="text-xs font-semibold text-[#606266] mb-1">安全操作规程（{{ labels.section }} + {{ labels.clause }}）</div>
        <div v-for="(sec, si) in edit.safetyProcedure?.sections || []" :key="si" class="border border-[#e4e7ed] rounded p-2 mb-2">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs text-[#909399] w-10 shrink-0">第{{ si + 1 }}章</span>
            <el-input v-model="sec.title" size="small" :placeholder="labels.section" />
            <el-button link type="danger" size="small" @click="edit.safetyProcedure.sections.splice(si, 1)">删</el-button>
          </div>
          <div v-for="(cl, ci) in sec.clauses" :key="ci" class="flex items-center gap-2 mb-1">
            <el-input v-model="sec.clauses[ci]" size="small" :placeholder="labels.clause" style="margin-left:48px" />
            <el-button link type="danger" size="small" @click="sec.clauses.splice(ci, 1)">删</el-button>
          </div>
          <el-button size="small" plain style="margin-left:48px" @click="sec.clauses.push('')">+ 条款</el-button>
        </div>
        <el-button size="small" type="primary" plain @click="addSection">+ 章节</el-button>
      </div>

      <!-- ────── 02/03/04/05 点检 / 一二级保养 / 设备润滑：items ────── -->
      <div v-else-if="isItems">
        <div class="text-xs font-semibold text-[#606266] mb-1">{{ itemsHeader }}（{{ edit.items?.length || 0 }} 项）</div>
        <el-table :data="edit.items" size="small" border max-height="420">
          <el-table-column label="序号" width="50"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
          <el-table-column :label="labels.item" width="110"><template #default="{ row }"><el-input v-model="row.project" v-if="fileCode === '02'" size="small" :placeholder="labels.item" /><el-input v-else v-model="row.category" size="small" :placeholder="labels.item" /></template></el-table-column>
          <el-table-column :label="labels.content" min-width="200"><template #default="{ row }"><el-input v-model="row.content" size="small" :placeholder="labels.content" /></template></el-table-column>
          <el-table-column v-if="fileCode !== '02'" :label="labels.standard" min-width="160"><template #default="{ row }"><el-input v-model="row.standard" size="small" :placeholder="labels.standard" /></template></el-table-column>
          <el-table-column v-if="fileCode === '04'" :label="labels.method" min-width="140"><template #default="{ row }"><el-input v-model="row.method" size="small" :placeholder="labels.method" /></template></el-table-column>
          <el-table-column v-if="fileCode === '04'" :label="labels.tool" width="110"><template #default="{ row }"><el-input v-model="row.tool" size="small" :placeholder="labels.tool" /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" size="small" @click="edit.items.splice($index, 1)">删</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" type="primary" plain @click="addRow('items')">+ 添加项</el-button>
      </div>

      <!-- ────── 06 定期检查：categories ────── -->
      <div v-else-if="isPeriodic">
        <div class="text-xs font-semibold text-[#606266] mb-1">定期检查类（{{ edit.categories?.length || 0 }} 类）</div>
        <el-table :data="edit.categories" size="small" border max-height="300">
          <el-table-column label="序号" width="50"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
          <el-table-column :label="labels.name" width="110"><template #default="{ row }"><el-input v-model="row.name" size="small" :placeholder="labels.name" /></template></el-table-column>
          <el-table-column :label="labels.standard" min-width="180"><template #default="{ row }"><el-input v-model="row.standard" size="small" :placeholder="labels.standard" /></template></el-table-column>
          <el-table-column :label="labels.checkItems" min-width="180"><template #default="{ row }"><el-input v-model="row.checkItemsText" size="small" placeholder="如：主梁挠度、焊缝外观" /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" size="small" @click="edit.categories.splice($index, 1)">删</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" type="primary" plain @click="addRow('categories')">+ 添加类别</el-button>
      </div>

      <!-- ────── 公共：handlingOpinions 处理意见（06） ────── -->
      <div v-if="edit.handlingOpinions">
        <div class="text-xs font-semibold text-[#606266] mb-1">超标处理意见（{{ edit.handlingOpinions.length }} 条）</div>
        <div v-for="(o, i) in edit.handlingOpinions" :key="i" class="flex items-center gap-2 mb-1">
          <el-input v-model="edit.handlingOpinions[i]" size="small" placeholder="处理意见" />
          <el-button link type="danger" size="small" @click="edit.handlingOpinions.splice(i, 1)">删</el-button>
        </div>
        <el-button size="small" plain @click="addOpinion">+ 处理意见</el-button>
      </div>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <div class="flex-1" />
        <el-button @click="visible = false">取消</el-button>
        <el-button v-if="!isExtra" type="primary" :loading="saving" @click="doSave(typeCode, fileCode, '已保存')">保存</el-button>
      </div>
    </template>
  </el-drawer>
</template>
