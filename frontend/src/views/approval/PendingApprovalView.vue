<script setup>
import { onMounted } from 'vue'
import { useApprovalStore } from '@/stores/approval'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import StatusTag from '@/components/common/StatusTag.vue'

const store = useApprovalStore()
const toast = useToast()
const modal = useModal()

onMounted(() => store.fetchPendingApprovals())

async function handleApprove(app) {
  try {
    await modal.confirm(`确定批准「${app.deviceName || ''}」的${app.type || '申请'}？`, { type: 'success' })
    await store.approve(app.id)
    toast.success('审批通过')
  } catch { /* cancelled */ }
}

async function handleReject(app) {
  try {
    await modal.confirm(`确定驳回「${app.deviceName || ''}」的${app.type || '申请'}？`, { type: 'warning' })
    await store.reject(app.id)
    toast.success('已驳回')
  } catch { /* cancelled */ }
}
</script>

<template>
  <div class="flex-1 overflow-auto p-3">
    <h3 class="text-sm font-semibold text-[#303133] mb-3">待我审批</h3>
    <el-table :data="store.pendingApprovals" size="small" stripe border empty-text="暂无待审批记录">
      <el-table-column prop="code" label="申请编号" width="140" show-overflow-tooltip>
        <template #default="{ row }"><span class="text-[#1192E8]">{{ row.code || row.id }}</span></template>
      </el-table-column>
      <el-table-column prop="type" label="申请类型" width="120" />
      <el-table-column prop="applicant" label="申请人" width="100" />
      <el-table-column prop="deviceName" label="设备名称" width="160" show-overflow-tooltip />
      <el-table-column prop="date" label="申请日期" width="120" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }"><StatusTag :status="row.status || '待审批'" /></template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button type="success" link size="small" @click="handleApprove(row)">通过</el-button>
          <el-button type="danger" link size="small" @click="handleReject(row)">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
