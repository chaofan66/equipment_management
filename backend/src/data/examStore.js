// 考试题库 / 考试计划 / 练习记录 / 课程计划。
// 落盘在仓库根（backend 之外），避免 nodemon 在保存时重启。
const fs = require('fs');
const path = require('path');
const grade = require('./examGrade');
const auth = require('./auth');
const assignments = require('./assignments');

const banksPath = path.join(__dirname, '..', '..', '..', 'examBanks.json');
const runtimePath = path.join(__dirname, '..', '..', '..', 'examRuntime.json');
const bundledHtml = path.join(__dirname, '..', '..', '..', '..', '考试需求资料', '0201-起重机', '02010107-通用桥式起重机标准考核题库-答题引擎.html');

const EXAM_ROLES = [
  { id: 'operator', name: '操作人员' },
  { id: 'opLeader', name: '操作班长' },
  { id: 'opSupervisor', name: '操作主管' },
  { id: 'workshopDirector', name: '车间主任' },
  { id: 'mtPersonnel', name: '维保人员' },
  { id: 'mtLeader', name: '维保班长' },
  { id: 'mtSupervisor', name: '维保主管' },
  { id: 'mtDirector', name: '维保主任' },
];

const ROLE_NAME = Object.fromEntries(EXAM_ROLES.map(r => [r.id, r.name]));

let banks = {};
let runtime = { plans: {}, courses: {}, attempts: [], openPapers: {} };

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[exam] 读取失败', file, e.message);
  }
  return fallback;
}

function saveBanks() {
  fs.writeFileSync(banksPath, JSON.stringify(banks));
}

function saveRuntime() {
  fs.writeFileSync(runtimePath, JSON.stringify(runtime));
}

function bad(msg) {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

function countsOf(questions) {
  return {
    single: (questions.single || []).length,
    multi: (questions.multi || []).length,
    fill: (questions.fill || []).length,
    essay: (questions.essay || []).length,
  };
}

function defaultPlan() {
  return {
    enabled: false,
    dailyStart: '',
    dailyEnd: '',
    presets: grade.DEFAULT_PRESETS.map(p => ({ ...p })),
    rolePresets: {},
  };
}

function parseBundledBank() {
  if (!fs.existsSync(bundledHtml)) throw bad('未找到起重机题库文件');
  const html = fs.readFileSync(bundledHtml, 'utf8');
  const start = html.indexOf('<script id="bankData"');
  if (start < 0) throw bad('题库文件中没有 bankData');
  const open = html.indexOf('>', start);
  const close = html.indexOf('</script>', open);
  if (open < 0 || close < 0) throw bad('题库文件格式无法识别');
  return JSON.parse(html.slice(open + 1, close));
}

function stdFileCode(typeCode) {
  return String(typeCode) + '01';
}

function nextBankCode(typeCode) {
  return stdFileCode(typeCode);
}

function importRawBank(raw, opts) {
  if (!raw || !raw.meta || !raw.single) throw bad('题库内容不完整');
  let typeCode = String(raw.meta.typeCode || '').trim();
  if (!/^\d{6}$/.test(typeCode)) typeCode = String(raw.meta.code || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(typeCode)) throw bad('资产小类编码须为 6 位');
  const code = nextBankCode(typeCode);
  const questions = {
    single: raw.single || [],
    multi: raw.multi || [],
    fill: raw.fill || [],
    essay: raw.essay || [],
  };
  const prev = banks[typeCode];
  const version = prev ? (prev.version || 1) + 1 : 1;
  banks[typeCode] = {
    code,
    typeCode,
    name: raw.meta.name || code,
    source: raw.meta.source || [],
    score: {
      single: Number(raw.meta.score && raw.meta.score.single) || grade.DEFAULT_SCORE.single,
      multi: Number(raw.meta.score && raw.meta.score.multi) || grade.DEFAULT_SCORE.multi,
      fill: Number(raw.meta.score && raw.meta.score.fill) || grade.DEFAULT_SCORE.fill,
      essay: Number(raw.meta.score && raw.meta.score.essay) || grade.DEFAULT_SCORE.essay,
    },
    counts: countsOf(questions),
    questions,
    uploadedAt: new Date().toISOString(),
    version,
  };
  if (!runtime.plans[typeCode]) runtime.plans[typeCode] = defaultPlan();
  if (!opts || !opts.silent) {
    saveBanks();
    saveRuntime();
  }
  return summaryOf(typeCode);
}

const QUESTION_SHEETS = ['单选题库', '多选题库', '填空题库', '问答题库'];

function isQuestionBankWorkbook(sheetNames) {
  return QUESTION_SHEETS.every(name => (sheetNames || []).indexOf(name) >= 0);
}

function cellAt(row, i) {
  if (i < 0 || !row) return '';
  return String(row[i] == null ? '' : row[i]).trim();
}

function headerIndex(rows, token) {
  return (rows || []).findIndex(r => (r || []).some(c => String(c == null ? '' : c).trim() === token));
}

function colOf(header, name) {
  return (header || []).findIndex(h => String(h == null ? '' : h).trim() === name);
}

function choiceRows(rows) {
  const hi = headerIndex(rows, '题目');
  if (hi < 0) throw bad('题库表缺少「题目」列');
  const header = rows[hi] || [];
  const iq = colOf(header, '题目');
  const ians = colOf(header, '正确答案');
  const iexp = colOf(header, '答案解析');
  const isrc = colOf(header, '依据');
  const optIdx = [];
  header.forEach((h, i) => {
    if (/^选项[A-F]$/.test(String(h == null ? '' : h).trim())) optIdx.push(i);
  });
  const out = [];
  rows.slice(hi + 1).forEach(r => {
    const q = cellAt(r, iq);
    const ans = cellAt(r, ians).replace(/\s+/g, '').toUpperCase();
    if (!q || !ans) return;
    out.push([q, optIdx.map(i => cellAt(r, i)).filter(Boolean), ans, cellAt(r, iexp), cellAt(r, isrc)]);
  });
  return out;
}

function fillRows(rows) {
  const hi = headerIndex(rows, '题目');
  if (hi < 0) throw bad('填空题库缺少「题目」列');
  const header = rows[hi] || [];
  const iq = colOf(header, '题目');
  const ia = colOf(header, '答案');
  const inblank = colOf(header, '空数');
  const iexp = colOf(header, '答案解析');
  const isrc = colOf(header, '依据');
  const out = [];
  rows.slice(hi + 1).forEach(r => {
    const q = cellAt(r, iq);
    const rawAns = cellAt(r, ia);
    if (!q || !rawAns) return;
    const n = Math.max(1, Math.floor(Number(cellAt(r, inblank)) || 1));
    let ans = [rawAns];
    if (n > 1) {
      const parts = rawAns.split(/[|；;、]/).map(s => s.trim()).filter(Boolean);
      if (parts.length) ans = parts;
    }
    out.push([q, ans, cellAt(r, iexp), cellAt(r, isrc)]);
  });
  return out;
}

function essayRows(rows) {
  const hi = headerIndex(rows, '题目');
  if (hi < 0) throw bad('问答题库缺少「题目」列');
  const header = rows[hi] || [];
  const iq = colOf(header, '题目');
  const iref = colOf(header, '参考答案');
  const ikp = colOf(header, '评分要点');
  const isrc = colOf(header, '依据');
  const out = [];
  rows.slice(hi + 1).forEach(r => {
    const q = cellAt(r, iq);
    if (!q) return;
    const kps = cellAt(r, ikp).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    out.push([q, cellAt(r, iref), kps, cellAt(r, isrc)]);
  });
  return out;
}

function readBankTitle(rows) {
  for (let i = 0; i < Math.min(6, (rows || []).length); i++) {
    const t = String((rows[i] && rows[i][0]) || '').trim();
    if (t && !/^\d{8}$/.test(t)) return t.split(/[·－\-]/)[0].trim();
  }
  return '';
}

function parseQuestionBankSheets(sheets, typeCode) {
  const missing = QUESTION_SHEETS.filter(name => !sheets || !sheets[name]);
  if (missing.length) throw bad('题库文件需要包含工作表：' + QUESTION_SHEETS.join('、'));
  const single = choiceRows(sheets['单选题库']);
  const multi = choiceRows(sheets['多选题库']);
  const fill = fillRows(sheets['填空题库']);
  const essay = essayRows(sheets['问答题库']);
  if (!single.length && !multi.length && !fill.length && !essay.length) throw bad('题库工作表里没有题目');
  const name = readBankTitle(sheets['单选题库']) || (typeCode + '标准考核题库');
  return {
    meta: { typeCode, code: stdFileCode(typeCode), name, source: [], score: { ...grade.DEFAULT_SCORE } },
    single, multi, fill, essay,
  };
}

function load() {
  banks = loadJson(banksPath, {});
  const rt = loadJson(runtimePath, null);
  runtime = {
    plans: (rt && rt.plans) || {},
    courses: (rt && rt.courses) || {},
    attempts: (rt && rt.attempts) || [],
    openPapers: (rt && rt.openPapers) || {},
  };
  migrateBankCodes();
}

function migrateBankCodes() {
  let banksChanged = false;
  let runtimeChanged = false;
  Object.keys(banks).forEach(typeCode => {
    const bank = banks[typeCode];
    const next = stdFileCode(typeCode);
    const cur = String(bank.code || '');
    if (cur === next) return;
    bank.code = next;
    banksChanged = true;
    (runtime.attempts || []).forEach(a => {
      if (a.typeCode === typeCode && a.bankCode !== next) {
        a.bankCode = next;
        runtimeChanged = true;
      }
    });
    Object.values(runtime.openPapers || {}).forEach(p => {
      if (p.typeCode === typeCode && p.bankCode !== next) {
        p.bankCode = next;
        runtimeChanged = true;
      }
    });
  });
  if (banksChanged) saveBanks();
  if (runtimeChanged) saveRuntime();
  const mc = require('./maintenanceConfig');
  let tplChanged = false;
  Object.keys(banks).forEach(typeCode => {
    const rec = mc.getTemplateRecord(typeCode, '01', null);
    if (rec && rec.questionBank && rec.questionBank.code !== banks[typeCode].code) {
      rec.questionBank.code = banks[typeCode].code;
      tplChanged = true;
    }
  });
  if (tplChanged) mc.persistTemplateOverrides();
}

function devices() {
  return require('./devices').devices;
}

function typeFromTree(typeCode) {
  const tree = require('./dict').DEVICE_TYPE_TREE;
  let hit = null;
  const walk = (node, path) => {
    if (!node || hit) return;
    Object.keys(node).forEach(key => {
      if (hit) return;
      const val = node[key];
      if (!val || typeof val !== 'object') return;
      const next = val.name ? path.concat(val.name) : path;
      if (val.code === typeCode && val.name) hit = { typeName: next.join('/'), typePath: next.join('/') };
      if (val.children) walk(val.children, next);
    });
  };
  walk(tree, []);
  return hit;
}

function typeMeta(typeCode) {
  const fromTree = typeFromTree(typeCode);
  if (fromTree) return fromTree;
  const d = devices().find(x => x.typeCode === typeCode);
  const typePath = (d && d.type) || '';
  const parts = typePath.split('/').filter(Boolean);
  return { typeName: (parts.length ? parts.join('/') : typeCode), typePath: typePath || typeCode };
}

function planOf(typeCode) {
  if (!runtime.plans[typeCode]) runtime.plans[typeCode] = defaultPlan();
  const plan = runtime.plans[typeCode];
  if (plan.dailyStart == null) plan.dailyStart = '';
  if (plan.dailyEnd == null) plan.dailyEnd = '';
  return plan;
}

function parseClock(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function clockText(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function hasDailyWindow(plan) {
  return !!(plan && plan.dailyStart && plan.dailyEnd);
}

function inDailyWindow(plan, now) {
  if (!hasDailyWindow(plan)) return false;
  const start = parseClock(plan.dailyStart);
  const end = parseClock(plan.dailyEnd);
  if (start == null || end == null || end <= start) return false;
  const t = now || new Date();
  const cur = t.getHours() * 60 + t.getMinutes();
  return cur >= start && cur <= end;
}

function windowOpen(plan, now) {
  if (!plan || !plan.enabled) return false;
  return inDailyWindow(plan, now);
}

function windowText(plan) {
  if (!plan || !hasDailyWindow(plan)) return '';
  return '每天 ' + plan.dailyStart + '–' + plan.dailyEnd;
}

function summaryOf(typeCode) {
  const bank = banks[typeCode];
  if (!bank) return null;
  const plan = planOf(typeCode);
  const meta = typeMeta(typeCode);
  return {
    typeCode,
    typeName: meta.typeName,
    typePath: meta.typePath,
    code: bank.code,
    name: bank.name,
    counts: bank.counts,
    score: bank.score,
    uploadedAt: bank.uploadedAt,
    version: bank.version,
    enabled: !!plan.enabled,
    status: plan.enabled ? '启用' : '未启用',
    dailyStart: plan.dailyStart || '',
    dailyEnd: plan.dailyEnd || '',
    inDailyWindow: inDailyWindow(plan),
    cannotDisable: !!(plan.enabled && inDailyWindow(plan)),
    windowText: windowText(plan),
    presets: plan.presets,
    rolePresets: plan.rolePresets || {},
  };
}

function typeHasUploadedStandard(typeCode) {
  const mc = require('./maintenanceConfig');
  const bucket = mc.standardTemplates[typeCode];
  if (!bucket) return false;
  return ['01', '02', '03', '04', '05', '06'].some(code => {
    const records = bucket[code] && bucket[code].records;
    if (!records) return false;
    return Object.keys(records).some(key => mc.hasTemplateContent(records[key]));
  });
}

function listBanks() {
  return Object.keys(banks).filter(typeHasUploadedStandard).sort().map(summaryOf);
}

function currentPersonnel() {
  const id = auth.CURRENT_USER.personnelId || 'p001';
  const p = auth.getPersonnelById(id);
  if (!p) throw bad('当前登录人不存在');
  return p;
}

function visibleTypeSet(personnel) {
  const codes = assignments.resolveVisibleCodes(personnel);
  const set = new Set();
  devices().forEach(d => {
    if (!d.typeCode) return;
    if (codes && !codes.has(d.code)) return;
    set.add(d.typeCode);
  });
  return set;
}

function assertPresetFits(preset, counts) {
  const checks = [
    ['单选', preset.s, counts.single],
    ['多选', preset.m, counts.multi],
    ['填空', preset.f, counts.fill],
    ['问答', preset.e, counts.essay],
  ];
  checks.forEach(([name, n, cap]) => {
    if (n > cap) throw bad(name + '抽题 ' + n + ' 道，超过库存 ' + cap);
  });
}

function savePlan(typeCode, body) {
  const bank = banks[typeCode];
  if (!bank) throw bad('题库不存在');
  const presetsIn = Array.isArray(body.presets) ? body.presets : [];
  if (!presetsIn.length) throw bad('至少保留一套题型组合');
  const ids = new Set();
  const presets = presetsIn.map((p, i) => {
    const id = String(p.id || ('P' + (i + 1))).trim();
    const name = String(p.name || '').trim();
    if (!name) throw bad('题型组合需要名称');
    if (ids.has(id)) throw bad('题型组合编号重复');
    ids.add(id);
    const preset = {
      id,
      name,
      s: Math.max(0, Math.floor(Number(p.s) || 0)),
      m: Math.max(0, Math.floor(Number(p.m) || 0)),
      f: Math.max(0, Math.floor(Number(p.f) || 0)),
      e: Math.max(0, Math.floor(Number(p.e) || 0)),
    };
    if (preset.s + preset.m + preset.f + preset.e <= 0) throw bad('「' + name + '」至少抽 1 道题');
    assertPresetFits(preset, bank.counts);
    return preset;
  });
  const rolePresets = {};
  const incoming = body.rolePresets || {};
  EXAM_ROLES.forEach(r => {
    const pid = incoming[r.id];
    if (!pid) return;
    if (!ids.has(pid)) throw bad(r.name + '选择的题型组合不存在');
    rolePresets[r.id] = pid;
  });
  const prev = planOf(typeCode);
  if (prev.enabled && inDailyWindow(prev) && !body.enabled) {
    throw bad('当前处于每天考试时间段内，不能关闭启用');
  }
  let dailyStart = body.dailyStart ? String(body.dailyStart).trim() : '';
  let dailyEnd = body.dailyEnd ? String(body.dailyEnd).trim() : '';
  if (!dailyStart || !dailyEnd) throw bad('每天考试时间段必填，不能设成全天');
  const startMin = parseClock(dailyStart);
  const endMin = parseClock(dailyEnd);
  if (startMin == null || endMin == null) throw bad('考试时间格式应为 HH:mm');
  if (endMin <= startMin) throw bad('结束时间须晚于开始时间');
  dailyStart = clockText(startMin);
  dailyEnd = clockText(endMin);
  if (prev.enabled && inDailyWindow(prev)) {
    dailyStart = prev.dailyStart;
    dailyEnd = prev.dailyEnd;
  }
  runtime.plans[typeCode] = {
    enabled: !!body.enabled,
    dailyStart,
    dailyEnd,
    presets,
    rolePresets,
  };
  saveRuntime();
  return summaryOf(typeCode);
}

function eligibleReason(personnel, typeCode) {
  const bank = banks[typeCode];
  if (!bank) return '题库不存在';
  const plan = planOf(typeCode);
  if (!plan.enabled) return '未启用';
  if (!windowOpen(plan)) return '不在考试时间段内';
  const presetId = (plan.rolePresets || {})[personnel.roleId];
  if (!presetId) return '当前职位未加入本场练习';
  if (!visibleTypeSet(personnel).has(typeCode)) return '未分配到该资产类别的设备';
  return '';
}

function practiceList(personnel) {
  const visible = visibleTypeSet(personnel);
  return Object.keys(banks).sort().map(typeCode => {
    const plan = planOf(typeCode);
    const presetId = (plan.rolePresets || {})[personnel.roleId];
    const preset = (plan.presets || []).find(p => p.id === presetId);
    const open = Object.values(runtime.openPapers).find(p => p.personnelId === personnel.id && p.typeCode === typeCode);
    const ok = !eligibleReason(personnel, typeCode);
    if (!presetId || !visible.has(typeCode)) return null;
    return {
      ...summaryOf(typeCode),
      canStart: ok,
      blockReason: eligibleReason(personnel, typeCode),
      presetId: presetId || '',
      presetName: preset ? preset.name : '',
      preset,
      openAttemptId: open ? open.id : '',
    };
  }).filter(Boolean);
}

function buildItems(bank, paper) {
  const items = [];
  const push = (kind, nos) => {
    nos.forEach(no => {
      const raw = bank.questions[kind][no - 1];
      const item = grade.itemFromRaw(kind, no, raw);
      if (!item) throw bad('题号 ' + no + ' 不在题库中');
      items.push(item);
    });
  };
  push('single', paper.single);
  push('multi', paper.multi);
  push('fill', paper.fill);
  push('essay', paper.essay);
  return items;
}

function publicPaper(open) {
  return {
    id: open.id,
    typeCode: open.typeCode,
    typeName: typeMeta(open.typeCode).typeName,
    bankCode: open.bankCode,
    bankVersion: open.bankVersion,
    presetId: open.presetId,
    presetName: open.presetName,
    seed: open.seed,
    startedAt: open.startedAt,
    questions: open.items.map((it, idx) => grade.publicQuestion(it, idx)),
  };
}

function startPractice(typeCode) {
  const personnel = currentPersonnel();
  const reason = eligibleReason(personnel, typeCode);
  if (reason) throw bad(reason);
  const bank = banks[typeCode];
  const plan = planOf(typeCode);
  const preset = plan.presets.find(p => p.id === plan.rolePresets[personnel.roleId]);
  if (!preset) throw bad('题型组合不存在');
  assertPresetFits(preset, bank.counts);
  Object.keys(runtime.openPapers).forEach(id => {
    const p = runtime.openPapers[id];
    if (p.personnelId === personnel.id && p.typeCode === typeCode) delete runtime.openPapers[id];
  });
  const seed = grade.newSeed();
  const paper = grade.makePaper(seed, preset, bank.counts);
  const meta = typeMeta(typeCode);
  const id = 'EX' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  const open = {
    id,
    personnelId: personnel.id,
    name: personnel.name,
    employeeId: personnel.employeeId || '',
    roleId: personnel.roleId,
    roleName: ROLE_NAME[personnel.roleId] || personnel.roleId,
    typeCode,
    typeName: meta.typeName,
    bankCode: bank.code,
    bankVersion: bank.version,
    presetId: preset.id,
    presetName: preset.name,
    presetCounts: { s: preset.s, m: preset.m, f: preset.f, e: preset.e },
    seed: paper.seed,
    startedAt: new Date().toISOString(),
    scoreRule: bank.score,
    items: buildItems(bank, paper),
  };
  runtime.openPapers[id] = open;
  saveRuntime();
  return publicPaper(open);
}

function getOpenPaper(id) {
  const personnel = currentPersonnel();
  const open = runtime.openPapers[id];
  if (!open) throw bad('答卷不存在或已交卷');
  if (open.personnelId !== personnel.id && !auth.hasPermission('exam.config.view')) throw bad('不能查看他人的未交卷答卷');
  if (open.personnelId !== personnel.id) {
    const err = new Error('未交卷的答卷只对本人返回题目');
    err.statusCode = 403;
    throw err;
  }
  return publicPaper(open);
}

function submitPractice(id, answers) {
  const personnel = currentPersonnel();
  const open = runtime.openPapers[id];
  if (!open) throw bad('答卷不存在或已交卷');
  if (open.personnelId !== personnel.id) throw bad('只能提交自己的答卷');
  const list = Array.isArray(answers) ? answers : [];
  const result = grade.gradeItems(open.items, list, open.scoreRule);
  const attempt = {
    id: open.id,
    personnelId: open.personnelId,
    name: open.name,
    employeeId: open.employeeId,
    roleId: open.roleId,
    roleName: open.roleName,
    typeCode: open.typeCode,
    typeName: open.typeName,
    bankCode: open.bankCode,
    bankVersion: open.bankVersion,
    presetId: open.presetId,
    presetName: open.presetName,
    presetCounts: open.presetCounts,
    seed: open.seed,
    startedAt: open.startedAt,
    submittedAt: new Date().toISOString(),
    score: result.score,
    full: result.full,
    acc: result.acc,
    rows: result.rows,
  };
  runtime.attempts.push(attempt);
  delete runtime.openPapers[id];
  saveRuntime();
  return attemptView(attempt);
}

function attemptView(a) {
  return {
    id: a.id,
    personnelId: a.personnelId,
    name: a.name,
    employeeId: a.employeeId,
    roleId: a.roleId,
    roleName: a.roleName,
    typeCode: a.typeCode,
    typeName: typeMeta(a.typeCode).typeName,
    bankCode: a.bankCode,
    bankVersion: a.bankVersion,
    presetId: a.presetId,
    presetName: a.presetName,
    presetCounts: a.presetCounts,
    seed: a.seed,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    score: a.score,
    full: a.full,
    acc: a.acc,
    rows: a.rows,
  };
}

function listAttempts(query, personnel) {
  const all = auth.hasPermission('exam.config.view') && query.scope === 'all';
  let rows = runtime.attempts.slice();
  if (!all) rows = rows.filter(a => a.personnelId === personnel.id);
  if (query.typeCode) rows = rows.filter(a => a.typeCode === query.typeCode);
  if (query.keyword) {
    const k = String(query.keyword).trim();
    rows = rows.filter(a => (a.name || '').includes(k) || (a.employeeId || '').includes(k) || (a.bankCode || '').includes(k));
  }
  if (query.from) rows = rows.filter(a => (a.submittedAt || '') >= query.from);
  if (query.to) rows = rows.filter(a => (a.submittedAt || '') <= query.to + 'T23:59:59');
  rows.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  return rows.map(a => {
    const view = attemptView(a);
    delete view.rows;
    return view;
  });
}

function getAttempt(id, personnel) {
  const a = runtime.attempts.find(x => x.id === id);
  if (!a) throw bad('成绩不存在');
  if (a.personnelId !== personnel.id && !auth.hasPermission('exam.config.view')) {
    const err = new Error('无权查看该成绩');
    err.statusCode = 403;
    throw err;
  }
  return attemptView(a);
}

function listProcedures() {
  const mc = require('./maintenanceConfig');
  const out = [];
  Object.keys(mc.standardTemplates || {}).forEach(typeCode => {
    if (!/^\d{6}$/.test(typeCode)) return;
    const resolved = mc.resolveTemplate(typeCode, '01');
    const sections = resolved.content && resolved.content.safetyProcedure && resolved.content.safetyProcedure.sections;
    if (!sections || !sections.length) return;
    const meta = typeMeta(typeCode);
    const course = runtime.courses[typeCode] || { enabled: false, roles: [] };
    const updatedAt = resolved.content.updatedAt || resolved.content.uploadedAt || '';
    out.push({
      typeCode,
      typeName: meta.typeName,
      typePath: meta.typePath,
      code: typeCode + '01',
      name: '安全操作规程',
      uploadedAt: updatedAt,
      enabled: !!course.enabled,
      status: course.enabled ? '启用' : '未启用',
      roles: Array.isArray(course.roles) ? course.roles.filter(id => ROLE_NAME[id]) : [],
    });
  });
  out.sort((a, b) => a.typeCode.localeCompare(b.typeCode));
  return out;
}

function saveCourse(typeCode, body) {
  const mc = require('./maintenanceConfig');
  const resolved = mc.resolveTemplate(typeCode, '01');
  const sections = resolved.content && resolved.content.safetyProcedure && resolved.content.safetyProcedure.sections;
  if (!sections || !sections.length) throw bad('该资产类别尚未上传安全操作规程');
  const roles = [];
  (body.roles || []).forEach(id => {
    if (ROLE_NAME[id] && roles.indexOf(id) < 0) roles.push(id);
  });
  runtime.courses[typeCode] = { enabled: !!body.enabled, roles };
  saveRuntime();
  return listProcedures().find(x => x.typeCode === typeCode);
}

function courseEligible(personnel, typeCode) {
  const course = runtime.courses[typeCode];
  if (!course || !course.enabled) return '课程未启用';
  if (!course.roles || course.roles.indexOf(personnel.roleId) < 0) return '当前职位不可学习该课程';
  if (!visibleTypeSet(personnel).has(typeCode)) return '未分配到该资产类别的设备';
  return '';
}

function myCourses(personnel) {
  const visible = visibleTypeSet(personnel);
  return listProcedures().filter(row => {
    if (!visible.has(row.typeCode)) return false;
    const course = runtime.courses[row.typeCode];
    if (!course || !course.enabled) return false;
    return (course.roles || []).indexOf(personnel.roleId) >= 0;
  }).map(row => ({ ...row, canRead: true, blockReason: '' }));
}

function courseContent(typeCode, personnel, preview) {
  const mc = require('./maintenanceConfig');
  const resolved = mc.resolveTemplate(typeCode, '01');
  if (!resolved.content) throw bad('安全操作规程未配置');
  if (!preview) {
    const reason = courseEligible(personnel, typeCode);
    if (reason) throw bad(reason);
  } else if (!auth.hasPermission('course.config.view')) {
    const reason = courseEligible(personnel, typeCode);
    if (reason) throw bad(reason);
  }
  const content = resolved.content;
  const sp = content.safetyProcedure || {};
  const meta = typeMeta(typeCode);
  return {
    typeCode,
    typeName: meta.typeName,
    typePath: meta.typePath,
    code: typeCode + '01',
    title: '安全操作规程',
    labels: content.labels || { section: '章节', clause: '条款' },
    sections: (sp.sections || []).map(s => ({
      seq: s.seq,
      title: s.title,
      clauses: s.clauses || [],
    })),
  };
}

load();

module.exports = {
  EXAM_ROLES,
  listBanks,
  summaryOf,
  importRawBank,
  parseBundledBank,
  QUESTION_SHEETS,
  isQuestionBankWorkbook,
  parseQuestionBankSheets,
  savePlan,
  practiceList,
  startPractice,
  getOpenPaper,
  submitPractice,
  listAttempts,
  getAttempt,
  currentPersonnel,
  listProcedures,
  saveCourse,
  myCourses,
  courseContent,
};
