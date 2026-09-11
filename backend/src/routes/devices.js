const express = require('express');
const router = express.Router();
const { devices } = require('../data');
const { dict } = require('../data');
const { helpers } = require('../data');
const { maintenance } = require('../data');
const { auth } = require('../data');
const assignments = require('../data/assignments');   // V1.46 设备分配（统一数据范围 resolveVisibleCodes）

// V1.44 数据权限：车间四角色可见设备按本人车间收窄（resolveDataScope 基于当前登录人）
function dataScope() {
  return auth.resolveDataScope(auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001'));
}

// GET /api/devices - list with filters and pagination
router.get('/', (req, res) => {
  let result = [...devices.devices];
  const { status, type, code, supplier, keyword, name, page, pageSize } = req.query;

  if (status) result = result.filter(d => d.status === status);
  if (type) result = result.filter(d => d.typeCode && d.typeCode.startsWith(type));
  if (code) result = result.filter(d => d.code && d.code.includes(code));
  if (supplier) result = result.filter(d => d.supplier && d.supplier === supplier);
  // V1.34 定期检查设备搜索：keyword（资产编号或资产名称子串）/ name（仅资产名称子串）
  if (keyword) result = result.filter(d => (d.code && d.code.includes(keyword)) || (d.name && d.name.includes(keyword)));
  if (name) result = result.filter(d => d.name && d.name.includes(name));

  // V1.44/V1.46 数据权限：车间角色只可见本车间设备；主管/组长/操作人员进一步按分配收窄（resolveVisibleCodes）
  const codes = assignments.resolveVisibleCodes(auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001'));
  if (codes) result = result.filter(d => codes.has(d.code));

  const total = result.length;
  const p = parseInt(page) || 1;
  const ps = parseInt(pageSize) || 15;
  const start = (p - 1) * ps;
  const paginated = result.slice(start, start + ps);

  res.json({
    success: true,
    data: paginated,
    pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) }
  });
});

// GET /api/devices/suppliers - list unique supplier names
router.get('/suppliers', (req, res) => {
  const suppliers = [...new Set(devices.devices.map(d => d.supplier).filter(Boolean))].sort();
  res.json({ success: true, data: suppliers });
});

// GET /api/devices/by-code/:code — 精确按资产编号（扫码落地页，须在 /:id 之前）
router.get('/by-code/:code', (req, res) => {
  const code = decodeURIComponent(String(req.params.code || '')).trim();
  if (!code) return res.status(400).json({ success: false, error: '缺少资产编号' });
  const device = devices.devices.find(d => d.code === code);
  if (!device) return res.status(404).json({ success: false, error: '设备不存在' });
  const codes = assignments.resolveVisibleCodes(auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001'));
  if (codes && !codes.has(device.code)) {
    return res.status(403).json({ success: false, error: '无权查看该设备' });
  }
  res.json({ success: true, data: device });
});

// GET /api/devices/:id
router.get('/:id', (req, res) => {
  const device = devices.devices.find(d => d.id === req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  // V1.44/V1.46 数据权限：车间角色不可查看范围外设备（主管/组长/操作人员按分配收窄）
  const codes = assignments.resolveVisibleCodes(auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001'));
  if (codes && !codes.has(device.code)) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  res.json({ success: true, data: device });
});

// POST /api/devices - create new device
router.post('/', (req, res) => {
  const data = req.body;
  const newDevice = { ...data };

  // Generate ID
  newDevice.id = helpers.genId();

  // Generate asset code
  if (!newDevice.code && newDevice.typeCode && newDevice.workshop) {
    newDevice.code = helpers.generateAssetCode(
      newDevice.typeCode,
      newDevice.workshop,
      newDevice.department || dict.DICT.WORKSHOP_DEPT_MAP[newDevice.workshop] || ''
    );
  }

  // Set defaults
  if (!newDevice.ownershipUnit) newDevice.ownershipUnit = require('../data/constants').DEFAULT_OWNERSHIP_UNIT;
  if (!newDevice.manageDept) newDevice.manageDept = require('../data/constants').DEFAULT_MANAGE_DEPT;

  devices.devices.push(newDevice);
  devices.normalizeDevices();

  res.status(201).json({ success: true, data: newDevice });
});

// PUT /api/devices/:id - update device
router.put('/:id', (req, res) => {
  const idx = devices.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  const merged = { ...devices.devices[idx], ...req.body, id: req.params.id };
  devices.devices[idx] = merged;
  devices.normalizeDevices();
  res.json({ success: true, data: devices.devices[idx] });
});

// DELETE /api/devices/:id
router.delete('/:id', (req, res) => {
  const idx = devices.devices.findIndex(d => d.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  devices.devices.splice(idx, 1);
  res.json({ success: true, message: '删除成功' });
});

// POST /api/devices/:id/transfer - initiate transfer
router.post('/:id/transfer', (req, res) => {
  const device = devices.devices.find(d => d.id === req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  const transferData = {
    id: 'TRF-' + new Date().getFullYear() + '-' + String(maintenance.transferRecords.length + 1).padStart(3, '0'),
    deviceId: device.id,
    deviceCode: device.code,
    deviceName: device.name,
    currentArea: device.area,
    targetArea: req.body.targetArea,
    newPerson: req.body.newPerson,
    reason: req.body.reason,
    transferDate: req.body.transferDate,
    applicant: req.body.applicant,
    applyTime: new Date().toISOString(),
    status: '待审批'
  };
  maintenance.transferRecords.push(transferData);
  maintenance.applications.push({
    id: 'APP' + String(maintenance.applications.length + 1).padStart(3, '0'),
    type: '调拨',
    deviceId: device.id,
    deviceCode: device.code,
    deviceName: device.name,
    ...req.body,
    applyTime: new Date().toISOString(),
    status: '待审批'
  });
  res.status(201).json({ success: true, data: transferData });
});

// POST /api/devices/:id/scrap - initiate scrap
router.post('/:id/scrap', (req, res) => {
  const device = devices.devices.find(d => d.id === req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  const scrapData = {
    id: 'SCP-' + new Date().getFullYear() + '-' + String(maintenance.scrapRecords.length + 1).padStart(3, '0'),
    deviceId: device.id,
    deviceCode: device.code,
    deviceName: device.name,
    currentStatus: device.status,
    value: device.value,
    scrapDate: req.body.scrapDate,
    disposal: req.body.disposal,
    residual: req.body.residual,
    reason: req.body.reason,
    applicant: req.body.applicant,
    applyTime: new Date().toISOString(),
    status: '审批中'
  };
  maintenance.scrapRecords.push(scrapData);
  maintenance.applications.push({
    id: 'APP' + String(maintenance.applications.length + 1).padStart(3, '0'),
    type: '报废',
    deviceId: device.id,
    deviceCode: device.code,
    deviceName: device.name,
    ...req.body,
    applyTime: new Date().toISOString(),
    status: '审批中'
  });
  res.status(201).json({ success: true, data: scrapData });
});

// GET /api/devices/:id/maintenance-history
router.get('/:id/maintenance-history', (req, res) => {
  const device = devices.devices.find(d => d.id === req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  const records = maintenance.maintenanceRecords.filter(r => r.deviceCode === device.code);
  res.json({ success: true, data: records });
});

// GET /api/devices/:id/transfer-history
router.get('/:id/transfer-history', (req, res) => {
  const device = devices.devices.find(d => d.id === req.params.id);
  if (!device) {
    return res.status(404).json({ success: false, error: '设备不存在' });
  }
  const records = maintenance.transferRecords.filter(r => r.deviceId === device.id);
  res.json({ success: true, data: records });
});

// POST /api/devices/generate-code
router.post('/generate-code', (req, res) => {
  const { typeCode, workshop, dept } = req.body;
  if (!typeCode || !workshop) {
    return res.status(400).json({ success: false, error: 'typeCode 和 workshop 为必填' });
  }
  const code = helpers.generateAssetCode(typeCode, workshop, dept || dict.DICT.WORKSHOP_DEPT_MAP[workshop] || '');
  res.json({ success: true, data: { code } });
});

module.exports = router;
