// ===================== 分配引擎工厂（V1.49） =====================
// 「设备分配拆分为 车间分配 + 维保分配，逻辑完全一致」的载体：
// createAssignmentStore(cfg) 参数化生成一个「设备→{supervisorId, leaderId, operatorIds}」分配 store。
// 车间 store（data/assignments.js，assignments.json）与 维保 store（data/mtAssignments.js，mt_assignments.json）
// 各实例化一份，共享同一套 读写/迁移/权限/数据范围/多选 逻辑（仅配置差异：角色、数据文件、基设备集、谁可设哪级）。
// 持久化：数据文件放仓库根（backend/ 之外），落盘不触发 nodemon 重启（见 assignments.js 头部注释）。
const fs = require('fs');
const path = require('path');
const { devices } = require('./devices');
const auth = require('./auth');

function createAssignmentStore(cfg) {
  // cfg:
  //   name              分配体系名（车间分配/维保分配，用于日志）
  //   file              数据文件名（仓库根，backend/ 之外）
  //   levelRoles        { supervisor, leader, operator } → 目标系统角色
  //   levelNames        { supervisor, leader, operator } → 中文名
  //   fullNullRoles     [roleId...] → 数据范围 null（全量）；车间=[admin]，维保=[admin,mtDirector]
  //   scopeFullRole     roleId|null → 体系顶级看 base 全量（车间=workshopDirector 本车间；维保 null，mtDirector 已走 fullNullRoles）
  //   scopedRoles       [roleId...] → 受「分配给我」收窄（baseScope ∩ 分配给我）
  //   baseScope         (personnel) => Set(deviceCode)  收窄前基设备集（车间=本车间，维保=全厂）
  //   assignRules       { roleId: [levelKey...] }  谁可设哪级；fullNullRoles 可设任意级
  //   assignNotes       { roleId: 'note' }  无权时的提示文案（可选）
  //   subordinateCheck  { roleId: 'supervisorId'|'leaderId' }  下级角色仅限自己名下设备继续下分
  //   seed              null | ({store, persist, storePath, devices}) => void  首次无数据文件时播种
  const store = {};   // deviceCode -> { supervisorId, leaderId, operatorIds, updatedAt, updatedBy }
  const storePath = path.join(__dirname, '..', '..', '..', cfg.file);

  function validDeviceCode(code) {
    return devices.some(d => d.code === code);
  }

  function load() {
    let migrated = false;
    try {
      const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      Object.entries(saved).forEach(([code, a]) => {
        if (!validDeviceCode(code)) return;   // 只接受真实设备编码，丢弃残留
        // V1.48 迁移：operatorId 单值 → operatorIds 数组（存量记录）
        if ('operatorId' in a) {
          a.operatorIds = a.operatorId ? [a.operatorId] : [];
          delete a.operatorId;
          migrated = true;
        }
        store[code] = a;
      });
    } catch (_) { /* 首次启动无文件，静默 */ }
    if (migrated) persist();   // 迁移后落盘新格式，保持磁盘一致
  }
  function persist() {
    try { fs.writeFileSync(storePath, JSON.stringify(store, null, 2)); }
    catch (e) { console.error('保存' + cfg.name + '失败:', e.message); }
  }

  function getAssignments() { return store; }
  function getAssignment(code) { return store[code] || null; }

  // 谁能分配哪级（允许跳级：顶级角色可设任意级）
  function canAssign(roleId, level) {
    if (cfg.fullNullRoles.includes(roleId)) return { allowed: true };
    const rules = cfg.assignRules[roleId];
    if (rules && rules.includes(level)) return { allowed: true };
    return { allowed: false, note: (cfg.assignNotes && cfg.assignNotes[roleId]) || '当前角色无权分配该层级' };
  }

  // 设置某级分配；personnelIds 数组（V1.48 起统一为数组，空数组=清空该级；兼容传单值自动包数组）。
  // actor = 当前登录人（不信任请求体，V1.44 防伪造）。
  // 错误以 '400:'/'403:' 前缀抛出，由路由映射 HTTP 状态码（与 advanceStep 同约定）。
  // 内部 _apply 只校验+写入内存不落盘；批量时先全量校验再统一 persist，避免部分生效。
  function _applyLevel(deviceCode, level, personnelIds, actor) {
    if (!validDeviceCode(deviceCode)) throw new Error('400:设备不存在');
    if (!cfg.levelRoles[level]) throw new Error('400:未知分配层级');
    if (!actor) throw new Error('403:未登录');

    const role = actor.roleId;
    const allow = canAssign(role, level);
    if (!allow.allowed) throw new Error('403:' + allow.note);

    // 下级角色仅限自己名下设备继续下分
    const a = store[deviceCode] || {};
    const subField = cfg.subordinateCheck[role];
    if (subField && a[subField] !== actor.id) {
      throw new Error('403:该设备未分配给本人，不能分配下级');
    }

    const ids = (Array.isArray(personnelIds) ? personnelIds : (personnelIds ? [personnelIds] : [])).filter(Boolean);

    // 目标人员校验（清空除外）
    if (level === 'operator') {
      // 操作级多选：逐人校验存在 + 角色匹配（空数组=清空，跳过）
      ids.forEach(id => {
        const t = auth.getPersonnelById(id);
        if (!t) throw new Error('400:人员不存在');
        if (t.roleId !== cfg.levelRoles[level]) {
          throw new Error('400:' + cfg.levelNames[level] + '须为角色「' + auth.getRoleById(cfg.levelRoles[level]).name + '」的人员');
        }
      });
    } else {
      // 主管/组长级仍单选：超过 1 人拒绝
      if (ids.length > 1) throw new Error('400:' + cfg.levelNames[level] + '仅支持单人分配');
      const id = ids[0] || null;
      if (id) {
        const target = auth.getPersonnelById(id);
        if (!target) throw new Error('400:人员不存在');
        if (target.roleId !== cfg.levelRoles[level]) {
          throw new Error('400:' + cfg.levelNames[level] + '须为角色「' + auth.getRoleById(cfg.levelRoles[level]).name + '」的人员');
        }
      }
    }

    // 存储：operator 存 operatorIds 数组（多选）；supervisor/leader 存单值 Id
    const next = { ...a, updatedAt: new Date().toISOString(), updatedBy: actor.id };
    if (level === 'operator') next.operatorIds = ids;
    else next[level + 'Id'] = ids[0] || null;
    store[deviceCode] = next;
    return next;
  }

  function setAssignmentLevel(deviceCode, level, personnelIds, actor) {
    const next = _applyLevel(deviceCode, level, personnelIds, actor);
    persist();
    return { ...next };
  }

  // 批量分配：先全量校验（含权限/目标人员），全部通过后统一落盘；单条失败则整体 400，不部分生效
  function setAssignmentLevels(deviceCodes, level, personnelIds, actor) {
    if (!Array.isArray(deviceCodes) || !deviceCodes.length) throw new Error('400:deviceCodes 不能为空');
    deviceCodes.forEach(code => _applyLevel(code, level, personnelIds, actor));
    persist();
    return deviceCodes.length;
  }

  // 按角色取「分配给我」的设备 code 集合
  function assignedCodeSet(roleId, personnelId) {
    const set = new Set();
    Object.keys(store).forEach(code => {
      const a = store[code];
      if (roleId === cfg.levelRoles.supervisor && a.supervisorId === personnelId) set.add(code);
      else if (roleId === cfg.levelRoles.leader && a.leaderId === personnelId) set.add(code);
      else if (roleId === cfg.levelRoles.operator && Array.isArray(a.operatorIds) && a.operatorIds.includes(personnelId)) set.add(code);
    });
    return set;
  }

  // 本体系数据范围：fullNullRoles → null（全量）；scopeFullRole → baseScope 全量；
  // scopedRoles → baseScope ∩ 分配给我；体系外角色 → null
  function resolveVisibleCodes(personnel) {
    if (!personnel) personnel = auth.getPersonnelById(auth.CURRENT_USER.personnelId || 'p001');
    if (!personnel) return null;
    const role = personnel.roleId;
    if (cfg.fullNullRoles.includes(role)) return null;
    if (role === cfg.scopeFullRole) return cfg.baseScope(personnel);
    if (!cfg.scopedRoles.includes(role)) return null;
    const base = cfg.baseScope(personnel);
    const mine = assignedCodeSet(role, personnel.id);
    return new Set([...base].filter(c => mine.has(c)));
  }

  // 分配候选人员：同 workshop（可空）；不传 workshop 返回该角色全部
  function candidatePersonnel(role, workshop) {
    return auth.PERSONNEL.filter(p => p.roleId === role && (!workshop || p.workshop === workshop));
  }

  load();
  if (cfg.seed) cfg.seed({ store, persist, storePath, devices, validDeviceCode });

  return {
    assignments: store, getAssignments, getAssignment,
    setAssignmentLevel, setAssignmentLevels,
    assignedCodeSet, candidatePersonnel, resolveVisibleCodes,
    LEVEL_ROLES: cfg.levelRoles,
  };
}

module.exports = { createAssignmentStore };
