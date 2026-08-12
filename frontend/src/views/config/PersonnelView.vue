<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useConfigStore } from '@/stores/config'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'

// V1.9：人员管理 = 人员档案 CRUD（开发期手动维护兜底，正式由 CIMS 按工号引入）
// 字段仅 姓名 / 工号 / 部门（下拉=系统配置部门车间）/ 系统角色（下拉=11 类）。
// 角色即职责：人员选定单一系统角色后，直接决定菜单可见性与维保步骤执行权限（admin 全部可执行）。
const store = useConfigStore()
const dictStore = useDictStore()
const toast = useToast()

// ===================== 数据 =====================
const keyword = ref('')

// 部门/车间级联选项 = 系统配置「部门车间」字典（dict.js deptWorkshopTree：部门名 → 车间名列表）
const deptCascadeOptions = computed(() => {
  const tree = dictStore.deptWorkshopTree || {}
  return Object.entries(tree).map(([dept, d]) => ({
    value: dept,
    label: dept,
    children: Object.values(d.workshops || {}).map(w => ({ value: w.name, label: w.name }))
  }))
})
// 级联 v-model：部门/车间（车间可空，仅选部门级）
const deptCascade = computed({
  get: () => (dialog.form.dept ? (dialog.form.workshop ? [dialog.form.dept, dialog.form.workshop] : [dialog.form.dept]) : []),
  set: val => {
    dialog.form.dept = val?.[0] || ''
    dialog.form.workshop = val?.[1] || ''
  }
})
const roleNameById = computed(() => {
  const m = {}
  store.roles.forEach(r => { m[r.id] = r.name })
  return m
})

// 表格部门列：部门 / 车间（车间名来自 dict 带「部门-」前缀，展示时剥离避免重复）
function deptCellLabel(row) {
  if (!row.dept) return '—'
  if (row.workshop) {
    const w = row.workshop.startsWith(row.dept + '-') ? row.workshop.slice(row.dept.length + 1) : row.workshop
    return `${row.dept} / ${w}`
  }
  return row.dept
}

// ===================== 人员档案 CRUD =====================
const dialog = reactive({ visible: false, editing: null, form: { id: '', name: '', employeeId: '', dept: '', workshop: '', roleId: '' } })

function openDialog(person = null) {
  dialog.editing = person
  dialog.form = person ? { ...person } : { id: '', name: '', employeeId: '', dept: '', workshop: '', roleId: '' }
  dialog.visible = true
}
async function savePerson() {
  const f = { ...dialog.form }
  if (!f.name || !f.employeeId) return toast.warning('姓名和工号必填')
  if (!f.dept) return toast.warning('请选择部门/车间')
  if (!f.roleId) return toast.warning('请选择系统角色')
  try {
    if (dialog.editing) await store.updatePersonnel(dialog.editing.id, f)
    else {
      delete f.id // 新建时不传 id，后端自动生成（否则空 id 会覆盖生成 id）
      await store.createPersonnel(f)
    }
    dialog.visible = false
    toast.success(dialog.editing ? '已更新' : '已新增')
  } catch (e) { toast.error(e.message || '保存失败') }
}
async function removePerson(person) {
  try {
    await ElMessageBox.confirm(
      `删除人员「${person.name}」(${person.employeeId})？删除后其待办与步骤执行权限即失效。`,
      '删除人员', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (_) { return }
  try {
    await store.deletePersonnel(person.id)
    toast.success('已删除')
  } catch (e) { toast.error(e.message || '删除失败') }
}

const filteredPersonnel = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return store.personnel
  return store.personnel.filter(p => p.name.includes(kw) || p.employeeId.includes(kw))
})

// ===================== 加载 =====================
onMounted(async () => {
  try {
    await Promise.all([
      store.fetchPersonnel(),
      store.fetchRoles(),
      dictStore.loadAll()   // 部门下拉 = 系统配置「部门车间」
    ])
  } catch (e) {
    toast.error(e.message || '加载失败')
  }
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- 精简说明（V1.9） -->
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb-2 shrink-0"
      title="人员由 CIMS 系统按工号引入，开发期提供手动维护 CRUD 兜底。角色即职责：系统角色（10 职责 + 系统管理员）直接决定菜单可见性与维保步骤执行权限。"
    />

    <!-- 工具栏 -->
    <div class="flex items-center justify-between px-1 mb-2 shrink-0">
      <el-input
        v-model="keyword"
        placeholder="按姓名 / 工号搜索"
        clearable
        size="small"
        class="w-[240px]"
      />
      <el-button type="primary" size="small" @click="openDialog()">新增人员</el-button>
    </div>

    <!-- 人员表格 -->
    <el-table :data="filteredPersonnel" size="small" stripe border empty-text="暂无人员数据" class="flex-1 min-h-0">
      <el-table-column prop="employeeId" label="工号" width="120" />
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column label="部门" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ deptCellLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="系统角色" min-width="120">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ roleNameById[row.roleId] || row.roleId }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right" align="center">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="openDialog(row)">编辑</el-button>
          <el-button type="danger" link size="small" @click="removePerson(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增 / 编辑人员 -->
    <el-dialog v-model="dialog.visible" :title="dialog.editing ? '编辑人员' : '新增人员'" width="480px">
      <el-form :model="dialog.form" label-width="80px" size="small">
        <el-form-item label="姓名" required><el-input v-model="dialog.form.name" placeholder="姓名" /></el-form-item>
        <el-form-item label="工号" required><el-input v-model="dialog.form.employeeId" placeholder="工号" /></el-form-item>
        <el-form-item label="部门/车间" required>
          <el-cascader
            v-model="deptCascade"
            :options="deptCascadeOptions"
            :props="{ checkStrictly: true, expandTrigger: 'hover' }"
            placeholder="选择部门 → 车间（可只选部门）"
            clearable
            filterable
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="系统角色" required>
          <el-select v-model="dialog.form.roleId" filterable placeholder="选择系统角色（10 职责 + 系统管理员）" class="w-full">
            <el-option v-for="r in store.roles" :key="r.id" :label="`${r.name} (${r.id})`" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" size="small" @click="savePerson">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
