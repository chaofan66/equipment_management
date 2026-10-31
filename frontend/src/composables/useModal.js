import { ElMessageBox } from 'element-plus'

export function useModal() {
  function confirm(message, options = {}) {
    const { title, confirmText, cancelText, type, ...rest } = options
    return ElMessageBox.confirm(message, title || '提示', {
      confirmButtonText: confirmText || '确定',
      cancelButtonText: cancelText || '取消',
      type: type || 'warning',
      ...rest,
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
