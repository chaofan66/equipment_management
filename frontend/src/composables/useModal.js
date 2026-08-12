import { ElMessageBox } from 'element-plus'

export function useModal() {
  function confirm(message, options = {}) {
    return ElMessageBox.confirm(message, options.title || '提示', {
      confirmButtonText: options.confirmText || '确定',
      cancelButtonText: options.cancelText || '取消',
      type: options.type || 'warning'
    })
  }

  function alert(message, options = {}) {
    return ElMessageBox.alert(message, options.title || '提示', {
      confirmButtonText: options.confirmText || '确定',
      type: options.type || 'info'
    })
  }

  return { confirm, alert }
}
