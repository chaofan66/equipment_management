<script setup>
const props = defineProps({
  status: { type: String, default: '' },
  size: { type: String, default: 'small' }
})

const typeMap = {
  '正常': 'success', '在用': 'success', '使用中': 'success', '已验收': 'success',
  '已完成': 'success', '已签字': 'success', '通过': 'success', '已批准': 'success', '已归档': 'success',
  '待审批': 'warning', '待机': 'warning', '待确认': 'warning', '待签字': 'warning',
  '待提交': 'warning', '待验收': 'warning', '待审核': 'warning', '待归档': 'warning',
  '运行中': '', '维修中': 'primary', '保养中': '',
  '已驳回': 'danger', '驳回': 'danger', '已超期': 'danger',
  '报废': 'danger', '已报废': 'danger', '异常': 'danger', '停机': 'danger', '故障': 'danger',
  '闲置': 'info', '封存': 'info', '待报废': 'info', '已调动': 'info'
}

function getType() {
  return typeMap[props.status] || 'info'
}

const colorMap = {
  'primary': '#1192E8', 'success': '#67C23A', 'warning': '#E6A23C',
  'danger': '#F56C6C', 'info': '#909399'
}
</script>

<template>
  <el-tag :type="getType()" :size="size" disable-transitions>
    {{ status }}
  </el-tag>
</template>
