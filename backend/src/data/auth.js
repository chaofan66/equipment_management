// ===================== AUTH & PERSONNEL =====================
const USERS = ['张建国','李伟民','王海波','陈志强','刘明辉','赵永刚','孙晓峰','周大伟'];
const CURRENT_USER = { name: '袁涛', id: '10862253', dept: '精度部', display: '袁涛 (10862253)-精度部', roleId: 'admin', personnelId: 'p001' };

// 权限点目录（V1.7：系统操作权限，模块→页面→动作 层级）
// 每页含 .view 及动作项；前端「角色管理」页按此渲染勾选，App.vue/维保子页/系统配置子页按页面级权限过滤
var PERMISSION_CATALOG = {
  dashboard: { name: '设备总览', pages: {
    overview: { name: '总览', items: { 'dashboard.view': '查看' } }
  } },
  ledger: { name: '资产台账', pages: {
    main: { name: '资产台账', items: { 'ledger.view': '查看', 'ledger.edit': '新增/编辑', 'ledger.delete': '删除' } }
  } },
  maintenance: { name: '维保管理', pages: {
    main:        { name: '维保总览',    items: { 'mt.main.view': '查看' } },
    dailycheck:  { name: '日常点检',    items: { 'mt.dailycheck.view': '查看', 'mt.dailycheck.execute': '执行/处理' } },
    plans:       { name: '保养计划',    items: { 'mt.plans.view': '查看', 'mt.plans.edit': '排期/生成' } },
    level1:      { name: '一级保养',    items: { 'mt.level1.view': '查看', 'mt.level1.execute': '执行/归档' } },
    level2:      { name: '二级保养',    items: { 'mt.level2.view': '查看', 'mt.level2.execute': '执行/归档' } },
    lubrication: { name: '设备润滑',    items: { 'mt.lubrication.view': '查看', 'mt.lubrication.execute': '执行/归档' } },
    inspection:  { name: '定期检查',    items: { 'mt.inspection.view': '查看', 'mt.inspection.execute': '执行/整改' } },
    repair:      { name: '维修工单',    items: { 'mt.repair.view': '查看', 'mt.repair.report': '报修', 'mt.repair.dispatch': '派工', 'mt.repair.repair': '维修', 'mt.repair.accept': '验收', 'mt.repair.approve': '审批' } },
    stdconfig:   { name: '标准文件配置', items: { 'mt.stdconfig.view': '查看', 'mt.stdconfig.edit': '配置' } },
    exam:        { name: '考试', items: { 'exam.config.view': '查看配置', 'exam.config.edit': '配置', 'exam.practice': '练习' } },
    course:      { name: '课程', items: { 'course.config.view': '查看配置', 'course.config.edit': '配置', 'course.view': '学习' } },
    assign:      { name: '车间分配',    items: { 'mt.assign.view': '查看', 'mt.assign.edit': '分配' } },
    assignmt:    { name: '维保分配',    items: { 'mt.assignmt.view': '查看', 'mt.assignmt.edit': '分配' } }
  } },
  approval: { name: '流转审批', pages: {
    main: { name: '审批中心', items: { 'approval.view': '查看', 'approval.approve': '审批' } }
  } },
  config: { name: '系统配置', pages: {
    main:       { name: '系统配置入口', items: { 'config.view': '查看' } },
    dict:       { name: '数据字典',  items: { 'config.dict.view': '查看', 'config.dict.edit': '编辑' } },
    assettypes: { name: '资产类型',  items: { 'config.assettypes.view': '查看', 'config.assettypes.edit': '编辑' } },
    deptws:     { name: '部门车间',  items: { 'config.deptws.view': '查看', 'config.deptws.edit': '编辑' } },
    params:     { name: '业务参数',  items: { 'config.params.view': '查看', 'config.params.edit': '编辑' } },
    roles:      { name: '角色管理',  items: { 'config.roles.view': '查看', 'config.roles.edit': '编辑' } },
    personnel:  { name: '人员管理',  items: { 'config.personnel.view': '查看', 'config.personnel.edit': '编辑' } }
  } }
};

// 全部权限串（admin 用）
function allPermissionKeys() {
  var out = [];
  Object.keys(PERMISSION_CATALOG).forEach(function (mk) {
    Object.keys(PERMISSION_CATALOG[mk].pages).forEach(function (pk) {
      Object.keys(PERMISSION_CATALOG[mk].pages[pk].items).forEach(function (perm) { out.push(perm); });
    });
  });
  return out;
}

// V1.9：系统角色 = 10 职责 + 系统管理员（角色即职责，共 11 类）
// 人员单一系统角色 → 直接决定菜单权限（hasPermission）与维保步骤执行权限（canExecuteStep 校验 roleId === step.role）
// 默认权限为页面级系统操作权限（模块→页面→动作，目录见 PERMISSION_CATALOG）
var ROLES = [
  { id: 'admin', name: '系统管理员', permissions: allPermissionKeys() },
  // V1.44 数据权限：车间四角色移除 ledger.view（看不到资产台账），可见数据按本人车间收窄（resolveDataScope）
  // V1.45：车间四角色增加 mt.level1.view（仅查看本车间一级保养单，不执行/归档）
  // V1.46 设备分配：四角色加 mt.assign.view（设备分配 tab）；主任/主管/组长加 mt.assign.edit（分配）
  { id: 'operator', name: '操作人员', permissions: ['dashboard.view',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
      'mt.inspection.view', 'mt.level1.view', 'mt.assign.view',
      'exam.practice', 'course.view'] },
  { id: 'opLeader', name: '操作班长', permissions: ['dashboard.view',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
      'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch', 'mt.level1.view',
      'mt.assign.view', 'mt.assign.edit',
      'exam.practice', 'course.view'] },
  { id: 'opSupervisor', name: '操作主管', permissions: ['dashboard.view',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
      'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch',
      'mt.plans.edit', 'approval.view', 'mt.level1.view',
      'mt.assign.view', 'mt.assign.edit',
      'exam.practice', 'course.view'] },
  { id: 'workshopDirector', name: '车间主任', permissions: ['dashboard.view',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.view', 'mt.repair.report',
      'mt.inspection.view', 'mt.inspection.execute', 'mt.plans.view', 'mt.repair.dispatch',
      'mt.plans.edit', 'approval.view', 'approval.approve', 'mt.level1.view',
      'mt.assign.view', 'mt.assign.edit',
      'exam.practice', 'course.view'] },
  // V1.49 维保分配：mt 四角色加 mt.assignmt.view（维保分配 tab）；主任/主管/班长加 mt.assignmt.edit（分配）
  { id: 'mtPersonnel', name: '维保人员', permissions: ['dashboard.view', 'ledger.view',
      'mt.main.view', 'mt.plans.view',
      'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute', 'mt.lubrication.view', 'mt.lubrication.execute',
      'mt.inspection.view', 'mt.inspection.execute',
      'mt.repair.view', 'mt.repair.report', 'mt.repair.repair', 'approval.view',
      'mt.assignmt.view',
      'exam.practice', 'course.view'] },
  { id: 'mtLeader', name: '维保班长', permissions: ['dashboard.view', 'ledger.view',
      'mt.main.view', 'mt.plans.view',
      'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute', 'mt.lubrication.view', 'mt.lubrication.execute',
      'mt.inspection.view', 'mt.inspection.execute',
      'mt.repair.view', 'mt.repair.report', 'mt.repair.repair', 'approval.view',
      'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.repair.dispatch',
      'mt.assignmt.view', 'mt.assignmt.edit',
      'exam.practice', 'course.view'] },
  { id: 'mtSupervisor', name: '维保主管', permissions: ['dashboard.view', 'ledger.view',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.plans.view', 'mt.plans.edit',
      'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute', 'mt.lubrication.view', 'mt.lubrication.execute',
      'mt.inspection.view', 'mt.inspection.execute', 'mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch', 'mt.repair.repair', 'mt.repair.accept', 'mt.repair.approve',
      'mt.stdconfig.view',
      'approval.view', 'approval.approve', 'config.view',
      'mt.assignmt.view', 'mt.assignmt.edit',
      'exam.practice', 'course.view'] },
  { id: 'mtDirector', name: '维保主任', permissions: ['dashboard.view', 'ledger.view', 'ledger.edit', 'ledger.delete',
      'mt.main.view', 'mt.dailycheck.view', 'mt.dailycheck.execute', 'mt.plans.view', 'mt.plans.edit',
      'mt.level1.view', 'mt.level1.execute', 'mt.level2.view', 'mt.level2.execute', 'mt.lubrication.view', 'mt.lubrication.execute',
      'mt.inspection.view', 'mt.inspection.execute', 'mt.repair.view', 'mt.repair.report', 'mt.repair.dispatch', 'mt.repair.repair', 'mt.repair.accept',
      'mt.stdconfig.view',
      'approval.view', 'config.view', 'config.dict.view', 'config.assettypes.view', 'config.deptws.view', 'config.params.view', 'config.roles.view', 'config.personnel.view', 'config.personnel.edit',
      'mt.assignmt.view', 'mt.assignmt.edit',
      'exam.practice', 'course.view'] },
  { id: 'archiver', name: '维保归档', permissions: ['dashboard.view', 'ledger.view',
      'mt.main.view', 'mt.stdconfig.view', 'approval.view',
      'mt.inspection.view', 'mt.inspection.execute'] },
  { id: 'viewer', name: '查看权限', permissions: ['dashboard.view', 'ledger.view', 'mt.main.view'] }
];

// 维修班组
var MAINTENANCE_TEAMS = [
  { id: 'team-1', name: '起重设备一室', dept: '生产保障部', leader: '' },
  { id: 'team-2', name: '起重设备二室', dept: '生产保障部', leader: '' },
  { id: 'team-3', name: '通用设备一室', dept: '生产保障部', leader: '' },
  { id: 'team-4', name: '通用设备二室', dept: '生产保障部', leader: '' },
  { id: 'team-5', name: '焊机工具一室', dept: '生产保障部', leader: '' }
];

// 人员数据库（V1.9：roleId = 11 类系统角色之一，单角色即职责）
// 迁移说明：原 equip-admin→mtDirector、mt-supervisor→mtSupervisor；原 repair-worker/normal-user 按原分层绑定语义
// 落为单一职责角色（如 p002 原车间主任绑定→workshopDirector、p004 原设备覆盖绑定→opLeader、p005 原班组绑定→mtLeader 等）
var PERSONNEL = [
  { id: 'p001', name: '袁涛',     employeeId: '10862253', dept: '精度部',       roleId: 'admin',          team: '',                 phone: '' },
  // 操作岗统一到 分段一部/曲组四车间（车间主任/操作人员/操作班长）
  { id: 'p002', name: '张建国',   employeeId: '10001001', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'workshopDirector', team: '', phone: '' },
  { id: 'p003', name: '李伟民',   employeeId: '10001002', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'operator',       team: '', phone: '' },
  { id: 'p004', name: '王海波',   employeeId: '10001003', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'opLeader',       team: '', phone: '' },
  // 维保岗统一到 生产保障部/通用设备一室（维保班长/维保人员/维保主任/维保主管）
  { id: 'p005', name: '陈志强',   employeeId: '10001004', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtLeader',       team: 'team-1', phone: '' },
  { id: 'p006', name: '刘明辉',   employeeId: '10001005', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtPersonnel',    team: 'team-2', phone: '' },
  { id: 'p007', name: '赵永刚',   employeeId: '10001006', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtPersonnel',    team: 'team-3', phone: '' },
  { id: 'p008', name: '孙晓峰',   employeeId: '10001007', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtPersonnel',    team: 'team-4', phone: '' },
  { id: 'p009', name: '周大伟',   employeeId: '10001008', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtDirector',     team: '', phone: '' },
  { id: 'p010', name: '邹伟林',   employeeId: '10002001', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtPersonnel',    team: 'team-5', phone: '' },
  { id: 'p011', name: '孙丽华',   employeeId: '10003001', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'operator',       team: '', phone: '' },
  { id: 'p012', name: '邹丽君',   employeeId: '10004001', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'operator',       team: '', phone: '' },
  { id: 'p013', name: '李健',     employeeId: '10005001', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'operator',       team: '', phone: '' },
  { id: 'p014', name: '邹红林',   employeeId: '10006001', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtPersonnel',    team: 'team-1', phone: '' },
  { id: 'p015', name: '李琳',     employeeId: '10007001', dept: '生产保障部',   workshop: '生产保障部-通用设备一室', roleId: 'mtSupervisor',   team: '', phone: '' },
  { id: 'p016', name: '陈海明',   employeeId: '10008001', dept: '仓库',         roleId: 'viewer',         team: '',                 phone: '' },
  // V1.46 设备分配演示：操作主管（分段一部 曲组四车间，原演示数据缺该角色层级）
  { id: 'p017', name: '吴刚',     employeeId: '10009001', dept: '分段一部',     workshop: '分段一部-曲组四车间', roleId: 'opSupervisor',   team: '', phone: '' }
];

// V1.50 维保分配：生产保障部各室主任（按设备维护部门 manageDept 自动带出，维保子 tab 只读展示「室主任」列）。
// 演示种子数据（人名可替换）；仅展示用，不参与角色/权限/数据范围/分配引擎。
var MANAGE_DEPT_DIRECTORS = {
  '生产保障部-综合管理室': { id: 'p110', name: '王海涛' },   // 当前全部设备 manageDept 均为此室
  '生产保障部-起重设备一室': { id: 'p111', name: '刘建华' },
  '生产保障部-起重设备二室': { id: 'p112', name: '赵国梁' },
  '生产保障部-通用设备一室': { id: 'p113', name: '孙立平' },
  '生产保障部-通用设备二室': { id: 'p114', name: '周明辉' },
  '生产保障部-焊机工具一室': { id: 'p115', name: '吴海峰' },
  '生产保障部-焊机工具二室': { id: 'p116', name: '郑文博' },
  '生产保障部-动能管理室':   { id: 'p117', name: '陈志明' }
};

// 辅助函数
function getRoleById(roleId) {
  return ROLES.find(function(r) { return r.id === roleId; });
}

function getPersonnelByRole(roleId) {
  return PERSONNEL.filter(function(p) { return p.roleId === roleId; });
}

function getPersonnelByTeam(teamId) {
  return PERSONNEL.filter(function(p) { return p.team === teamId; });
}

function getMaintenanceTeams() {
  return MAINTENANCE_TEAMS;
}

function getPersonnelById(personId) {
  return PERSONNEL.find(function(p) { return p.id === personId; });
}

function getTeamById(teamId) {
  return MAINTENANCE_TEAMS.find(function(t) { return t.id === teamId; });
}

// 权限检查：当前登录用户是否拥有指定权限
function hasPermission(perm) {
  if (!CURRENT_USER.roleId) return false;
  var role = getRoleById(CURRENT_USER.roleId);
  if (!role) return false;
  return role.permissions.indexOf(perm) >= 0;
}

// V1.44 数据权限：车间四角色（操作人员/操作班长/操作主管/车间主任）可见数据按本人车间收窄，其余角色全量
// 判定基于当前登录人（getPersonnelById），不信任请求体 personnelId（防伪造）
var SCOPED_ROLES = ['operator', 'opLeader', 'opSupervisor', 'workshopDirector'];
function resolveDataScope(personnel) {
  if (personnel && SCOPED_ROLES.indexOf(personnel.roleId) >= 0) {
    return { type: 'workshop', workshop: personnel.workshop || null };
  }
  return { type: 'all' };
}

module.exports = { USERS, CURRENT_USER, ROLES, PERMISSION_CATALOG, MAINTENANCE_TEAMS, PERSONNEL, MANAGE_DEPT_DIRECTORS, getRoleById, getPersonnelByRole, getPersonnelByTeam, getMaintenanceTeams, getPersonnelById, getTeamById, hasPermission, resolveDataScope };