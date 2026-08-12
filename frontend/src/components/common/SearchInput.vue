<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '搜索...' },
  clearable: { type: Boolean, default: true }
})

const emit = defineEmits(['update:modelValue', 'search'])

const keyword = ref(props.modelValue)
watch(() => props.modelValue, (val) => { keyword.value = val })

function onSearch() {
  emit('update:modelValue', keyword.value)
  emit('search', keyword.value)
}

function onClear() {
  keyword.value = ''
  emit('update:modelValue', '')
  emit('search', '')
}
</script>

<template>
  <el-input
    v-model="keyword"
    :placeholder="placeholder"
    :clearable="clearable"
    style="width: 220px"
    size="small"
    @keyup.enter="onSearch"
    @clear="onClear"
  >
    <template #append>
      <el-button :icon="'Search'" size="small" @click="onSearch" />
    </template>
  </el-input>
</template>
