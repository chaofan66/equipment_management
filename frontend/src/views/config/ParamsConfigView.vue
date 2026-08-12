<script setup>
import { onMounted, ref } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useToast } from '@/composables/useToast'

const store = useConfigStore()
const toast = useToast()
const editParams = ref({})

onMounted(async () => {
  await store.fetchParams()
  editParams.value = { ...store.params }
})

const PARAM_LABELS = {
  assetUnitId: '资产单元ID',
  defaultOwnershipUnit: '默认所属单位',
  defaultManageDept: '默认管理部门',
  defaultManageDeptCode: '默认管理部门编码',
  suppliers: '供应商列表'
}

function paramLabel(key) {
  return PARAM_LABELS[key] || key
}

async function saveParams() {
  try {
    await store.updateParams(editParams.value)
    toast.success('参数保存成功')
  } catch (e) {
    toast.error(e.message || '保存失败')
  }
}
</script>

<template>
  <div class="flex-1 overflow-auto p-3">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">业务参数</h3>
      <el-button type="primary" size="small" @click="saveParams">保存</el-button>
    </div>
    <div v-if="!store.params" class="text-center py-8 text-[#909399]">暂无业务参数配置</div>
    <el-form v-else label-width="160px" class="max-w-[600px]">
      <el-form-item v-for="(value, key) in editParams" :key="key" :label="paramLabel(key)" size="small">
        <el-input v-model="editParams[key]" :placeholder="String(value)" />
      </el-form-item>
    </el-form>
  </div>
</template>
