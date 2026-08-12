<script setup>
import { onMounted } from 'vue'
import { useApprovalStore } from '@/stores/approval'
import StatusTag from '@/components/common/StatusTag.vue'

const store = useApprovalStore()

onMounted(() => store.fetchMyApplications())

const columns = [
  { key: 'code', label: '申请编号', width: '140' },
  { key: 'type', label: '申请类型', width: '120' },
  { key: 'deviceName', label: '设备名称', width: '160' },
  { key: 'date', label: '申请日期', width: '120' },
  { key: 'status', label: '状态', width: '100' }
]
</script>

<template>
  <div class="flex-1 overflow-auto p-3">
    <h3 class="text-sm font-semibold text-[#303133] mb-3">我的申请</h3>
    <el-table :data="store.myApplications" size="small" stripe border empty-text="暂无申请记录">
      <el-table-column v-for="c in columns" :key="c.key" :prop="c.key" :label="c.label" :width="c.width" show-overflow-tooltip>
        <template v-if="c.key === 'code'" #default="{ row }">
          <span class="text-[#1192E8]">{{ row.code || row.id }}</span>
        </template>
        <template v-if="c.key === 'status'" #default="{ row }">
          <StatusTag :status="row.status || '待审批'" />
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
