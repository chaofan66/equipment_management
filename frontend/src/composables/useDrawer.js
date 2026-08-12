import { ref, shallowRef } from 'vue'
import { ElMessageBox } from 'element-plus'

const drawerVisible = ref(false)
const drawerComponent = shallowRef(null)
const drawerProps = ref({})
const drawerTitle = ref('')
const drawerSize = ref('960px')

export function useDrawer() {
  function open(component, props = {}, options = {}) {
    drawerComponent.value = component
    drawerProps.value = props
    drawerTitle.value = options.title || ''
    drawerSize.value = options.size || '960px'
    drawerVisible.value = true
  }

  function close() {
    drawerVisible.value = false
  }

  function beforeClose(done) {
    ElMessageBox.confirm('有未保存的修改，确定关闭？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(() => {
      close()
      done()
    }).catch(() => {
      // stay open
    })
  }

  function updateTitle(title) {
    drawerTitle.value = title
  }

  return { drawerVisible, drawerComponent, drawerProps, drawerTitle, drawerSize, open, close, beforeClose, updateTitle }
}
