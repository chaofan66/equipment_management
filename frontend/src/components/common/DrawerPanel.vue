<script setup>
import { useDrawer } from '@/composables/useDrawer'
const { drawerVisible, drawerComponent, drawerProps, drawerTitle, drawerSize, close } = useDrawer()
</script>

<template>
  <el-drawer
    v-model="drawerVisible"
    :title="drawerTitle"
    :size="drawerSize"
    direction="rtl"
    @close="close"
  >
    <component v-if="drawerComponent" :is="drawerComponent" v-bind="drawerProps" />
  </el-drawer>
</template>
