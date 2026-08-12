// ===================== 车间分配 store（V1.46；V1.49 改由共享工厂 createAssignmentStore 实例化） =====================
// 设备逐级分配到人：车间主任(workshopDirector) → 操作主管(opSupervisor) → 操作组长(操作班长 opLeader) → 操作人员(operator)。
// 每台设备一个分配记录：{ supervisorId, leaderId, operatorIds }（字段可空=该级未分配；operatorIds 数组=V1.48 操作人员多选，可空数组=未分配）；允许跳级。
// 数据权限（决策①按分配收窄）：opSupervisor/opLeader/operator 只看到「本车间 ∩ 分配给自己」的设备；车间主任看全车间；维保岗/admin/viewer 全量。
// 执行强绑定（决策②）：日常点检班前/班后提交只有该设备被分配的 operator（多选集合中任意一人）能执行（canExecuteStep）。
// V1.49：车间分配 = createAssignmentStore 实例；本模块导出升级为「系统级数据范围 dispatcher」——
//   车间四角色 → 车间 store；维保四角色 → 维保 store（./mtAssignments，单向依赖无环）；其余（admin/viewer/archiver）→ 全量。
//   9 处列表调用点 require('./assignments').resolveVisibleCodes 零改动。
// ⚠️ storePath 指到 backend/ 之外（equipment_management/ 仓库根，assignments.json / mt_assignments.json）：
//    nodemon 递归监听 backend/ 内 .js/.mjs/.json，当前运行实例又不重读 nodemon.json 的 ignore/ext 配置，
//    落盘到 data/ 会在「保存分配的瞬间」触发后端重启 → CURRENT_USER 重置回 p001（用户被登出）。
//    放到 backend 之外后，落盘不再触发重启，会话保持。
const fs = require('fs');
const { createAssignmentStore } = require('./assignmentFactory');
const auth = require('./auth');

const wsStore = createAssignmentStore({
  name: '车间分配',
  file: 'assignments.json',
  levelRoles: { supervisor: 'opSupervisor', leader: 'opLeader', operator: 'operator' },
  levelNames: { supervisor: '主管', leader: '组长', operator: '操作人员' },
  fullNullRoles: ['admin'],
  scopeFullRole: 'workshopDirector',
  scopedRoles: ['opSupervisor', 'opLeader', 'operator'],
  baseScope: (personnel) => {
    const set = new Set();
    const { devices } = require('./devices');
    devices.forEach(d => { if (d.workshop === personnel.workshop) set.add(d.code); });
    return set;
  },
  assignRules: {
    opSupervisor: ['leader', 'operator'],
    opLeader: ['operator'],
  },
  assignNotes: {
    opSupervisor: '操作主管只能把名下设备分配给组长/操作人员',
    opLeader: '操作组长只能把名下设备分配给操作人员',
  },
  subordinateCheck: { opSupervisor: 'supervisorId', opLeader: 'leaderId' },
  // 演示种子：首次启动（assignments.json 不存在）时给 曲组四 前 5 台设备种完整分配链
  seed: ({ store, persist, storePath, devices }) => {
    if (fs.existsSync(storePath)) return;
    const codes = devices.filter(d => d.workshop === '分段一部-曲组四车间').slice(0, 5).map(d => d.code);
    codes.forEach(code => {
      store[code] = { supervisorId: 'p017', leaderId: 'p004', operatorIds: ['p003'], updatedAt: new Date().toISOString(), updatedBy: 'seed' };
    });
    persist();
  },
});

// ===================== 系统级数据范围 dispatcher（V1.49） =====================
// 返回当前登录人可见设备 code 集合；null = 全量。
// - 车间四角色 → 车间 store（workshopDirector 本车间全量；opSupervisor/opLeader/operator 本车间∩分配给我）
// - 维保四角色 → 维保 store（mtDirector 全量；mtSupervisor/mtLeader/mtPersonnel 全厂∩分配给我）
// - 其余（admin/viewer/archiver）→ 全量
const mtAssignments = require('./mtAssignments');
function resolveVisibleCodes(personnel) {
  if (!personnel) personnel = auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001');
  if (!personnel) return null;
  const role = personnel.roleId;
  if (role === 'mtDirector' || role === 'mtSupervisor' || role === 'mtLeader' || role === 'mtPersonnel') {
    return mtAssignments.resolveVisibleCodes(personnel);
  }
  return wsStore.resolveVisibleCodes(personnel);
}

module.exports = {
  assignments: wsStore.assignments,
  getAssignments: wsStore.getAssignments,
  getAssignment: wsStore.getAssignment,
  setAssignmentLevel: wsStore.setAssignmentLevel,
  setAssignmentLevels: wsStore.setAssignmentLevels,
  assignedCodeSet: wsStore.assignedCodeSet,
  candidatePersonnel: wsStore.candidatePersonnel,
  resolveVisibleCodes,
  LEVEL_ROLES: wsStore.LEVEL_ROLES,
};
