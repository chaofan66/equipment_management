const express = require('express');
const router = express.Router();
const { auth } = require('../data');
const { dict } = require('../data');
const { constants } = require('../data');

// ===================== PERSONNEL =====================
router.get('/personnel', (req, res) => {
  let result = [...auth.PERSONNEL];
  const { name, employeeId, dept, role, team } = req.query;
  if (name) result = result.filter(p => p.name.includes(name));
  if (employeeId) result = result.filter(p => p.employeeId.includes(employeeId));
  if (dept) result = result.filter(p => p.dept === dept);
  if (role) result = result.filter(p => p.roleId === role);
  if (team) result = result.filter(p => p.team === team);
  res.json({ success: true, data: result, total: result.length });
});

router.get('/personnel/:id', (req, res) => {
  const person = auth.getPersonnelById(req.params.id);
  if (!person) return res.status(404).json({ success: false, error: '人员不存在' });
  res.json({ success: true, data: person });
});

router.post('/personnel', (req, res) => {
  // 忽略客户端传来的 id（表单含空 id 会覆盖自动生成），id 统一后端生成
  const { id: _ignored, ...body } = req.body;
  const newPerson = {
    id: 'p' + String(auth.PERSONNEL.length + 1).padStart(3, '0'),
    ...body
  };
  auth.PERSONNEL.push(newPerson);
  res.status(201).json({ success: true, data: newPerson });
});

router.put('/personnel/:id', (req, res) => {
  const idx = auth.PERSONNEL.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '人员不存在' });
  auth.PERSONNEL[idx] = { ...auth.PERSONNEL[idx], ...req.body, id: req.params.id };
  res.json({ success: true, data: auth.PERSONNEL[idx] });
});

router.delete('/personnel/:id', (req, res) => {
  const idx = auth.PERSONNEL.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '人员不存在' });
  auth.PERSONNEL.splice(idx, 1);
  res.json({ success: true, message: '删除成功' });
});

// ===================== ROLES =====================
router.get('/roles', (req, res) => {
  res.json({ success: true, data: auth.ROLES, total: auth.ROLES.length });
});

router.get('/roles/:id', (req, res) => {
  const role = auth.getRoleById(req.params.id);
  if (!role) return res.status(404).json({ success: false, error: '角色不存在' });
  res.json({ success: true, data: role });
});

router.post('/roles', (req, res) => {
  const newRole = { ...req.body };
  auth.ROLES.push(newRole);
  res.status(201).json({ success: true, data: newRole });
});

router.put('/roles/:id', (req, res) => {
  const idx = auth.ROLES.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '角色不存在' });
  auth.ROLES[idx] = { ...auth.ROLES[idx], ...req.body, id: req.params.id };
  res.json({ success: true, data: auth.ROLES[idx] });
});

router.delete('/roles/:id', (req, res) => {
  const idx = auth.ROLES.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '角色不存在' });
  auth.ROLES.splice(idx, 1);
  res.json({ success: true, message: '删除成功' });
});

// GET /api/config/permissions - permission catalog
router.get('/permissions', (req, res) => {
  res.json({ success: true, data: auth.PERMISSION_CATALOG });
});

// ===================== TEAMS =====================
router.get('/teams', (req, res) => {
  res.json({ success: true, data: auth.MAINTENANCE_TEAMS, total: auth.MAINTENANCE_TEAMS.length });
});

// ===================== BUSINESS PARAMS =====================
router.get('/params', (req, res) => {
  res.json({
    success: true,
    data: {
      assetUnitId: constants.ASSET_UNIT_ID,
      defaultOwnershipUnit: constants.DEFAULT_OWNERSHIP_UNIT,
      defaultManageDept: constants.DEFAULT_MANAGE_DEPT,
      defaultManageDeptCode: constants.DEFAULT_MANAGE_DEPT_CODE,
      suppliers: constants.SUPPLIERS
    }
  });
});

router.put('/params', (req, res) => {
  const allowed = ['assetUnitId', 'defaultOwnershipUnit', 'defaultManageDept', 'defaultManageDeptCode'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const constKey = key === 'assetUnitId' ? 'ASSET_UNIT_ID'
        : key === 'defaultOwnershipUnit' ? 'DEFAULT_OWNERSHIP_UNIT'
        : key === 'defaultManageDept' ? 'DEFAULT_MANAGE_DEPT'
        : 'DEFAULT_MANAGE_DEPT_CODE';
      constants[constKey] = req.body[key];
    }
  }
  if (req.body.suppliers) constants.SUPPLIERS.length = 0;
  if (Array.isArray(req.body.suppliers)) constants.SUPPLIERS.push(...req.body.suppliers);
  res.json({ success: true, message: '参数更新成功' });
});

module.exports = router;
