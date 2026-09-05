import axios from 'axios'
import client from './client'

// Dashboard（V1.42：维保总览聚合，全部读 V2 generatedPlans）
export function fetchDashboardOverview(params = {}) {
  return client.get('/maintenance/dashboard/overview', { params })
}

// Plans
export function fetchPlans(params = {}) {
  return client.get('/maintenance/plans', { params })
}

export function fetchPlan(id) {
  return client.get(`/maintenance/plans/${id}`)
}

export function createPlan(data) {
  return client.post('/maintenance/plans', data)
}

export function updatePlan(id, data) {
  return client.put(`/maintenance/plans/${id}`, data)
}

export function deletePlan(id) {
  return client.delete(`/maintenance/plans/${id}`)
}

export function updatePlanStatus(id, data) {
  return client.put(`/maintenance/plans/${id}/status`, data)
}

// Records
export function fetchRecords(params = {}) {
  return client.get('/maintenance/records', { params })
}

export function fetchRecord(id) {
  return client.get(`/maintenance/records/${id}`)
}

export function createRecord(data) {
  return client.post('/maintenance/records', data)
}

// Work Orders
export function fetchWorkOrders(params = {}) {
  return client.get('/maintenance/work-orders', { params })
}

export function fetchWorkOrder(id) {
  return client.get(`/maintenance/work-orders/${id}`)
}

export function createWorkOrder(data) {
  return client.post('/maintenance/work-orders', data)
}

export function updateWorkOrder(id, data) {
  return client.put(`/maintenance/work-orders/${id}`, data)
}

export function updateWorkOrderStatus(id, data) {
  return client.put(`/maintenance/work-orders/${id}/status`, data)
}

// Daily Checks
export function fetchDailyChecks(params = {}) {
  return client.get('/maintenance/daily-checks', { params })
}

export function createDailyCheck(data) {
  return client.post('/maintenance/daily-checks', data)
}

// Inspections
export function fetchInspections(params = {}) {
  return client.get('/maintenance/inspections', { params })
}

export function fetchInspection(id) {
  return client.get(`/maintenance/inspections/${id}`)
}

export function createInspection(data) {
  return client.post('/maintenance/inspections', data)
}

export function updateInspection(id, data) {
  return client.put(`/maintenance/inspections/${id}`, data)
}

// V1.35：定期检查审批流步骤流转（提交/确认/验收/审核/归档）
export function advanceInspectionStep(id, stepNo, data) {
  return client.put(`/maintenance/inspections/${id}/step/${stepNo}`, data)
}

// Rectifications
export function fetchRectifications(params = {}) {
  return client.get('/maintenance/rectifications', { params })
}

// V1.36：编辑整改项（整改措施/责任人/期限）
export function updateRectification(id, data) {
  return client.put(`/maintenance/rectifications/${id}`, data)
}

// Purchases
export function fetchPurchases() {
  return client.get('/maintenance/purchases')
}

// ===================== V2 维保业务逻辑（模板/配置/绑定/步骤引擎/报表） =====================
// 维保标准分配
export function resolveTemplate(params = {}) {
  return client.get('/maintenance/templates/resolve', { params })
}
export function fetchTemplateTree(params = {}) {
  return client.get('/maintenance/templates/tree', { params })
}
// V1.57：按月取记录（?month=YYYY-MM；01 忽略 month）
export function fetchTemplate(typeCode, fileCode, month) {
  return client.get(`/maintenance/templates/${typeCode}/${fileCode}`, { params: month ? { month } : {} })
}
// V1.57：data 含 month（02-06 目标执行月）或纯内容（01）
export function saveTemplate(typeCode, fileCode, data) {
  return client.put(`/maintenance/templates/${typeCode}/${fileCode}`, data)
}
// V1.57：删除某月记录（?month=YYYY-MM）
export function deleteTemplate(typeCode, fileCode, month) {
  return client.delete(`/maintenance/templates/${typeCode}/${fileCode}`, { params: month ? { month } : {} })
}
// V1.57：上传 Excel 到目标执行月（执行期=整月，无起止日期）
export function importTemplateExcel(typeCode, fileCode, file, month) {
  const formData = new FormData()
  formData.append('typeCode', typeCode)
  formData.append('fileCode', fileCode)
  formData.append('file', file)
  if (month) formData.append('month', month)
  return client.post('/maintenance/templates/import', formData)
}
// V1.57：复制月份记录（添加月份时「复制上一年同月/任意已配置月」为基础再改）
export function copyTemplateRecord(typeCode, fileCode, fromMonth, toMonth) {
  return client.post(`/maintenance/templates/${typeCode}/${fileCode}/copy`, { fromMonth, toMonth })
}
export function fetchTemplateModules(typeCode) {
  return client.get('/maintenance/templates/modules', { params: { typeCode } })
}
export function createTemplateModule(data) {
  return client.post('/maintenance/templates/modules', data)
}
export function updateTemplateModule(typeCode, code, data) {
  return client.put(`/maintenance/templates/modules/${typeCode}/${code}`, data)
}

// 职责角色绑定（仅保留候选下拉，TrainingView 使用；其余配置接口随「维保配置」tab 删除）
export function fetchRoleOptions() {
  return client.get('/maintenance/config/role-bindings/options')
}

// 实例与步骤引擎
export function fetchDeviceConfig(params = {}) {
  return client.get('/maintenance/device-config', { params })
}
export function fetchV2Plans(params = {}) {
  return client.get('/maintenance/v2-plans', { params })
}
export function fetchV2Plan(id) {
  return client.get(`/maintenance/v2-plans/${id}`)
}
export function generateV2Plans(data = {}) {
  return client.post('/maintenance/v2-generate', data)
}
export function generateV2Daily(data = {}) {
  return client.post('/maintenance/v2-generate-daily', data)
}
// 保养计划批量保存（§5.3(3) V1.3 设备×12月 网格）：body 含 level（tab 决定级别）+ items[{deviceCode,months}] 勾选生成；本次仅生成、不作废
export function createV2PlansBatch(data) {
  return client.post('/maintenance/v2-plans/batch', data)
}
// 保养计划网格（§5.3(3) V1.3）：?workshop&year&level（level1|level2，tab 决定级别）→ 设备×12月 可勾选网格（仅列配对应 03/04 标准设备 + 各月已有该级别保养单）
export function fetchV2PlanGrid(params = {}) {
  return client.get('/maintenance/v2-plans/plan-config', { params })
}
export function advanceV2Step(id, stepNo, data) {
  return client.put(`/maintenance/v2-plans/${id}/step/${stepNo}`, data)
}
// V1.33：第一步提交图片附件（multipart FormData，file 字段）
export function uploadV2Attachment(id, stepNo, file) {
  const formData = new FormData()
  formData.append('file', file)
  return client.post(`/maintenance/v2-plans/${id}/step/${stepNo}/attachment`, formData)
}
// V1.34：定期检查「发现问题」图片上传（通用端点，multipart FormData，file 字段）
export function uploadInspectionAttachment(file) {
  const formData = new FormData()
  formData.append('file', file)
  return client.post('/maintenance/attachments', formData)
}
export function rescheduleV2Plan(id, data) {
  return client.put(`/maintenance/v2-plans/${id}/reschedule`, data)
}

// 培训
export function fetchTrainingRecords(params = {}) {
  return client.get('/maintenance/training-records', { params })
}
export function createTrainingRecord(data) {
  return client.post('/maintenance/training-records', data)
}
export function advanceTrainingRecord(id, data) {
  return client.put(`/maintenance/training-records/${id}`, data)
}

// KPI / 台时
export function fetchDailyKpi(params = {}) {
  return client.get('/maintenance/kpi/daily', { params })
}
export function fetchDashboardKpi(params = {}) {
  return client.get('/maintenance/dashboard/kpi', { params })
}
export function upsertKpi(data) {
  return client.post('/maintenance/kpi/upsert', data)
}

// 报表（V1.41：仅保留日常点检页共用的 daily-check；repair-summary/inspection-issues/completion-rates 随统计报表 tab 删除）
export function fetchDailyCheckReport(params = {}) {
  return client.get('/maintenance/reports/daily-check', { params })
}

export function fetchMyDevices(params = {}) {
  return client.get('/maintenance/my-devices', { params })
}

// 维修 V2（6步）
export function createRepairOrder(data) {
  return client.post('/maintenance/repair-orders', data)
}
export function fetchRepairOrders(params = {}) {
  return client.get('/maintenance/repair-orders', { params })
}
/** 设备维修记录报表（时间段·已归档）→ Blob；404/业务错误解析 JSON */
export async function exportRepairOrdersReport({ start, end }) {
  try {
    const res = await axios.get('/api/maintenance/repair-orders/export', {
      params: { start, end },
      responseType: 'blob',
      timeout: 60000,
    })
    return res.data
  } catch (error) {
    const data = error.response?.data
    if (data instanceof Blob) {
      try {
        const text = await data.text()
        const j = JSON.parse(text)
        throw new Error(j.error || '下载失败')
      } catch (e) {
        if (e instanceof Error && e.message && e.message !== '下载失败' && !String(e.message).includes('Unexpected')) throw e
      }
    }
    const msg = error.response?.data?.error || error.message || '下载失败'
    throw new Error(typeof msg === 'string' ? msg : '下载失败')
  }
}

// 整改跟踪闭环
export function fetchRectificationClose(id, data) {
  return client.put(`/maintenance/rectifications/${id}/close`, data)
}

// ===================== V1.46 设备分配（V1.49 拆分为 车间分配 ws + 维保分配 mt） =====================
// 设备×三级分配人列表（GET /maintenance/assignments?scope=ws|mt，按当前登录人数据范围收窄；admin/顶级主任可传 workshop 过滤）
export function fetchAssignments(params = {}) {
  return client.get('/maintenance/assignments', { params })
}
// 分配候选人员（GET /maintenance/assignments/candidates?scope=&role=&workshop=；车间 scope 同车间过滤，维保 scope 不按车间）
export function fetchAssignmentCandidates(params = {}) {
  return client.get('/maintenance/assignments/candidates', { params })
}
// 单台设置某级分配（PUT /maintenance/assignments/:deviceCode?scope=，body { level, personnelIds:[] }；V1.48 起数组，空数组=清空该级；操作级支持多选）
export function saveAssignment(deviceCode, data, scope = 'ws') {
  return client.put(`/maintenance/assignments/${deviceCode}`, data, { params: { scope } })
}
// 批量设置某级分配（POST /maintenance/assignments/batch?scope=，body { deviceCodes:[], level, personnelIds:[] }）
export function batchAssign(data, scope = 'ws') {
  return client.post('/maintenance/assignments/batch', data, { params: { scope } })
}
