import { ElMessage } from 'element-plus'

export function useToast() {
  function success(message, duration = 3000) {
    ElMessage({ message, type: 'success', duration, showClose: true })
  }
  function error(message, duration = 5000) {
    ElMessage({ message, type: 'error', duration, showClose: true })
  }
  function info(message, duration = 3000) {
    ElMessage({ message, type: 'info', duration, showClose: true })
  }
  function warning(message, duration = 4000) {
    ElMessage({ message, type: 'warning', duration, showClose: true })
  }
  return { success, error, info, warning }
}
