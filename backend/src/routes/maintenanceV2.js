const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { devices } = require('../data/devices');
const { CURRENT_USER, PERSONNEL, getPersonnelById, resolveDataScope, MAINTENANCE_TEAMS } = require('../data/auth');
const mc = require('../data/maintenanceConfig');
const v2 = require('../data/maintenanceV2');
const assignments = require('../data/assignments');   // V1.46 设备分配（统一数据范围 resolveVisibleCodes）
const mtAssignments = require('../data/mtAssignments');   // V1.49 维保分配（维修工单按指派可见 carve-out）

const uploadMemory = multer({ storage: multer.memoryStorage() }).single('file');

// 当前登录人（内存单例）
function curPersonnelId() { return CURRENT_USER.personnelId || 'p001'; }

// V1.44 数据权限：车间四角色可见数据按本人车间收窄（基于当前登录人，不信任请求体）
// ⚠️ maintenanceV2.js 的 devices 是 require('../data/devices') 直接解构出的数组（该模块导出 { devices, ... }），不是 {devices:[...]} 包一层
function dataScope() { return resolveDataScope(getPersonnelById(curPersonnelId())); }
function scopedCodeSet(scope) {
  if (scope.type !== 'workshop') return null;
  const set = new Set();
  devices.forEach(d => { if (d.workshop === scope.workshop) set.add(d.code); });
  return set;
}

// V1.57：该小类+文件类型在目标月是否已有（未作废）计划 → 该月模板锁定（已排期不可再改）
const FILE_TO_PROJECT = { '02': ['daily_check'], '03': ['level1'], '04': ['level2'], '05': ['lubrication'], '06': ['periodic_inspection'] };
function monthHasPlans(typeCode, fileCode, month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !FILE_TO_PROJECT[fileCode]) return false;
  const pts = FILE_TO_PROJECT[fileCode];
  const prefix = month + '-';
  return v2.generatedPlans.some(p => !p.voided && pts.includes(p.projectType)
    && (p.planDate || '').startsWith(prefix)
    && (mc.getDeviceByCode(p.deviceCode) || {}).typeCode === typeCode);
}

// ===================== 维保标准分配（§5.7，按 6 位小类，无继承） =====================
// 模板解析（直读小类）：GET /maintenance/templates/resolve?typeCode&fileCode[&month=YYYY-MM]
// V1.57：month 缺省 → 最新一条；指定月 → 该月记录（缺 → 未配置）
router.get('/templates/resolve', (req, res) => {
  const { typeCode, fileCode, month } = req.query;
  if (!typeCode || !fileCode) return res.status(400).json({ success: false, error: '缺少 typeCode/fileCode' });
  const r = mc.resolveTemplate(typeCode, fileCode, month || undefined);
  res.json({ success: true, data: { ...r, typeCode, fileCode, month: month || null } });
});

// 类型树（按大类/中类查模板状态）：GET /maintenance/templates/tree?major=02
router.get('/templates/tree', (req, res) => {
  const { major } = req.query;
  const full = require('../data/dict').DEVICE_TYPE_TREE;
  const majors = major ? { [major]: full[major] } : full;
  const walk = (node) => {
    const out = { code: node.code || '', name: node.name || '', children: [] };
    if (node.children) {
      out.children = Object.values(node.children).map(walk);
      // 中类节点汇总其下小类模板自定义数量
      out.customCount = out.children.reduce((a, c) => a + (c.customCount || 0), 0);
    } else {
      // 小类节点：标注固定 6 类模板配置状态（自定义/未配置，V1.17）
      const fileStates = {};
      let custom = 0;
      ['01', '02', '03', '04', '05', '06'].forEach(fc => {
        const r = mc.resolveTemplate(node.code, fc);
        fileStates[fc] = r.source;
        if (r.source === '自定义') custom++;
      });
      out.fileStates = fileStates;
      out.customCount = custom;
    }
    return out;
  };
  const tree = Object.values(majors).filter(Boolean).map(walk);
  res.json({ success: true, data: tree });
});

// 模块清单：GET /maintenance/templates/modules?typeCode=（每小类各自维护；懒播种 6 个默认模块）
// V1.57：每条记录 locked 补「该月已排期」判定（listTemplateRecords 无 plans 上下文，route 层补）+ 返回 today
// ⚠️ 静态段 modules 必须定义在参数路由 :typeCode/:fileCode 之前，否则会被误匹配
router.get('/templates/modules', (req, res) => {
  const { typeCode } = req.query;
  if (!typeCode) return res.status(400).json({ success: false, error: '缺少 typeCode' });
  const modules = mc.listTemplateModules(typeCode);
  modules.forEach(mod => {
    if (mod.records && mod.code !== '01') {
      mod.records.forEach(r => {
        if (r.month) r.locked = mc.isMonthLocked(typeCode, mod.code, r.month, monthHasPlans(typeCode, mod.code, r.month));
      });
    }
  });
  res.json({ success: true, data: modules, today: mc.serverTodayStr() });
});

// 新增模块：POST /maintenance/templates/modules {typeCode, code, name}
router.post('/templates/modules', (req, res) => {
  try {
    const { typeCode, code, name } = req.body;
    const tpl = mc.createTemplateModule(typeCode, code, name);
    res.status(201).json({ success: true, data: { typeCode, code, name: tpl.name, status: tpl.status } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// V1.57：复制月份记录（POST /templates/:typeCode/:fileCode/copy {fromMonth,toMonth}）
//   添加月份时「复制上一年同月/任意已配置月」为基础再改；fromMonth 缺省 = 上一年同月（添加 2026-09 → 复制 2025-09）
// ⚠️ 静态段 copy 须定义在参数路由 :typeCode/:fileCode 之前，否则会被误匹配
router.post('/templates/:typeCode/:fileCode/copy', (req, res) => {
  try {
    const { typeCode, fileCode } = req.params;
    if (!/^\d{6}$/.test(typeCode)) return res.status(400).json({ success: false, error: 'typeCode 须为 6 位小类编码' });
    if (fileCode === '01') return res.status(400).json({ success: false, error: '01 安全操作规程不参与按月复制' });
    let { fromMonth, toMonth } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(toMonth || '')) return res.status(400).json({ success: false, error: '缺少目标月份 toMonth（YYYY-MM）' });
    if (!/^\d{4}-\d{2}$/.test(fromMonth || '')) {
      fromMonth = (parseInt(toMonth.substring(0, 4), 10) - 1) + toMonth.substring(4); // 默认上一年同月
    }
    mc.assertMonthNotLocked(typeCode, fileCode, toMonth, monthHasPlans(typeCode, fileCode, toMonth));
    const rec = mc.copyTemplateRecord(typeCode, fileCode, fromMonth, toMonth);
    if (!rec) return res.status(400).json({ success: false, error: '源月份 ' + fromMonth + ' 无标准记录，请改用上传' });
    Object.keys(mc.configCache).forEach(k => delete mc.configCache[k]);
    res.json({ success: true, data: { typeCode, fileCode, fromMonth, toMonth, version: rec.version, name: rec.name, fileName: rec.fileName || '' } });
  } catch (e) {
    if (e.message.startsWith('403:')) return res.status(403).json({ success: false, error: e.message.slice(4) });
    res.status(400).json({ success: false, error: e.message });
  }
});

// 编辑模块（改名/改编号）：PUT /maintenance/templates/modules/:typeCode/:code {name, code?}
router.put('/templates/modules/:typeCode/:code', (req, res) => {
  try {
    const { typeCode, code } = req.params;
    const { name, code: newCode } = req.body;
    const tpl = mc.renameTemplateModule(typeCode, code, newCode, name);
    Object.keys(mc.configCache).forEach(k => delete mc.configCache[k]);
    res.json({ success: true, data: { typeCode, code: newCode || code, name: tpl.name, status: tpl.status, version: tpl.version } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// 小类模板维护：GET/PUT/DELETE /maintenance/templates/:typeCode/:fileCode（typeCode 须为 6 位小类）
// V1.57：GET ?month=YYYY-MM 返回该月记录 + 全部月份列表 + 锁定态（服务端 today 权威，前端禁用本地日期比较）
router.get('/templates/:typeCode/:fileCode', (req, res) => {
  const { typeCode, fileCode } = req.params;
  if (!/^\d{6}$/.test(typeCode)) return res.status(400).json({ success: false, error: 'typeCode 须为 6 位小类编码' });
  const month = fileCode === '01' ? null : (req.query.month || null);
  const rec = mc.getTemplateRecord(typeCode, fileCode, month);
  const r = mc.resolveTemplate(typeCode, fileCode, month || undefined);
  res.json({
    success: true,
    data: {
      typeCode, fileCode, month: month || null,
      configured: !!(rec && mc.hasTemplateContent(rec)),
      template: rec || null,
      records: mc.listTemplateRecords(typeCode, fileCode),
      resolved: r,
      today: mc.serverTodayStr(),
      locked: fileCode === '01' ? false : mc.isMonthLocked(typeCode, fileCode, month, monthHasPlans(typeCode, fileCode, month)),
    },
  });
});

router.put('/templates/:typeCode/:fileCode', (req, res) => {
  const { typeCode, fileCode } = req.params;
  if (!/^\d{6}$/.test(typeCode)) return res.status(400).json({ success: false, error: 'typeCode 须为 6 位小类编码' });
  const { month, ...content } = req.body || {};
  try {
    // V1.57：写回目标月记录——月份锁定校验（该月已执行/已排期 → 403 本月已执行，不可修改）；01 豁免
    if (fileCode !== '01') {
      if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ success: false, error: '缺少执行月份（YYYY-MM）' });
      mc.assertMonthNotLocked(typeCode, fileCode, month, monthHasPlans(typeCode, fileCode, month));
    }
  } catch (e) {
    if (e.message.startsWith('403:')) return res.status(403).json({ success: false, error: e.message.slice(4) });
    return res.status(400).json({ success: false, error: e.message });
  }
  const recMonth = fileCode === '01' ? null : month;
  const prev = mc.getTemplateRecord(typeCode, fileCode, recMonth);
  const saved = mc.setTemplateRecord(typeCode, fileCode, recMonth, {
    ...content,
    version: ((prev && prev.version) || 0) + 1,
  });
  // 清缓存 + 落盘（setTemplateRecord 内部 persist）
  Object.keys(mc.configCache).forEach(k => delete mc.configCache[k]);
  res.json({ success: true, data: { ...saved, month: recMonth || null, today: mc.serverTodayStr() } });
});

// 删除某月模板记录：DELETE /maintenance/templates/:typeCode/:fileCode?month=YYYY-MM（该月回退未配置 → 不生成）
router.delete('/templates/:typeCode/:fileCode', (req, res) => {
  const { typeCode, fileCode } = req.params;
  if (!/^\d{6}$/.test(typeCode)) return res.status(400).json({ success: false, error: 'typeCode 须为 6 位小类编码' });
  const month = req.query.month || null;
  try {
    // V1.57：该月已执行/已排期不可删除（后端拦截）；01 整桶删除豁免
    if (fileCode !== '01') {
      if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ success: false, error: '缺少执行月份（YYYY-MM）' });
      mc.assertMonthNotLocked(typeCode, fileCode, month, monthHasPlans(typeCode, fileCode, month));
    }
  } catch (e) {
    if (e.message.startsWith('403:')) return res.status(403).json({ success: false, error: e.message.slice(4) });
    return res.status(400).json({ success: false, error: e.message });
  }
  mc.deleteTemplateRecord(typeCode, fileCode, fileCode === '01' ? null : month);
  Object.keys(mc.configCache).forEach(k => delete mc.configCache[k]);
  res.json({ success: true, data: { typeCode, fileCode, month: month || null, deleted: true } });
});

// 模板 Excel 导入（按 小类 + 文件类型 + 执行月份）：POST /maintenance/templates/import (multipart: typeCode, fileCode, month, file)
// V1.18：02 点检保养标准为单槽（仅班前），无 part 参数
// V1.57：执行期 = 目标整月（month 推导），无起止日期选择；02-06 该月已执行/已排期 → 403
router.post('/templates/import', uploadMemory, (req, res) => {
  try {
    const { typeCode, fileCode, month } = req.body;
    if (!/^\d{6}$/.test(typeCode || '')) return res.status(400).json({ success: false, error: 'typeCode 须为 6 位小类编码' });
    if (!/^\d{2}$/.test(fileCode || '')) return res.status(400).json({ success: false, error: '模块编号须为 2 位数字: ' + fileCode });
    if (!req.file) return res.status(400).json({ success: false, error: '缺少文件（字段名 file）' });
    // 锁定校验在 XLSX.read 解析之前拦截，避免解析落盘后才 403 无法回滚
    if (fileCode !== '01') {
      if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ success: false, error: '缺少执行月份（YYYY-MM）' });
      mc.assertMonthNotLocked(typeCode, fileCode, month, monthHasPlans(typeCode, fileCode, month));
    }
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    let extraRows = null;
    const extraSheet = wb.SheetNames.find(n => n.includes('附加'));
    if (extraSheet) extraRows = XLSX.utils.sheet_to_json(wb.Sheets[extraSheet], { header: 1, defval: '', raw: true });
    // V1.17：固定 6 类（01-06）解析为维保结构化内容；其他编号仅存 rawRows（不再支持附加标准文件）
    const structured = ['01', '02', '03', '04', '05', '06'].includes(fileCode);
    const parsed = structured ? mc.parseTemplateExcel(fileCode, rows, extraRows) : { rawRows: rows };
    // 修复 multer 对中文文件名的编码问题（latin1 → utf8，与 app.js 上传同一手法）
    let originalName = req.file.originalname;
    try { originalName = Buffer.from(originalName, 'latin1').toString('utf8'); } catch (_) {}
    const recMonth = fileCode === '01' ? null : month;
    const prev = mc.getTemplateRecord(typeCode, fileCode, recMonth);
    const saved = mc.setTemplateRecord(typeCode, fileCode, recMonth, {
      ...parsed,
      name: (prev && prev.name) || mc.DEFAULT_MODULE_NAMES[fileCode] || ('标准文件' + fileCode),
      fileName: originalName, // 当前上传文件名（弹框展示）
      stdCode: typeCode + fileCode, // 标准文件编码：上传文件后自动生成
      version: ((prev && prev.version) || 0) + 1,
    });
    const count = parsed.items?.length || parsed.points?.length || parsed.categories?.length || parsed.safetyProcedure?.sections?.length || parsed.rawRows?.length || 0;
    Object.keys(mc.configCache).forEach(k => delete mc.configCache[k]);
    res.json({
      success: true,
      data: {
        typeCode, fileCode, month: recMonth || null, name: saved.name, stdCode: typeCode + fileCode,
        version: saved.version, count,
        today: mc.serverTodayStr(),
      },
    });
  } catch (e) {
    if (e.message.startsWith('403:')) return res.status(403).json({ success: false, error: e.message.slice(4) });
    res.status(400).json({ success: false, error: e.message });
  }
});

// ===================== 职责角色（§5.8） =====================
// V1.9：角色即职责，roleBindings/proxies 已废弃；resolveRoleBindings 按系统角色派生。
// 仅保留 role-bindings/options（TrainingView 使用）。

// 候选下拉：GET /maintenance/config/role-bindings/options
router.get('/config/role-bindings/options', (req, res) => {
  res.json({
    success: true,
    data: {
      roles: mc.ROLE_DEFS,
      personnel: PERSONNEL.map(p => ({ id: p.id, name: p.name, employeeId: p.employeeId, dept: p.dept, roleId: p.roleId })),
      teams: MAINTENANCE_TEAMS,
      workshops: Object.values(mc.dict && mc.dict.DEPT_WORKSHOP_TREE || {}).reduce((acc, d) => {
        Object.values(d.workshops || {}).forEach(w => acc.push({ code: w.code, name: w.name }));
        return acc;
      }, []),
    }
  });
});

// ===================== 实例（§5.3 / §5.2 步骤引擎） =====================
// 合成展示：GET /maintenance/device-config?deviceCode
router.get('/device-config', (req, res) => {
  const { deviceCode } = req.query;
  const d = mc.getDeviceByCode(deviceCode);
  if (!d) return res.status(404).json({ success: false, error: '设备不存在' });
  res.json({ success: true, data: mc.getDeviceConfig(d) });
});

// 实例列表：GET /maintenance/v2-plans
// V1.1 惰性生成（B4）：日常点检按日、定期检查按年月，读取即自动出单（全量设备，去白名单）
router.get('/v2-plans', (req, res) => {
  // V1.5：列表返回前刷新状态，超期/顺延实时
  v2.refreshStatuses();
  const { projectType, status, deviceCode, year, month, date } = req.query;
  if (projectType === 'daily_check') {
    v2.generateDailyChecksForDate(date || require('../data/helpers').fmtDate(new Date()));
  }
  let result = [...v2.generatedPlans];
  if (projectType) result = result.filter(p => p.projectType === projectType);
  if (status) result = result.filter(p => p.status === status);
  if (deviceCode) result = result.filter(p => p.deviceCode === deviceCode);
  if (year) result = result.filter(p => p.year === parseInt(year));
  if (month) result = result.filter(p => p.month === parseInt(month));
  if (date) result = result.filter(p => p.planDate === date);
  // V1.44/V1.46 数据权限：车间角色只可见本车间设备的计划；主管/组长/操作人员进一步按分配收窄（resolveVisibleCodes）
  const codes = assignments.resolveVisibleCodes(getPersonnelById(curPersonnelId()));
  if (codes) result = result.filter(p => codes.has(p.deviceCode));
  // 按计划日期倒序
  result.sort((a, b) => (b.planDate || '').localeCompare(a.planDate || ''));
  res.json({ success: true, data: result, total: result.length });
});

// 保养计划网格（§5.3(3) V1.3）：GET /maintenance/v2-plans/plan-config?workshop&year&level
// 返回 设备×12月 可勾选网格行（资产台账基本信息 + 级别 + 各月已有保养单摘要）
// level 为 'level1'|'level2'（一级/二级保养计划 tab）：仅返回配对应标准（03/04）设备的网格行，级别固定为该 level
// ⚠️ 必须注册在 /v2-plans/:id 之前，否则 'plan-config' 会被 :id 参数路由吞掉
router.get('/v2-plans/plan-config', (req, res) => {
  // V1.44 数据权限：车间四角色强制 workshop = 本人车间（忽略 query，防查别车间）
  const scope = dataScope();
  const workshop = scope.type === 'workshop' ? scope.workshop : req.query.workshop;
  if (!workshop) return res.status(400).json({ success: false, error: '缺少车间 workshop' });
  const { year, level } = req.query;
  const y = parseInt(year) || new Date().getFullYear();
  let rows = v2.planGrid(workshop, y, level);
  // V1.46 设备分配：主管/组长/操作人员 保养网格按名下设备收窄（主任仍全车间）
  const codes = assignments.resolveVisibleCodes(getPersonnelById(curPersonnelId()));
  if (codes) rows = rows.filter(r => codes.has(r.deviceCode));
  res.json({ success: true, data: { workshop, year: y, level: level || null, rows, total: rows.length } });
});

// 实例详情：GET /maintenance/v2-plans/:id
router.get('/v2-plans/:id', (req, res) => {
  const plan = v2.generatedPlans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ success: false, error: '计划不存在' });
  res.json({ success: true, data: plan });
});

// 全量生成（P0-2 初始化）：POST /maintenance/v2-generate
router.post('/v2-generate', (req, res) => {
  const created = v2.generateAll(req.body.year || new Date().getFullYear());
  res.json({ success: true, data: { generated: created.length, total: v2.generatedPlans.length } });
});

// 当日点检生成（惰性）：POST /maintenance/v2-generate-daily
router.post('/v2-generate-daily', (req, res) => {
  const date = req.body.date || require('../data/helpers').fmtDate(new Date());
  const created = v2.generateDailyChecksForDate(date);
  res.json({ success: true, data: { date, generated: created.length } });
});

// 保养计划批量保存（§5.3(3) B3 V1.3 设备×12月 网格）：勾选月份生成（级别由 tab 决定）
// body: { workshop, year, level: 'level1'|'level2', items: [{ deviceCode, months: [2,4,...] }] }
// V1.3：level 由前端 tab 传入，items 以该级别生成；不传 level 时回落模板自动定级（兼容）；仅生成、不作废（超期/作废逻辑本次不实现）
router.post('/v2-plans/batch', (req, res) => {
  try {
    // V1.44 数据权限：车间四角色强制 workshop = 本人车间（防跨车间批量生成）
    const scope = dataScope();
    const workshop = scope.type === 'workshop' ? scope.workshop : req.body.workshop;
    if (!workshop) return res.status(400).json({ success: false, error: '缺少车间 workshop' });
    // V1.46 设备分配：主管/组长/操作人员批量生成仅限名下设备（主任/全量角色不受限）
    const codes = assignments.resolveVisibleCodes(getPersonnelById(curPersonnelId()));
    const { year, level, items } = req.body;
    const y = parseInt(year) || new Date().getFullYear();
    const created = [];
    const alreadyExists = [];
    const skippedNoTemplate = [];
    // 勾选月份 → 按 tab 级别生成（未传 level 时回落模板自动定级）
    (Array.isArray(items) ? items : []).forEach(it => {
      const device = mc.getDeviceByCode(it.deviceCode);
      if (!device) return; // 设备不存在 → 跳过（前端已按车间过滤）
      if (device.workshop !== workshop) throw new Error('设备 ' + it.deviceCode + ' 不属于车间 ' + workshop);
      if (codes && !codes.has(it.deviceCode)) throw new Error('设备 ' + it.deviceCode + ' 未分配给本人，不能排期');
      const pt = level || v2.resolveMaintenanceLevel(device);
      if (!pt) {
        // 未配置 03/04 保养标准的小类设备：整台不参与（§5.3(3) V1.3）
        (Array.isArray(it.months) ? it.months : []).forEach(m => {
          skippedNoTemplate.push({ deviceCode: device.code, deviceName: device.name, level: null, month: parseInt(m) });
        });
        return;
      }
      (Array.isArray(it.months) ? it.months : []).forEach(m => {
        const mm = parseInt(m);
        const r = v2.generateDevicePlanAtMonth(device, pt, y, mm);
        if (r.created) created.push(r.plan);
        else if (r.reason === '未配置模板') skippedNoTemplate.push({ deviceCode: device.code, deviceName: device.name, level: pt, month: mm });
        else if (r.reason === '已存在') alreadyExists.push({ deviceCode: device.code, level: pt, month: mm });
      });
    });
    v2.refreshStatuses();
    const parts = [];
    if (created.length) parts.push(`已生成 ${created.length} 张${level === 'level1' ? '一级' : level === 'level2' ? '二级' : level === 'lubrication' ? '润滑' : ''}保养单`);
    if (alreadyExists.length) parts.push(`${alreadyExists.length} 张已存在（未重复生成）`);
    if (skippedNoTemplate.length) parts.push(`${skippedNoTemplate.length} 台次因未配置 ${level === 'level1' ? '03' : level === 'level2' ? '04' : level === 'lubrication' ? '05' : '03/04/05'} 标准被跳过`);
    const message = parts.length ? parts.join('；') : '无变更';
    res.json({ success: true, data: { workshop, year: y, level: level || null, created: created.length, alreadyExists, skippedNoTemplate, message } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// V1.33 图片附件上传（磁盘落盘 uploads/，复用 /uploads 静态服务 + 20MB 限制）：
// POST /maintenance/v2-plans/:id/step/:stepNo/attachment（multipart field=file）
const uploadAtt = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads')),
  filename: (req, file, cb) => {
    let on = file.originalname; try { on = Buffer.from(on, 'latin1').toString('utf8') } catch (_) {}
    cb(null, `v2-${req.params.id}-${req.params.stepNo}-${Date.now()}${path.extname(on) || '.png'}`)
  }
}), limits: { fileSize: 20 * 1024 * 1024 } }).single('file');
router.post('/v2-plans/:id/step/:stepNo/attachment', uploadAtt, (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '未收到文件' });
  res.json({ success: true, data: { url: '/uploads/' + req.file.filename, name: req.file.originalname } });
});

// V1.34 定期检查「发现问题」图片上传（通用端点，无 plan 依赖）：POST /maintenance/attachments（multipart field=file）
const uploadIssue = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads')),
  filename: (req, file, cb) => {
    let on = file.originalname; try { on = Buffer.from(on, 'latin1').toString('utf8') } catch (_) {}
    cb(null, `att-${Date.now()}${path.extname(on) || '.png'}`)
  }
}), limits: { fileSize: 20 * 1024 * 1024 } }).single('file');
router.post('/attachments', uploadIssue, (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '未收到文件' });
  res.json({ success: true, data: { url: '/uploads/' + req.file.filename, name: req.file.originalname } });
});

// 步骤流转：PUT /maintenance/v2-plans/:id/step/:stepNo
router.put('/v2-plans/:id/step/:stepNo', (req, res) => {
  const payload = { ...req.body, personnelId: req.body.personnelId || curPersonnelId() };
  try {
    const r = v2.advanceStep(req.params.id, parseInt(req.params.stepNo), payload);
    res.json({ success: true, data: r });
  } catch (e) {
    const status = e.message.startsWith('403') ? 403 : e.message.startsWith('409') ? 409 : 400;
    res.status(status).json({ success: false, error: e.message.replace(/^(403|409):/, '') });
  }
});

// 改期：PUT /maintenance/v2-plans/:id/reschedule
router.put('/v2-plans/:id/reschedule', (req, res) => {
  try {
    const plan = v2.reschedulePlan(req.params.id, req.body.newDate, { reason: req.body.reason, by: CURRENT_USER.name });
    res.json({ success: true, data: plan });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// 作废：PUT /maintenance/v2-plans/:id/void
router.put('/v2-plans/:id/void', (req, res) => {
  try {
    const plan = v2.voidPlan(req.params.id, { reason: req.body.reason, by: CURRENT_USER.name });
    res.json({ success: true, data: plan });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ===================== 培训（§5.3(5) 活动粒度） =====================
router.get('/training-records', (req, res) => {
  let result = [...v2.trainingRecords];
  const { year, month, status } = req.query;
  if (year) result = result.filter(t => t.year === parseInt(year));
  if (month) result = result.filter(t => t.month === parseInt(month));
  if (status) result = result.filter(t => t.status === status);
  res.json({ success: true, data: result, total: result.length });
});
router.post('/training-records', (req, res) => {
  const act = v2.createTrainingActivity(req.body);
  res.status(201).json({ success: true, data: act });
});
router.put('/training-records/:id', (req, res) => {
  try {
    const act = v2.advanceTraining(req.params.id, { ...req.body, personnelId: req.body.personnelId || curPersonnelId() });
    res.json({ success: true, data: act });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ===================== 维修工单 V2（§5.5 8步：报修→指派→接单→安全审核→完工提交→完工确认→完工审核→归档） =====================
// 创建维修：POST /maintenance/repair-orders
router.post('/repair-orders', (req, res) => {
  try {
    const rep = v2.createRepairOrder({ ...req.body, reporterPersonnelId: req.body.personnelId || curPersonnelId() });
    res.status(201).json({ success: true, data: rep });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// V2 维修列表：GET /maintenance/repair-orders
router.get('/repair-orders', (req, res) => {
  const { status, deviceCode } = req.query;
  const user = getPersonnelById(curPersonnelId());
  let result = v2.generatedPlans.filter(p => p.projectType === 'repair');
  if (status) result = result.filter(p => p.status === status);
  if (deviceCode) result = result.filter(p => p.deviceCode === deviceCode);
  // V1.49 维修工单可见性（决策③）：不按维保分配收窄，改按「工单指派」——
  //   维保人员(mtPersonnel)/维保班长(mtLeader) 只看到 repairData.assignee===本人 的工单（只派给谁谁可见）；
  //   维保主管(mtSupervisor)/维保主任(mtDirector) 作为指派/审核流程角色保持全局可见（需指派未分配工单/完工审核）。
  //   其余角色维持 V1.44/V1.46 车间数据范围（resolveVisibleCodes）。
  if (user && (user.roleId === 'mtPersonnel' || user.roleId === 'mtLeader')) {
    result = result.filter(p => p.repairData && p.repairData.assignee === user.id);
  } else if (!user || (user.roleId !== 'mtSupervisor' && user.roleId !== 'mtDirector')) {
    const codes = assignments.resolveVisibleCodes(user);
    if (codes) result = result.filter(p => codes.has(p.deviceCode));
  }
  result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ success: true, data: result, total: result.length });
});

// ===================== 整改跟踪（§5.10 问题7 闭环） =====================
router.get('/rectifications', (req, res) => {
  const { status } = req.query;
  let list = [...v2.rectifications];
  if (status) list = list.filter(r => r.status === status);
  // V1.44/V1.46 数据权限：车间角色只可见本车间设备的整改项；主管/组长/操作人员进一步按分配收窄
  const codes = assignments.resolveVisibleCodes(getPersonnelById(curPersonnelId()));
  if (codes) list = list.filter(r => codes.has(r.deviceCode));
  res.json({ success: true, data: list, total: list.length });
});
router.put('/rectifications/:id/close', (req, res) => {
  try {
    const r = v2.closeRectification(req.params.id, { note: req.body.note, by: CURRENT_USER.name });
    res.json({ success: true, data: r });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ===================== KPI / 台时（§5.4 / §5.9(3)） =====================
router.get('/kpi/daily', (req, res) => {
  const { deviceCode, year, month } = req.query;
  const rep = v2.dailyCheckReport(deviceCode, year, month);
  res.json({ success: true, data: rep });
});

router.get('/dashboard/kpi', (req, res) => {
  const { year, month } = req.query;
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  res.json({ success: true, data: v2.kpiDashboard(y, m) });
});

// V1.42 维保总览聚合（一次返回 统计卡/KPI/日历/超期预警/TOP5/分类分布/完成率/趋势，全部读 V2 generatedPlans）
router.get('/dashboard/overview', (req, res) => {
  const { year, month } = req.query;
  res.json({ success: true, data: v2.dashboardOverview(year, month) });
});

// 台时补录：POST /maintenance/kpi/upsert
router.post('/kpi/upsert', (req, res) => {
  const { deviceCode, date, runHours, faultStopHours, planStopHours } = req.body;
  const rec = v2.upsertKpi(deviceCode, date, { runHours, faultStopHours, planStopHours });
  res.json({ success: true, data: rec });
});

// ===================== 报表（§5.6；V1.41 仅保留日常点检页共用的 daily-check，专属 3 接口随统计报表 tab 删除） =====================
router.get('/reports/daily-check', (req, res) => {
  const { deviceCode, year, month } = req.query;
  res.json({ success: true, data: v2.dailyCheckReport(deviceCode, year, month) });
});

// ===================== 我负责的设备（§5.11 问题4） =====================
router.get('/my-devices', (req, res) => {
  const pid = req.query.personnelId || curPersonnelId();
  const user = getPersonnelById(pid);
  const out = [];
  devices.forEach(d => {
    if (!mc.isPilotDevice(d)) return;
    const bind = mc.resolveRoleBindings(d);   // 系统角色派生：roleKey → 该职责下人员
    // admin 覆盖全部职责 → 全部试点设备（演示便利）
    const roles = user && user.roleId === 'admin'
      ? Object.keys(bind)
      : Object.keys(bind).filter(rk => bind[rk].personnelIds.includes(pid));
    if (roles.length) out.push({ device: { code: d.code, name: d.name, typeCode: d.typeCode, area: d.area, assetClass: mc.resolveAssetClass(d) }, roles });
  });
  res.json({ success: true, data: out, total: out.length });
});

// ===================== Excel 导入（§5.9(5) 试点专用，校验接口） =====================
// 导入内容：设备匹配(code) + 资产分类 + 参与项目及频率 + 职责信息(10角色人员 + stepPermissions)
// 全部写入配置侧（deviceProjects / 职责绑定记录），不写回台账。资产分类直读台账 assetCategory。
router.post('/import/excel', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const errors = mc.validatePilotImport(rows);
  if (errors.length) return res.status(400).json({ success: false, errors, imported: 0 });
  rows.forEach(r => {
    // 资产分类：不再写覆盖（无 typeCode→分类映射层），维保频率直读台账 assetCategory
    // 参与项目及频率（{daily_check:{enabled,cycle}, ...}）
    if (r.projects && typeof r.projects === 'object') mc.deviceProjects.overrides[r.deviceCode] = r.projects;
    // V1.9：职责绑定不再导入（角色即职责，人员角色在人员管理维护）；仅保留步骤权限矩阵（stepMatrix）
    if (r.stepMatrix && typeof r.stepMatrix === 'object') {
      mc.stepPermissionOverrides[r.deviceCode] = r.stepMatrix;   // 职责信息→stepPermissions 逐台核对
    }
    delete mc.configCache[r.deviceCode];
  });
  res.json({ success: true, imported: rows.length });
});

module.exports = router;
