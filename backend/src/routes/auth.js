const express = require('express');
const router = express.Router();
const { auth } = require('../data');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { userId } = req.body;
  const person = auth.PERSONNEL.find(p => p.employeeId === userId || p.id === userId);
  if (!person) {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }
  auth.CURRENT_USER.name = person.name;
  auth.CURRENT_USER.id = person.employeeId;
  auth.CURRENT_USER.dept = person.dept;
  auth.CURRENT_USER.display = `${person.name} (${person.employeeId})-${person.dept}`;
  auth.CURRENT_USER.roleId = person.roleId;
  auth.CURRENT_USER.personnelId = person.id;
  res.json({ success: true, data: auth.CURRENT_USER });
});

// GET /api/auth/current-user
router.get('/current-user', (req, res) => {
  const role = auth.getRoleById(auth.CURRENT_USER.roleId);
  res.json({
    success: true,
    data: {
      ...auth.CURRENT_USER,
      permissions: role ? role.permissions : [],
      role: role || null
    }
  });
});

// POST /api/auth/switch-user
router.post('/switch-user', (req, res) => {
  const { personnelId } = req.body;
  const person = auth.PERSONNEL.find(p => p.id === personnelId);
  if (!person) {
    return res.status(404).json({ success: false, error: '人员不存在' });
  }
  auth.CURRENT_USER.name = person.name;
  auth.CURRENT_USER.id = person.employeeId;
  auth.CURRENT_USER.dept = person.dept;
  auth.CURRENT_USER.display = `${person.name} (${person.employeeId})-${person.dept}`;
  auth.CURRENT_USER.roleId = person.roleId;
  auth.CURRENT_USER.personnelId = person.id;
  const role = auth.getRoleById(person.roleId);
  res.json({
    success: true,
    data: {
      ...auth.CURRENT_USER,
      permissions: role ? role.permissions : [],
      role: role || null
    }
  });
});

// GET /api/auth/permissions - permission catalog
router.get('/permissions', (req, res) => {
  res.json({ success: true, data: auth.PERMISSION_CATALOG });
});

module.exports = router;
