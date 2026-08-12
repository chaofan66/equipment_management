<script setup>
import SubTabs from '@/components/common/SubTabs.vue'

const tabs = [
  { key: 'my-applications', label: '我的申请', route: '/approval/my-applications' },
  { key: 'pending', label: '待我审批', route: '/approval/pending' }
]
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <SubTabs :tabs="tabs" />
    <div class="flex-1 flex flex-col min-h-0">
      <router-view />
    </div>
  </div>
</template>
