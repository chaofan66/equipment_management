<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'

const store = useDictStore()
const toast = useToast()

const treeData = ref({})
const searchText = ref('')
const editingRowId = ref(null)
const editForm = ref({ name: '', code: '', remark: '' })

// Build tree structure for el-table (nested children for expand/collapse)
const treeRows = computed(() => {
  function build(node, parentId, level, majorName, midName) {
    if (!node) return []
    return Object.entries(node).map(([key, val]) => {
      const id = parentId ? `${parentId}-${key}` : key
      const childNodes = val.children ? val.children : null
      const hasChildren = !!(childNodes && Object.keys(childNodes).length > 0)
      const isLeaf = !!val.code
      const children = hasChildren
        ? build(childNodes, id, level + 1, level === 0 ? val.name : majorName, level === 1 ? val.name : midName)
        : undefined
      return {
        id,
        code: val.code || key,
        name: val.name,
        remark: val.remark || '',
        parentId: parentId || null,
        level,
        hasChildren,
        isLeaf,
        majorName: level === 0 ? val.name : majorName,
        midName: level === 1 ? val.name : (level === 2 ? midName : ''),
        children,
        _raw: val
      }
    })
  }
  return build(treeData.value, null, 0, '', '')
})

// Filter tree (keep parents if children match search)
function filterTree(rows, search) {
  if (!search) return rows
  const s = search.toLowerCase()
  return rows.reduce((acc, row) => {
    const selfMatch = row.name.toLowerCase().includes(s) || row.code.toLowerCase().includes(s)
    const filteredChildren = row.children ? filterTree(row.children, search) : undefined
    if (selfMatch || (filteredChildren && filteredChildren.length > 0)) {
      acc.push({
        ...row,
        children: selfMatch ? (row.children || undefined) : filteredChildren,
        hasChildren: selfMatch ? row.hasChildren : (filteredChildren && filteredChildren.length > 0)
      })
    }
    return acc
  }, [])
}

const filteredRows = computed(() => filterTree(treeRows.value, searchText.value))

// 分页（V1.11）：树形表格按大类分页，保留树形展开下钻；总数 = 大类数
const page = ref(1)
const pageSize = ref(10)
const pageSizes = [5, 10, 20]
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

// 展开状态（V1.11 改自定义展开：el-table 树形 default-expand-all 在异步数据下不可靠，无法默认折叠）
// 每页展示「分页的大类 + 其展开的下钻节点」，搜索时强制展开命中节点
const expanded = reactive({})
function flattenTree(rows, forceExpand = false, out = []) {
  for (const row of rows) {
    // 去掉 children 防止 el-table 自动识别为树并全展开（分页 + 自定义展开时按平铺渲染）
    out.push({ ...row, children: undefined })
    if (row.children && row.children.length && (forceExpand || expanded[row.id])) {
      flattenTree(row.children, forceExpand, out)
    }
  }
  return out
}
const displayRows = computed(() => flattenTree(pagedRows.value, !!searchText.value))
function toggleExpand(row) {
  expanded[row.id] = !expanded[row.id]
}

// Helper to count total rows in a tree
function countTreeRows(rows) {
  let count = 0
  for (const row of rows) {
    count++
    if (row.children) count += countTreeRows(row.children)
  }
  return count
}

const levelLabel = (level) => ['大类', '中类', '小类'][level] || ''
const levelTagType = (level) => ['primary', 'primary', 'success'][level] || 'info'

function startEdit(row) {
  editingRowId.value = row.id
  editForm.value = { name: row.name, code: row.code, remark: row.remark }
}

function cancelEdit() {
  editingRowId.value = null
}

function saveEdit(row) {
  // Update the raw node
  if (row._raw) {
    row._raw.name = editForm.value.name
    if (row.isLeaf) {
      row._raw.code = editForm.value.code
      row._raw.remark = editForm.value.remark
    }
  }
  row.name = editForm.value.name
  if (row.isLeaf) {
    row.code = editForm.value.code
    row.remark = editForm.value.remark
  }
  editingRowId.value = null
  toast.success('已修改')
}

function addChild(row) {
  const parentNode = row._raw
  if (!parentNode.children) parentNode.children = {}
  const newCode = row.isLeaf ? '' : '99'
  const newKey = row.isLeaf ? '' : '99'
  const newNode = row.isLeaf
    ? { name: '新设备类型', code: '', remark: '' }
    : { name: '新分类', children: {} }
  // For leaf parent, we can't add children (it's a leaf)
  if (row.isLeaf) {
    toast.warning('小类节点下不能添加子节点')
    return
  }
  parentNode.children[newKey] = newNode
  // Force reactivity
  treeData.value = { ...treeData.value }
  toast.success('已添加新节点')
}

function deleteNode(row) {
  // Find parent and remove
  function removeFromParent(node) {
    if (!node) return false
    for (const [key, val] of Object.entries(node)) {
      if (val === row._raw) {
        delete node[key]
        return true
      }
      if (val.children && removeFromParent(val.children)) return true
    }
    return false
  }
  // For top-level
  for (const [key, val] of Object.entries(treeData.value)) {
    if (val === row._raw) {
      delete treeData.value[key]
      treeData.value = { ...treeData.value }
      toast.success('已删除')
      return
    }
    if (val.children && removeFromParent(val.children)) {
      treeData.value = { ...treeData.value }
      toast.success('已删除')
      return
    }
  }
}

function addTopLevel() {
  const key = '99'
  treeData.value = { ...treeData.value, [key]: { name: '新大类', children: {} } }
  toast.success('已添加新大类')
}

async function saveAll() {
  try {
    await store.saveDeviceTypeTree(treeData.value)
    toast.success('资产类型已保存')
  } catch (e) {
    toast.error(e.message || '保存失败')
  }
}

onMounted(async () => {
  await store.loadAll()
  treeData.value = JSON.parse(JSON.stringify(store.deviceTypeTree || {}))
})
</script>

<template>
  <div class="flex-1 overflow-auto p-3">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">资产类型（三级编码）</h3>
      <div class="flex items-center gap-2">
        <el-input v-model="searchText" size="small" placeholder="搜索名称或编码" style="width: 200px" clearable />
        <el-button size="small" @click="addTopLevel">新增大类</el-button>
        <el-button type="primary" size="small" @click="saveAll">保存全部</el-button>
      </div>
    </div>

    <el-table
      v-if="!!Object.keys(treeData).length"
      :data="displayRows"
      size="small"
      stripe
      border
      row-key="id"
      max-height="calc(100vh - 240px)"
    >
      <el-table-column prop="name" label="名称" min-width="200">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id">
            <el-input v-model="editForm.name" size="small" class="w-full" />
          </template>
          <template v-else>
            <span class="inline-flex items-center">
              <span
                v-if="row.hasChildren && !searchText"
                class="inline-flex w-4 cursor-pointer select-none justify-center text-[#606266]"
                @click="toggleExpand(row)"
              >{{ expanded[row.id] ? '▾' : '▸' }}</span>
              <span v-else class="inline-flex w-4"></span>
              <span
                :style="{ paddingLeft: row.level * 16 + 'px' }"
                :class="{ 'font-semibold': row.level === 0, 'text-sm': row.level > 0 }"
              >{{ row.name }}</span>
            </span>
          </template>
        </template>
      </el-table-column>

      <el-table-column label="编码" width="120" align="center">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id && row.isLeaf">
            <el-input v-model="editForm.code" size="small" />
          </template>
          <template v-else>
            <el-tag :type="row.isLeaf ? 'success' : 'info'" size="small">{{ row.code }}</el-tag>
          </template>
        </template>
      </el-table-column>

      <el-table-column label="层级" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="levelTagType(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag>
        </template>
      </el-table-column>

      <el-table-column prop="remark" label="备注" width="100" align="center">
        <template #default="{ row }">
          <template v-if="editingRowId === row.id && row.isLeaf">
            <el-input v-model="editForm.remark" size="small" />
          </template>
          <template v-else>
            <span class="text-xs text-[#909399]">{{ row.remark || '—' }}</span>
          </template>
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
            <el-button link size="small" @click="addChild(row)" v-if="!row.isLeaf">添加子级</el-button>
            <el-popconfirm title="确定删除此节点及其所有子节点？" @confirm="deleteNode(row)">
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
        共 {{ countTreeRows(treeRows) }} 条记录（{{ Object.keys(treeData).length }} 个大类）
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
