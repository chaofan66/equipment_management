const express = require('express');
const router = express.Router();
const { maintenance, devices } = require('../data');
const auth = require('../data/auth');
const assignments = require('../data/assignments');   // V1.46 设备分配（统一数据范围 resolveVisibleCodes）
const mtAssignments = require('../data/mtAssignments');   // V1.49 维保分配（定期检查发起强绑定）
const { fmtDate, fmtDateTime } = require('../data/helpers');

// ===================== MAINTENANCE PLANS =====================
router.get('/plans', (req, res) => {
  let result = [...maintenance.maintenancePlans];
  const { status, year, month, deviceId, area, dept } = req.query;
  if (status) result = result.filter(p => p.status === status);
  if (year) result = result.filter(p => p.year === parseInt(year));
  if (month) result = result.filter(p => p.month === parseInt(month));
  if (deviceId) result = result.filter(p => p.deviceId === deviceId);
  if (area) result = result.filter(p => p.area && p.area.includes(area));
  if (dept) result = result.filter(p => p.dept === dept);
  res.json({ success: true, data: result, total: result.length });
});

router.get('/plans/:id', (req, res) => {
  const plan = maintenance.maintenancePlans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ success: false, error: '计划不存在' });
  res.json({ success: true, data: plan });
});

router.post('/plans', (req, res) => {
  const newPlan = { ...req.body, id: 'MP-MANUAL-' + String(maintenance.maintenancePlans.length + 1).padStart(3, '0') };
  maintenance.maintenancePlans.push(newPlan);
  res.status(201).json({ success: true, data: newPlan });
});

router.put('/plans/:id', (req, res) => {
  const idx = maintenance.maintenancePlans.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '计划不存在' });
  maintenance.maintenancePlans[idx] = { ...maintenance.maintenancePlans[idx], ...req.body };
  res.json({ success: true, data: maintenance.maintenancePlans[idx] });
});

router.delete('/plans/:id', (req, res) => {
  const idx = maintenance.maintenancePlans.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '计划不存在' });
  maintenance.maintenancePlans.splice(idx, 1);
  res.json({ success: true, message: '删除成功' });
});

router.put('/plans/:id/status', (req, res) => {
  const idx = maintenance.maintenancePlans.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '计划不存在' });
  maintenance.maintenancePlans[idx].status = req.body.status;
  if (req.body.operatorSign) maintenance.maintenancePlans[idx].operatorSign = req.body.operatorSign;
  if (req.body.deptSign) maintenance.maintenancePlans[idx].deptSign = req.body.deptSign;
  if (req.body.supervisorSign) maintenance.maintenancePlans[idx].supervisorSign = req.body.supervisorSign;
  if (req.body.completedDate) maintenance.maintenancePlans[idx].completedDate = req.body.completedDate;
  res.json({ success: true, data: maintenance.maintenancePlans[idx] });
});

// ===================== MAINTENANCE RECORDS =====================
router.get('/records', (req, res) => {
  let result = [...maintenance.maintenanceRecords];
  const { deviceId, type, dateRange } = req.query;
  if (deviceId) result = result.filter(r => r.deviceId === deviceId || r.deviceCode === deviceId);
  if (type) result = result.filter(r => r.mtType === type);
  res.json({ success: true, data: result, total: result.length });
});

router.post('/records', (req, res) => {
  const newRecord = { ...req.body, id: 'MT-' + new Date().getFullYear() + '-' + String(maintenance.maintenanceRecords.length + 1).padStart(3, '0') };
  maintenance.maintenanceRecords.push(newRecord);
  res.status(201).json({ success: true, data: newRecord });
});

// ===================== WORK ORDERS =====================
router.get('/work-orders', (req, res) => {
  let result = [...maintenance.workOrders];
  const { status, dept, urgency } = req.query;
  if (status) result = result.filter(w => w.status === status);
  if (dept) result = result.filter(w => w.dept === dept);
  if (urgency) result = result.filter(w => w.urgency === urgency);
  res.json({ success: true, data: result, total: result.length });
});

router.get('/work-orders/:id', (req, res) => {
  const wo = maintenance.workOrders.find(w => w.id === req.params.id);
  if (!wo) return res.status(404).json({ success: false, error: '工单不存在' });
  res.json({ success: true, data: wo });
});

router.post('/work-orders', (req, res) => {
  const newWo = {
    ...req.body,
    id: 'SBWX-' + new Date().toISOString().substring(0, 7).replace('-', '') + '-' + String(maintenance.workOrders.length + 1).padStart(3, '0'),
    createdAt: new Date().toISOString(),
    status: '待派工'
  };
  maintenance.workOrders.push(newWo);
  res.status(201).json({ success: true, data: newWo });
});

router.put('/work-orders/:id', (req, res) => {
  const idx = maintenance.workOrders.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '工单不存在' });
  maintenance.workOrders[idx] = { ...maintenance.workOrders[idx], ...req.body };
  res.json({ success: true, data: maintenance.workOrders[idx] });
});

router.put('/work-orders/:id/status', (req, res) => {
  const idx = maintenance.workOrders.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '工单不存在' });
  const allowed = ['待派工', '待维修', '维修中', '待验收', '已完成'];
  if (!allowed.includes(req.body.status)) {
    return res.status(400).json({ success: false, error: '无效的状态值' });
  }
  maintenance.workOrders[idx].status = req.body.status;
  // Merge any lifecycle data from request body
  Object.assign(maintenance.workOrders[idx], req.body);
  res.json({ success: true, data: maintenance.workOrders[idx] });
});

// ===================== DAILY CHECKS =====================
router.get('/daily-checks', (req, res) => {
  let result = [...maintenance.dailyCheckRecords];
  const { deviceCode, area, year, month } = req.query;
  if (deviceCode) result = result.filter(r => r.deviceCode === deviceCode);
  if (area) result = result.filter(r => r.location && r.location.includes(area));
  if (year) result = result.filter(r => r.year === parseInt(year));
  if (month) result = result.filter(r => r.month === parseInt(month));
  res.json({ success: true, data: result, total: result.length });
});

router.post('/daily-checks', (req, res) => {
  const newCheck = { ...req.body, id: 'DC-NEW-' + Date.now() };
  maintenance.dailyCheckRecords.push(newCheck);
  res.status(201).json({ success: true, data: newCheck });
});

// ===================== INSPECTIONS =====================
router.get('/inspections', (req, res) => {
  // V1.36：每条补 deviceType（台账设备 type「大类/中类/小类」，按 deviceCode join；台账无此编码则留空）
  let result = [...maintenance.inspectionRecords].map(r => ({
    ...r,
    deviceType: r.deviceType || ((devices.devices.find(d => d.code === r.deviceCode) || {}).type) || '',
  }));
  const { type, dept } = req.query;
  if (type) result = result.filter(r => r.checkType === type);
  if (dept) result = result.filter(r => r.dept === dept);
  // V1.44/V1.46 数据权限：车间角色只可见本车间设备的检查记录；主管/组长/操作人员进一步按分配收窄
  const codes = assignments.resolveVisibleCodes(auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001'));
  if (codes) result = result.filter(r => codes.has(r.deviceCode));
  res.json({ success: true, data: result, total: result.length });
});

router.get('/inspections/:id', (req, res) => {
  const record = maintenance.inspectionRecords.find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ success: false, error: '检查记录不存在' });
  const rectification = maintenance.rectificationItems.filter(r => r.checkId === record.id);
  res.json({ success: true, data: { ...record, rectification } });
});

// 发起检查（V1.35）：角色门禁（admin||维保人员）→ 检查编号 = 资产编号-年份-月日-流水号 → 初始化 5 步审批流，提交步由当前登录人完成
// V1.49 维保执行强绑定：mtPersonnel 仅可对被分配给自己的设备发起（operatorIds 集合含本人；admin 豁免）
router.post('/inspections', (req, res) => {
  const user = auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001');
  if (!user || (user.roleId !== 'admin' && user.roleId !== 'mtPersonnel')) {
    return res.status(403).json({ success: false, error: '仅维保人员可发起检查' });
  }
  if (user.roleId === 'mtPersonnel') {
    const ma = mtAssignments.getAssignment(req.body.deviceCode);
    if (!ma || !Array.isArray(ma.operatorIds) || !ma.operatorIds.includes(user.id)) {
      return res.status(403).json({ success: false, error: '该设备未分配给你，仅被分配的维保人员可发起定期检查' });
    }
  }
  const body = { ...req.body };
  const id = maintenance.genInspectionId(body.checkDate);   // V1.61：检查编号 = yyyy+mmdd+6位当日全局流水号
  const steps = maintenance.INSPECTION_STEPS.map(s => ({ seq: s.seq, name: s.name, action: s.action, role: s.role, status: 'pending', date: '', signatures: [] }));
  steps[0].status = 'done';
  steps[0].date = fmtDate(new Date());
  steps[0].signatures.push(maintenance.inspectionSignature(user));
  const newRecord = {
    ...body,
    id,
    checkType: body.checkType || '定期检查',
    inspector: body.inspector || user.name,
    startedAt: fmtDateTime(new Date()),   // V1.61：发起即首步「提交」完成=开始执行时间
    status: maintenance.deriveInspectionStatus({ steps }),
    version: 1,
    rejectLog: [],
    steps,
  };
  maintenance.inspectionRecords.push(newRecord);
  // 发现问题仅留在检查记录 issues 上；月度报表只统计有问题的检查单，不再生成整改项/状态
  res.status(201).json({ success: true, data: newRecord });
});

// 步骤流转（V1.35 审批流）：PUT /maintenance/inspections/:id/step/:stepNo（通过/驳回/归档）
router.put('/inspections/:id/step/:stepNo', (req, res) => {
  const payload = { ...req.body, personnelId: (req.body && req.body.personnelId) || auth.CURRENT_USER.personnelId || 'p001' };
  try {
    const r = maintenance.advanceInspectionStep(req.params.id, parseInt(req.params.stepNo), payload);
    res.json({ success: true, data: r });
  } catch (e) {
    const status = e.message.startsWith('403') ? 403 : e.message.startsWith('409') ? 409 : 400;
    res.status(status).json({ success: false, error: e.message.replace(/^(403|409):/, '') });
  }
});

router.put('/inspections/:id', (req, res) => {
  const idx = maintenance.inspectionRecords.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '检查记录不存在' });
  maintenance.inspectionRecords[idx] = { ...maintenance.inspectionRecords[idx], ...req.body };
  res.json({ success: true, data: maintenance.inspectionRecords[idx] });
});

// ===================== RECTIFICATION =====================
router.get('/rectifications', (req, res) => {
  res.json({ success: true, data: maintenance.rectificationItems, total: maintenance.rectificationItems.length });
});

router.put('/rectifications/:id', (req, res) => {
  const idx = maintenance.rectificationItems.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '整改项不存在' });
  maintenance.rectificationItems[idx] = { ...maintenance.rectificationItems[idx], ...req.body };
  res.json({ success: true, data: maintenance.rectificationItems[idx] });
});

// ===================== PURCHASE =====================
router.get('/purchases', (req, res) => {
  res.json({ success: true, data: maintenance.purchaseRecords, total: maintenance.purchaseRecords.length });
});

module.exports = router;
