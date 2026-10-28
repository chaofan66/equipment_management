<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { fetchExamRoles, fetchExamBanks, saveExamPlan } from '@/api/learning'

const dict = useDictStore()
const auth = useAuthStore()
const toast = useToast()

const canConfig = computed(() => auth.hasPermission('exam.config.view'))
const canEdit = computed(() => auth.hasPermission('exam.config.edit'))

const major = ref('')
const mid = ref('')
const keyword = ref('')
const banks = ref([])
const loading = ref(false)
const roles = ref([])

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
const filteredBanks = computed(() => {
  const k = keyword.value.trim()
  return banks.value.filter(b => {
    if ((major.value || mid.value) && leafCodes.value.size && !leafCodes.value.has(b.typeCode)) return false
    if (!k) return true
    return b.typeName.includes(k) || b.typeCode.includes(k) || b.code.includes(k)
  })
})

function fmt(t) {
  if (!t) return '—'
  return String(t).replace('T', ' ').replace(/\.\d+Z$/, '').slice(0, 19)
}
async function loadBanks() {
  if (!canConfig.value) return
  loading.value = true
  try {
    const res = await fetchExamBanks()
    banks.value = res.data || []
  } catch (e) { toast.error(e.message) }
  finally { loading.value = false }
}

const settingsOpen = ref(false)
const saving = ref(false)
const form = reactive({ typeCode: '', code: '', name: '', counts: {}, enabled: false, dailyStart: '', dailyEnd: '', cannotDisable: false, presets: [], roleOn: {}, rolePreset: {} })

function openSettings(row) {
  form.typeCode = row.typeCode
  form.code = row.code
  form.name = row.name
  form.counts = row.counts || {}
  form.enabled = !!row.enabled
  form.dailyStart = row.dailyStart || ''
  form.dailyEnd = row.dailyEnd || ''
  form.cannotDisable = !!row.cannotDisable
  form.presets = (row.presets || []).map(p => ({ ...p }))
  form.roleOn = {}
  form.rolePreset = {}
  roles.value.forEach(r => {
    const pid = (row.rolePresets || {})[r.id]
    form.roleOn[r.id] = !!pid
    form.rolePreset[r.id] = pid || (form.presets[0] && form.presets[0].id) || ''
  })
  settingsOpen.value = true
}

function addPreset() {
  form.presets.push({ id: 'P' + Date.now().toString(36), name: '', s: 10, m: 5, f: 4, e: 1 })
}
function removePreset(id) {
  if (form.presets.length <= 1) return toast.warning('至少保留一套题型组合')
  const used = roles.value.some(r => form.roleOn[r.id] && form.rolePreset[r.id] === id)
  if (used) return toast.warning('有职位正在使用该组合，请先改选')
  form.presets = form.presets.filter(p => p.id !== id)
}

async function saveSettings() {
  const rolePresets = {}
  for (const r of roles.value) {
    if (!form.roleOn[r.id]) continue
    if (!form.rolePreset[r.id]) return toast.warning(r.name + '请选择题型组合')
    rolePresets[r.id] = form.rolePreset[r.id]
  }
  if (!form.dailyStart || !form.dailyEnd) return toast.warning('请填写每天考试时间，不能设成全天')
  saving.value = true
  try {
    await saveExamPlan(form.typeCode, {
      enabled: form.cannotDisable ? true : form.enabled,
      dailyStart: form.dailyStart || '',
      dailyEnd: form.dailyEnd || '',
      presets: form.presets,
      rolePresets
    })
    toast.success('考试设置已保存')
    settingsOpen.value = false
    await loadBanks()
  } catch (e) { toast.error(e.message) }
  finally { saving.value = false }
}

onMounted(async () => {
  await dict.loadAll()
  try {
    const res = await fetchExamRoles()
    roles.value = res.data || []
  } catch (e) { toast.error(e.message) }
  await loadBanks()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 bg-white">
    <div v-if="canConfig" class="flex flex-col flex-1 min-h-0">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-[#ebeef5] shrink-0 flex-wrap">
        <el-select v-model="major" clearable placeholder="资产大类" size="small" style="width: 140px" @change="mid = ''">
          <el-option v-for="m in majors" :key="m.code" :label="m.name" :value="m.code" />
        </el-select>
        <el-select v-model="mid" clearable placeholder="资产中类" size="small" style="width: 140px" :disabled="!major">
          <el-option v-for="m in mids" :key="m.code" :label="m.name" :value="m.code" />
        </el-select>
        <el-input v-model="keyword" clearable placeholder="题库编号 / 资产类别" size="small" style="width: 200px" />
      </div>
      <div class="flex-1 overflow-auto p-3">
        <el-table :data="filteredBanks" v-loading="loading" size="small" border stripe empty-text="上传标准文件后，对应题库会显示在这里">
          <el-table-column prop="code" label="题库编号" width="120" />
          <el-table-column prop="typeName" label="资产类别" min-width="240" show-overflow-tooltip />
          <el-table-column label="单选" width="70" align="center"><template #default="{ row }">{{ row.counts?.single || 0 }}</template></el-table-column>
          <el-table-column label="多选" width="70" align="center"><template #default="{ row }">{{ row.counts?.multi || 0 }}</template></el-table-column>
          <el-table-column label="填空" width="70" align="center"><template #default="{ row }">{{ row.counts?.fill || 0 }}</template></el-table-column>
          <el-table-column label="问答" width="70" align="center"><template #default="{ row }">{{ row.counts?.essay || 0 }}</template></el-table-column>
          <el-table-column label="上传时间" width="160"><template #default="{ row }">{{ fmt(row.uploadedAt) }}</template></el-table-column>
          <el-table-column label="考试时间段" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.windowText || '—' }}</template></el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button v-if="canEdit" type="primary" link size="small" @click="openSettings(row)">设置</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="settingsOpen" :title="'考试设置 · ' + form.code" width="860px" :close-on-click-modal="false">
      <el-form label-width="110px" size="small">
        <el-form-item label="题库">{{ form.name }}</el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" :disabled="form.cannotDisable" />
          <span class="text-xs text-[#909399] ml-2">{{ form.cannotDisable ? '当前处于每天考试时间段内，不能关闭启用' : '启用后，已勾选职位可在每天时段内反复练习' }}</span>
        </el-form-item>
        <el-form-item label="每天考试时间" required>
          <div class="flex items-center gap-2">
            <el-time-picker v-model="form.dailyStart" value-format="HH:mm" format="HH:mm" placeholder="开始" :clearable="false" :disabled="form.cannotDisable" style="width: 140px" />
            <span class="text-xs text-[#909399]">至</span>
            <el-time-picker v-model="form.dailyEnd" value-format="HH:mm" format="HH:mm" placeholder="结束" :clearable="false" :disabled="form.cannotDisable" style="width: 140px" />
          </div>
          <div class="text-xs text-[#909399] mt-1">必填，按每天的钟点重复，不能设成全天。时段内不能关闭启用，也不能改这个时段。</div>
        </el-form-item>
        <el-form-item label="题型组合">
          <div class="w-full">
            <div class="text-xs text-[#909399] mb-1">库存：单选 {{ form.counts.single || 0 }} / 多选 {{ form.counts.multi || 0 }} / 填空 {{ form.counts.fill || 0 }} / 问答 {{ form.counts.essay || 0 }}</div>
            <div v-for="p in form.presets" :key="p.id" class="flex items-center gap-2 mb-2">
              <el-input v-model="p.name" placeholder="组合名称" style="width: 140px" />
              <span class="text-xs text-[#909399]">单选</span><el-input-number v-model="p.s" :min="0" :max="form.counts.single || 0" controls-position="right" style="width: 90px" />
              <span class="text-xs text-[#909399]">多选</span><el-input-number v-model="p.m" :min="0" :max="form.counts.multi || 0" controls-position="right" style="width: 90px" />
              <span class="text-xs text-[#909399]">填空</span><el-input-number v-model="p.f" :min="0" :max="form.counts.fill || 0" controls-position="right" style="width: 90px" />
              <span class="text-xs text-[#909399]">问答</span><el-input-number v-model="p.e" :min="0" :max="form.counts.essay || 0" controls-position="right" style="width: 90px" />
              <el-button link type="danger" @click="removePreset(p.id)">删除</el-button>
            </div>
            <el-button size="small" @click="addPreset">添加组合</el-button>
          </div>
        </el-form-item>
        <el-form-item label="职位">
          <el-table :data="roles" size="small" border>
            <el-table-column label="参加" width="70">
              <template #default="{ row }"><el-checkbox v-model="form.roleOn[row.id]" /></template>
            </el-table-column>
            <el-table-column prop="name" label="职位" width="120" />
            <el-table-column label="题型组合">
              <template #default="{ row }">
                <el-select v-model="form.rolePreset[row.id]" size="small" :disabled="!form.roleOn[row.id]" placeholder="选择组合" style="width: 220px">
                  <el-option v-for="p in form.presets" :key="p.id" :label="p.name || p.id" :value="p.id" />
                </el-select>
              </template>
            </el-table-column>
          </el-table>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingsOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
