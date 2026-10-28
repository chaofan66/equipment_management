<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { fetchExamRoles, fetchCourseCatalog, saveCoursePlan, fetchMyCourses, fetchCourseContent } from '@/api/learning'

const dict = useDictStore()
const auth = useAuthStore()
const toast = useToast()

const canConfig = computed(() => auth.hasPermission('course.config.view'))
const canEdit = computed(() => auth.hasPermission('course.config.edit'))
const canLearn = computed(() => auth.hasPermission('course.view'))
const pageTabs = computed(() => {
  const tabs = []
  if (canConfig.value) tabs.push({ key: 'config', label: '课程配置' })
  if (canLearn.value) tabs.push({ key: 'learn', label: '课程学习' })
  return tabs
})
const tab = ref('')
watch(pageTabs, (tabs) => {
  if (!tabs.some(t => t.key === tab.value) && tab.value !== 'read') tab.value = tabs[0]?.key || ''
}, { immediate: true })
const major = ref('')
const mid = ref('')
const keyword = ref('')
const catalog = ref([])
const mine = ref([])
const roles = ref([])
const loading = ref(false)
const reading = ref(null)

const majors = computed(() => Object.entries(dict.deviceTypeTree || {}).map(([code, node]) => ({ code, name: node.name })))
const mids = computed(() => {
  if (!major.value) return []
  const node = dict.deviceTypeTree?.[major.value]
  return node ? Object.entries(node.children || {}).map(([code, c]) => ({ code, name: c.name })) : []
})
const leafCodes = computed(() => {
  const set = new Set()
  const walk = (node, majorCode, midCode) => {
    Object.entries(node || {}).forEach(([key, val]) => {
      if (val.children) {
        if (!majorCode) walk(val.children, key, '')
        else walk(val.children, majorCode, key)
      } else if (val.code) {
        if (major.value && majorCode !== major.value) return
        if (mid.value && midCode !== mid.value) return
        set.add(val.code)
      }
    })
  }
  walk(dict.deviceTypeTree || {}, '', '')
  return set
})

function matchFilter(row) {
  if ((major.value || mid.value) && leafCodes.value.size && !leafCodes.value.has(row.typeCode)) return false
  const k = keyword.value.trim()
  if (!k) return true
  return row.typeName.includes(k) || row.typeCode.includes(k) || row.code.includes(k)
}
const filteredCatalog = computed(() => catalog.value.filter(matchFilter))
const filteredMine = computed(() => mine.value.filter(matchFilter))

function fmt(t) {
  if (!t) return '—'
  return String(t).replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19)
}
function roleNames(ids) {
  return (ids || []).map(id => roles.value.find(r => r.id === id)?.name || id).join('、') || '—'
}

async function loadCatalog() {
  if (!canConfig.value) return
  loading.value = true
  try {
    const res = await fetchCourseCatalog()
    catalog.value = res.data || []
  } catch (e) { toast.error(e.message) }
  finally { loading.value = false }
}
async function loadMine() {
  if (!canLearn.value) return
  try {
    const res = await fetchMyCourses()
    mine.value = res.data || []
  } catch (e) { toast.error(e.message) }
}

const settingsOpen = ref(false)
const saving = ref(false)
const form = reactive({ typeCode: '', code: '', typeName: '', enabled: false, roles: [] })

function openSettings(row) {
  form.typeCode = row.typeCode
  form.code = row.code
  form.typeName = row.typeName
  form.enabled = !!row.enabled
  form.roles = [...(row.roles || [])]
  settingsOpen.value = true
}

async function saveSettings() {
  saving.value = true
  try {
    await saveCoursePlan(form.typeCode, { enabled: form.enabled, roles: form.roles })
    toast.success('课程设置已保存')
    settingsOpen.value = false
    await Promise.all([loadCatalog(), loadMine()])
  } catch (e) { toast.error(e.message) }
  finally { saving.value = false }
}

async function openCourse(row, preview) {
  try {
    const res = await fetchCourseContent(row.typeCode, preview)
    reading.value = res.data
    tab.value = 'read'
  } catch (e) { toast.error(e.message) }
}

onMounted(async () => {
  await dict.loadAll()
  try {
    const res = await fetchExamRoles()
    roles.value = res.data || []
  } catch (e) { toast.error(e.message) }
  await Promise.all([loadCatalog(), loadMine()])
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 bg-white">
    <div v-if="tab !== 'read'" class="flex items-center gap-2 px-3 py-2 border-b border-[#dcdfe6] shrink-0 flex-wrap">
      <el-radio-group v-model="tab" size="small">
        <el-radio-button v-for="t in pageTabs" :key="t.key" :value="t.key">{{ t.label }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="major" clearable placeholder="资产大类" size="small" style="width: 140px" @change="mid = ''">
        <el-option v-for="m in majors" :key="m.code" :label="m.name" :value="m.code" />
      </el-select>
      <el-select v-model="mid" clearable placeholder="资产中类" size="small" style="width: 140px" :disabled="!major">
        <el-option v-for="m in mids" :key="m.code" :label="m.name" :value="m.code" />
      </el-select>
      <el-input v-model="keyword" clearable placeholder="资产类别" size="small" style="width: 180px" />
    </div>

    <div v-if="canConfig && tab === 'config'" class="flex-1 overflow-auto p-3">
      <el-table :data="filteredCatalog" v-loading="loading" size="small" border stripe empty-text="还没有已上传的安全操作规程">
        <el-table-column prop="code" label="资料编号" width="110" />
        <el-table-column prop="typeName" label="资产类别" min-width="160" show-overflow-tooltip />
        <el-table-column prop="typePath" label="类别路径" min-width="200" show-overflow-tooltip />
        <el-table-column label="上传时间" width="160"><template #default="{ row }">{{ fmt(row.uploadedAt) }}</template></el-table-column>
        <el-table-column label="可见职位" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ roleNames(row.roles) }}</template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit" type="primary" link size="small" @click="openSettings(row)">设置</el-button>
            <el-button type="primary" link size="small" @click="openCourse(row, true)">预览</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else-if="tab === 'learn'" class="flex-1 overflow-auto p-3">
      <el-table :data="filteredMine" size="small" border stripe empty-text="当前职位没有可学习的课程">
        <el-table-column prop="code" label="资料编号" width="110" />
        <el-table-column prop="typeName" label="资产类别" min-width="160" />
        <el-table-column prop="name" label="资料" width="140" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }"><el-button type="primary" link size="small" @click="openCourse(row, false)">学习</el-button></template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else-if="tab === 'read' && reading" class="flex flex-col flex-1 min-h-0">
      <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] shrink-0">
        <el-button size="small" @click="tab = pageTabs[0]?.key || 'learn'">返回</el-button>
        <span class="text-sm font-semibold">{{ reading.typeName }} · {{ reading.title }}</span>
        <span class="text-xs text-[#909399]">{{ reading.code }}</span>
      </div>
      <div class="flex-1 overflow-auto p-4">
        <div v-if="!reading.sections?.length" class="text-sm text-[#909399]">这份规程还没有章节内容。</div>
        <section v-for="sec in reading.sections" :key="sec.seq" class="mb-4">
          <h3 class="text-sm font-semibold mb-2">{{ sec.seq }}. {{ sec.title }}</h3>
          <p v-for="(clause, i) in sec.clauses" :key="i" class="text-sm leading-7 text-[#303133] whitespace-pre-wrap mb-2">{{ clause }}</p>
        </section>
      </div>
    </div>

    <el-dialog v-model="settingsOpen" :title="'课程设置 · ' + form.code" width="520px" :close-on-click-modal="false">
      <el-form label-width="90px" size="small">
        <el-form-item label="资产类别">{{ form.typeName }}</el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item label="可见职位">
          <el-checkbox-group v-model="form.roles" class="flex flex-col items-start gap-1">
            <el-checkbox v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
