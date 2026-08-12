<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useDictStore } from '@/stores/dict'
import { useMaintenanceStore } from '@/stores/maintenance'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import DataTable from '@/components/common/DataTable.vue'
import StatusTag from '@/components/common/StatusTag.vue'
import { fetchSuppliers } from '@/api/devices'

const route = useRoute()
const devicesStore = useDevicesStore()
const dictStore = useDictStore()
const maintenanceStore = useMaintenanceStore()
const toast = useToast()
const modal = useModal()

	
	// Columns grouped into 6 categories matching Excel (设备台账-1615-试验版.xlsx)
	const columns = [
	  { type: 'index', key: 'index', label: '序号', width: '55', align: 'center', fixed: 'left' },
	  { key: 'code', label: '资产编码', width: '150', fixed: 'left' },
	  { label: '基本信息', children: [
	    { key: 'name', label: '资产名称', width: '140' },
	    { key: 'spec', label: '规格/型号', width: '120' },
	    { key: 'typeCode', label: '资产类别编码', width: '110' },
	    { key: 'type', label: '资产类别', width: '120' },
	    { key: 'assetCategory', label: '资产分类', width: '80', align: 'center' },
	    { key: 'qty', label: '数量', width: '60', align: 'center' },
	    { key: 'unit', label: '计量单位', width: '80' },
	    { key: 'status', label: '资产状况', width: '90' }
	  ]},
	  { label: '配置信息', children: [
	    { key: 'acquisitionMethod', label: '取得方式', width: '90' },
	    { key: 'purchaseDate', label: '投用日期', width: '100' },
	    { key: 'supplier', label: '供应商', width: '130' },
	    { key: 'contractNo', label: '合同编号', width: '130' },
	    { key: 'valueType', label: '价值类型', width: '90' },
	    { key: 'value', label: '资产原值', width: '110', align: 'right' }
	  ]},
	  { label: '财务信息', children: [
	    { key: 'bookingStatus', label: '入账状态', width: '90' },
	    { key: 'depreciationStatus', label: '折旧状态', width: '90' },
	    { key: 'depreciationMethod', label: '折旧方法', width: '100' },
	    { key: 'useMonths', label: '使用月限', width: '80', align: 'center' },
	    { key: 'accrualMonths', label: '计提月份', width: '80', align: 'center' },
	    { key: 'netValue', label: '资产净值', width: '110', align: 'right' },
	    { key: 'bookingDate', label: '入账日期', width: '100' },
	    { key: 'voucherNo', label: '记账凭证号', width: '130' }
	  ]},
	  { label: '归属信息', children: [
	    { key: 'ownershipUnit', label: '归属单位', width: '200' },
	    { key: 'manageDeptCode', label: '管理部门编码', width: '110' },
	    { key: 'manageDept', label: '管理部门', width: '120' },
	    { key: 'useDeptCode', label: '使用部门编码', width: '110' },
	    { key: 'department', label: '使用部门', width: '110' },
	    { key: 'person', label: '使用人', width: '90' },
	    { key: 'area', label: '存放地点', width: '150' },
	    { key: 'manageNo', label: '管理编号', width: '130' }
	  ]},
	  { label: '附属信息', children: [
	    { key: 'factoryNo', label: '出厂编号', width: '130' },
	    { key: 'projectNo', label: '项目号', width: '130' },
	    { key: 'remark', label: '备注', width: '150' }
	  ]},
	  { key: 'actions', label: '操作', width: '160', fixed: 'right' }
	];

const codeFilter = ref('')
const statusFilter = ref('')
const typeFilter = ref('')
const supplierFilter = ref('')
const supplierOptions = ref([])
const statusOptions = ['在用', '闲置', '维修中', '保养中', '报废', '封存']

// Drawer state
const drawerVisible = ref(false)
const drawerMode = ref('view') // 'create' | 'edit' | 'view'
const currentDevice = ref(null)

// Maintenance history drawer
const mtDrawerVisible = ref(false)
const mtRecords = ref([])

// Edit form
const editForm = reactive({})

// El-Cascader model values (arrays of selected path values)
const assetTypeSelected = ref([])
const deptWorkshopSelected = ref([])

// Asset type options for el-cascader (3-level tree)
const assetTypeOptions = computed(() => {
  const tree = dictStore.deviceTypeTree || {}
  return Object.entries(tree).map(([code, node]) => ({
    value: code,
    label: `${code} ${node.name}`,
    children: Object.entries(node.children || {}).map(([mcode, mnode]) => ({
      value: mcode,
      label: `${code}${mcode} ${mnode.name}`,
      children: Object.entries(mnode.children || {}).map(([scode, snode]) => ({
        value: scode,
        label: `${snode.code} ${snode.name}`
      }))
    }))
  }))
})

// Dept-workshop options for el-cascader (2-level tree)
const deptWorkshopOptions = computed(() => {
  const tree = dictStore.deptWorkshopTree || {}
  return Object.entries(tree).map(([deptName, info]) => ({
    value: info.code,
    label: `${info.code} ${deptName}`,
    children: Object.entries(info.workshops || {}).map(([wcode, winfo]) => ({
      value: winfo.code,
      label: `${winfo.code} ${winfo.name}`
    }))
  }))
})

// Handle asset type cascade change (values: ['00', '01', '01'])
function handleAssetTypeChange(values) {
  if (!values || values.length < 3) {
    editForm.type = ''
    editForm.typeCode = ''
    return
  }
  const [major, mid, minor] = values
  const leaf = dictStore.deviceTypeTree[major]?.children?.[mid]?.children?.[minor]
  if (leaf) {
    editForm.type = leaf.name
    editForm.typeCode = leaf.code
    generateCodePreview()
  }
}

// Handle dept/workshop cascade change (values: ['1000', '1001'])
function handleDeptWorkshopChange(values) {
  if (!values || values.length === 0) {
    editForm.department = ''
    editForm.area = ''
    editForm.useDeptCode = ''
    return
  }
  const [deptCode, wsCode] = values
  editForm.useDeptCode = deptCode || ''
  // Find dept info from tree
  const tree = dictStore.deptWorkshopTree || {}
  for (const [name, info] of Object.entries(tree)) {
    if (info.code === deptCode) {
      editForm.department = name
      if (wsCode && info.workshops) {
        const ws = info.workshops[wsCode]
        editForm.area = ws?.name || ''
      } else {
        editForm.area = ''
      }
      break
    }
  }
  generateCodePreview()
}

// Backfill cascade selectors from existing editForm data (for edit mode)
function backfillCascadeSelectors() {
  // Asset type: from typeCode like "020105" → ['02', '01', '05']
  if (editForm.typeCode && editForm.typeCode.length >= 6) {
    const tc = editForm.typeCode
    assetTypeSelected.value = [tc.substring(0, 2), tc.substring(2, 4), tc.substring(4, 6)]
  } else {
    assetTypeSelected.value = []
  }
  // Dept/workshop: look up codes from deptWorkshopTree
  const tree = dictStore.deptWorkshopTree || {}
  const result = []
  for (const [deptName, info] of Object.entries(tree)) {
    if (deptName === editForm.department) {
      result.push(info.code)
      for (const [code, ws] of Object.entries(info.workshops || {})) {
        if (ws.name === editForm.area) {
          result.push(code)
          break
        }
      }
      break
    }
  }
  deptWorkshopSelected.value = result
}

function formatMoney(val) {
  if (val === null || val === undefined || val === '') return ''
  return Number(val).toLocaleString('zh-CN')
}

// Search
async function doSearch() {
  devicesStore.setFilters({
    code: codeFilter.value,
    status: statusFilter.value,
    type: typeFilter.value,
    supplier: supplierFilter.value
  })
  await devicesStore.fetchList()
}

function resetFilters() {
  codeFilter.value = ''
  statusFilter.value = ''
  typeFilter.value = ''
  supplierFilter.value = ''
  doSearch()
}

function onPageChange(page) {
  devicesStore.setPage(page)
  devicesStore.fetchList()
}

function onSizeChange(size) {
  devicesStore.setPageSize(size)
  devicesStore.fetchList()
}

// Open create drawer
function openCreate() {
  drawerMode.value = 'create'
  currentDevice.value = null
  Object.keys(editForm).forEach(k => delete editForm[k])
  // Defaults
  editForm.ownershipUnit = '恒力造船（大连）有限公司'
  editForm.manageDept = '生产保障部'
  editForm.qty = 1
  editForm.unit = '台'
  editForm.assetCategory = 'B'
  editForm.acquisitionMethod = '采购'
  editForm.valueType = '原值'
  editForm.useMonths = 120
  editForm.depreciationMethod = '年限平均法'
  editForm.status = '在用'
  editForm.bookingStatus = '已入账'
  editForm.depreciationStatus = '正常计提'
  assetTypeSelected.value = []
  deptWorkshopSelected.value = []
  drawerVisible.value = true
}

// Open edit/view drawer
function openEdit(row) {
  drawerMode.value = 'edit'
  currentDevice.value = row
  Object.assign(editForm, JSON.parse(JSON.stringify(row)))
  backfillCascadeSelectors()
  drawerVisible.value = true
}

// Save device
async function saveDevice() {
  try {
    if (drawerMode.value === 'create') {
      await devicesStore.create(editForm)
      toast.success('设备创建成功')
    } else {
      await devicesStore.update(currentDevice.value.id, editForm)
      toast.success('设备更新成功')
    }
    drawerVisible.value = false
  } catch (e) {
    toast.error(e.message || '保存失败')
  }
}

// Delete device with validation
async function deleteDevice(row) {
  try {
    // Check maintenance records
    const records = await maintenanceStore.fetchRecords({ deviceId: row.id })
    if (records && records.length > 0) {
      toast.warning(`该设备关联 ${records.length} 条维保记录，不可删除`)
      return
    }
    await modal.confirm(`确定删除设备「${row.name}（${row.code}）」？此操作不可恢复。`, { type: 'warning' })
    await devicesStore.remove(row.id)
    toast.success('设备已删除')
  } catch (e) {
    if (e !== 'cancel') toast.error(e.message || '删除失败')
  }
}

// Open maintenance history drawer
async function openMaintenanceHistory(row) {
  mtRecords.value = await maintenanceStore.fetchRecords({ deviceId: row.id })
  mtDrawerVisible.value = true
}

// Download template
  function downloadTemplate() {
  // Flatten grouped columns for CSV header
  const flatCols = []
  for (const col of columns) {
    if (col.children) { flatCols.push(...col.children) }
    else if (col.key !== "actions") { flatCols.push(col) }
  }
  const headers = flatCols.filter(c => c.key !== "index").map(c => c.label).join(",")
  const blob = new Blob(['﻿' + headers + '\n'], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '设备台账导入模板.csv'; a.click()
  URL.revokeObjectURL(url)
  toast.success('模板下载成功')
}

// Generate asset code preview
function generateCodePreview() {
  if (editForm.typeCode && editForm.department) {
    devicesStore.generateCode({
      typeCode: editForm.typeCode,
      workshop: editForm.area || editForm.workshop || '',
      dept: editForm.department
    }).then(res => { if (res) editForm.code = res })
  }
}

onMounted(async () => {
  await Promise.all([dictStore.loadAll(), devicesStore.fetchList()])
  // Load supplier options
  try {
    const res = await fetchSuppliers()
    supplierOptions.value = res.data || []
  } catch (e) { /* ignore */ }
  if (route.query.type) {
    typeFilter.value = route.query.type
    doSearch()
  }
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Filter Toolbar -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-[#dcdfe6] bg-white shrink-0 flex-wrap">
      <el-select v-model="typeFilter" placeholder="资产编码" size="small" style="width: 160px" clearable>
        <el-option v-for="(node, code) in dictStore.deviceTypeTree" :key="code" :label="`${code} ${node.name}`" :value="code" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部状态" size="small" style="width: 110px" clearable>
        <el-option v-for="s in statusOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="supplierFilter" placeholder="供应商" size="small" style="width: 160px" clearable>
        <el-option v-for="s in supplierOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <el-button type="primary" size="small" @click="doSearch">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
      <div class="flex-1" />
      <el-button size="small" @click="downloadTemplate">下载模板</el-button>
      <el-button type="primary" size="small" @click="openCreate">新增设备</el-button>
    </div>

    <!-- Data Table -->
    <DataTable
      :columns="columns"
      :data="devicesStore.list"
      :loading="devicesStore.loading"
      :pagination="devicesStore.pagination"
	      :stripe="false"
      @page-change="onPageChange"
      @size-change="onSizeChange"
    >
      <template #cell-code="{ value, row }">
        <span class="text-[#1192E8] cursor-pointer" @click="openEdit(row)">{{ value }}</span>
      </template>
      <template #cell-status="{ value }">
        <StatusTag :status="value" />
      </template>
      <template #cell-bookingStatus="{ value }">
        <StatusTag :status="value" />
      </template>
      <template #cell-depreciationStatus="{ value }">
        <StatusTag :status="value" />
      </template>
      <template #cell-value="{ value }">
        <span>{{ formatMoney(value) }}</span>
      </template>
      <template #cell-netValue="{ value }">
        <span>{{ formatMoney(value) }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center gap-1 pr-2">
          <el-button type="primary" link size="small" @click.stop="openEdit(row)">编辑</el-button>
          <el-button type="primary" link size="small" @click.stop="openMaintenanceHistory(row)">维保</el-button>
          <el-button type="danger" link size="small" @click.stop="deleteDevice(row)">删除</el-button>
        </div>
      </template>
    </DataTable>

    <!-- Edit/Create Drawer -->
    <el-drawer v-model="drawerVisible" :title="drawerMode === 'create' ? '新增设备' : '编辑设备'" size="800px">
      <el-form label-width="110px" size="small">
        <!-- 基本信息 -->
        <div class="section-title">基本信息</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="资产编码">
              <el-input :model-value="editForm.code" disabled placeholder="系统自动生成" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="资产名称" required>
              <el-input v-model="editForm.name" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="规格/型号">
              <el-input v-model="editForm.spec" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="资产类别" required>
              <el-cascader
                v-model="assetTypeSelected"
                :options="assetTypeOptions"
                :props="{ expandTrigger: 'hover' }"
                placeholder="请选择大类→中类→小类"
                clearable
                style="width:100%"
                @change="handleAssetTypeChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="类别编码">
              <el-input :model-value="editForm.typeCode" disabled placeholder="选择类别后自动填入" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="数量">
              <el-input-number v-model="editForm.qty" :min="1" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="单位">
              <el-input v-model="editForm.unit" />
            </el-form-item>
          </el-col>
          <el-col :span="4">
            <el-form-item label="资产分类">
              <el-input v-model="editForm.assetCategory" placeholder="如A/B/C" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="资产状况" required>
              <el-select v-model="editForm.status" style="width:100%">
                <el-option v-for="s in statusOptions" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 配置信息 -->
        <div class="section-title">配置信息</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="取得方式">
              <el-input v-model="editForm.acquisitionMethod" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="投用日期" required>
              <el-input v-model="editForm.purchaseDate" type="date" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="供应商">
              <el-input v-model="editForm.supplier" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="合同编号">
              <el-input v-model="editForm.contractNo" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="价值类型">
              <el-input v-model="editForm.valueType" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="资产原值">
              <el-input-number v-model="editForm.value" :min="0" :precision="2" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 财务信息 -->
        <div class="section-title">财务信息</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="入账状态">
              <el-select v-model="editForm.bookingStatus" style="width:100%">
                <el-option v-for="s in ['已入账','未入账','部分入账']" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="折旧状态">
              <el-select v-model="editForm.depreciationStatus" style="width:100%">
                <el-option v-for="s in ['正常计提','已提足','未开始','暂停计提']" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="折旧方法">
              <el-select v-model="editForm.depreciationMethod" style="width:100%">
                <el-option v-for="s in ['年限平均法','工作量法','双倍余额递减法','年数总和法']" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="使用月限">
              <el-input-number v-model="editForm.useMonths" :min="1" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="计提月份">
              <el-input-number v-model="editForm.accrualMonths" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="资产净值">
              <el-input :model-value="formatMoney(editForm.netValue)" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="入账日期">
              <el-input v-model="editForm.bookingDate" type="date" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="记账凭证号">
              <el-input v-model="editForm.voucherNo" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 归属信息 -->
        <div class="section-title">归属信息</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="归属单位">
              <el-input v-model="editForm.ownershipUnit" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="管理部门编码">
              <el-input v-model="editForm.manageDeptCode" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="管理部门">
              <el-input v-model="editForm.manageDept" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="使用部门编码">
              <el-input v-model="editForm.useDeptCode" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="使用部门/车间" required>
              <el-cascader
                v-model="deptWorkshopSelected"
                :options="deptWorkshopOptions"
                :props="{ expandTrigger: 'hover' }"
                placeholder="请选择部门→车间"
                clearable
                style="width:100%"
                @change="handleDeptWorkshopChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="使用人" required>
              <el-input v-model="editForm.person" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="存放地点">
              <el-input :model-value="editForm.area" disabled placeholder="选择部门后自动填入" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="管理编号">
              <el-input v-model="editForm.manageNo" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 附属信息 -->
        <div class="section-title">附属信息</div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="出厂编号">
              <el-input v-model="editForm.factoryNo" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="项目号">
              <el-input v-model="editForm.projectNo" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="备注">
              <el-input v-model="editForm.remark" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDevice">保存</el-button>
      </template>
    </el-drawer>

    <!-- Maintenance History Drawer -->
    <el-drawer v-model="mtDrawerVisible" title="维保记录" size="600px">
      <el-table :data="mtRecords" size="small" stripe border empty-text="该设备暂无维保记录">
        <el-table-column prop="id" label="记录编号" width="130" />
        <el-table-column label="维保日期" width="140">
          <template #default="{ row }">{{ row.arriveTime || row.checkDate || row.createdAt }}</template>
        </el-table-column>
        <el-table-column prop="mtType" label="维保类型" width="90" />
        <el-table-column prop="mtPerson" label="维保人员" min-width="140" show-overflow-tooltip />
        <el-table-column label="摘要" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.faultAnalysis || row.checkRecord || '').substring(0, 50) }}</template>
        </el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  padding: 8px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
  border-left: 3px solid #1192E8;
  padding-left: 8px;
}

</style>
