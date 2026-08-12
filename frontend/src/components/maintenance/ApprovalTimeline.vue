<script setup>
import { computed } from 'vue'

// 审批弹框「操作记录」模块（V2 双 Tab 改造）：时间线展示各审批步的操作记录
// 每条 done 步：步骤名 + 通过标签 + 操作人（姓名·工号·职务）+ 意见 + 时间
// 未完成步 → 待处理节点；rejectLog/rescheduleLog/splitLog → danger/warning 节点
const props = defineProps({
  steps: { type: Array, default: () => [] },      // [{ seq, name, status, signatures: [] }]
  rejectLog: { type: Array, default: () => [] },  // [{ from, to, reason, by, date }]
  rescheduleLog: { type: Array, default: () => [] }, // [{ from, to, reason, by, date }]
  splitLog: { type: Array, default: () => [] },   // [{ reason }]
})

const doneSteps = computed(() => (props.steps || []).filter(s => s.status === 'done'))
const pending = computed(() => (props.steps || []).find(s => s.status !== 'done'))
const hasRecords = computed(() =>
  doneSteps.value.length || pending.value ||
  (props.rejectLog || []).length || (props.rescheduleLog || []).length || (props.splitLog || []).length
)
const fmtDate = d => (d || '').replace('T', ' ').substring(0, 16) || '—'
const fmtOpinions = sgs => (sgs || []).map(x => [x.shift, x.note].filter(Boolean).join(' · ')).filter(Boolean).join('；') || '—'
</script>

<template>
  <div class="text-xs">
    <div class="flex items-center gap-1 mb-3">
      <span class="inline-block w-[2px] h-3 bg-[#1192E8] rounded"></span>
      <span class="text-sm font-semibold text-[#303133]">操作记录</span>
    </div>
    <el-timeline v-if="hasRecords">
      <!-- 已提交步骤：通过 -->
      <el-timeline-item v-for="s in doneSteps" :key="s.seq" type="success" :timestamp="fmtDate(s.signatures?.[0]?.date)">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-semibold text-[#303133]">第{{ s.seq }}步 {{ s.name }}</span>
          <el-tag size="small" type="success">通过</el-tag>
        </div>
        <div v-for="(sg, i) in s.signatures || []" :key="i" class="leading-5">
          <span class="font-medium text-[#303133]">{{ sg.name }}</span>
          <span class="text-[#606266]">（{{ sg.employeeId || '—' }} · {{ sg.roleName || '—' }}）</span>
        </div>
        <div v-if="!s.signatures?.length" class="text-[#909399]">操作人：—</div>
        <div class="text-[#909399] mt-0.5">意见：{{ fmtOpinions(s.signatures) }}</div>
      </el-timeline-item>

      <!-- 当前未完成步：待处理 -->
      <el-timeline-item v-if="pending" type="info" timestamp="待处理">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-[#303133]">第{{ pending.seq }}步 {{ pending.name }}</span>
          <el-tag size="small" type="info">待处理</el-tag>
        </div>
        <div class="text-[#909399] mt-0.5">等待相应人员操作</div>
      </el-timeline-item>

      <!-- 驳回记录 -->
      <el-timeline-item v-for="(r, i) in rejectLog || []" :key="'rj' + i" type="danger" :timestamp="fmtDate(r.date)">
        <div class="font-semibold text-[#F56C6C] mb-0.5">驳回：第{{ r.from }}步 → 第{{ r.to }}步</div>
        <div class="text-[#606266]">{{ r.reason || '—' }}</div>
        <div class="text-[#909399]">退回人：{{ r.by || '—' }}</div>
      </el-timeline-item>

      <!-- 改期记录 -->
      <el-timeline-item v-for="(r, i) in rescheduleLog || []" :key="'rs' + i" type="warning" :timestamp="fmtDate(r.date)">
        <div class="font-semibold text-[#E6A23C] mb-0.5">改期：{{ r.from }} → {{ r.to }}</div>
        <div class="text-[#606266]">{{ r.reason || '—' }} · {{ r.by || '—' }}</div>
      </el-timeline-item>

      <!-- 拆分记录 -->
      <el-timeline-item v-for="(r, i) in splitLog || []" :key="'sp' + i" type="warning">
        <div class="text-[#E6A23C]">{{ r.reason }}</div>
      </el-timeline-item>
    </el-timeline>
    <div v-else class="text-[#909399] text-center py-8">暂无操作记录</div>
  </div>
</template>
