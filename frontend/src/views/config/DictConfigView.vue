<script setup>
import { ref, onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useToast } from '@/composables/useToast'

const store = useDictStore()
const toast = useToast()
const selectedCategory = ref('')
const selectedLabel = ref('')
const editItems = ref([])

async function selectCategory(name) {
  selectedCategory.value = name
  const cat = store.categories.find(c => c.name === name)
  selectedLabel.value = cat ? cat.label : name
  const data = await store.loadCategory(name)
  editItems.value = JSON.parse(JSON.stringify(Array.isArray(data) ? data : []))
}

async function saveCategory() {
  if (!selectedCategory.value) return
  try {
    await store.saveCategory(selectedCategory.value, editItems.value)
    toast.success('保存成功')
  } catch (e) {
    toast.error(e.message || '保存失败')
  }
}

onMounted(() => store.loadAll())
</script>

<template>
  <div class="flex flex-1 min-h-0">
    <div class="w-[200px] border-r border-[#dcdfe6] overflow-auto shrink-0">
      <el-menu :default-active="selectedCategory" @select="selectCategory">
        <el-menu-item v-for="cat in store.categories" :key="cat.name" :index="cat.name">
          <span class="text-xs">{{ cat.label }}</span>
          <el-tag size="small" class="ml-auto">{{ cat.count }}</el-tag>
        </el-menu-item>
      </el-menu>
    </div>
    <div class="flex-1 overflow-auto p-3">
      <div v-if="!selectedCategory" class="text-center py-8 text-[#909399]">请从左侧选择字典分类</div>
      <template v-else>
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold">{{ selectedLabel }}</h3>
          <el-button type="primary" size="small" @click="saveCategory">保存</el-button>
        </div>
        <el-table v-if="editItems.length" :data="editItems" size="small" stripe border>
          <el-table-column label="值" width="200">
            <template #default="{ row, $index }">
              <el-input v-if="typeof row === 'object'" v-model="row.value" size="small" />
              <el-input v-else v-model="editItems[$index]" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="标签">
            <template #default="{ row }">
              <el-input v-if="typeof row === 'object'" v-model="row.label" size="small" />
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="text-center py-8 text-[#909399]">该分类无条目</div>
      </template>
    </div>
  </div>
</template>
