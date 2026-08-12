// ===================== 维保分配 store（V1.49） =====================
// 设备逐级分配到人（维保侧）：维保主任(mtDirector，全量) → 维保主管(mtSupervisor) → 维保班长(mtLeader) → 维保人员(mtPersonnel，多选)。
// 与「车间分配」（./assignments.js）**同一套分配引擎**（createAssignmentStore，见 ./assignmentFactory.js），仅配置差异。
// 数据范围（决策①收窄扩展到维保岗）：mtSupervisor/mtLeader/mtPersonnel 只看到「全厂 ∩ 分配给自己」的设备，
//   维保主任(mtDirector) 全量。设备列表/保养计划/一级二级保养/设备润滑/定期检查经系统 dispatcher（assignments.resolveVisibleCodes）自动贯通。
// 执行强绑定（决策②）：定期检查发起（POST /inspections）、二级保养/设备润滑提交（level2/lubrication seq1）仅被分配维保人员/班长可执行。
// 持久化：mt_assignments.json（仓库根，backend/ 之外，落盘不触发 nodemon 重启）。
const fs = require('fs');
const { createAssignmentStore } = require('./assignmentFactory');

module.exports = createAssignmentStore({
  name: '维保分配',
  file: 'mt_assignments.json',
  levelRoles: { supervisor: 'mtSupervisor', leader: 'mtLeader', operator: 'mtPersonnel' },
  levelNames: { supervisor: '维保主管', leader: '维保班长', operator: '维保人员' },
  fullNullRoles: ['admin', 'mtDirector'],
  scopeFullRole: null,
  scopedRoles: ['mtSupervisor', 'mtLeader', 'mtPersonnel'],
  baseScope: () => {
    const set = new Set();
    const { devices } = require('./devices');
    devices.forEach(d => set.add(d.code));
    return set;
  },
  assignRules: {
    mtSupervisor: ['leader', 'operator'],
    mtLeader: ['operator'],
  },
  assignNotes: {
    mtSupervisor: '维保主管只能把名下设备分配给维保班长/维保人员',
    mtLeader: '维保班长只能把名下设备分配给维保人员',
  },
  subordinateCheck: { mtSupervisor: 'supervisorId', mtLeader: 'leaderId' },
  // 演示种子：首次启动（mt_assignments.json 不存在）时给 曲组四 前 5 台设备种完整维保链
  // mtSupervisor(p015)→mtLeader(p005)→mtPersonnel(p006)，保证强绑定后演示可用
  seed: ({ store, persist, storePath, devices }) => {
    if (fs.existsSync(storePath)) return;
    const codes = devices.filter(d => d.workshop === '分段一部-曲组四车间').slice(0, 5).map(d => d.code);
    codes.forEach(code => {
      store[code] = { supervisorId: 'p015', leaderId: 'p005', operatorIds: ['p006'], updatedAt: new Date().toISOString(), updatedBy: 'seed' };
    });
    persist();
  },
});
