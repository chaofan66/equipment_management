<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'

const store = useDictStore()
const toast = useToast()

const treeData = ref({})
const searchText = ref('')
const editingRowId = ref(null)
const editForm = ref({ name: '', code: '' })

// Flatten department-workshop tree
const flatRows = computed(() => {
  const rows = []
  Object.entries(treeData.value).forEach(([deptName, deptInfo]) => {
    const deptId = `dept-${deptInfo.code}`
    const workshops = deptInfo.workshops || {}
    const wsList = Object.entries(workshops)
    rows.push({
      id: deptId,
      code: deptInfo.code,
      name: deptName,
      parentId: null,
      level: 0,
      hasChildren: wsList.length > 0,
      isDept: true,
      wsCount: wsList.length,
      _raw: deptInfo,
      _isDeptNode: true
    })
    wsList.forEach(([wsCode, wsInfo]) => {
      rows.push({
        id: `ws-${wsInfo.code}`,
        code: wsInfo.code,
        name: wsInfo.name,
        parentId: deptId,
        level: 1,
        hasChildren: false,
        isDept: false,
        deptName,
        _raw: wsInfo,
        _deptRaw: deptInfo
      })
    })
  })
  return rows
})

const filteredRows = computed(() => {
  if (!searchText.value) return flatRows.value
  const s = searchText.value.toLowerCase()
  return flatRows.value.filter(r =>
    r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)
  )
})

// 分页（V1.11）：平铺记录分页，默认 20 条/页
const page = ref(1)
const pageSize = ref(20)
const pageSizes = [20, 50, 100]
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})
watch(searchText, () => { page.value = 1 })
watch(pageSize, () => { page.value = 1 })
watch(() => filteredRows.value.length, (n) => {
  const max = Math.ceil(n / pageSize.value) || 1
  if (page.value > max) page.value = max
})

function startEdit(row) {
  editingRowId.value = row.id
  editForm.value = { name: row.name, code: row.code }
}

function cancelEdit() {
  editingRowId.value = null
}

function saveEdit(row) {
  if (row._isDeptNode) {
    // Updating department
    const oldName = row.name
    const newName = editForm.value.name
    row._raw.code = editForm.value.code
    row.name = newName
    row.code = editForm.value.code
    // If name changed, update tree key
    if (oldName !== newName) {
      treeData.value[newName] = treeData.value[oldName]
      delete treeData.value[oldName]
    }
  } else {
    // Updating workshop
    row._raw.name = editForm.value.name
    row._raw.code = editForm.value.code
    row.name = editForm.value.name
    row.code = editForm.value.code
    // Update the workshop key in parent dept
    const deptInfo = row._deptRaw
    if (deptInfo && deptInfo.workshops) {
      const oldCode = Object.keys(deptInfo.workshops).find(k => deptInfo.workshops[k] === row._raw)
      if (oldCode && oldCode !== editForm.value.code) {
        deptInfo.workshops[editForm.value.code] = deptInfo.workshops[oldCode]
        delete deptInfo.workshops[oldCode]
      }
    }
  }
  editingRowId.value = null
  toast.success('已修改')
}

function addWorkshop(row) {
  if (!row._isDeptNode) return
  const newCode = '9900'
  const newName = row.name + '-新车间'
  if (!row._raw.workshops) row._raw.workshops = {}
  row._raw.workshops[newCode] = { name: newName, code: newCode }
  treeData.value = { ...treeData.value }
  toast.success('已添加车间')
}

function addDept() {
  const newCode = '9900'
  const newName = '新部门'
  treeData.value = { ...treeData.value, [newName]: { code: newCode, workshops: { [newCode]: { name: newName, code: newCode } } } }
  toast.success('已添加新部门')
}

function deleteNode(row) {
  if (row._isDeptNode) {
    delete treeData.value[row.name]
  } else {
    const dept = row._deptRaw
    if (dept && dept.workshops) {
      const wsCode = Object.keys(dept.workshops).find(k => dept.workshops[k] === row._raw)
      if (wsCode) delete dept.workshops[wsCode]
    }
  }
  treeData.value = { ...treeData.value }
  toast.success('已删除')
}

async function saveAll() {
  try {
    await store.saveDeptWorkshopTree(treeData.value)
    toast.success('部门车间已保存')
  } catch (e) {
    toast.error(e.message || '保存失败')
  }
}

const deptCount = computed(() => Object.keys(treeData.value).length)
const wsCount = computed(() => {
  let c = 0
  Object.values(treeData.value).forEach(d => { c += Object.keys(d.workshops || {}).length })
  return c
})

onMounted(async () => {
  await store.loadAll()
  treeData.value = JSON.parse(JSON.stringify(store.deptWorkshopTree || {}))
})
</script>

<template>
  <div class="flex-1 overflow-auto p-3">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">部门车间</h3>
      <div class="flex items-center gap-2">
        <el-input v-model="searchText" size="small" placeholder="搜索名称或编码" style="width: 200px" clearable />
        <el-button size="small" @click="addDept">新增部门</el-button>
        <el-button type="primary" size="small" @click="saveAll">保存全部</el-button>
      </div>
    </div>

    <el-table
      :data="pagedRows"
      size="small"
      stripe
      border
      row-key="id"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
      default-expand-all
      max-height="calc(100vh - 240px)"
    >
      <el-table-column label="编码" width="120" align="center">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id">
            <el-input v-model="editForm.code" size="small" />
          </template>
          <template v-else>
            <el-tag :type="row.isDept ? 'primary' : 'success'" size="small">{{ row.code }}</el-tag>
          </template>
        </template>
      </el-table-column>

      <el-table-column prop="name" label="名称" min-width="250">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id">
            <el-input v-model="editForm.name" size="small" class="w-full" />
          </template>
          <template v-else>
            <span :class="{ 'font-semibold': row.isDept }">{{ row.name }}</span>
          </template>
        </template>
      </el-table-column>

      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isDept ? 'primary' : 'info'" size="small">{{ row.isDept ? '部门' : '车间' }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="所属部门" width="180">
        <template #default="{ row }">
          <span v-if="!row.isDept" class="text-xs">{{ row.deptName }}</span>
          <span v-else class="text-xs text-[#909399]">—</span>
        </template>
      </el-table-column>

      <el-table-column label="车间数" width="80" align="center">
        <template #default="{ row }">
          <span v-if="row.isDept" class="text-xs">{{ row.wsCount }}</span>
          <span v-else class="text-xs text-[#c0c4cc]">—</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id">
            <el-button type="primary" link size="small" @click="saveEdit(row)">确定</el-button>
            <el-button link size="small" @click="cancelEdit">取消</el-button>
          </template>
          <template v-else>
            <el-button type="primary" link size="small" @click="startEdit(row)">编辑</el-button>
            <el-button v-if="row.isDept" link size="small" @click="addWorkshop(row)">添加车间</el-button>
            <el-popconfirm title="确定删除？" @confirm="deleteNode(row)">
              <template #reference>
                <el-button type="danger" link size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex items-center justify-between mt-2">
      <div class="text-xs text-[#909399]">
        共 {{ deptCount }} 个部门，{{ wsCount }} 个车间
      </div>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="pageSizes"
        :total="filteredRows.length"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
      />
    </div>
  </div>
</template>
