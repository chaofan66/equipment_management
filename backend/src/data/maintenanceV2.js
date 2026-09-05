// =====================================================================
// 设备维保 V2 实例存储与生成引擎（依据《设备维保业务逻辑调整方案》）
// =====================================================================
// P0-2 计划生成引擎改造 + P0-3 步骤引擎（替换单一 status）。
// 双轨兼容：白名单内设备走 V2 实例；白名单外保持旧 plans(status)（§5.2 双轨兼容）。
// 试点切换（§5.9(1) 定稿）：切换日旧计划未来实例作废冻结，历史只读。
// =====================================================================
const { devices } = require('./devices');
const auth = require('./auth');
const { fmtDate } = require('./helpers');
const mc = require('./maintenanceConfig');
const assignments = require('./assignments');   // V1.46 设备分配（日常点检执行强绑定）
const mtAssignments = require('./mtAssignments');   // V1.49 维保分配（二级保养/设备润滑提交强绑定）

// ===================== V2 实例存储 =====================
const generatedPlans = [];     // 各项目实例（日常点检/一二级保养/定期检查/设备维保/培训）
const trainingRecords = [];    // 培训活动（§5.3(5) 按活动粒度，覆盖多台设备）
const kpiRecords = [];         // 台时记录（§5.9(3) 按设备运行日历逐日维护）
const rectifications = require('./maintenance').rectificationItems; // 整改跟踪（复用）

// V1.26：020101 代码默认模板已清除，演示一级保养单改静态快照（不再读 resolveTemplate('020101','03')）
const DEMO_L1_ITEMS = [
  { seq: 1,  category: '清洁', content: '整机清洁，清除油污、灰尘、铁屑', standard: '设备外观整洁无积垢' },
  { seq: 2,  category: '润滑', content: '各减速机、轴承座、钢丝绳加注润滑油（脂）', standard: '油位油质正常、润滑到位' },
  { seq: 3,  category: '紧固', content: '行走轮、联轴器、制动器底座螺栓检查复紧', standard: '无松动、力矩达标' },
  { seq: 4,  category: '钢丝绳', content: '钢丝绳外观检查，发现断丝/磨损超标登记', standard: '断丝数≤报废标准' },
  { seq: 5,  category: '吊钩', content: '吊钩裂纹、磨损检查', standard: '无裂纹，磨损≤5%' },
  { seq: 6,  category: '制动器', content: '制动器间隙调整、制动片磨损检查', standard: '间隙0.5-1mm，制动可靠' },
  { seq: 7,  category: '轨道', content: '轨道压板、接头检查', standard: '压板紧固、接头平整' },
  { seq: 8,  category: '电气', content: '控制柜清灰、接线端子紧固', standard: '柜内清洁、接线牢固' },
  { seq: 9,  category: '电气', content: '电动机绝缘、碳刷检查', standard: '绝缘合格、碳刷正常' },
  { seq: 10, category: '安全', content: '限位器、缓冲器、防碰撞装置检查', standard: '动作可靠' },
  { seq: 11, category: '安全', content: '接地电阻测量', standard: '≤4Ω' },
  { seq: 12, category: '试机', content: '空载运行各机构', standard: '无异响、异振、跑偏' },
  { seq: 13, category: '试机', content: '带载试吊', standard: '制动平稳、无溜钩' },
  { seq: 14, category: '记录', content: '填写保养记录', standard: '记录完整、签字齐全' },
];

// 演示点检项（静态快照，不依赖当月模板内容是否已复制）
const DEMO_DC_ITEMS = [
  { seq: 1, project: '电源检查', content: '电源指示灯正常，电源开启正常' },
  { seq: 2, project: '控制系统', content: '控制系统正常，操作杆灵敏可靠' },
  { seq: 3, project: '制动装置', content: '制动可靠，无溜钩' },
  { seq: 4, project: '钢丝绳', content: '外观无明显断丝、磨损超标' },
  { seq: 5, project: '安全装置', content: '限位器、缓冲器动作可靠' },
];

// 演示定期检查类别
const DEMO_PI_CATEGORIES = [
  { seq: 1, name: '钢结构', result: '', issue: '', handlingOpinion: '' },
  { seq: 2, name: '机械', result: '', issue: '', handlingOpinion: '' },
  { seq: 3, name: '液压', result: '', issue: '', handlingOpinion: '' },
  { seq: 4, name: '电气', result: '', issue: '', handlingOpinion: '' },
  { seq: 5, name: '安全装置', result: '', issue: '', handlingOpinion: '' },
];

// 签名审计快照（V1.22）：写时固存 姓名/工号/职务/时间，人员后续变更不影响已留痕记录
function signatureSnapshot(user, extra) {
  return Object.assign({
    personnelId: user.id, name: user.name,
    employeeId: user.employeeId || '', dept: user.dept || '',
    roleId: user.roleId || '', roleName: (auth.getRoleById(user.roleId) || {}).name || '',
    date: nowTs(),
  }, extra);
}

// V1.60：当前时刻时间戳 YYYY-MM-DDTHH:MM（与签名日期同格式，供 startedAt/completedAt 用）
function nowTs() {
  return fmtDate(new Date()) + 'T' + new Date().toTimeString().substring(0, 5);
}

// ===================== 实例状态派生 =====================
// V1.54：月度保养（一级/二级/设备润滑）超期判定改按「执行时间段」——
// 计划所在月处于标准文件配置执行期内即可正常操作（不显示已超期），执行期结束仍未完成才置「已超期」。
const MONTHLY_MAINT_TYPES = ['level1', 'level2', 'lubrication'];

// 月度保养计划自身执行期结束日（V1.54 起按执行期；V1.57 执行期=整月 → 生成时快照 periodUntil=该月月末，旧单无快照回退计划月末）
function monthlyPlanPeriodEnd(plan) {
  if (plan.periodUntil) return plan.periodUntil; // 新单快照（V1.54 生成时固存）
  const lastDay = new Date(plan.year, plan.month, 0).getDate(); // month 1 基 → new Date(y, month, 0) = 上月月末
  return plan.year + '-' + String(plan.month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
}

function deriveStatus(plan) {
  const allDone = plan.steps.every(s => s.status === 'done');
  if (allDone) return '已归档';
  const doneCount = plan.steps.filter(s => s.status === 'done').length;
  const current = plan.steps[doneCount];
  // 超期判定；维修为临时工单不按时间判超期
  if (current && !plan.dateExtended && plan.projectType !== 'repair') {
    if (MONTHLY_MAINT_TYPES.includes(plan.projectType)) {
      // V1.54：月度保养按执行时间段判超期（执行期结束仍未完成为已超期）
      if (monthlyPlanPeriodEnd(plan) < fmtDate(new Date())) return '已超期';
    } else {
      // 其余类型（日常点检/定期检查/培训）保持原「计划日期 + 宽限期」规则
      const overdueDays = {
        daily_check: 1, level1: 7, level2: 7, lubrication: 7, periodic_inspection: 7, training: 7,
      };
      const grace = overdueDays[plan.projectType] || 7;
      const p = new Date(plan.planDate); p.setDate(p.getDate() + grace);
      if (new Date() > p) return '已超期';
    }
  }
  if (doneCount === 0) return '待执行';
  return '进行中';
}

// 刷新全部实例状态（超期/紧急超时自动标记）
function refreshStatuses() {
  generatedPlans.forEach(p => {
    if (p.voided || p.status === '已归档') return;
    // §5.12 问题8：紧急维修 24h 未补全流程 → 超时红标
    if (p.projectType === 'repair' && p.repairData && p.repairData.emergency && p.createdAt) {
      const created = new Date(p.createdAt);
      if (!isNaN(created) && Date.now() - created > 24 * 3600 * 1000) p.flowTimeout = true;
    }
    p.status = deriveStatus(p);
  });
}

// ===================== 整改跟踪（§5.10 问题7 闭环） =====================
// 复查闭环：完成整改 → 关闭；超期 → 催办（状态标"已超期"）
function markOverdueRectifications() {
  const today = fmtDate(new Date());
  rectifications.forEach(r => {
    if (r.status === '进行中' && r.deadline && r.deadline < today) r.status = '已超期';
  });
}
function closeRectification(rectId, payload) {
  const r = rectifications.find(x => x.id === rectId);
  if (!r) throw new Error('整改记录不存在');
  r.status = '已关闭';
  r.closedAt = fmtDate(new Date());
  r.closeNote = payload.note || '';
  r.closer = payload.by || '';
  return r;
}

// ===================== 实例生成（§5.3 分配链路） =====================
let seq = 100;
function genId(prefix) {
  seq += 1;
  return prefix + '-' + String(seq).padStart(4, '0');
}

// 日期 + n 天（整改期限等）
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function buildSteps(projectType, date) {
  return mc.PROJECT_TYPES[projectType].steps.map(s => ({
    seq: s.seq, name: s.name, action: s.action, role: s.role,
    status: 'pending', signatures: [], date: null,
  }));
}

// 演示种子签名（固定人员，便于报表/流程页展示）
const DEMO_SIG_BY_ROLE = {
  operator:         { personnelId: 'p002', name: '张建国', employeeId: '10001001', dept: '总装一部', roleId: 'workshopDirector', roleName: '车间主任' },
  opLeader:         { personnelId: 'p004', name: '王海波', employeeId: '10001003', dept: '加工一部', roleId: 'opLeader', roleName: '操作班长' },
  opSupervisor:     { personnelId: 'p001', name: '袁涛', employeeId: '10862253', dept: '精度部', roleId: 'admin', roleName: '系统管理员' },
  mtPersonnel:      { personnelId: 'p005', name: '陈志强', employeeId: '10001004', dept: '总装二部', roleId: 'mtLeader', roleName: '维保班长' },
  mtLeader:         { personnelId: 'p005', name: '陈志强', employeeId: '10001004', dept: '总装二部', roleId: 'mtLeader', roleName: '维保班长' },
  mtSupervisor:     { personnelId: 'p015', name: '李琳', employeeId: '10007001', dept: '生产保障部', roleId: 'mtSupervisor', roleName: '维保主管' },
  mtDirector:       { personnelId: 'p009', name: '周大伟', employeeId: '10001008', dept: '生产保障部', roleId: 'mtDirector', roleName: '维保主任' },
  workshopDirector: { personnelId: 'p002', name: '张建国', employeeId: '10001001', dept: '总装一部', roleId: 'workshopDirector', roleName: '车间主任' },
  archiver:         { personnelId: 'p009', name: '周大伟', employeeId: '10001008', dept: '生产保障部', roleId: 'mtDirector', roleName: '维保主任' },
};

function demoMonthEnd(year, month) {
  const last = new Date(year, month, 0).getDate();
  return year + '-' + String(month).padStart(2, '0') + '-' + String(last).padStart(2, '0');
}

function demoSteps(projectType, doneCount, dateStr) {
  return mc.PROJECT_TYPES[projectType].steps.map((s, idx) => {
    const done = idx < doneCount;
    const base = DEMO_SIG_BY_ROLE[s.role] || DEMO_SIG_BY_ROLE.operator;
    return {
      seq: s.seq, name: s.name, action: s.action, role: s.role,
      status: done ? 'done' : 'pending',
      signatures: done ? [{ ...base, date: dateStr + 'T' + String(8 + idx).padStart(2, '0') + ':00' }] : [],
      date: done ? dateStr : null,
    };
  });
}

function demoDevice(code) {
  const d = devices.find(x => x.code === code) || {};
  return {
    deviceCode: code,
    deviceName: d.name || '通用桥式起重机',
    spec: d.spec || 'G=40/20,S=46.5,H=16.9',
    area: d.area || '曲组四车间第一区',
    dept: d.department || d.dept || '分段一部',
    assetClass: (d.code && mc.getDeviceConfig(d)?.assetClass) || 'Bc',
  };
}

function pushDemoPlan(plan) {
  generatedPlans.push(plan);
  return plan;
}

// 演示状态种子：2026-03~07 覆盖点检/一二级保养/润滑/定期检查/维修，及 待执行/进行中/已超期/已归档
function seedDemoData() {
  // 复制 8 月标准到 3~7 月，便于切换月份时 KPI/点检报表有生效模板（幂等：已有则跳过）
  ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'].forEach(m => {
    ['02', '03', '04', '06'].forEach(fc => {
      if (!mc.getTemplateRecord('020101', fc, m)) {
        mc.copyTemplateRecord('020101', fc, '2026-08', m);
      }
    });
  });

  const D1 = '16150201010001';
  const D2 = '16150201010002';
  const D3 = '16150201010003';
  const D4 = '16150201010004';
  const D5 = '16150201010005';

  function basePlan(id, projectType, deviceCode, planDate, extra) {
    const y = parseInt(planDate.substring(0, 4), 10);
    const m = parseInt(planDate.substring(5, 7), 10);
    const fileCode = mc.PROJECT_TYPES[projectType].fileCode;
    return Object.assign({
      id, projectType, ...demoDevice(deviceCode),
      planDate, year: y, month: m,
      periodUntil: demoMonthEnd(y, m),
      templateId: '020101' + fileCode, templateVersion: 1, templateSource: '自定义',
      status: '待执行', version: 1, source: 'generated', voided: false, dateExtended: false,
    }, extra);
  }

  // ---- 日常点检 ----
  function seedDaily(id, deviceCode, planDate, { doneCount, dateExtended, itemsState, afterShift }) {
    const states = itemsState || DEMO_DC_ITEMS.map(() => '正常');
    pushDemoPlan(basePlan(id, 'daily_check', deviceCode, planDate, {
      checkNo: planDate.replace(/-/g, '') + id.slice(-6).replace(/\D/g, '').padStart(6, '0').slice(-6),
      labels: { item: '项目', content: '检查保养内容' },
      items: DEMO_DC_ITEMS.map((it, i) => ({ ...it, state: states[i] || '正常', remark: '', handled: states[i] === '异常' ? false : undefined })),
      afterShiftItems: [],
      afterShift: afterShift || { runHours: 7.5, faultStopHours: 0.5, planStopHours: 0 },
      steps: demoSteps('daily_check', doneCount, planDate),
      dateExtended: !!dateExtended,
      status: doneCount >= 4 ? '已归档' : '待执行',
    }));
  }

  // ---- 月度保养（一级/二级/润滑） ----
  function seedMaint(id, projectType, deviceCode, planDate, { doneCount, dateExtended, allChecked }) {
    const checked = allChecked !== false;
    pushDemoPlan(basePlan(id, projectType, deviceCode, planDate, {
      labels: { item: '类别', content: '内容', standard: '合格标准' },
      items: DEMO_L1_ITEMS.map(i => ({ ...i, checked, remark: '' })),
      steps: demoSteps(projectType, doneCount, planDate),
      dateExtended: !!dateExtended,
      status: doneCount >= mc.PROJECT_TYPES[projectType].steps.length ? '已归档' : '待执行',
    }));
  }

  // ---- 定期检查 ----
  function seedPI(id, deviceCode, planDate, { doneCount, dateExtended, categories }) {
    pushDemoPlan(basePlan(id, 'periodic_inspection', deviceCode, planDate, {
      labels: { name: '类别', standard: '检查标准' },
      categories: (categories || DEMO_PI_CATEGORIES).map(c => ({ ...c })),
      handlingOpinions: ['停机处理', '列入维修计划（建议完成时限）', '继续观察运行'],
      steps: demoSteps('periodic_inspection', doneCount, planDate),
      dateExtended: !!dateExtended,
      status: doneCount >= 5 ? '已归档' : '待执行',
    }));
  }

  // ---- 维修 ----
  function seedRepair(id, deviceCode, planDate, { doneCount, emergency, flowTimeout, createdAt, faultDesc }) {
    pushDemoPlan(basePlan(id, 'repair', deviceCode, planDate, {
      templateId: null, templateVersion: 0, templateSource: '',
      createdAt: createdAt || planDate,
      source: 'manual',
      steps: demoSteps('repair', doneCount, planDate),
      status: doneCount >= 6 ? '已归档' : '待执行',
      flowTimeout: !!flowTimeout,
      repairData: {
        faultDesc: faultDesc || '演示故障：制动器异响',
        faultTime: planDate + ' 08:30',
        urgency: emergency ? '紧急' : '普通',
        emergency: !!emergency,
        sourceType: '', sourceId: '',
        reporter: 'p002', assignee: 'p005', assigneeName: '陈志强',
        safety4: { areaNotified: true, powerOff: true, warningSet: true, dangerWork: false },
        dangerTickets: [], safetyBriefing: '演示安全交底',
        diagnosis: '制动片磨损', repairContent: '更换制动片', spareParts: '制动片×2', remainingIssue: '',
        testNoLoad: '正常', testLoad: '正常', testAbnormalDesc: '',
        startTime: planDate + ' 09:00', endTime: planDate + ' 11:30',
        faultReason: '磨损', stopType: '故障停台', testResult: '合格', abnormalDesc: '',
        faultStopHours: 2.5,
      },
    }));
  }

  // ========== 3 月：已归档 / 已超期 / 进行中 / 待执行 ==========
  seedMaint('V2-L1-DEMO-001', 'level1', D1, '2026-03-01', { doneCount: 4 }); // 已归档（保留原演示单）
  seedMaint('V2-L1-DEMO-0302', 'level1', D2, '2026-03-01', { doneCount: 1 }); // 已超期（历史月未完成）
  seedMaint('V2-L2-DEMO-0301', 'level2', D3, '2026-03-01', { doneCount: 2, dateExtended: true }); // 进行中（延期未关）
  seedDaily('V2-DC-DEMO-0305', D1, '2026-03-05', { doneCount: 4, afterShift: { runHours: 8, faultStopHours: 0, planStopHours: 0 } });
  seedDaily('V2-DC-DEMO-0312', D1, '2026-03-12', { doneCount: 4, itemsState: ['正常', '异常', '正常', '正常', '正常'], afterShift: { runHours: 6, faultStopHours: 2, planStopHours: 0 } });
  seedDaily('V2-DC-DEMO-0320', D2, '2026-03-20', { doneCount: 1 }); // 已超期点检
  seedPI('V2-PI-DEMO-0301', D4, '2026-03-15', { doneCount: 0, dateExtended: true }); // 待执行
  seedRepair('20260318000001', D1, '2026-03-18', { doneCount: 6, faultDesc: '起升机构异响（3月演示归档）' });

  // ========== 4 月 ==========
  seedMaint('V2-L2-DEMO-0401', 'level2', D1, '2026-04-01', { doneCount: 5 }); // 已归档
  seedMaint('V2-L1-DEMO-0401', 'level1', D2, '2026-04-01', { doneCount: 2, dateExtended: true }); // 进行中
  seedMaint('V2-LUB-DEMO-0401', 'lubrication', D3, '2026-04-01', { doneCount: 0, dateExtended: true }); // 待执行
  seedDaily('V2-DC-DEMO-0408', D1, '2026-04-08', { doneCount: 4, afterShift: { runHours: 7, faultStopHours: 0.5, planStopHours: 0.5 } });
  seedDaily('V2-DC-DEMO-0415', D2, '2026-04-15', { doneCount: 4 });
  seedDaily('V2-DC-DEMO-0422', D3, '2026-04-22', { doneCount: 2 }); // 已超期
  seedPI('V2-PI-DEMO-0401', D1, '2026-04-10', { doneCount: 1 }); // 已超期检查
  seedRepair('20260412000001', D2, '2026-04-12', { doneCount: 3, emergency: true, createdAt: '2026-04-12', flowTimeout: true, faultDesc: '紧急：限位器失效（4月演示超时）' });

  // ========== 5 月 ==========
  seedMaint('V2-L1-DEMO-0501', 'level1', D1, '2026-05-01', { doneCount: 4 });
  seedMaint('V2-L2-DEMO-0501', 'level2', D2, '2026-05-01', { doneCount: 1 }); // 已超期
  seedMaint('V2-LUB-DEMO-0501', 'lubrication', D4, '2026-05-01', { doneCount: 3, dateExtended: true }); // 进行中
  seedDaily('V2-DC-DEMO-0506', D1, '2026-05-06', { doneCount: 4, afterShift: { runHours: 8, faultStopHours: 0, planStopHours: 0 } });
  seedDaily('V2-DC-DEMO-0518', D2, '2026-05-18', { doneCount: 4, afterShift: { runHours: 5, faultStopHours: 1, planStopHours: 2 } });
  seedDaily('V2-DC-DEMO-0525', D5, '2026-05-25', { doneCount: 0 }); // 已超期
  seedPI('V2-PI-DEMO-0501', D3, '2026-05-20', {
    doneCount: 5,
    categories: [
      { seq: 1, name: '钢结构', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 2, name: '机械', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 3, name: '液压', result: '超标', issue: '液压油渗漏', handlingOpinion: '列入维修计划（建议完成时限）' },
      { seq: 4, name: '电气', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 5, name: '安全装置', result: '达标', issue: '', handlingOpinion: '' },
    ],
  });
  seedRepair('20260510000001', D3, '2026-05-10', { doneCount: 2, faultDesc: '大车跑偏（5月演示进行中）' });

  // ========== 6 月 ==========
  seedMaint('V2-L1-DEMO-0601', 'level1', D1, '2026-06-01', { doneCount: 0, dateExtended: true }); // 待执行
  seedMaint('V2-LUB-DEMO-0601', 'lubrication', D2, '2026-06-01', { doneCount: 5 }); // 已归档
  seedMaint('V2-L2-DEMO-0601', 'level2', D4, '2026-06-01', { doneCount: 2 }); // 已超期
  seedDaily('V2-DC-DEMO-0603', D1, '2026-06-03', { doneCount: 4, afterShift: { runHours: 7.5, faultStopHours: 0.2, planStopHours: 0.3 } });
  seedDaily('V2-DC-DEMO-0610', D2, '2026-06-10', { doneCount: 4 });
  seedDaily('V2-DC-DEMO-0619', D3, '2026-06-19', { doneCount: 3, dateExtended: true }); // 进行中
  seedPI('V2-PI-DEMO-0601', D5, '2026-06-08', { doneCount: 0, dateExtended: true }); // 待执行
  seedRepair('20260615000001', D1, '2026-06-15', { doneCount: 6, faultDesc: '电气柜过热（6月演示归档）' });

  // ========== 7 月 ==========
  seedPI('V2-PI-DEMO-001', D1, '2026-07-01', {
    doneCount: 5,
    categories: [
      { seq: 1, name: '钢结构', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 2, name: '机械', result: '超标', issue: '大车行走轮磨损超标', handlingOpinion: '列入维修计划（建议完成时限）' },
      { seq: 3, name: '液压', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 4, name: '电气', result: '达标', issue: '', handlingOpinion: '' },
      { seq: 5, name: '安全装置', result: '超标', issue: '起升限位器动作迟滞', handlingOpinion: '停机处理' },
    ],
  });
  seedMaint('V2-L2-DEMO-0701', 'level2', D2, '2026-07-01', { doneCount: 3, dateExtended: true }); // 进行中
  seedMaint('V2-L1-DEMO-0701', 'level1', D3, '2026-07-01', { doneCount: 1 }); // 已超期
  seedMaint('V2-LUB-DEMO-0701', 'lubrication', D1, '2026-07-01', { doneCount: 5 }); // 已归档
  seedDaily('V2-DC-DEMO-0707', D1, '2026-07-07', { doneCount: 4, afterShift: { runHours: 8, faultStopHours: 0, planStopHours: 0 } });
  seedDaily('V2-DC-DEMO-0714', D2, '2026-07-14', { doneCount: 4, itemsState: ['正常', '正常', '异常', '正常', '正常'], afterShift: { runHours: 6.5, faultStopHours: 1.5, planStopHours: 0 } });
  seedDaily('V2-DC-DEMO-0728', D4, '2026-07-28', { doneCount: 1 }); // 已超期
  seedRepair('20260720000001', D4, '2026-07-20', { doneCount: 1, faultDesc: '吊钩磨损待换（7月演示待执行）' });

  // 台时补录：让 3~7 月 KPI（利用率/故障率等）非空
  const kpiSeed = [
    [D1, '2026-03-05', { runHours: 8, faultStopHours: 0, planStopHours: 0 }],
    [D1, '2026-03-12', { runHours: 6, faultStopHours: 2, planStopHours: 0 }],
    [D1, '2026-03-18', { runHours: 5, faultStopHours: 2.5, planStopHours: 0.5 }],
    [D2, '2026-03-10', { runHours: 7, faultStopHours: 0.5, planStopHours: 0.5 }],
    [D1, '2026-04-08', { runHours: 7, faultStopHours: 0.5, planStopHours: 0.5 }],
    [D2, '2026-04-15', { runHours: 8, faultStopHours: 0, planStopHours: 0 }],
    [D3, '2026-04-20', { runHours: 6, faultStopHours: 1, planStopHours: 1 }],
    [D1, '2026-05-06', { runHours: 8, faultStopHours: 0, planStopHours: 0 }],
    [D2, '2026-05-18', { runHours: 5, faultStopHours: 1, planStopHours: 2 }],
    [D3, '2026-05-10', { runHours: 4, faultStopHours: 3, planStopHours: 1 }],
    [D1, '2026-06-03', { runHours: 7.5, faultStopHours: 0.2, planStopHours: 0.3 }],
    [D2, '2026-06-10', { runHours: 8, faultStopHours: 0, planStopHours: 0 }],
    [D1, '2026-06-15', { runHours: 5, faultStopHours: 2.5, planStopHours: 0.5 }],
    [D1, '2026-07-07', { runHours: 8, faultStopHours: 0, planStopHours: 0 }],
    [D2, '2026-07-14', { runHours: 6.5, faultStopHours: 1.5, planStopHours: 0 }],
    [D4, '2026-07-20', { runHours: 7, faultStopHours: 0.5, planStopHours: 0.5 }],
  ];
  kpiSeed.forEach(([code, date, hours], i) => {
    kpiRecords.push({
      id: 'KPI-DEMO-' + String(i + 1).padStart(3, '0'),
      deviceCode: code, date,
      year: parseInt(date.substring(0, 4), 10),
      month: parseInt(date.substring(5, 7), 10),
      meterSource: 'demo',
      ...hours,
    });
  });

  refreshStatuses();
}
seedDemoData();

// 枚举 YYYY-MM-DD 起止每一天（含首尾），供报表按整月取数（V1.57 起仅整月 ≤31 天，无截断）
function enumerateDays(from, to) {
  if (!from || !to || from > to) return [];
  const parse = s => { const p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const days = [];
  let cur = parse(from);
  const end = parse(to);
  while (cur <= end) {
    days.push(fmt(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return days;
}

// 非每日项目实例生成（一级/二级/定期检查）
// opts.ignoreEnabled=true → 跳过「项目启用」校验：保养计划按用户选月生成，不受资产分类频率约束（仍受模板配置门禁，§5.7 定稿）
function generatePlanForDevice(device, projectType, date, opts) {
  const cfg = mc.getDeviceConfig(device);
  if (!cfg.projects[projectType]) return null;
  if (!(opts && opts.ignoreEnabled) && !cfg.projects[projectType].enabled) return null;
  const year = parseInt(date.substring(0, 4));
  const month = parseInt(date.substring(5, 7));
  const monthStr = date.substring(0, 7);   // V1.57：按生成目标月取标准（该月无记录 → 不生成，不回退其他月）
  const tpl = mc.resolveTemplate(device.typeCode, mc.PROJECT_TYPES[projectType].fileCode, monthStr);
  if (!mc.isTemplateEffective(tpl.content)) return null; // V1.57：该月未配置标准（无内容）→ 不生成实例（§5.7 定稿）
  const plan = {
    id: genId('V2-' + projectType),
    projectType, deviceCode: device.code, deviceName: device.name, spec: device.spec || '',
    area: device.area, dept: device.department || '',
    assetClass: cfg.assetClass,
    planDate: date, year, month,
    // V1.54 快照执行期结束日 → 超期判定按快照；V1.57 执行期=整月 → 快照=该月月末
    periodUntil: mc.monthBounds(monthStr).validUntil,
    templateId: tpl.templateId, templateVersion: tpl.templateVersion, templateSource: tpl.source,
    status: '待执行', version: 1, source: 'generated', voided: false, dateExtended: false,
    steps: buildSteps(projectType, date),
    personnelSnapshot: cfg.personnel,   // §5.1 快照：仅作已签留痕展示
  };
  const content = tpl.content;
  // V1.19 表头快照：模板 labels（上传 Excel 真实列名）复制进实例，在途单保持创建时表头
  if (content.labels) plan.labels = { ...content.labels };
  if (projectType === 'periodic_inspection' && content) {
    plan.categories = (content.categories || []).map(c => ({ ...c, result: '', issue: '', handlingOpinion: '' }));
    plan.handlingOpinions = content.handlingOpinions || ['停机处理','列入维修计划（建议完成时限）','继续观察运行'];
  } else if ((projectType === 'level1' || projectType === 'level2' || projectType === 'lubrication') && content) {
    // V1.17：设备润滑（lubrication）表单生成逻辑与二级保养一致（items）
    // V1.29：执行结果改「保养」勾选——items 种子 result(合格/不合格)→checked(布尔)，用户按实际勾选已保养项
    plan.items = (content.items || []).map(i => ({ ...i, checked: false, remark: '' }));
  } else if (content) {
    plan.items = (content.items || []).map(i => ({ ...i, result: '', remark: '' }));
  }
  // V1.28 安全告知及注意事项（标题+文本）：五类项目统一复制进实例；旧 safetyNotices[] 迁移合成 content
  if (content.safetyNotice) plan.safetyNotice = { ...content.safetyNotice };
  else if (content.safetyNotices?.length) plan.safetyNotice = { title: '安全告知及注意事项', content: content.safetyNotices.join('\n') };
  generatedPlans.push(plan);
  return plan;
}

// 保养计划：按指定年份+月份生成一级/二级保养（§5.3(3) B3，用户网格勾选月份）
// 跳过资产分类频率约束（ignoreEnabled，与资产分类脱钩），仍受 03/04 模板配置门禁；同设备同项目同月幂等去重
function generateDevicePlanAtMonth(device, projectType, year, month) {
  const date = year + '-' + String(month).padStart(2, '0') + '-01';
  // V1.2：已作废的同月实例不参与去重（取消勾选作废后再勾选 → 重新生成新单）
  if (generatedPlans.find(p => p.projectType === projectType && p.deviceCode === device.code && p.planDate === date && !p.voided)) {
    return { created: false, skipped: true, reason: '已存在' };
  }
  const plan = generatePlanForDevice(device, projectType, date, { ignoreEnabled: true });
  if (!plan) return { created: false, skipped: true, reason: '未配置模板' };
  return { created: true, plan };
}

// 保养计划级别自动解析（§5.3(3) V1.2 定稿）：配 04 二级保养标准 → level2；否则配 03 → level1；两者均未配 → null（不参与）
// V1.57：按目标年（默认当前年）是否有该标准记录判断
function resolveMaintenanceLevel(device, year) {
  const y = year || new Date().getFullYear();
  if (mc.hasRecordInYear(device.typeCode, '04', y)) return 'level2';
  if (mc.hasRecordInYear(device.typeCode, '03', y)) return 'level1';
  return null;
}

// 保养计划网格（§5.3(3) V1.3 设备×12月 可勾选网格）：设备行（资产台账基本信息 + 级别）+ 各月已有保养单摘要
// months 仅含实际有（未作废）保养单的月份：{ m: { planId, projectType, status } }
// V1.3 传 level（'level1'|'level2'）时：仅列配对应标准（03/04）的设备、级别固定为 level、months 仅汇总该级别既有单；
// 不传 level 时保持 V1.2 行为（全部设备 + resolveMaintenanceLevel + 两级月份）
function planGrid(workshop, year, level) {
  const y = year || new Date().getFullYear();
  // V1.17：级别→模板码映射（level1→03 / level2→04 / lubrication→05），润滑网格按 05 模板过滤设备
  const tplCode = level && { level1: '03', level2: '04', lubrication: '05' }[level];
  const rows = [];
  // V1.57：按目标年是否有该级别标准记录过滤设备（该年未配 03/04/05 → 不纳入网格）
  devices.filter(d => d.workshop === workshop
    && (!level || (tplCode && mc.hasRecordInYear(d.typeCode, tplCode, y)))
  ).forEach(d => {
    const months = {};
    generatedPlans.filter(p =>
      (p.projectType === 'level1' || p.projectType === 'level2' || p.projectType === 'lubrication')
      && (!level || p.projectType === level)
      && p.deviceCode === d.code && p.year === y && !p.voided
    ).forEach(p => {
      months[p.month] = { planId: p.id, projectType: p.projectType, status: deriveStatus(p) };
    });
    rows.push({
      deviceCode: d.code, deviceName: d.name, assetCategory: mc.resolveAssetClass(d),
      workshop: d.workshop, level: level || resolveMaintenanceLevel(d, y), months,
    });
  });
  return rows;
}

// 定期检查惰性生成（§5.3(6)：打开即生成指定年+月的定期检查）
// 仍受「项目启用 + 06 模板已配置」双门禁；同设备同月幂等去重（读取即自动出单）
function generatePeriodicForMonth(year, month) {
  const y = year || new Date().getFullYear();
  const m = month || new Date().getMonth() + 1;
  const pad = n => String(n).padStart(2, '0');
  const created = [];
  devices.forEach(d => {
    const cfg = mc.getDeviceConfig(d);
    const proj = cfg.projects['periodic_inspection'];
    if (!proj || !proj.enabled) return;
    const dates = mc.computeSchedule('periodic_inspection', proj.cycle, y, { startMonth: 3 });
    dates.filter(date => date.substring(0, 7) === y + '-' + pad(m)).forEach(date => {
      if (generatedPlans.find(p => p.projectType === 'periodic_inspection' && p.deviceCode === d.code && p.planDate === date)) return;
      const plan = generatePlanForDevice(d, 'periodic_inspection', date);
      if (plan) created.push(plan);
    });
  });
  refreshStatuses();
  return created;
}

// 日常点检惰性生成（§5.3(4)：按当日需点检设备扫描）
function generateDailyChecksForDate(dateStr) {
  const created = [];
  devices.forEach(d => {
    // V1.1 全量设备生效（去白名单）：凡 isCheckDay=true（资产分类含点检频率）且配 02 模板 → 当天出单
    if (!mc.isCheckDay(d, dateStr)) return;
    // 一设备一日一单（§5.3(4) 定稿）
    if (generatedPlans.find(p => p.projectType === 'daily_check' && p.deviceCode === d.code && p.planDate === dateStr)) return;
    const cfg = mc.getDeviceConfig(d);
    // V1.57：按当日所属月的 02 标准记录判定（该月未配 02 → 当日不生成）
    const tpl = mc.resolveTemplate(d.typeCode, '02', dateStr.substring(0, 7));
    if (!mc.isTemplateEffective(tpl.content)) return; // 该月未配置 02 标准 → 当日不生成（§5.7 定稿）
    const plan = {
      id: genId('V2-daily_check'),
      checkNo: genCheckNo(dateStr), // V1.58：点检编号 yyyy-mmdd-序号（6 位，当日全局递增）
      projectType: 'daily_check', deviceCode: d.code, deviceName: d.name, spec: d.spec || '',
      area: d.area, dept: d.department || '',
      assetClass: cfg.assetClass,
      planDate: dateStr, year: parseInt(dateStr.substring(0, 4)), month: parseInt(dateStr.substring(5, 7)),
      templateId: tpl.templateId, templateVersion: tpl.templateVersion, templateSource: tpl.source,
      // V1.19 表头快照：模板 labels（上传 Excel 真实列名）复制进实例，在途单保持创建时表头
      labels: (tpl.content && tpl.content.labels) ? { ...tpl.content.labels } : undefined,
      // V1.18 点检单结构：两区——A班前检查（02 班前模板 items）/ B班后固定表单（afterShift，每日运行时间/故障停台时间/计划停台时间）
      items: (tpl.content && Array.isArray(tpl.content.items) ? tpl.content.items : []).map(i => ({ ...i, state: '', remark: '' })), // 班前 items（state: 正常/异常/停工，V1.21 由不适用改停工）
      afterShiftItems: [],  // V1.18 班后不再生成检查项（恒空）
      afterShift: { runHours: '', faultStopHours: '', planStopHours: '' },  // §5.9(3) 班后固定表单（台时3项）
      status: '待执行', version: 1, source: 'generated', voided: false, dateExtended: false,
      steps: buildSteps('daily_check', dateStr),
      personnelSnapshot: cfg.personnel,
    };
    // V1.28 安全告知及注意事项（标题+文本）：日常点检（02）执行表单顶部展示；旧 safetyNotices[] 迁移合成 content
    if (tpl.content.safetyNotice) plan.safetyNotice = { ...tpl.content.safetyNotice };
    else if (tpl.content.safetyNotices?.length) plan.safetyNotice = { title: '安全告知及注意事项', content: tpl.content.safetyNotices.join('\n') };
    generatedPlans.push(plan);
    created.push(plan);
  });
  return created;
}

// 全量初始化：某年定期检查 + 当日点检（§5.3(7) 维保初始化）
// V1.1：一二级保养改由保养计划按车间逐台选月生成（B3），不再全量自动排期；润滑模块已删除。
// opts: { firstYear, currentMonth } 支持年中入网设备首年剩余月份重排（§5.12 问题2）
function generateAll(year, opts) {
  // V1.35：定期检查不再按资产分类频率自动排期（纯手动「发起检查」），全量初始化仅生成今日点检
  const now = new Date();
  const created = [];
  // 今日点检
  const today = fmtDate(now);
  created.push(...generateDailyChecksForDate(today));
  refreshStatuses();
  return created;
}

// ===================== 维修工单 V2（§5.5 V1.38 6步自动归档 + 危险作业票 + 紧急24h） =====================
// 维修实例存 generatedPlans(projectType='repair')，与保养/点检共用步骤引擎；
// 旧 workOrders 保留给非白名单设备（双轨兼容）。
// V1.61：工单号 = yyyy+mmdd+6位流水号（当日全局递增，与定期检查检查编号同格式，对齐 V1.58 点检编号口径），如 20260812000001
function genRepairId() {
  const yyyymmdd = fmtDate(new Date()).replace(/-/g, '');
  let max = 0;
  generatedPlans.forEach(p => {
    if (p.projectType === 'repair' && String(p.id || '').startsWith(yyyymmdd)) {
      const seq = parseInt(String(p.id).slice(8), 10);
      if (!isNaN(seq)) max = Math.max(max, seq);
    }
  });
  return yyyymmdd + String(max + 1).padStart(6, '0');
}

// V1.58：点检编号 = yyyymmdd+序号（6 位，无分割线），不含资产编号，按【当日全部点检单】全局递增（每天每单唯一）
function genCheckNo(dateStr) {
  const [y, m, d] = String(dateStr).split('-');
  const prefix = y + m + d;   // 去分割线：如 20260811
  let max = 0;
  generatedPlans.forEach(p => {
    if (p.projectType === 'daily_check' && String(p.checkNo || '').startsWith(prefix)) {
      const seq = parseInt(String(p.checkNo).slice(prefix.length), 10);
      if (!isNaN(seq)) max = Math.max(max, seq);
    }
  });
  return prefix + String(max + 1).padStart(6, '0');
}

function createRepairOrder(data) {
  // { deviceCode, faultDesc, faultTime, urgency, emergency, sourceType, sourceId, reporterPersonnelId }
  const device = mc.getDeviceByCode(data.deviceCode);
  if (!device) throw new Error('设备不存在: ' + data.deviceCode);
  // V1.17：移除 08 设备维保标准门禁——维修模块走独立流程，不再依赖标准文件配置（安全交底改手工填写）
  const today = fmtDate(new Date());
  const cfg = mc.getDeviceConfig(device);
  const plan = {
    id: genRepairId(),   // V1.61：工单号 = yyyy+mmdd+6位当日全局流水号（无资产编号）
    projectType: 'repair', deviceCode: device.code, deviceName: device.name, spec: device.spec || '',
    area: device.area, dept: device.department || '',
    assetClass: cfg.assetClass,
    planDate: today, year: parseInt(today.substring(0, 4)), month: parseInt(today.substring(5, 7)),
    templateId: null, templateVersion: 0, templateSource: '',
    status: '待执行', version: 1, source: 'manual', voided: false, dateExtended: false,
    createdAt: today,
    steps: buildSteps('repair', today),
    personnelSnapshot: cfg.personnel,
    repairData: {
      faultDesc: data.faultDesc || '', faultTime: data.faultTime || '',
      urgency: data.urgency || '普通',
      emergency: data.emergency !== undefined ? !!data.emergency : (data.urgency === '紧急'),
      sourceType: data.sourceType || '', sourceId: data.sourceId || '',
      reporter: data.reporterPersonnelId || '',
      // V1.37：指派（维保主管 → 维保人员，强绑定 接单/完工提交 仅被指派人可提交）
      assignee: data.assignee || '', assigneeName: data.assigneeName || '',
      safety4: { areaNotified: false, powerOff: false, warningSet: false, dangerWork: false },
      dangerTickets: [],              // 至多4张 {no, type, content}
      safetyBriefing: data.safetyBriefing || '',  // V1.17：安全交底手工填写（不再从 08 标准预填）
      diagnosis: '', repairContent: '', spareParts: '', remainingIssue: '',
      testNoLoad: '', testLoad: '', testAbnormalDesc: '',
      // V1.37：《维保完工提交内容.jpg》——开始/完成时间、故障原因、停台类型、试车情况、异常描述
      startTime: '', endTime: '', faultReason: '', stopType: '', testResult: '', abnormalDesc: '',
    },
  };
  generatedPlans.push(plan);
  // V1.37：报修提交即自动完成「报修」步（签名=报修人，同点检异常自动报修模式），流程进入「指派」
  const reporter = auth.getPersonnelById(data.reporterPersonnelId);
  if (reporter) {
    const s1 = plan.steps[0];
    s1.signatures.push(signatureSnapshot(reporter, { note: '报修提交' }));
    s1.status = 'done'; s1.date = fmtDate(new Date());
    plan.status = deriveStatus(plan);
    plan.currentStepNo = 2;   // 报修已自动完成，当前步骤=指派
  }
  return plan;
}

// §3.6D 完工回写：维修归档时回写点检异常项为"已处理"
function closeInspectionAbnormal(sourceId) {
  const src = generatedPlans.find(p => p.id === sourceId);
  if (!src) return;
  (src.items || []).forEach(it => { if (it.state === '异常') it.handled = true; });
  src.abnormalClosedAt = fmtDate(new Date());
}

// 设备停用/移除白名单 → 冻结在途实例（§5.3(7)）
function freezeDeviceInstances(deviceCode) {
  let n = 0;
  generatedPlans.forEach(p => {
    if (p.deviceCode === deviceCode && !p.voided && p.status !== '已归档') {
      p.voided = true;
      p.voidLog = { reason: '设备停用冻结', date: fmtDate(new Date()) };
      n++;
    }
  });
  return n;
}

// ===================== 步骤引擎（§5.2 / §5.12 问题1） =====================
// 权限判定（§5.8(4) V1.9：角色即职责）：
//   人员单一系统角色（10 职责 + 系统管理员）直接决定步骤执行权限。
//   系统管理员（admin）可执行任意步骤；否则须 人员.roleId === step.role。
function canExecuteStep(plan, step, personnelId) {
  const user = auth.getPersonnelById(personnelId);
  if (user && user.roleId === 'admin') return { allowed: true, note: '管理员' };
  // V1.38：指派强绑定——维修工单 接单(seq3)/完工提交(seq4) 仅被指派的维保人员可执行。
  // 必须在角色匹配之前判定（被指派人必是 mtPersonnel，角色匹配会先命中，须先拦非被指派人）。
  if (plan.projectType === 'repair' && (step.seq === 3 || step.seq === 4) && plan.repairData?.assignee
      && plan.repairData.assignee !== personnelId) {
    return { allowed: false, note: '本单指派给 ' + (plan.repairData.assigneeName || '指定维保人员') + ' 执行' };
  }
  // V1.46 设备分配执行强绑定 + V1.48 操作人员多选：日常点检 班前(seq1)/班后(seq2)
  // 该设备被分配的任意操作人员（operatorIds 集合包含本人）可执行
  // （未分配→非 admin 不可执行，需先分配；admin 已在上面 return 不受影响；seq3 确认仍按角色走）
  if (plan.projectType === 'daily_check' && (step.seq === 1 || step.seq === 2)) {
    const a = assignments.getAssignment(plan.deviceCode);
    if (a && Array.isArray(a.operatorIds) && a.operatorIds.length) {
      if (!a.operatorIds.includes(personnelId)) {
        return { allowed: false, note: '该设备已分配给指定操作人员，仅被分配者可执行日常点检' };
      }
    } else {
      return { allowed: false, note: '该设备未分配操作人员，需先由车间主任/主管/组长分配后再执行' };
    }
  }
  // V1.49 维保执行强绑定：二级保养(level2)/设备润滑(lubrication) 提交(seq1) 仅该设备被分配的维保班长(mtLeader)可执行
  // （未分配→非 admin 不可执行，需先由维保主任/主管分配；角色匹配在下方，先拦非被分配者）
  if ((plan.projectType === 'level2' || plan.projectType === 'lubrication') && step.seq === 1) {
    const ma = mtAssignments.getAssignment(plan.deviceCode);
    if (!ma || !ma.leaderId) {
      return { allowed: false, note: '该设备未分配维保班长，需先由维保主任/主管分配后再执行' };
    }
    if (ma.leaderId !== personnelId) {
      return { allowed: false, note: '该设备已分配维保班长，仅被分配者可提交' };
    }
  }
  if (user && user.roleId === step.role) return { allowed: true, note: step.role };
  return { allowed: false, note: '该步骤由角色「' + step.role + '」执行' };
}

// 完成条件（§5.12 问题1）：步骤 status 由完成条件驱动
// daily_check 班前/班后为多人依次提交（allowMulti，signatures[] 追加不覆盖），当班提交齐即完成；
// 其余步骤 1:1 角色单签 / 1:N 多人会签任一人签即过。
function stepCompletion(plan, step) {
  if (step.status === 'done') return true;
  return step.signatures.length > 0;
}

// 步骤流转：PUT /plans/:id/step/:stepNo
// 入参: { personnelId, action:'submit'|'approve'|'reject', data:{...}, version, shift }
function advanceStep(planId, stepNo, payload) {
  const plan = generatedPlans.find(p => p.id === planId);
  if (!plan) throw new Error('计划不存在');
  if (plan.voided) throw new Error('计划已作废');
  if (plan.status === '已归档') throw new Error('计划已归档');
  // 日常点检：计划日已过去不可继续提交（列表侧展示为「已过期」）
  if (plan.projectType === 'daily_check' && plan.planDate < fmtDate(new Date())) {
    throw new Error('403:该点检日已过期，无法继续操作');
  }
  // 乐观锁（§5.2 并发控制）
  if (payload.version !== undefined && payload.version !== plan.version) {
    throw new Error('409:数据已变更，请刷新后重试');
  }
  const step = plan.steps.find(s => s.seq === parseInt(stepNo));
  if (!step) throw new Error('步骤不存在');
  // 只允许流转到当前步骤
  const currentStep = plan.steps.find(s => s.status !== 'done');
  if (!currentStep) throw new Error('计划已完成');
  if (step.seq !== currentStep.seq) throw new Error('当前应在第' + currentStep.seq + '步「' + currentStep.name + '」');

  const user = auth.getPersonnelById(payload.personnelId);
  if (!user) throw new Error('人员不存在');

  // V1.54：已超期计划锁定——月度保养（一级/二级/润滑）已超期后不可继续提交/驳回（可改期/作废；系统管理员可越过）
  if (MONTHLY_MAINT_TYPES.includes(plan.projectType) && plan.status === '已超期' && user.roleId !== 'admin') {
    throw new Error('403:计划已超期，无法继续操作');
  }

  if (payload.action === 'reject') {
    // 驳回/退回（§5.2）：填写驳回原因，退回上一步执行步
    if (!payload.reason) throw new Error('驳回必须填写原因');
    // 退回上一步执行步：点检退回"班后提交"，保养退回"提交"，其余退回上一非归档步
    const execSteps = plan.steps.filter(s => s.action !== '归档');
    const toReject = execSteps.filter(s => s.status === 'done').slice(-1)[0] || currentStep;
    const prevIdx = plan.steps.findIndex(s => s.seq === toReject.seq);
    plan.steps.forEach(s => { if (s.seq >= toReject.seq) { s.status = 'pending'; } });
    plan.rejectLog = plan.rejectLog || [];
    plan.rejectLog.push({ from: currentStep.seq, to: toReject.seq, reason: payload.reason, by: user.name, date: fmtDate(new Date()) + 'T' + new Date().toTimeString().substring(0, 5) });
    plan.version += 1;
    plan.status = deriveStatus(plan);
    return { plan, rejectedTo: toReject.seq };
  }

  // 权限判定（实时绑定，§5.10 问题1 / §5.8(4)）
  const perm = canExecuteStep(plan, currentStep, payload.personnelId);
  if (!perm.allowed) {
    throw new Error('403:' + perm.note);
  }

  // V1.37：指派步（seq2）校验——必须选择被指派的维保人员
  if (plan.projectType === 'repair' && currentStep.seq === 2 && (!payload.data || !payload.data.assignee)) {
    throw new Error('请选择指派的维保人员');
  }

  // 执行数据合并（§5.3(5) 执行结果）
  if (payload.data) {
    const data = payload.data;
    if (plan.projectType === 'daily_check') {
      if (currentStep.seq === 1 && data.items) {
        plan.items = data.items;                                   // 班前检查结果（三态）
        // §3.6D 点检异常 → 一键生成维修工单（sourceType=点检/sourceId，完工回写）
        // V1.17：移除 08 设备维保标准门禁——维修走独立流程，班前异常即自动报修（不再受标准配置限制）
        const abnormal = (data.items || []).filter(i => i.state === '异常');
        if (abnormal.length && !plan.linkedRepairId) {
          const rep = createRepairOrder({
            deviceCode: plan.deviceCode,
            faultDesc: '日常点检异常：' + abnormal.map(i => (i.content || '')).join('；'),
            sourceType: '点检', sourceId: plan.id, reporterPersonnelId: user.id,
          });
          plan.linkedRepairId = rep.id;
          // V1.37：报修步已由 createRepairOrder 内部自动完成（签名=报修人），此处仅关联，不再重复签名
        }
      }
      if (currentStep.seq === 2 && (data.afterShift)) {
        // V1.18：班后提交 = 班后固定表单（台时3项：每日运行时间/故障停台时间/计划停台时间）
        if (data.afterShift) {
          plan.afterShift = data.afterShift;                       // 班后固定表单
          // PRD §7.3.1 / D-06：计划停台手工填写，有排期仅前端提示，不按额定台时自动带入
          // §5.4/§5.9(3)：班后台时顺势写入台时记录（KPI 日累计数据源）
          upsertKpi(plan.deviceCode, plan.planDate, {
            runHours: Number(plan.afterShift.runHours || 0),
            faultStopHours: Number(plan.afterShift.faultStopHours || 0),
            planStopHours: Number(plan.afterShift.planStopHours || 0),
            meterSource: 'manual',
          });
        }
      }
    } else if (currentStep.seq === 1 && data.items && plan.projectType !== 'repair') {
      plan.items = data.items;                                   // 保养逐项结果
      // V1.33：第一步提交图片附件（仅 一级/二级/润滑），URL 数组快照
      if (['level1', 'level2', 'lubrication'].includes(plan.projectType) && Array.isArray(data.attachments)) {
        plan.attachments = data.attachments;
      }
    } else if (plan.projectType === 'periodic_inspection' && currentStep.seq === 1 && data.categories) {
      plan.categories = data.categories;                         // 定期检查逐类结果
      // 发现问题记在 categories/issues；不再生成整改跟踪项（月报只列有问题检查记录）
    } else if (plan.projectType === 'repair' && data) {
      // 维修数据合并（安配4项/危险作业票/交底/完工内容/试机结果）
      plan.repairData = { ...plan.repairData, ...data };
      if (data.dangerTickets) plan.repairData.dangerTickets = data.dangerTickets;
    }
    if (data.remark) plan.remark = data.remark;
  }

  // 签名（§5.12 问题1 signatures[] 数组，追加不覆盖；V1.22 审计快照：employeeId/roleName 写时固存）
  currentStep.signatures.push(signatureSnapshot(user, { shift: payload.shift || '', note: perm.note }));
  if (!plan.startedAt) plan.startedAt = nowTs();   // V1.60：首次执行时间（只写一次）
  currentStep.date = fmtDate(new Date());
  // 完成条件判定
  if (stepCompletion(plan, currentStep)) {
    currentStep.status = 'done';
    // 下一步自动进入
    let next = plan.steps.find(s => s.status !== 'done');
    // V1.43 自动归档：后续「归档」步自动完成（签名=当前操作人，语义「通过即自动归档」），无需 archiver 人工操作
    while (next && next.action === '归档') {
      next.status = 'done';
      next.date = fmtDate(new Date());
      next.signatures = next.signatures || [];
      next.signatures.push(signatureSnapshot(user, { note: '自动归档' }));
      next = plan.steps.find(s => s.status !== 'done');
    }
    if (next) {
      next.status = 'pending';
      plan.currentStepNo = next.seq;
    }
  }
  // §3.6D 完工回写：维修归档时回写点检异常项"已处理"，点检报表只统计未处理异常
  // V1.38：维修 6 步流程无独立归档步，最后一步（完工审核）完成即自动归档，回写随最后一步触发
  if (plan.projectType === 'repair' && currentStep.status === 'done' && currentStep.seq === plan.steps.length
      && plan.repairData && plan.repairData.sourceType === '点检' && plan.repairData.sourceId) {
    closeInspectionAbnormal(plan.repairData.sourceId);
  }
  plan.version += 1;
  plan.status = deriveStatus(plan);
  if (plan.status === '已归档' && !plan.completedAt) plan.completedAt = nowTs();   // V1.60：完成归档时间
  return { plan, currentStepNo: plan.currentStepNo || (plan.status === '已归档' ? plan.steps.length : undefined) };
}

// 改期（§5.2 定稿）：需留痕，按新 planDate 重排
function reschedulePlan(planId, newDate, payload) {
  const plan = generatedPlans.find(p => p.id === planId);
  if (!plan) throw new Error('计划不存在');
  if (plan.status === '已归档' || plan.voided) throw new Error('当前状态不可改期');
  const oldDate = plan.planDate;
  plan.planDate = newDate;
  plan.year = parseInt(newDate.substring(0, 4));
  plan.month = parseInt(newDate.substring(5, 7));
  plan.dateExtended = true;
  plan.rescheduleLog = plan.rescheduleLog || [];
  plan.rescheduleLog.push({ from: oldDate, to: newDate, reason: payload.reason || '', by: payload.by || '', date: fmtDate(new Date()) });
  // §5.12 问题6：联合单一方改期 → 自动解除 together 标记
  if (plan.together && plan.together.relatedPlanId) {
    const other = generatedPlans.find(p => p.id === plan.together.relatedPlanId);
    if (other && other.together) { delete other.together; other.splitLog = other.splitLog || []; other.splitLog.push({ reason: '联合单拆分：' + plan.id + ' 改期', date: fmtDate(new Date()) }); }
    delete plan.together;
  }
  plan.version += 1;
  return plan;
}

// ===================== 培训活动（§5.3(5) 按活动粒度） =====================
function createTrainingActivity(data) {
  // { title, contentId(fileCode 01 安全操作规程), deviceCodes:[], participants:[personnelId], cycleMonth }
  const activity = {
    id: genId('V2-training'),
    title: data.title || '设备安全操作规程培训',
    sourceTemplate: data.contentId || '01',   // V1.17：培训内容固定复用 01 安全操作规程
    deviceCodes: data.deviceCodes || [],
    participants: data.participants || [],          // 参训名单
    trainingDate: data.trainingDate || fmtDate(new Date()),
    year: parseInt((data.trainingDate || fmtDate(new Date())).substring(0, 4)),
    month: parseInt((data.trainingDate || fmtDate(new Date())).substring(5, 7)),
    status: '进行中', version: 1,
    steps: buildSteps('training', data.trainingDate || fmtDate(new Date())),
    content: null,   // 复用 07/01 模板内容
  };
  // 培训内容按小类解析（data.typeCode ?? 首台设备小类）；未配置则 content 为空（不报错）
  const dev0 = devices.find(d => d.code === ((data.deviceCodes || [])[0] || ''));
  const typeCode = data.typeCode || (dev0 && dev0.typeCode) || '000000';
  activity.typeCode = typeCode;
  const tpl = mc.resolveTemplate(typeCode, data.contentId || '01');
  if (tpl.content) activity.content = tpl.content;
  trainingRecords.push(activity);
  return activity;
}

function advanceTraining(activityId, payload) {
  const act = trainingRecords.find(a => a.id === activityId);
  if (!act) throw new Error('培训活动不存在');
  const current = act.steps.find(s => s.status !== 'done');
  if (!current) throw new Error('培训已完成');
  const user = auth.getPersonnelById(payload.personnelId);
  const perm = canExecuteStep({ deviceCode: act.deviceCodes[0] || '16150201010001' }, current, payload.personnelId);
  if (!perm.allowed && !(user && user.roleId === 'admin')) throw new Error('403:' + perm.note);
  current.signatures.push(signatureSnapshot(user, {}));
  current.status = 'done';
  current.date = fmtDate(new Date());
  if (payload.participants) act.participants = payload.participants;
  act.version += 1;
  if (act.steps.every(s => s.status === 'done')) act.status = '已归档';
  return act;
}

// ===================== 台时记录（§5.9(3)） =====================
// 点检日由点检单班后顺势录；非点检日由班组长/操作员补录
function upsertKpi(deviceCode, dateStr, data) {
  let rec = kpiRecords.find(r => r.deviceCode === deviceCode && r.date === dateStr);
  if (!rec) {
    rec = { id: genId('KPI'), deviceCode, date: dateStr, year: parseInt(dateStr.substring(0, 4)), month: parseInt(dateStr.substring(5, 7)), meterSource: 'manual' };
    kpiRecords.push(rec);
  }
  if (data.runHours !== undefined) rec.runHours = data.runHours;
  if (data.faultStopHours !== undefined) rec.faultStopHours = data.faultStopHours;
  if (data.planStopHours !== undefined) rec.planStopHours = data.planStopHours;
  if (data.meterSource) rec.meterSource = data.meterSource;
  return rec;
}

// 额定日工作时长（已废弃：PRD V1.1 / §7.3.1 利用率改用 R÷(R+F+P)，不再依赖额定台时）
// 保留空字典与 setter 避免外部引用报错，新逻辑请勿再调用
const ratedHours = {};
function setRatedHours(deviceCode, hours) {
  ratedHours[deviceCode] = Number(hours) || 8;
  return ratedHours[deviceCode];
}
function getRatedHours(deviceCode) { return ratedHours[deviceCode] || 8; }

// ===================== 报表聚合（§5.6 / §5.4 KPI；PRD §7.3.1） =====================

// 点检月报（§5.6 报表1 + §5.4 KPI；V1.53 起取数周期=设备 02 模板执行时间段，废弃 26→25 跨月口径）
function dailyCheckReport(deviceCode, year, month) {
  const device = mc.getDeviceByCode(deviceCode);
  if (!device) return null;
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  // V1.57：取数周期 = 该设备 02 标准【目标月整月】；该月无 02 记录（标准不生效）→ 报表空（无任何回退）
  const monthStr = mc.monthKey(y, m);
  const tpl02 = mc.resolveTemplate(device.typeCode, '02', monthStr).content;
  if (!mc.isTemplateEffective(tpl02)) return null;
  const mb = mc.monthBounds(monthStr);
  const days = enumerateDays(mb.validFrom, mb.validUntil);
  const daysInPeriod = days.length;
  // 当月点检单
  const monthChecks = generatedPlans.filter(p => p.projectType === 'daily_check' && p.deviceCode === deviceCode
    && p.planDate >= days[0] && p.planDate <= days[days.length - 1]);
  const checkDays = monthChecks.filter(p => p.status === '已归档').length;
  const doneItems = {}; const abnormalItems = {}; const handledItems = {};
  monthChecks.filter(p => p.status === '已归档').forEach(p => {
    // V1.17：班前 items + 班后 afterShiftItems 合并统计（按 zone+seq 区分，避免两区同 seq 撞桶）
    [...(p.items || []).map(it => ({ it, zone: 'before' })), ...(p.afterShiftItems || []).map(it => ({ it, zone: 'after' }))].forEach(({ it, zone }) => {
      const key = zone + ':' + it.seq;
      doneItems[key] = (doneItems[key] || 0) + 1;
      if (it.state === '异常') { abnormalItems[key] = (abnormalItems[key] || 0) + 1; if (it.handled) handledItems[key] = (handledItems[key] || 0) + 1; }
    });
  });
  // 台时
  let runHours = 0, faultStopHours = 0, planStopHours = 0;
  kpiRecords.filter(r => r.deviceCode === deviceCode && days.includes(r.date)).forEach(r => {
    runHours += Number(r.runHours || 0);
    faultStopHours += Number(r.faultStopHours || 0);
    planStopHours += Number(r.planStopHours || 0);
  });
  // 完好天数（§5.10 问题4）：当日故障停台=0 且 当日无未处理维修工单（旧 workOrders + V2 repair）
  // 仅有台时记录的日才计完好日（无记录=未确认，不计入，避免无数据日全部虚算为完好）
  const workOrders = require('./maintenance').workOrders;
  let healthyDays = 0; const missedDays = [];
  days.forEach(ds => {
    const k = kpiRecords.find(r => r.deviceCode === deviceCode && r.date === ds);
    const faultToday = k ? Number(k.faultStopHours || 0) : null;
    const openWo = workOrders.filter(w => w.deviceCode === deviceCode && w.status !== '已完成' && (w.createdAt || '').substring(0, 10) === ds).length;
    const openRepair = generatedPlans.some(p => p.projectType === 'repair' && p.deviceCode === deviceCode && !p.voided && p.status !== '已归档' && (p.createdAt || '').substring(0, 10) === ds);
    // 点检缺检（§5.3(5) 定稿）：应点检日未归档 → 缺检红标
    const sched = monthChecks.find(p => p.planDate === ds);
    if (sched && sched.status !== '已归档') missedDays.push(ds);
    if (k && faultToday === 0 && openWo === 0 && !openRepair) healthyDays++;
  });
  // PRD §7.3.1：利用率 = ΣR ÷ Σ(R+F+P)，不再使用额定台时；分母为 0 记 0%
  const occupiedHours = runHours + faultStopHours + planStopHours;
  const availability = (healthyDays / daysInPeriod) * 100;
  const utilization = occupiedHours > 0 ? (runHours / occupiedHours) * 100 : 0;
  const faultRate = runHours > 0 ? (faultStopHours / runHours) * 100 : 0;
  const plannedStopRate = runHours > 0 ? (planStopHours / runHours) * 100 : 0;   // V1.59：计划停运率 = 计划停台时间÷运行台时
  return {
    deviceCode, deviceName: device.name, spec: device.spec, year: y, month: m,
    period: mb.validFrom + ' ~ ' + mb.validUntil, daysInPeriod,
    // V1.57：取数周期 = 目标月整月（前端网格列头跟随 periodDays）
    periodDays: days, validFrom: mb.validFrom, validUntil: mb.validUntil, periodSource: 'execMonth',
    checkDays, checkCompletion: checkDays ? Number((checkDays / daysInPeriod * 100).toFixed(1)) : 0,
    itemStats: Object.keys(doneItems).map(key => {
      const [zone, seq] = key.split(':');
      return { zone, seq: Number(seq), label: (zone === 'after' ? '班后 ' : '班前 ') + Number(seq), done: doneItems[key], abnormal: (abnormalItems[key] || 0) - (handledItems[key] || 0), handled: handledItems[key] || 0 };
    }),
    runHours, faultStopHours, planStopHours, occupiedHours,
    missedDays, healthyDays, availability: Number(availability.toFixed(2)),
    utilization: Number(utilization.toFixed(2)), faultRate: Number(faultRate.toFixed(2)), plannedStopRate: Number(plannedStopRate.toFixed(2)),
  };
}

// V1.37：《维保完工提交内容.jpg》开始/完成时间 → 故障停台小时（未手工填 faultStopHours 时按时间差）
function repairFaultStopHours(rd) {
  if (rd && Number(rd.faultStopHours || 0)) return Number(rd.faultStopHours);
  if (rd && rd.startTime && rd.endTime) {
    const s = new Date(String(rd.startTime).replace(' ', 'T'));
    const e = new Date(String(rd.endTime).replace(' ', 'T'));
    if (!isNaN(s) && !isNaN(e) && e > s) return Number(((e - s) / 3600000).toFixed(2));
  }
  return 0;
}

/** 完成时间口径：优先维修完成时间 endTime，回退 completedAt → YYYY-MM-DD */
function repairCompletionDate(plan) {
  const t = (plan && plan.repairData && plan.repairData.endTime) || (plan && plan.completedAt) || '';
  return String(t).replace('T', ' ').substring(0, 10);
}

function _ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 校验闭区间起止日期 YYYY-MM-DD */
function repairReportDateRange(startStr, endStr) {
  const start = String(startStr || '').substring(0, 10);
  const end = String(endStr || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('start/end 须为 YYYY-MM-DD');
  }
  if (start > end) throw new Error('开始日期不能晚于结束日期');
  return { start, end };
}

/** @deprecated 保留兼容；优先用 repairReportDateRange(start, end) */
function repairReportPeriodRange(period, dateStr) {
  const raw = String(dateStr || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('日期格式须为 YYYY-MM-DD');
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) throw new Error('无效日期');
  if (period === 'day') return { start: raw, end: raw };
  if (period === 'week') {
    const dow = d.getDay(); // 0=Sun
    const toMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(d); mon.setDate(d.getDate() + toMon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: _ymd(mon), end: _ymd(sun) };
  }
  if (period === 'month') {
    const y = d.getFullYear();
    const m = d.getMonth();
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const last = new Date(y, m + 1, 0);
    return { start, end: _ymd(last) };
  }
  throw new Error('period 须为 day|week|month');
}

function _formatDangerTicket(t) {
  if (!t) return '';
  const no = (t.no || '').trim();
  const type = (t.type || '').trim();
  const content = (t.content || '').trim();
  if (!no && !type && !content) return '';
  if (type || content) {
    const mid = type && content ? `${type}：${content}` : (type || content);
    return no ? `${no}（${mid}）` : mid;
  }
  return no;
}

/**
 * 已归档维修工单按完成时间落在 [start,end] 的列表（可选 visibleCodes 收窄）。
 * 按完成时间升序。
 */
function listCompletedRepairsInRange(startStr, endStr, visibleCodes) {
  const range = repairReportDateRange(startStr, endStr);
  let list = generatedPlans.filter(p => {
    if (p.projectType !== 'repair' || p.voided) return false;
    if (p.status !== '已归档') return false;
    const cd = repairCompletionDate(p);
    if (!cd) return false;
    return cd >= range.start && cd <= range.end;
  });
  if (visibleCodes) list = list.filter(p => visibleCodes.has(p.deviceCode));
  list.sort((a, b) => repairCompletionDate(a).localeCompare(repairCompletionDate(b)) || String(a.id).localeCompare(String(b.id)));
  return { range, list };
}

/** @deprecated 日/周/月入口；新代码用 listCompletedRepairsInRange */
function listCompletedRepairsInPeriod(period, dateStr, visibleCodes) {
  const range = repairReportPeriodRange(period, dateStr);
  return listCompletedRepairsInRange(range.start, range.end, visibleCodes);
}

/**
 * 构建设备维修记录报表行（与样表列一致）。
 */
function repairRecordReportRows(plans) {
  return plans.map((p, idx) => {
    const rd = p.repairData || {};
    const dev = devices.find(d => d.code === p.deviceCode);
    const tickets = Array.isArray(rd.dangerTickets) ? rd.dangerTickets : [];
    const stopH = repairFaultStopHours(rd);
    return {
      seq: idx + 1,
      id: p.id || '',
      deviceCode: p.deviceCode || '',
      deviceName: p.deviceName || (dev && dev.name) || '',
      spec: p.spec || (dev && dev.spec) || '',
      dept: p.dept || (dev && dev.department) || '',
      assetClass: p.assetClass || (dev && (dev.assetCategory || dev.type)) || '',
      startTime: rd.startTime || '',
      endTime: rd.endTime || '',
      stopHours: stopH ? String(stopH) : '',
      stopType: rd.stopType || '',
      repairContent: rd.repairContent || '',
      spareParts: rd.spareParts || '',
      faultReason: rd.faultReason || '',
      assigneeName: rd.assigneeName || '',
      safetyBriefing: rd.safetyBriefing || '',
      ticket1: _formatDangerTicket(tickets[0]),
      ticket2: _formatDangerTicket(tickets[1]),
      ticket3: _formatDangerTicket(tickets[2]),
      remark: rd.abnormalDesc || '',
    };
  });
}


// KPI 总览（§5.4：总体设备完好率/利用率/故障率/计划停运率）
function kpiDashboard(year, month, visibleCodes) {
  // V1.1 全量设备生效：参与点检的设备 = 小类配 02 点检模板的设备（未配不参与，§5.7 定稿）
  // V1.57：按目标月该设备 02 标准记录判定（该月未配 02 → 不参与、dailyCheckReport 返 null 不贡献）
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  const monthStr = mc.monthKey(y, m);
  const inScope = code => !visibleCodes || visibleCodes.has(code);
  let checkDevices = devices.filter(d => inScope(d.code) && mc.isTemplateEffective(mc.resolveTemplate(d.typeCode, '02', monthStr).content));
  let runH = 0, faultH = 0, planH = 0, healthy = 0, daysIn = 0;
  checkDevices.forEach(d => {
    const rep = dailyCheckReport(d.code, year, month);
    if (!rep) return;
    runH += rep.runHours; faultH += rep.faultStopHours;
    planH += rep.planStopHours; healthy += rep.healthyDays; daysIn = rep.daysInPeriod || 1;
  });
  const totalDevices = checkDevices.length;
  // PRD §7.3.1：总体利用率 = ΣR ÷ Σ(R+F+P)，不使用额定台时
  const occupiedH = runH + faultH + planH;
  return {
    year: parseInt(year), month: parseInt(month),
    totalDevices,
    availability: totalDevices ? Number((healthy / (totalDevices * daysIn) * 100).toFixed(2)) : 0,
    utilization: occupiedH > 0 ? Number((runH / occupiedH * 100).toFixed(2)) : 0,
    faultRate: runH > 0 ? Number((faultH / runH * 100).toFixed(2)) : 0,
    plannedStopRate: runH > 0 ? Number((planH / runH * 100).toFixed(2)) : 0,
    runHours: runH, faultStopHours: faultH, planStopHours: planH, occupiedHours: occupiedH,
  };
}

// ===================== 维保总览聚合（V1.42，全部读 V2 generatedPlans） =====================
// 供 GET /maintenance/dashboard/overview 使用；一次返回 统计卡/KPI/日历/超期统计。
// 口径：统计卡=各模块总数/已完成/未完成；超期统计=当月已超期保养/检查（不含点检）。
// opts.visibleCodes：数据权限设备集合（与 v2-plans 列表同源）；null/undefined=全量。
function dashboardOverview(year, month, opts = {}) {
  const visibleCodes = opts.visibleCodes;
  const inScope = code => !visibleCodes || visibleCodes.has(code);

  refreshStatuses();
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  const planStatuses = ['level1', 'level2', 'lubrication'];
  const monthPlans = generatedPlans.filter(p => !p.voided && p.year === y && p.month === m && inScope(p.deviceCode));
  const TYPE_MAP = { level1: '保养', level2: '保养', lubrication: '润滑', daily_check: '点检', periodic_inspection: '检查', repair: '维修' };
  const today = fmtDate(new Date());
  const monthStr = mc.monthKey(y, m);

  // 今日点检惰性生成（与列表页一致）
  generateDailyChecksForDate(today);

  // 缺检累计 = 各设备 missedDays 之和（台·日）；不含今天——今日进度由 dailyCheckToday 展示
  let missedCheckDays = 0;
  devices.filter(d => inScope(d.code) && mc.isTemplateEffective(mc.resolveTemplate(d.typeCode, '02', monthStr).content))
    .forEach(d => {
      const rep = dailyCheckReport(d.code, year, month);
      if (rep?.missedDays) missedCheckDays += rep.missedDays.filter(ds => ds < today).length;
    });

  const emergencyRepairTimeout = monthPlans.filter(p => p.projectType === 'repair' && p.flowTimeout).length;

  // ---- 业务统计卡：按模块进度（总数 / 已完成 / 未完成）----
  // 已完成=已归档；未完成=待执行+进行中+已超期；总数=已完成+未完成
  const moduleProgress = (plans) => {
    const total = plans.length;
    const done = plans.filter(p => p.status === '已归档').length;
    return { total, done, pending: total - done };
  };
  const todayDailyPlans = generatedPlans.filter(p =>
    p.projectType === 'daily_check' && p.planDate === today && !p.voided && inScope(p.deviceCode)
  );
  const maintMonthPlans = monthPlans.filter(p => planStatuses.includes(p.projectType));
  const inspMonthPlans = monthPlans.filter(p => p.projectType === 'periodic_inspection');
  const repairMonthPlans = monthPlans.filter(p => p.projectType === 'repair');
  const overdueMaintInspect = monthPlans.filter(p => p.status === '已超期' && (planStatuses.includes(p.projectType) || p.projectType === 'periodic_inspection'));
  const stats = {
    dailyCheckToday: moduleProgress(todayDailyPlans),
    maintenance: {
      ...moduleProgress(maintMonthPlans),
      detail: {
        level1: moduleProgress(maintMonthPlans.filter(p => p.projectType === 'level1')),
        level2: moduleProgress(maintMonthPlans.filter(p => p.projectType === 'level2')),
        lubrication: moduleProgress(maintMonthPlans.filter(p => p.projectType === 'lubrication')),
      },
    },
    inspection: moduleProgress(inspMonthPlans),
    repair: moduleProgress(repairMonthPlans),
    missedCheckDays,
    emergencyRepairTimeout,
  };

  // 超期天数锚点：保养类按执行期结束日，其余按计划日
  const overdueAnchor = p => planStatuses.includes(p.projectType) ? monthlyPlanPeriodEnd(p) : p.planDate;
  const overdueDaysOf = p => Math.max(0, Math.floor((new Date(today) - new Date(overdueAnchor(p))) / 86400000));

  // ---- 日历事件（当月全部计划，projectType 供前端按 6 类着色） ----
  const calendar = monthPlans.map(p => ({
    id: p.id, date: p.planDate, deviceName: p.deviceName,
    projectType: p.projectType,
    type: TYPE_MAP[p.projectType] || p.projectType,
    level: p.level || undefined,
    status: p.status,
  }));

  // ---- 超期统计（保养/检查；不含点检、不含整改） ----
  const mapOverdue = p => ({
    type: p.projectType === 'periodic_inspection' ? '检查' : '保养',
    deviceCode: p.deviceCode, deviceName: p.deviceName, dept: p.dept, planDate: p.planDate,
    overdueDays: overdueDaysOf(p),
  });
  const planOverdue = overdueMaintInspect.map(mapOverdue);
  const overdueList = { plan: planOverdue, rect: [] };

  return { year: y, month: m, stats, kpi: kpiDashboard(y, m, visibleCodes), calendar, overdueList };
}

// ===================== 试点切换（§5.9(1) 定稿） =====================
// 切换日：白名单设备旧 plans 未来实例作废冻结（幂等，历史只读）；V2 新实例不受影响
function switchPilotDate(dateStr) {
  const oldPlans = require('./maintenance').maintenancePlans;
  let frozen = 0;
  oldPlans.forEach(p => {
    if (mc.isPilotDeviceCode(p.deviceCode) && p.status !== '已冻结' && (p.planDate || '') >= dateStr) {
      p.status = '已冻结'; frozen++;
    }
  });
  return { switchedAt: dateStr, frozenOldPlans: frozen };
}

// 设备生命周期（§5.3(7)）：新增/入白名单 → 自动触发维保初始化（firstYear 首年剩余月份重排）
function initDeviceMaintenance(device, opts) {
  return generateAll(new Date().getFullYear(), opts || { firstYear: true, currentMonth: new Date().getMonth() + 1 });
}

module.exports = {
  generatedPlans, trainingRecords, kpiRecords, ratedHours, rectifications,
  deriveStatus, refreshStatuses, generatePlanForDevice, generateDevicePlanAtMonth, resolveMaintenanceLevel, planGrid,
  generateDailyChecksForDate, generatePeriodicForMonth,
  generateAll, advanceStep, reschedulePlan,
  createRepairOrder, closeInspectionAbnormal, freezeDeviceInstances,
  createTrainingActivity, advanceTraining,
  upsertKpi, setRatedHours, dailyCheckReport, kpiDashboard, dashboardOverview,
  enumerateDays,
  closeRectification, markOverdueRectifications,
  switchPilotDate, initDeviceMaintenance, canExecuteStep,
  repairFaultStopHours, repairCompletionDate, repairReportDateRange, repairReportPeriodRange,
  listCompletedRepairsInRange, listCompletedRepairsInPeriod, repairRecordReportRows,
};
