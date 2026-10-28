// =====================================================================
// 设备维保配置侧新增模块（依据《设备维保业务逻辑调整方案-依据1615试验版》）
// =====================================================================
// 🔒 基础数据只读原则（硬约束，用户确认）：
//   设备台账(devices.js 4588台·40字段)、部门车间字典、资产类型树
//   （DEVICE_TYPE_TREE / TYPE_CODE_MAP）本轮零改动。
//   本文件全部为「配置侧新增」，运行时与台账只读数据【合成展示】。
// =====================================================================
const { devices } = require('./devices');
const dict = require('./dict');
const fs = require('fs');
const path = require('path');

// ===================== ① 职责角色字典（§5.8(2) 10角色） =====================
const ROLE_DEFS = [
  { roleKey: 'operator',          name: '操作人员',   cardinality: '1:N', scopeLevel: 'device',   group: 'operate',  description: '每台设备的操作工，可多人' },
  { roleKey: 'opLeader',          name: '操作班长',   cardinality: '1:1', scopeLevel: 'team',     group: 'operate',  description: '设备所属操作班班长' },
  { roleKey: 'opSupervisor',      name: '操作主管',   cardinality: '1:1', scopeLevel: 'workshop', group: 'operate',  description: '使用车间主管' },
  { roleKey: 'workshopDirector',  name: '车间主任',   cardinality: '1:1', scopeLevel: 'workshop', group: 'operate',  description: '全车间统一一人' },
  { roleKey: 'mtPersonnel',       name: '维保人员',   cardinality: '1:N', scopeLevel: 'team',     group: 'maintain', description: '维修工，可多人' },
  { roleKey: 'mtLeader',          name: '维保班长',   cardinality: '1:1', scopeLevel: 'team',     group: 'maintain', description: '复用现有维修班组（MAINTENANCE_TEAMS）' },
  { roleKey: 'mtSupervisor',      name: '维保主管',   cardinality: '1:1', scopeLevel: 'dept',     group: 'maintain', description: '维保科室负责人' },
  { roleKey: 'mtDirector',        name: '维保主任',   cardinality: '1:1', scopeLevel: 'dept',     group: 'maintain', description: '维保审批最终角色' },
  { roleKey: 'archiver',          name: '维保归档',   cardinality: '1:1', scopeLevel: 'global',   group: 'archive',  description: '归档操作人' },
  { roleKey: 'viewer',            name: '查看权限',   cardinality: '1:N', scopeLevel: 'global',   group: 'view',     description: '默认所有人；可收窄到指定部门/角色' },
];

// ===================== ② 项目类型 + 步骤引擎（§5.2 权威步序） =====================
// 每步 role 为「默认提示角色」，运行时以设备职责信息 stepPermissions 判定（§5.11 问题2）。
// signatures[] 支持多人依次提交（§5.12 问题1）；多班组轮班设备 allowMulti=true。
const PROJECT_TYPES = {
  daily_check: {
    name: '日常点检', fileCode: '02', allowMulti: true,
    steps: [
      { seq: 1, name: '班前提交',     action: '提交', role: 'operator' },
      { seq: 2, name: '班后提交',     action: '提交', role: 'operator' },
      { seq: 3, name: '确认',         action: '确认', role: 'opSupervisor' },
      { seq: 4, name: '归档',         action: '归档', role: 'archiver' },
    ],
  },
  level1: {
    name: '一级保养', fileCode: '03', allowMulti: false,
    steps: [
      { seq: 1, name: '提交',         action: '提交', role: 'operator' },
      { seq: 2, name: '验收',         action: '验收', role: 'opLeader' },
      { seq: 3, name: '确认',         action: '确认', role: 'opSupervisor' },
      { seq: 4, name: '归档',         action: '归档', role: 'archiver' },
    ],
  },
  level2: {
    name: '二级保养', fileCode: '04', allowMulti: false,
    steps: [
      { seq: 1, name: '提交',         action: '提交', role: 'mtLeader' },
      { seq: 2, name: '验收',         action: '验收', role: 'opLeader' },
      { seq: 3, name: '确认',         action: '确认', role: 'workshopDirector' },
      { seq: 4, name: '审核',         action: '审核', role: 'mtDirector' },
      { seq: 5, name: '归档',         action: '归档', role: 'archiver' },
    ],
  },
  lubrication: {
    // V1.17 恢复设备润滑：表单生成逻辑与二级保养一致（fileCode 05，审批链镜像 level2）
    name: '设备润滑', fileCode: '05', allowMulti: false,
    steps: [
      { seq: 1, name: '提交',         action: '提交', role: 'mtLeader' },
      { seq: 2, name: '验收',         action: '验收', role: 'opLeader' },
      { seq: 3, name: '确认',         action: '确认', role: 'workshopDirector' },
      { seq: 4, name: '审核',         action: '审核', role: 'mtDirector' },
      { seq: 5, name: '归档',         action: '归档', role: 'archiver' },
    ],
  },
  periodic_inspection: {
    name: '定期检查', fileCode: '06', allowMulti: false,
    steps: [
      { seq: 1, name: '提交',         action: '提交', role: 'mtPersonnel' },
      { seq: 2, name: '确认',         action: '确认', role: 'operator' },
      { seq: 3, name: '验收',         action: '验收', role: 'mtSupervisor' },
      { seq: 4, name: '审核',         action: '审核', role: 'mtDirector' },
      { seq: 5, name: '归档',         action: '归档', role: 'archiver' },
    ],
  },
  repair: {
    // V1.38：维修工单 6 步流程（报修(自动完成)→指派含安全审核→接单施工准备→完工提交→完工确认→完工审核自动归档）
    // 由 V1.37 8 步精简：安全审核并入指派（同为维保主管，指派即审批放行）；归档并入完工审核（通过即自动归档，去 archiver 步）
    // 强绑定：接单(seq3)/完工提交(seq4) 仅被指派人可提交
    name: '设备维修', fileCode: '08', allowMulti: false,
    steps: [
      { seq: 1, name: '报修',         action: '报修',     role: 'operator' },
      { seq: 2, name: '指派',         action: '指派',     role: 'mtSupervisor' },
      { seq: 3, name: '接单',         action: '接单',     role: 'mtPersonnel' },
      { seq: 4, name: '完工提交',     action: '完工提交', role: 'mtPersonnel' },
      { seq: 5, name: '完工确认',     action: '完工确认', role: 'opSupervisor' },
      { seq: 6, name: '完工审核',     action: '完工审核', role: 'mtDirector' },
    ],
  },
};

// ===================== ③ 资产分类频率表（§3.3，频率由台账 assetCategory 决定） =====================
// 键 = 台账设备.assetCategory（A/B/CT/C1/C2），直读台账，无 typeCode→资产分类映射层。
// 单位: level1/level2 次数每年（仅历史参考，V1.1 改由保养计划用户选月）；periodic 每月/每季/0；training 每月/0；daily 每天
const ASSET_CLASS_FREQUENCIES = {
  'A':  { level1: 2, level2: 2, periodic_inspection: 'month',   daily_check: 'daily' },  // 大型/特种桥吊（起重 A 类）
  'B':  { level1: 2, level2: 1, periodic_inspection: 'quarter', daily_check: 'daily' },  // 标准桥吊等（B 类）
  'CT': { level1: 1, level2: 0, periodic_inspection: 0,         daily_check: 'daily' },  // 焊切/动能设备
  'C1': { level1: 1, level2: 0, periodic_inspection: 0,         daily_check: 'daily' },  // 辅助设备（低维保）
  'C2': { level1: 0, level2: 0, periodic_inspection: 0,         daily_check: 0 },          // 不纳入维保
  'DEFAULT': 'B',   // 全局默认资产分类（台账 assetCategory 缺省 B，见 import-devices.js）
};

// ===================== ⑤ 试点白名单（§5.9(1)，Excel 43台设备编号清单为权威） =====================
// area 仅二次校验（现状"曲组四车间"有3613台，不能靠 area 精确圈定）。
const PILOT_CODES = [
  '16150201010001','16150201010002','16150201010003','16150201010004','16150201010005',
  '16150201010006','16150201010007','16150201010008','16150201010009','16150201010010',
  '16150201010011','16150201010012','16150201010013','16150201010014','16150201010015',
  '16150201010016','16150201010017','16150201010018','16150201010019','16150201010020',
  '16150201010021','16150201010022','16150201010023','16150201010024','16150201010025',
  '16150201010026','16150201010027','16150201010028','16150201010029','16150201010030',
  '16150201010031','16150201010032','16150201010033','16150201010034','16150201010035',
  '16150201010036','16150201010037','16150201010038','16150201010039','16150201010040',
  '16150201070001','16150201070002','16150201070003',
];

const pilotWhitelist = {
  workshopCodes: ['1615'],           // 曲组四车间（分段一部-曲组四车间）
  deviceCodes: [...PILOT_CODES],     // Excel 43台设备编号清单（权威）
};

// ===================== ⑥ 停产日/节假日日历（§5.12 问题4，可配置） =====================
// 保养/检查/润滑/培训实例落停产日 → 顺延至最近工作日；点检停产日照常生成（班前留空按三态选择/台时0）
const holidays = [
  '2026-02-15','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21',
  '2026-05-01','2026-05-02','2026-05-03',
  '2026-10-01','2026-10-02','2026-10-03',
];

// ===================== 设备参与项目配置覆盖（§5.3，设备级；默认按资产分类频率推导） =====================
const deviceProjects = {
  // overrides: { deviceCode: { projectType: { enabled, cycle } } }
  overrides: {},
};

// ===================== 维保标准分配（§5.7） =====================
// 模板主键 = (6位小类 typeCode, 2位模块编号 fileCode)。无继承、无全局兜底：
//   未配置模板的小类 → 不生成维保实例（§5.7 定稿）。
// 模块 = 每小类独立维护的清单：standardTemplates[typeCode][code] 即一个模块记录，
//   含 name(模块名称)、status、version、updatedAt、content、stdCode(标准文件编码=typeCode+code，上传时生成)。
// 懒播种：小类读取时按 DEFAULT_MODULE_NAMES 播种 6 个固定模板空桶（空桶未配置），
//   已有代码默认/持久化内容合并展示；仅变更时落盘。
// V1.17：固定 6 个模板（01安全操作规程/02点检保养标准/03一级/04二级/05设备润滑/06定期检查），
//   不可新增、不可删除、不可改编号；07 设备培训标准并入 01（培训复用安全操作规程）、
//   08 设备维保标准移除（维修走独立流程）。
// V1.18：02 点检保养标准改单槽——仅班前 items 上传（班后为固定表单：每日运行时间/故障停台时间/计划停台时间，不设模板）。
// V1.26：不再内置示范数据，全部小类由业务上传标准文件 Excel 生成（解析见 parseTemplateExcel）；
//   未配置小类显示 6 个懒播种空桶（listTemplateModules 按需生成，未配置不生成维保实例 §5.7 定稿）。
//   表头（labels）纯随上传 Excel 真实列名，无回退硬编码。
const DEFAULT_MODULE_NAMES = {
  '01': '安全操作规程', '02': '点检保养标准', '03': '一级保养标准', '04': '二级保养标准',
  '05': '设备润滑标准', '06': '定期检查标准',
};
const standardTemplates = {};

// ===================== 模板持久化（§5.7(6) 维保标准分配编辑/Excel 导入，重启不丢） =====================
// 保存态 standardTemplates.json 按 (小类, fileCode) 粒度覆盖代码默认；boot 合并保证
// 未保存到的 key 仍用代码默认。load 只接受 6 位数字小类 key（迁移：丢弃历史 GLOBAL 等），
// 下次 persist 自动清掉文件里的旧 key。
// ⚠️ 与 assignments.json 同理（V1.46）：storePath 指到 backend/ 之外（仓库根）——标准状态/执行期
// 落盘触发 nodemon 重启会引入 ~0.3-1s 502 断档（改版冒烟/测试竞态），移出 watch 树即根治。
const templateStorePath = path.join(__dirname, '..', '..', '..', 'standardTemplates.json');
function loadTemplateOverrides() {
  try {
    const saved = JSON.parse(fs.readFileSync(templateStorePath, 'utf8'));
    Object.entries(saved).forEach(([tc, files]) => {
      if (!/^\d{6}$/.test(tc)) return; // 迁移：跳过 GLOBAL 等非小类 key
      if (!standardTemplates[tc]) standardTemplates[tc] = {};
      Object.entries(files).forEach(([fc, tpl]) => {
        // V1.57 迁移：旧单记录结构（顶层带 validFrom/items，非 records 桶）→ 按月 records
        //   02-06 由 validFrom 前 7 位推导月份（如 08-01~08-29 → '2026-08'）；01 无执行期 → 存 '_'
        if (tpl && !tpl.records) {
          // V1.18 迁移：02 旧双槽结构（beforeShift/afterShift）→ 单槽（班前 items 归顶层；班后废弃不再读取）
          if (fc === '02' && tpl.beforeShift && !Array.isArray(tpl.items)) {
            tpl = migrate02ToSingleSlot(tpl);
          }
          const m = PERIOD_LOCK_FILE_CODES.includes(fc) && tpl.validFrom ? String(tpl.validFrom).substring(0, 7) : NON_MONTH_KEY;
          const { validFrom, validUntil, modifying, expiryContinue, ...rec } = tpl;
          standardTemplates[tc][fc] = { records: { [m]: rec } };
          return;
        }
        // 已是 records 结构：02 单槽迁移逐条应用
        if (fc === '02' && tpl && tpl.records) {
          Object.keys(tpl.records).forEach(m => {
            const r = tpl.records[m];
            if (r && r.beforeShift && !Array.isArray(r.items)) tpl.records[m] = migrate02ToSingleSlot(r);
          });
        }
        standardTemplates[tc][fc] = tpl;
      });
    });
  } catch (_) { /* 首次启动无文件，静默 */ }
}
function persistTemplateOverrides() {
  try { fs.writeFileSync(templateStorePath, JSON.stringify(standardTemplates, null, 2)); }
  catch (e) { console.error('保存模板失败:', e.message); }
}

// ===================== 标准文件全局设置（全年执行） =====================
// 开启后：已上传标准的小类模块不再按月反复「添加月份」；解析时当月无记录则回退最新已配置标准，
// 各月初对应维保项目自动按该标准执行。
const settingsStorePath = path.join(__dirname, '..', '..', '..', 'standardFileSettings.json');
const standardFileSettings = { yearRoundExecution: false };
function loadStandardFileSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsStorePath, 'utf8'));
    if (typeof saved.yearRoundExecution === 'boolean') {
      standardFileSettings.yearRoundExecution = saved.yearRoundExecution;
    }
  } catch (_) { /* 首次无文件 */ }
}
function persistStandardFileSettings() {
  try { fs.writeFileSync(settingsStorePath, JSON.stringify(standardFileSettings, null, 2)); }
  catch (e) { console.error('保存标准文件设置失败:', e.message); }
}
function isYearRoundExecution() { return !!standardFileSettings.yearRoundExecution; }
function getStandardFileSettings() {
  return { yearRoundExecution: isYearRoundExecution() };
}
function setStandardFileSettings(patch) {
  if (patch && typeof patch.yearRoundExecution === 'boolean') {
    standardFileSettings.yearRoundExecution = patch.yearRoundExecution;
  }
  persistStandardFileSettings();
  return getStandardFileSettings();
}
loadStandardFileSettings();
// boot 补名：代码默认/持久化记录缺 name 时按 DEFAULT_MODULE_NAMES 填充（V1.57：逐条 records 记录）
function ensureModuleNames() {
  Object.values(standardTemplates).forEach(files => {
    Object.entries(files).forEach(([code, tpl]) => {
      if (tpl && tpl.records) {
        Object.keys(tpl.records).forEach(m => {
          const r = tpl.records[m];
          if (r && !r.name && DEFAULT_MODULE_NAMES[code]) r.name = DEFAULT_MODULE_NAMES[code];
        });
      }
    });
  });
}
function deleteTemplate(typeCode, fileCode) {
  if (standardTemplates[typeCode]) {
    delete standardTemplates[typeCode][fileCode];
    if (Object.keys(standardTemplates[typeCode]).length === 0) delete standardTemplates[typeCode];
  }
  persistTemplateOverrides();
  return { success: true };
}

// V1.18：02 旧双槽（beforeShift/afterShift）→ 单槽（班前 items 归顶层；stdCode 保底；班后废弃）
function migrate02ToSingleSlot(tpl) {
  const b = tpl.beforeShift || {};
  const { beforeShift, afterShift, ...rest } = tpl;
  return {
    ...rest,
    name: rest.name || DEFAULT_MODULE_NAMES['02'],
    status: rest.status || 'active',
    version: rest.version || b.version || 1,
    items: Array.isArray(b.items) ? b.items : [],
    fileName: rest.fileName || b.fileName || '',
    updatedAt: rest.updatedAt || b.updatedAt || '',
  };
}

// 模板记录是否含内容（内容字段在记录顶层：items/points/categories/safetyProcedure/rawRows）
function hasTemplateContent(tpl) {
  if (!tpl) return false;
  if (tpl.items || tpl.points || tpl.categories || tpl.safetyProcedure || tpl.rawRows || tpl.questionBank) return true;
  return false;
}
// 模块项数（不同结构取对应数组长度）
function countItems(tpl) {
  if (!tpl) return 0;
  const qb = tpl.questionBank && tpl.questionBank.counts;
  if (qb) return (qb.single || 0) + (qb.multi || 0) + (qb.fill || 0) + (qb.essay || 0);
  return (tpl.items?.length || tpl.points?.length || tpl.categories?.length || tpl.safetyProcedure?.sections?.length || (tpl.rawRows && tpl.rawRows.length) || 0);
}

// V1.57：标准文件按月模型——执行期 = 日历整月。
//   02-06 五类（日常点检/一级/二级/润滑/定期检查）按「日历月」建记录（standardTemplates[typeCode][fileCode].records['YYYY-MM']），
//   执行期由月份推导（monthBounds），不再手工选起止日期；不再有「到期横幅 / 修改中锁 / 继续执行」状态机。
//   01 安全操作规程不参与执行期（无月份），存 records['_'] 单记录。
//   记录状态（相对当前月）：待执行（未来月）/ 执行中（本月）/ 已结束（已过月）。
//   锁定规则：该月已生成计划 || month < 当前月 || month == 当前月 → 禁上传/微调/删除（403 本月已执行，不可修改）。
//   服务端日期权威（fmtDate(new Date())），前端禁用本地日期比较。
const PERIOD_LOCK_FILE_CODES = ['02', '03', '04', '05', '06'];
const NON_MONTH_KEY = '_';   // 01 安全操作规程单记录键
function serverTodayStr() {
  const { fmtDate } = require('./helpers');
  return fmtDate(new Date());
}
// 'YYYY-MM'
function monthKey(y, m) { return y + '-' + String(m).padStart(2, '0'); }
function monthOf(dateStr) { return dateStr ? String(dateStr).substring(0, 7) : ''; }
function currentMonth() { return monthOf(serverTodayStr()); }
// 'YYYY-MM' → { validFrom:'YYYY-MM-01', validUntil:'YYYY-MM-月末日' }
function monthBounds(m) {
  if (!/^\d{4}-\d{2}$/.test(m || '')) return null;
  const y = parseInt(m.substring(0, 4), 10);
  const mm = parseInt(m.substring(5, 7), 10);
  const last = new Date(y, mm, 0).getDate();
  return { validFrom: m + '-01', validUntil: m + '-' + String(last).padStart(2, '0') };
}
// 该月相对当前月的状态：'待执行' | '执行中' | '已结束' | null（01/非法月）
function monthStatus(m) {
  if (!m || m === NON_MONTH_KEY || !/^\d{4}-\d{2}$/.test(m)) return null;
  const cur = currentMonth();
  if (m < cur) return '已结束';
  if (m === cur) return '执行中';
  return '待执行';
}
// V1.57b：该模块是否已配置过任何月份的标准文件（有内容）——「本月可选」判定依据：
//   从未配置过任何月份 → 本月可上传/可改/可删；已配置过（含仅未来月）→ 本月锁定，只能添加未来月
function moduleHasAnyRecord(typeCode, fileCode) {
  const b = templateBucket(typeCode, fileCode);
  if (!b) return false;
  return Object.keys(b.records).some(m => m !== NON_MONTH_KEY && hasTemplateContent(b.records[m]));
}
// 最新「有内容」月份键（全年执行底稿定位）
function latestConfiguredMonthKey(typeCode, fileCode) {
  const b = templateBucket(typeCode, fileCode);
  if (!b) return null;
  const monthKeys = Object.keys(b.records).filter(k => k !== NON_MONTH_KEY).sort();
  for (let i = monthKeys.length - 1; i >= 0; i--) {
    if (hasTemplateContent(b.records[monthKeys[i]])) return monthKeys[i];
  }
  return null;
}
// 月份/记录是否锁定（02-06）：该月已生成计划、过去月 → 锁定；当前月 → 该模块已配置过才锁定；01 豁免
// V1.57b：当前月不再恒锁——该模块从未配置过任何月份文件时本月可选（首次配置当月）
// 全年执行：允许改「最新已配置」那一条（全年底稿，可上传替换/微调）；其余月份只读；已排期仍锁
function isMonthLocked(typeCode, fileCode, month, plansExist) {
  if (!PERIOD_LOCK_FILE_CODES.includes(fileCode)) return false; // 01 豁免
  if (plansExist) return true; // 该月已生成计划 → 锁定（即使未来月也已排期）
  if (!month || month === NON_MONTH_KEY || !/^\d{4}-\d{2}$/.test(month)) return false;
  if (isYearRoundExecution()) {
    const latestKey = latestConfiguredMonthKey(typeCode, fileCode);
    if (!latestKey || month === latestKey) return false; // 底稿可改；尚无配置也可写
    return true; // 非最新月只读
  }
  if (month < currentMonth()) return true; // 过去月已执行
  if (month === currentMonth()) return moduleHasAnyRecord(typeCode, fileCode); // 本月：从未配置 → 可选
  return false;
}
function assertMonthNotLocked(typeCode, fileCode, month, plansExist) {
  if (isMonthLocked(typeCode, fileCode, month, plansExist)) throw new Error('403:本月已执行，不可修改');
}
// 模板桶（records 结构）
function templateBucket(typeCode, fileCode) {
  const b = standardTemplates[typeCode] && standardTemplates[typeCode][fileCode];
  return b && b.records ? b : null;
}
// 取某月记录；month 缺省/01 → 单记录（_）；month 未命中返回 null
function getTemplateRecord(typeCode, fileCode, month) {
  const b = templateBucket(typeCode, fileCode);
  if (!b) return null;
  if (month && month !== NON_MONTH_KEY) return b.records[month] || null;
  return b.records[NON_MONTH_KEY] || null;
}
// 最新一条月度记录（未指定月份兜底；01 取 _）
// 优先返回「有内容」的最新月份；全年执行回退依赖此语义
function latestTemplateRecord(typeCode, fileCode) {
  const b = templateBucket(typeCode, fileCode);
  if (!b) return null;
  const monthKeys = Object.keys(b.records).filter(k => k !== NON_MONTH_KEY).sort();
  if (monthKeys.length) {
    for (let i = monthKeys.length - 1; i >= 0; i--) {
      const rec = b.records[monthKeys[i]];
      if (hasTemplateContent(rec)) return rec;
    }
    return b.records[monthKeys[monthKeys.length - 1]];
  }
  return b.records[NON_MONTH_KEY] || null;
}
// 写记录（rec 合并进该月；自动补 name/status/updatedAt；落盘）
function setTemplateRecord(typeCode, fileCode, month, rec) {
  typeCode = (typeCode || '').padStart(6, '0');
  fileCode = String(fileCode || '').trim();
  if (!standardTemplates[typeCode]) standardTemplates[typeCode] = {};
  let b = standardTemplates[typeCode][fileCode];
  if (!b || !b.records) b = standardTemplates[typeCode][fileCode] = { records: {} };
  const key = month && month !== NON_MONTH_KEY ? month : NON_MONTH_KEY;
  const merged = { ...b.records[key], ...rec };
  if (!merged.name) merged.name = DEFAULT_MODULE_NAMES[fileCode] || ('标准文件' + fileCode);
  if (!merged.status) merged.status = 'active';
  merged.updatedAt = rec.updatedAt || serverTodayStr();
  b.records[key] = merged;
  persistTemplateOverrides();
  return merged;
}
// 复制记录（fromM → toM：内容+fileName+labels+name，version 归 1）；源不存在返回 null
function copyTemplateRecord(typeCode, fileCode, fromM, toM) {
  const src = getTemplateRecord(typeCode, fileCode, fromM);
  if (!src) return null;
  const { version, updatedAt, ...rest } = src;
  return setTemplateRecord(typeCode, fileCode, toM, { ...rest, version: 1 });
}
// 某年是否有该模板内容记录（生成门禁：planGrid/级别解析按年判断）
// 全年执行开启时：任意月份已配置即视为全年可用
function hasRecordInYear(typeCode, fileCode, year) {
  if (isYearRoundExecution() && moduleHasAnyRecord(typeCode, fileCode)) return true;
  const b = templateBucket(typeCode, fileCode);
  if (!b) return false;
  const prefix = String(year) + '-';
  return Object.keys(b.records).some(k => k !== NON_MONTH_KEY && k.startsWith(prefix) && hasTemplateContent(b.records[k]));
}
// 该模块月份记录清单（前端列表）
// 02-06 仅列出月份记录（空桶 '_' 播种跳过）；01 返回单记录（month=null）
function listTemplateRecords(typeCode, fileCode) {
  typeCode = (typeCode || '').padStart(6, '0');
  const b = templateBucket(typeCode, fileCode);
  if (!b) return [];
  return Object.keys(b.records)
    .filter(m => m !== NON_MONTH_KEY || fileCode === '01' || hasTemplateContent(b.records[m]))
    .map(m => {
    const rec = b.records[m];
    return {
      month: m === NON_MONTH_KEY ? null : m,
      name: rec.name || DEFAULT_MODULE_NAMES[fileCode] || ('标准文件' + fileCode),
      version: rec.version || 1,
      fileName: rec.fileName || '',
      stdCode: hasTemplateContent(rec) ? (rec.stdCode || typeCode + fileCode) : null,
      updatedAt: rec.updatedAt || '',
      configured: hasTemplateContent(rec),
      items: countItems(rec),
      status: m === NON_MONTH_KEY ? '未设置' : (monthStatus(m) || '未设置'),
      locked: m === NON_MONTH_KEY ? false : isMonthLocked(typeCode, fileCode, m, false),
    };
  }).sort((a, b) => {
    if (a.month === null) return -1;
    if (b.month === null) return 1;
    return a.month < b.month ? -1 : 1;
  });
}
// 删除某月记录（无 month → 删整个模块桶）
function deleteTemplateRecord(typeCode, fileCode, month) {
  typeCode = (typeCode || '').padStart(6, '0');
  const b = templateBucket(typeCode, fileCode);
  if (!b) return { success: false };
  if (month && month !== NON_MONTH_KEY) {
    delete b.records[month];
  } else {
    delete standardTemplates[typeCode][fileCode];
    if (Object.keys(standardTemplates[typeCode]).length === 0) delete standardTemplates[typeCode];
  }
  persistTemplateOverrides();
  return { success: true };
}

// V1.57：模板记录「生效」判定 = 有内容（执行期 = 该记录所在整月，不再单独校验起止日期）
function isTemplateEffective(tpl) {
  return !!tpl && hasTemplateContent(tpl);
}

// 该小类模块清单（V1.17：固定 6 个模板，缺桶即播种空桶；仅变更时落盘）。
// 07/08 及 09+ 附加模块不再展示（持久化里旧桶保留但固定列表不读它们）。
// V1.57：每模块返回 records[]（月份/状态/锁定/版本/文件名），01 单记录 month=null。
function listTemplateModules(typeCode) {
  typeCode = (typeCode || '').padStart(6, '0');
  if (!standardTemplates[typeCode]) standardTemplates[typeCode] = {};
  let seeded = false;
  Object.keys(DEFAULT_MODULE_NAMES).forEach(code => {
    if (!standardTemplates[typeCode][code]) {
      standardTemplates[typeCode][code] = { records: { [NON_MONTH_KEY]: { name: DEFAULT_MODULE_NAMES[code], status: 'inactive', version: 0 } } };
      seeded = true;
    }
  });
  // 02 若仍为旧双槽结构（beforeShift/afterShift）→ 迁移为单槽（班前 items 归顶层；覆盖持久化后/代码默认均兜底）
  const tpl02 = standardTemplates[typeCode]['02'];
  if (tpl02 && tpl02.records) {
    Object.keys(tpl02.records).forEach(m => {
      const r = tpl02.records[m];
      if (r && r.beforeShift && !Array.isArray(r.items)) tpl02.records[m] = migrate02ToSingleSlot(r);
    });
  }
  if (seeded) persistTemplateOverrides();

  return Object.entries(standardTemplates[typeCode])
    .filter(([code]) => DEFAULT_MODULE_NAMES[code] !== undefined)
    .map(([code]) => {
      const records = listTemplateRecords(typeCode, code);
      const latest = latestTemplateRecord(typeCode, code);
      return {
        code,
        name: (latest && latest.name) || DEFAULT_MODULE_NAMES[code] || ('标准文件' + code),
        slotType: 'single',
        configured: records.some(r => r.configured),
        version: (latest && latest.version) || 0,
        items: records.reduce((a, r) => a + r.items, 0),
        fileName: (latest && latest.fileName) || '',
        stdCode: records.find(r => r.stdCode) ? (records.find(r => r.stdCode).stdCode) : null,
        updatedAt: (latest && latest.updatedAt) || '',
        // V1.57：月份记录列表（month/status/locked/version/fileName/configured）
        records,
        periodStatus: code === '01' ? '未设置' : ((latest && latest.status) || '未设置'),
        locked: code === '01' ? false : !!(latest && latest.locked),
        effective: records.some(r => r.configured),
      };
    })
    .sort((a, b) => Number(a.code) - Number(b.code));
}

// 新增模块（空桶，未配置）
function createTemplateModule(typeCode, code, name) {
  typeCode = (typeCode || '').padStart(6, '0');
  code = String(code || '').trim();
  if (!/^\d{6}$/.test(typeCode)) throw new Error('typeCode 须为 6 位小类编码');
  if (!/^\d{2}$/.test(code)) throw new Error('模块编号须为 2 位数字');
  if (!standardTemplates[typeCode]) standardTemplates[typeCode] = {};
  if (standardTemplates[typeCode][code]) throw new Error('编号 ' + code + ' 已存在');
  // V1.57：records 桶结构（空桶单记录 '_'）
  standardTemplates[typeCode][code] = {
    records: { [NON_MONTH_KEY]: { name: (name || '').trim() || DEFAULT_MODULE_NAMES[code] || ('标准文件' + code), status: 'inactive', version: 0 } },
  };
  persistTemplateOverrides();
  return standardTemplates[typeCode][code];
}

// 编辑模块：改名 / 改编号（迁移内容桶；V1.57 逐条 records 记录补名）
function renameTemplateModule(typeCode, code, newCode, name) {
  typeCode = (typeCode || '').padStart(6, '0');
  code = String(code || '').trim();
  newCode = String(newCode == null ? code : newCode).trim();
  if (!/^\d{2}$/.test(newCode)) throw new Error('模块编号须为 2 位数字');
  if (!standardTemplates[typeCode] || !standardTemplates[typeCode][code]) throw new Error('模块不存在');
  if (newCode !== code) {
    if (standardTemplates[typeCode][newCode]) throw new Error('编号 ' + newCode + ' 已存在');
    standardTemplates[typeCode][newCode] = standardTemplates[typeCode][code];
    delete standardTemplates[typeCode][code];
  }
  const tpl = standardTemplates[typeCode][newCode];
  if (tpl && tpl.records) {
    Object.keys(tpl.records).forEach(m => {
      if (name !== undefined && String(name).trim()) tpl.records[m].name = String(name).trim();
      if (hasTemplateContent(tpl.records[m]) && newCode !== code) tpl.records[m].stdCode = typeCode + newCode; // 编码随编号迁移
    });
  }
  persistTemplateOverrides();
  return tpl;
}
loadTemplateOverrides();
ensureModuleNames();

// ===================== 派生缓存（运行时合成，不写回台账） =====================
// deviceConfigCache[code] = { assetClass, projects, personnel, stepPermissions, source... }
const configCache = {};

// ===================== 辅助函数 =====================

// 取设备（按 code）
function getDeviceByCode(code) {
  return devices.find(d => d.code === code);
}

// —— ① 模板解析（§5.7 按 6 位小类）：直读小类模块，无继承、无全局兜底 ——
// 未配置/空桶（无 content）→ 调用方在 content 为空时跳过生成（不生成维保实例）。
// 01-08 之外的编号可上传文件（rawRows）但维保生成不消费 → 天然"仅存储不生成"。
function resolveTemplate(typeCode, fileCode, month) {
  typeCode = (typeCode || '').padStart(6, '0');
  // V1.57：按月取记录——month 明确提供 → 精确该月（缺 → null，不回退，生成/报表按目标月判定）；
  //   month 缺省 → 最新一条（01 '_' 单记录；聚合/级别解析兜底）
  // 全年执行：指定月无记录时回退最新已配置标准，避免每月反复上传
  let tpl;
  let usedFallback = false;
  if (month && month !== NON_MONTH_KEY) {
    tpl = getTemplateRecord(typeCode, fileCode, month);
    if ((!tpl || !hasTemplateContent(tpl)) && isYearRoundExecution()) {
      const latest = latestTemplateRecord(typeCode, fileCode);
      if (latest && hasTemplateContent(latest)) {
        tpl = latest;
        usedFallback = true;
      }
    }
  } else {
    tpl = latestTemplateRecord(typeCode, fileCode);
  }
  if (tpl && (tpl.status === 'active' || usedFallback) && hasTemplateContent(tpl)) {
    return {
      content: tpl,
      source: usedFallback ? '全年执行(回退最新)' : '自定义',
      sourceLevel: '小类',
      sourceKey: typeCode,
      templateId: typeCode + fileCode,
      templateVersion: tpl.version,
      yearRoundFallback: usedFallback,
    };
  }
  return { content: null, source: '未配置', sourceLevel: null, sourceKey: null, templateId: null, templateVersion: 0 };
}

// ===================== 模板 Excel 解析（§5.7 按小类上传） =====================
// 每个标准模块（2位编号）一份 Excel。固定 6 个模块（01/02/03/04/05/06）解析为维保结构化内容。
// 可选第二个 sheet「附加」（列：类型 | 内容），供 04/05 填安全注意事项、06 填处理意见。
// V1.27 列名不设死规则：语义列探测「精确 → 包含 → 按列序兜底」，任意 ≥2 数据列的 Excel 均可上传。
// parseTemplateExcel(fileCode, rows, extraRows) 解析 → 模板内容对象；0 行抛错。

// 01 安全操作规程。业务文件是「序号 | 条款」：1/2/3 为章节标题，1.1、5.1、5.1.1 为条款（中间层如「5.1 操作前」保留在条款里）。
// 仍兼容旧表「章节 | 条款」（章节名变化即新章节）。
function parseSafetyProcedure(header, dataRows) {
  const get = (r, i) => (i == null || i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim());
  const findHeader = (names) => {
    for (const n of names) {
      const i = header.findIndex(h => h === n);
      if (i >= 0) return i;
    }
    return header.findIndex(h => h && names.some(n => h.includes(n)));
  };
  const codeIdx = findHeader(['序号', '编号']);
  const textIdx = findHeader(['条款', '内容']);
  const chapterIdx = findHeader(['章节']);
  const numbered = codeIdx >= 0 && dataRows.some(r => /^\d+(?:\.\d+)*$/.test(get(r, codeIdx)));
  if (numbered) {
    const bodyIdx = textIdx >= 0 && textIdx !== codeIdx ? textIdx : chapterIdx;
    if (bodyIdx < 0 || bodyIdx === codeIdx) throw new Error('Excel 未识别到「条款」列，请确认表头为「序号 / 条款」');
    const items = [];
    dataRows.forEach(r => {
      const code = get(r, codeIdx);
      const text = get(r, bodyIdx);
      if (!/^\d+(?:\.\d+)*$/.test(code) || !text) return;
      items.push({ code, text, depth: code.split('.').length });
    });
    if (!items.length) throw new Error('未解析到安全操作规程条款，请确认为「序号 / 条款」');
    const sections = [];
    let cur = null;
    items.forEach(it => {
      if (it.depth === 1) {
        cur = { seq: Number(it.code) || sections.length + 1, title: it.text, clauses: [] };
        sections.push(cur);
        return;
      }
      if (!cur) {
        cur = { seq: sections.length + 1, title: '规程', clauses: [] };
        sections.push(cur);
      }
      cur.clauses.push(it.code + ' ' + it.text);
    });
    sections.forEach((s, i) => { if (!s.seq) s.seq = i + 1; });
    return { sections, labels: { section: '章节', clause: header[bodyIdx] || '条款' } };
  }
  const ci = chapterIdx >= 0 ? chapterIdx : (textIdx >= 0 ? textIdx : 0);
  const cj = textIdx >= 0 && textIdx !== ci ? textIdx : -1;
  if (chapterIdx < 0 && textIdx < 0) throw new Error('Excel 未识别到「序号 / 条款」或「章节 / 条款」，请确认表头');
  const sections = [];
  let cur = null;
  dataRows.forEach(r => {
    const title = get(r, ci);
    const clause = get(r, cj);
    if (!title && !clause) return;
    if (/编制$/.test(title) && !clause) return;
    if (!cur || (title && title !== cur.title)) {
      cur = { title: title || ('章节' + (sections.length + 1)), clauses: [] };
      sections.push(cur);
    }
    if (clause) cur.clauses.push(clause);
  });
  sections.forEach((s, i) => { s.seq = i + 1; });
  if (!sections.length) throw new Error('未解析到安全操作规程内容');
  return { sections, labels: { section: header[ci] || '章节', clause: cj < 0 ? '条款' : (header[cj] || '条款') } };
}

function parseTemplateExcel(fileCode, rows, extraRows) {
  if (!rows || rows.length === 0) throw new Error('Excel 无数据');
  // 表头行探测：跳过前置标题/说明行（如合并的标题单元格），定位第一个含表头关键字的行；找不到则退回首行
  const HEADER_TOKENS = ['序号', '项目', '类别', '内容', '检查内容', '检查保养内容', '工序内容', '章节', '条款', '检查类别', '判定标准', '方法', '工具', '标准'];
  let hi = rows.findIndex(r => (r || []).some(c => HEADER_TOKENS.includes(String(c == null ? '' : c).trim())));
  if (hi < 0) hi = 0;
  const header = (rows[hi] || []).map(h => String(h == null ? '' : h).trim());
  const dataRows = rows.slice(hi + 1).filter(r => (r || []).some(c => String(c == null ? '' : c).trim() !== ''));
  if (dataRows.length === 0) throw new Error('未解析到内容行，请检查表头是否与样例一致');
  const get = (r, i) => (i == null ? '' : String(r[i] == null ? '' : r[i]).trim());
  // V1.27 列探测放宽（不设死规则）：① 精确匹配整列名 → ② 包含匹配（工序内容 含「内容」、合格标准 含「标准」等）→ ③ 按列序兜底（跳过序号列与已占用列）
  const seqIdx = header.indexOf('序号');
  const dataCols = header.map((h, i) => ({ i, h })).filter(d => d.h && d.i !== seqIdx);
  const used = new Set();
  const findCol = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) { used.add(i); return i; } }
    const d = dataCols.find(x => !used.has(x.i) && names.some(n => x.h.includes(n)));
    if (d) { used.add(d.i); return d.i; }
    return null;
  };
  const fallbackCol = () => {
    const d = dataCols.find(x => !used.has(x.i));
    if (d) { used.add(d.i); return d.i; }
    return null;
  };
  const tpl = { status: 'active' };

  if (fileCode === '01') {
    const safety = parseSafetyProcedure(header, dataRows);
    tpl.safetyProcedure = { sections: safety.sections };
    tpl.labels = safety.labels;
  } else if (fileCode === '02' || fileCode === '03' || fileCode === '04' || fileCode === '05') {
    // V1.27 语义池共享（02-05 不区分文件类型）：item 列=项目/类别/部位 任一；内容列=含「内容」任一列（工序内容/检查保养内容/检查内容/内容…）
    const ci = findCol(['类别', '项目', '部位']) ?? fallbackCol();
    const cj = findCol(['内容']) ?? fallbackCol();
    if (ci == null || cj == null) throw new Error('Excel 未识别到「项目/内容」列，请确认首行为表头（如：序号/项目/工序内容/合格标准）');
    const key = fileCode === '02' ? 'project' : 'category'; // 05 设备润滑同 03/04 表头：类别/内容/标准
    // 列索引一次性解析（map 内仅按索引取值）；标准/方法/工具 仅语义匹配、可选（不做位置兜底，避免把备注/周期等尾列误当标准）
    const cm = findCol(['方法']), ct = findCol(['工具', '工器具']), cs = fileCode === '02' ? null : findCol(['标准']);
    const items = dataRows.map(r => {
      const it = { [key]: get(r, ci), content: get(r, cj) };
      if (cm != null && get(r, cm)) it.method = get(r, cm);
      if (ct != null && get(r, ct)) it.tool = get(r, ct);
      if (cs != null && get(r, cs)) it.standard = get(r, cs);
      return it;
    }).filter(it => it.content);
    items.forEach((it, i) => { it.seq = i + 1; });
    tpl.items = items;
    // V1.19 表头快照：item(类别/项目/部位)/content/method/tool/standard 真实列名
    const labels = { item: header[ci], content: header[cj] };
    if (cm != null) labels.method = header[cm];
    if (ct != null) labels.tool = header[ct];
    if (cs != null) labels.standard = header[cs];
    tpl.labels = labels;
  } else if (fileCode === '06') {
    const cn = findCol(['检查类别', '检查项目', '项目', '类别']) ?? fallbackCol();
    const cs = findCol(['判定标准', '检查标准', '标准']) ?? fallbackCol();
    if (cn == null || cs == null) throw new Error('Excel 未识别到「检查类别/判定标准」列，请确认首行为表头（如：序号/检查类别/判定标准）');
    const checkCols = [];
    for (let i = 1; i <= 8; i++) { const x = findCol(['检查项' + i]); if (x != null) checkCols.push(x); }
    const categories = dataRows.map(r => {
      const cat = { name: get(r, cn), standard: get(r, cs) };
      const checkItems = checkCols.map(i => get(r, i)).filter(Boolean);
      if (checkItems.length) cat.checkItems = checkItems;
      return cat;
    }).filter(x => x.name || x.standard);
    categories.forEach((x, i) => { x.seq = i + 1; });
    tpl.categories = categories;
    // V1.19 表头快照：检查类别/判定标准/首个检查项 真实列名
    tpl.labels = { name: header[cn], standard: header[cs] };
    if (checkCols.length) tpl.labels.checkItems = header[checkCols[0]];
  } else {
    throw new Error('不支持的文件类型: ' + fileCode);
  }

  // 附加 sheet（类型|内容）→ 06 处理意见；「安全」行作安全告知兜底
  const extra = (extraRows || []).filter(r => (r || []).some(x => String(x == null ? '' : x).trim() !== ''))
    .map(r => ({ type: String(r[0] == null ? '' : r[0]).trim(), text: String(r[1] == null ? '' : r[1]).trim() }))
    .filter(x => x.text);
  const notices = extra.filter(x => x.type.includes('安全')).map(x => x.text);
  const opinions = extra.filter(x => x.type.includes('处理') || x.type.includes('意见')).map(x => x.text);
  if (fileCode === '06') {
    if (opinions.length) tpl.handlingOpinions = opinions;
    else tpl.handlingOpinions = ['停机处理', '列入维修计划（建议完成时限）', '继续观察运行'];
  }
  // V1.28 安全告知及注意事项 = 标题 + 文本（无文件上传），02-06 五类统一：
  // 主 sheet 表头前「安全告知及注意事项」行（标签单元格 + 相邻内容单元格多行文本，如二级保养标准.xlsx）自动带出；
  // 附加 sheet「安全」行兜底（title=安全告知及注意事项、content=各行文字换行拼接）；无则内容微调手动填写。
  if (['02', '03', '04', '05', '06'].includes(fileCode)) {
    let snTitle = '', snContent = '';
    for (const r of rows) {
      const ci = (r || []).findIndex(c => String(c == null ? '' : c).includes('安全告知'));
      if (ci >= 0) {
        snTitle = String(r[ci] == null ? '' : r[ci]).trim();
        const contentCell = (r || []).find((c, j) => j !== ci && String(c == null ? '' : c).trim() !== '');
        snContent = contentCell == null ? '' : String(contentCell).trim();
        break;
      }
    }
    if (snTitle || snContent) tpl.safetyNotice = { title: snTitle, content: snContent };
    else if (notices.length) tpl.safetyNotice = { title: '安全告知及注意事项', content: notices.join('\n') };
  }
  return tpl;
}

// —— ② 资产分类解析（§5.9(2)）：直接按台账 assetCategory，无 typeCode→分类映射层 ——
function resolveAssetClass(device) {
  if (!device) return null;
  const a = device.assetCategory;
  return ASSET_CLASS_FREQUENCIES[a] ? a : ASSET_CLASS_FREQUENCIES['DEFAULT'];
}

// —— ③ 参与项目配置（§5.3）：设备级覆盖 + 资产分类频率推导 ——
function resolveDeviceProjects(device) {
  const assetClass = resolveAssetClass(device);
  const freq = ASSET_CLASS_FREQUENCIES[assetClass] || ASSET_CLASS_FREQUENCIES[ASSET_CLASS_FREQUENCIES['DEFAULT']];
  const ov = deviceProjects.overrides[device.code] || {};
  const out = {};
  Object.keys(PROJECT_TYPES).forEach(pt => {
    if (pt === 'repair') return; // 维修随时，不排期
    const f = freq[pt] === undefined ? 0 : freq[pt];
    const enabled = f !== 0 && f !== undefined;
    const ovPt = ov[pt];
    const finalEnabled = ovPt ? (ovPt.enabled === undefined ? enabled : ovPt.enabled) : enabled;
    const finalFreq = ovPt && ovPt.cycle ? ovPt.cycle : f;
    out[pt] = { enabled: finalEnabled, cycle: finalFreq, assetClass };
  });
  // 培训默认参与（§3.3 每月），但按「培训活动」粒度执行（§5.3(5)），不逐设备生成实例
  return out;
}

// —— ④ 职责角色解析（§5.8 V1.9：角色即职责）——
// 人员系统角色 = 职责角色（10 职责 + 系统管理员）。按 PERSONNEL.roleId 派生各职责对应人员，
// 取代旧分层绑定级联（roleBindings 已废弃，CIMS/Excel 不再预置绑定）。
// 返回 { roleKey: { personnelIds: [], source: '系统角色', sourceRef: '直接' } }
function resolveRoleBindings(device) {
  const auth = require('./auth');
  const out = {};
  ROLE_DEFS.forEach(r => {
    const ids = auth.PERSONNEL.filter(p => p.roleId === r.roleKey).map(p => p.id);
    out[r.roleKey] = { personnelIds: ids, source: '系统角色', sourceRef: '直接' };
  });
  return out;
}

// —— ⑤ 步骤权限矩阵（§5.8(3) 职责信息→stepPermissions）——
// 按 角色+动作名 匹配项目步骤（非硬套数字）；默认按 PROJECT_TYPES.steps[].role 派生，
// 设备级可配置覆盖（职责信息矩阵，逐台核对写入 stepPermissionOverrides，不写回台账）。
// 返回 { projectType: { roleKey: [stepNo...] } }
const stepPermissionOverrides = {
  // { deviceCode: { projectType: { roleKey: [stepNo...] } } }
  // 示例：如某设备职责信息把"确认"步授权给 操作班长（而非默认 操作主管）
  // '16150201010001': { periodic_inspection: { operator: [2, 4] } }
};

function resolveStepPermissions(device) {
  const out = {};
  const ov = stepPermissionOverrides[device.code] || {};
  Object.keys(PROJECT_TYPES).forEach(pt => {
    const defs = PROJECT_TYPES[pt].steps;
    out[pt] = {};
    const ptOv = ov[pt] || {};
    // 先并入设备级覆盖，再并入默认派生（覆盖优先、默认兜底）
    Object.keys(ptOv).forEach(rk => { out[pt][rk] = [...ptOv[rk]]; });
    defs.forEach(s => {
      if (!out[pt][s.role]) out[pt][s.role] = [];
      if (out[pt][s.role].indexOf(s.seq) < 0) out[pt][s.role].push(s.seq);
    });
  });
  return out;
}

// —— ⑥ 合成展示：设备维保配置（§5.1 派生缓存）——
function getDeviceConfig(device) {
  if (!device) return null;
  if (configCache[device.code]) return configCache[device.code];
  const assetClass = resolveAssetClass(device);
  const projects = resolveDeviceProjects(device);
  const roleBind = resolveRoleBindings(device);
  const stepPermissions = resolveStepPermissions(device);
  const pilot = isPilotDeviceCode(device.code);
  // personnel 快照：各角色解析到的人员名（用于签字区下拉与展示）
  const auth = require('./auth');
  const personnel = {};
  Object.keys(roleBind).forEach(rk => {
    personnel[rk] = roleBind[rk].personnelIds.map(id => {
      const p = auth.getPersonnelById(id);
      return p ? { id: p.id, name: p.name, employeeId: p.employeeId, dept: p.dept } : null;
    }).filter(Boolean);
  });
  const cfg = {
    deviceCode: device.code,
    assetClass,
    assetCategory: device.assetCategory,   // 台账只读引用
    pilot,
    projects,                              // { projectType: {enabled, cycle, assetClass} }
    personnel,
    stepPermissions,
    roleBinding: roleBind,
  };
  configCache[device.code] = cfg;
  return cfg;
}

// configCache 为内部展示快照缓存（仅 /device-config 使用；步骤引擎实时读绑定不读缓存）
// 绑定变更后全清无副作用（configCache 是 const，只能逐 key 删除）
function clearConfigCache() {
  Object.keys(configCache).forEach(k => delete configCache[k]);
}

// —— ⑦ 试点判定（§5.9(1)）——
// 白名单 = 设备级清单（Excel 43台编号为权威）；workshopCodes 为车间归属标注（用于二次校验/筛选），
// 不自动纳入该车间全量设备（现状全部设备 useDeptCode=1615，按车间纳入会把 4588 台全部圈入）。
function isPilotDeviceCode(code) {
  return pilotWhitelist.deviceCodes.indexOf(code) >= 0;
}
function isPilotDevice(device) {
  return isPilotDeviceCode(device.code);
}

// —— ⑧ 节假日/工作日（§5.12 问题4）——
function isHoliday(dateStr) {
  if (holidays.indexOf(dateStr) >= 0) return true;
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6; // 周末默认停产
}
// 顺延至最近工作日
function nextWorkday(dateStr) {
  let d = new Date(dateStr);
  let guard = 0;
  const fmt = dd => dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
  while (isHoliday(fmt(d)) && guard < 30) { d.setDate(d.getDate() + 1); guard++; }
  return fmt(d);
}

// —— ⑧b 点检日判定（§5.3(4) 惰性生成用）——
// daily_check 频率：daily=每天 / weekly=每周固定日(默认周一) / monthly=每月固定日(默认1日)
// 停产日照常生成（班前留空按三态选择/台时0，§5.12 问题4）
function isCheckDay(device, dateStr) {
  const cfg = getDeviceConfig(device);
  const dc = cfg.projects['daily_check'];
  if (!dc || !dc.enabled) return false;
  const cycle = dc.cycle;
  if (cycle === 'daily') return true;
  const d = new Date(dateStr);
  if (cycle === 'weekly') return d.getDay() === 1;      // 周一
  if (cycle === 'monthly') return d.getDate() === 1;    // 1日
  return false;
}

// —— ⑨ 排期计算（§5.3(3)）：资产分类频率 → 年度具体日期 ——
// 返回 [ '2026-03-01', ... ]；cycle: 次数(1/2) 或 'month'/'quarter'/'weekly'/'daily'
// 支持首年剩余月份重排（§5.12 问题2）
function computeSchedule(projectType, cycle, year, opts) {
  opts = opts || {};
  const months = [];
  const dates = [];
  const pad = n => String(n).padStart(2, '0');
  if (cycle === 'month' || cycle === 'quarter') {
    const step = cycle === 'month' ? 1 : 3;
    for (let m = 1; m <= 12; m += step) months.push(m);
  } else if (typeof cycle === 'number' && cycle > 0) {
    // 次数/年：1次默认投产月(3月)、2次上/下半年(3月/9月)；支持首年剩余月份重排（§5.12 问题2）
    const cm = opts.currentMonth || 1;   // 入网当月（1-12），默认年初
    if (cycle === 1) {
      let m = opts.startMonth || 3;
      if (opts.firstYear && m < cm) m = 12;            // 投产月已过 → 顺延至当年12月
      months.push(m);
    } else {
      const def = [3, 9];
      // 首年且已过全部排期月 → 当年不生成（§5.12 问题2：次年按完整年排期）
      const remaining = def.filter(m => !opts.firstYear || m >= cm);
      if (remaining.length) months.push(...remaining);
    }
  } else if (cycle === 'weekly') {
    // 每周固定日（默认周一）
    for (let d = 1; d <= 365; d++) {
      const dt = new Date(year, 0, d);
      if (dt.getDay() === 1) dates.push(year + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()));
    }
    return dates.map(d => nextWorkday(d));
  } else if (cycle === 'daily') {
    // 惰性：不预生成（§5.3(4)），返回空，由生成器按日生成
    return [];
  }
  months.forEach(m => {
    let day = opts.startDay || 1;
    // 首年剩余月份重排：1次/年且投产月已过 → 顺延至当年最后剩余月份（12月）
    if (opts.firstYear && cycle === 1 && m < year && opts.currentMonth > 6) {
      m = 12;
    }
    const lastDay = new Date(year, m, 0).getDate();
    day = Math.min(day, lastDay);
    dates.push(nextWorkday(year + '-' + pad(m) + '-' + pad(day)));
  });
  // 去重 + 排序
  return [...new Set(dates)].sort();
}

// —— ⑩ 校验：设备编号/人员工号/频率合法性（§5.9(5) 导入校验）——
function validatePilotImport(rows) {
  const errors = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    if (!r.deviceCode) errors.push({ line, msg: '设备编号为空' });
    else {
      const d = getDeviceByCode(r.deviceCode);
      if (!d) errors.push({ line, msg: '设备编号不存在: ' + r.deviceCode });
      else if (!isPilotDeviceCode(r.deviceCode)) errors.push({ line, msg: '设备不在试点白名单: ' + r.deviceCode });
    }
    if (r.assetClass && !ASSET_CLASS_FREQUENCIES[r.assetClass]) errors.push({ line, msg: '资产分类非法: ' + r.assetClass });
    if (r.personIds) {
      r.personIds.forEach(pid => {
        if (!require('./auth').getPersonnelById(pid)) errors.push({ line, msg: '人员工号不存在: ' + pid });
      });
    }
  });
  return errors;
}

// ===================== 导出 =====================
module.exports = {
  ROLE_DEFS, PROJECT_TYPES, ASSET_CLASS_FREQUENCIES,
  pilotWhitelist, PILOT_CODES, holidays, deviceProjects,
  standardTemplates, configCache, clearConfigCache, stepPermissionOverrides, DEFAULT_MODULE_NAMES,
  PERIOD_LOCK_FILE_CODES, NON_MONTH_KEY, serverTodayStr,
  // V1.57：按月模型
  monthKey, monthOf, currentMonth, monthBounds, monthStatus,
  isMonthLocked, assertMonthNotLocked, moduleHasAnyRecord, latestConfiguredMonthKey,
  getTemplateRecord, latestTemplateRecord, setTemplateRecord, copyTemplateRecord,
  listTemplateRecords, deleteTemplateRecord, hasRecordInYear,
  hasTemplateContent, isTemplateEffective,
  persistTemplateOverrides, deleteTemplate, parseTemplateExcel,
  listTemplateModules, createTemplateModule, renameTemplateModule,
  standardFileSettings, getStandardFileSettings, setStandardFileSettings, isYearRoundExecution,
  getDeviceByCode, resolveTemplate, resolveAssetClass, resolveDeviceProjects,
  resolveRoleBindings, resolveStepPermissions, getDeviceConfig,
  isPilotDeviceCode, isPilotDevice, isHoliday, nextWorkday, isCheckDay, computeSchedule,
  validatePilotImport,
};
