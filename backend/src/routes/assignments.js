// ===================== 设备分配（V1.46；V1.49 拆分为 车间分配+维保分配） =====================
// 同一套端点按 ?scope=ws|mt 分派到「车间 store」或「维保 store」（两个 store 均为 createAssignmentStore 实例，逻辑一致）。
// GET    /maintenance/assignments?scope=            设备×三级分配人列表（按当前登录人数据范围收窄）
// GET    /maintenance/assignments/candidates?scope= 分配候选人员（车间角色强制本人车间，维保不强制）
// PUT    /maintenance/assignments/:deviceCode?scope= 单台设置某级分配
// POST   /maintenance/assignments/batch?scope=       批量设置某级分配
const express = require('express');
const router = express.Router();
const { CURRENT_USER, getPersonnelById, PERSONNEL, MANAGE_DEPT_DIRECTORS } = require('../data/auth');
const assignments = require('../data/assignments');
const mtAssignments = require('../data/mtAssignments');
const { devices } = require('../data/devices');

function curPersonnelId() { return CURRENT_USER.personnelId || 'p001'; }
function actor() { return getPersonnelById(curPersonnelId()); }

function person(id) {
  if (!id) return null;
  const p = getPersonnelById(id);
  return p ? { id: p.id, name: p.name, employeeId: p.employeeId, roleId: p.roleId } : null;
}

// V1.50 主任自动带出（只读）：ws=按设备车间找车间主任（车间=使用人）；mt=按设备维护部门（室）找室主任
function directorOf(d, mt) {
  if (mt) return MANAGE_DEPT_DIRECTORS[d.manageDept] || null;
  const p = PERSONNEL.find(x => x.roleId === 'workshopDirector' && x.workshop === d.workshop);
  return p ? { id: p.id, name: p.name } : null;
}

// V1.49：scope=mt → 维保 store；缺省/ws → 车间 store
function storeFor(req) { return req.query.scope === 'mt' ? mtAssignments : assignments; }

const ASSIGN_LEVELS = ['opSupervisor', 'opLeader', 'operator'];
const MT_ASSIGN_LEVELS = ['mtSupervisor', 'mtLeader', 'mtPersonnel'];

// 设备×三级分配人列表
router.get('/assignments', (req, res) => {
  const user = actor();
  if (!user) return res.status(403).json({ success: false, error: '未登录' });
  const { workshop } = req.query;
  const store = storeFor(req);
  const codes = assignments.resolveVisibleCodes(user);   // Set | null（null=全量，系统级 dispatcher 已按角色路由到 车间/维保 store）
  let list = devices.filter(d => (codes ? codes.has(d.code) : true));
  if (workshop) list = list.filter(d => d.workshop === workshop);
  const data = list.map(d => {
    const a = store.getAssignment(d.code) || {};
    return {
      deviceCode: d.code,
      deviceName: d.name,
      spec: d.spec || '',
      department: d.department || '',
      assetClass: d.assetCategory || '',
      type: d.type || '',
      workshop: d.workshop || '',
      manageDept: d.manageDept || '',
      director: directorOf(d, req.query.scope === 'mt'),
      supervisorId: a.supervisorId || null,
      leaderId: a.leaderId || null,
      operatorId: (a.operatorIds && a.operatorIds[0]) || null,
      supervisor: person(a.supervisorId),
      leader: person(a.leaderId),
      operator: person((a.operatorIds && a.operatorIds[0]) || null),
      operatorIds: a.operatorIds || [],
      operators: (a.operatorIds || []).map(person),
      updatedAt: a.updatedAt || null,
      updatedBy: a.updatedBy || null,
    };
  });
  res.json({ success: true, data, total: data.length });
});

// 分配候选人员
router.get('/assignments/candidates', (req, res) => {
  const { role } = req.query;
  const store = storeFor(req);
  const mt = req.query.scope === 'mt';
  const levels = mt ? MT_ASSIGN_LEVELS : ASSIGN_LEVELS;
  if (!levels.includes(role)) {
    return res.status(400).json({ success: false, error: 'role 须为 ' + levels.join('/') });
  }
  const user = actor();
  // 车间角色强制本人车间，防跨车间错配；admin/主任可传 query workshop；维保角色不强制（维保岗同属生产保障部）
  let workshop = req.query.workshop;
  if (user && !mt && ['opSupervisor', 'opLeader', 'operator'].includes(user.roleId)) workshop = user.workshop;
  const data = store.candidatePersonnel(role, workshop);
  res.json({ success: true, data, total: data.length });
});

// 单台设置某级分配（V1.48：personnelIds 数组，空数组=清空该级；兼容旧 personnelId 单值字段）
router.put('/assignments/:deviceCode', (req, res) => {
  try {
    const { level, personnelId, personnelIds } = req.body;
    const ids = Array.isArray(personnelIds) ? personnelIds : (personnelId ? [personnelId] : []);
    const r = storeFor(req).setAssignmentLevel(req.params.deviceCode, level, ids, actor());
    res.json({ success: true, data: r });
  } catch (e) {
    const status = e.message.startsWith('403') ? 403 : 400;
    res.status(status).json({ success: false, error: e.message.replace(/^(403|400):/, '') });
  }
});

// 批量设置某级分配（V1.48：personnelIds 数组）
router.post('/assignments/batch', (req, res) => {
  try {
    const { deviceCodes, level, personnelId, personnelIds } = req.body;
    const ids = Array.isArray(personnelIds) ? personnelIds : (personnelId ? [personnelId] : []);
    const n = storeFor(req).setAssignmentLevels(deviceCodes, level, ids, actor());
    res.json({ success: true, data: { assigned: n } });
  } catch (e) {
    const status = e.message.startsWith('403') ? 403 : 400;
    res.status(status).json({ success: false, error: e.message.replace(/^(403|400):/, '') });
  }
});

module.exports = router;
