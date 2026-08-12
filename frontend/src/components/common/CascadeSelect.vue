<script setup>
import { ref, watch, computed } from 'vue'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  // modelValue: { da: '', zhong: '', xiao: '' }
  levels: { type: Array, required: true },
  // levels: [{ key: 'da', label: '请选择大类', options: [{value, label, children}] }, ...]
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'small' }
})

const emit = defineEmits(['update:modelValue', 'change'])

const selected = ref({ ...props.modelValue })
watch(() => props.modelValue, (val) => { selected.value = { ...val } }, { deep: true })

const levelOptions = computed(() => {
  return props.levels.map((level, i) => {
    if (i === 0) return level.options || []
    // Walk from level 0 through all previous selections to find this level's options
    let options = props.levels[0].options || []
    for (let j = 0; j < i; j++) {
      const parentKey = props.levels[j].key
      const parentVal = selected.value[parentKey]
      if (!parentVal) return []
      const parentOption = options.find(o => o.value === parentVal)
      if (!parentOption) return []
      options = parentOption.children || []
    }
    return options
  })
})

function isLevelDisabled(index) {
  if (props.disabled) return true
  if (index === 0) return false
  const parentKey = props.levels[index - 1]?.key
  return !selected.value[parentKey]
}

function onSelectChange(index, value) {
  const key = props.levels[index].key
  selected.value = { ...selected.value, [key]: value }
  for (let i = index + 1; i < props.levels.length; i++) {
    selected.value[props.levels[i].key] = ''
  }
  emit('update:modelValue', { ...selected.value })
  emit('change', { ...selected.value })
}
</script>

<template>
  <div class="flex gap-1 flex-1">
    <el-select
      v-for="(level, i) in levels"
      :key="level.key"
      :model-value="selected[level.key] || ''"
      :placeholder="level.label"
      :disabled="isLevelDisabled(i)"
      :size="size"
      class="flex-1"
      @change="(val) => onSelectChange(i, val)"
    >
      <el-option
        v-for="opt in levelOptions[i]"
        :key="opt.value"
        :label="opt.label"
        :value="opt.value"
      />
    </el-select>
  </div>
</template>
