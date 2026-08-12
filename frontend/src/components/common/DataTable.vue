<script setup>
const props = defineProps({
  columns: { type: Array, required: true },
  // columns: [{ key: 'name', label: '名称', width: '200', fixed: 'left', sortable: true }]
  data: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  pagination: { type: Object, default: null },
  // pagination: { page: 1, pageSize: 15, total: 0 }
  rowKey: { type: String, default: 'id' },
  stripe: { type: Boolean, default: true },
  border: { type: Boolean, default: true },
  size: { type: String, default: 'small' },
  height: { type: String, default: undefined }
})

const emit = defineEmits(['row-click', 'page-change', 'size-change', 'sort-change', 'selection-change'])

function onRowClick(row) {
  emit('row-click', row)
}

function onPageChange(page) {
  emit('page-change', page)
}

function onSizeChange(size) {
  emit('size-change', size)
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <el-table
      :data="data"
      :stripe="stripe"
      :border="border"
      :size="size"
      :height="height"
      :row-key="rowKey"
      :loading="loading"
      :default-sort="{ prop: '', order: 'ascending' }"
      highlight-current-row
      @row-click="onRowClick"
      @sort-change="emit('sort-change', $event)"
      @selection-change="emit('selection-change', $event)"
      empty-text="暂无数据"
      element-loading-text="加载中..."
    >
      <template v-for="col in columns" :key="col.key || col.label">
        <!-- Group column with nested children (double-layer header) -->
        <el-table-column
          v-if="col.children && col.children.length"
          :label="col.label"
          :fixed="col.fixed"
          :align="col.align || 'center'"
          header-align="center"
          :class-name="col.className || 'group-header-col'"
        >
          <el-table-column
            v-for="child in col.children"
            :key="child.key"
            :type="child.type"
            :prop="child.key"
            :label="child.label"
            :width="child.width"
            :min-width="child.minWidth"
            :align="child.align || 'left'"
            :sortable="child.sortable ? 'custom' : false"
            :show-overflow-tooltip="true"
            :class-name="col.className"
          >
            <template v-if="child.type !== 'selection'" #default="{ row }">
              <slot :name="`cell-${child.key}`" :row="row" :value="row[child.key]">
                {{ row[child.key] }}
              </slot>
            </template>
          </el-table-column>
        </el-table-column>

        <!-- Regular flat column -->
        <el-table-column
          v-else
          :type="col.type"
          :prop="col.key"
          :label="col.label"
          :width="col.width"
          :min-width="col.minWidth"
          :fixed="col.fixed"
          :align="col.align || 'left'"
          :sortable="col.sortable ? 'custom' : false"
          :show-overflow-tooltip="true"
        >
          <template v-if="col.type !== 'selection' && col.type !== 'index'" #default="{ row }">
            <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
              {{ row[col.key] }}
            </slot>
          </template>
        </el-table-column>
      </template>
    </el-table>

    <div v-if="pagination" class="flex items-center justify-between px-4 py-2 shrink-0">
      <span class="text-xs text-[#909399]">共 {{ pagination.total }} 条</span>
      <el-pagination
        :current-page="pagination.page"
        :page-size="pagination.pageSize || 50"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        size="small"
        background
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>
  </div>
</template>

<style scoped>
:deep(.group-header-col > .cell) {
  font-weight: 700;
  font-size: 13px;
  color: #1a1a1a;
  background: #f5f7fa;
}
</style>
