// 抽卷与判分，口径对齐《通用桥式起重机标准考核题库》答题引擎 QCORE。
// 卷号二级散列与 Excel「自动组卷」一致；问答按要点覆盖率直接给分，不由考生改分。

const OFF = { single: 0, multi: 104729, fill: 224737, essay: 350377 };
const SEED_MIN = 1;
const SEED_MAX = 999999999;
const SUGGEST_COV = 0.70;
const REF_FULL_COV = 0.80;

const DEFAULT_PRESETS = [
  { id: 'A', name: '卷面型', s: 20, m: 6, f: 8, e: 1 },
  { id: 'B', name: '单选为主型', s: 24, m: 6, f: 4, e: 1 },
  { id: 'C', name: '填空加重型', s: 16, m: 6, f: 12, e: 1 },
  { id: 'D', name: '多选加重型', s: 25, m: 4, f: 8, e: 1 },
];

const DEFAULT_SCORE = { single: 2, multi: 5, fill: 2, essay: 14 };

function intSeed(v) {
  let s = Math.floor(Number(v));
  if (!isFinite(s)) return SEED_MIN;
  if (s < SEED_MIN) s = SEED_MIN;
  if (s > SEED_MAX) s = SEED_MAX;
  return s;
}

function newSeed() {
  return Math.floor(Math.random() * (SEED_MAX - 1)) + SEED_MIN;
}

function draw(kind, k, seed, n) {
  k = Math.floor(Number(k) || 0);
  n = Math.floor(Number(n) || 0);
  if (k <= 0) return [];
  if (k > n) {
    const err = new Error(kind + '抽题数 ' + k + ' 超过库存 ' + n);
    err.statusCode = 400;
    throw err;
  }
  seed = intSeed(seed);
  const off = OFF[kind];
  const arr = [];
  for (let i = 1; i <= n; i++) {
    const h = (i * 49297 + seed * 9301 + off) % 233280;
    const h2 = (h * 48271 + seed * 69621 + 12345) % 2147483647;
    arr.push([h2 * 1000 + i, i]);
  }
  arr.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let j = 0; j < k; j++) out.push(arr[j][1]);
  return out;
}

function normalizePreset(preset, counts) {
  const cap = counts || { single: 0, multi: 0, fill: 0, essay: 0 };
  const clamp = (v, hi) => {
    let x = Math.floor(Number(v));
    if (!isFinite(x) || x < 0) x = 0;
    if (x > hi) x = hi;
    return x;
  };
  return {
    id: (preset && preset.id) || 'X',
    name: (preset && preset.name) || '自定义',
    s: clamp(preset && preset.s, cap.single),
    m: clamp(preset && preset.m, cap.multi),
    f: clamp(preset && preset.f, cap.fill),
    e: clamp(preset && preset.e, cap.essay),
  };
}

function makePaper(seed, preset, counts) {
  seed = intSeed(seed);
  const p = normalizePreset(preset, counts);
  return {
    seed,
    presetId: p.id,
    presetName: p.name,
    counts: { s: p.s, m: p.m, f: p.f, e: p.e },
    single: draw('single', p.s, seed, counts.single),
    multi: draw('multi', p.m, seed, counts.multi),
    fill: draw('fill', p.f, seed, counts.fill),
    essay: draw('essay', p.e, seed, counts.essay),
  };
}

function itemFromRaw(kind, no, raw) {
  if (!raw) return null;
  if (kind === 'essay') {
    return { no, kind, q: raw[0], ref: raw[1], kps: raw[2] || [], src: raw[3] || '' };
  }
  if (kind === 'fill') {
    return { no, kind, q: raw[0], ans: raw[1] || [], exp: raw[2] || '', src: raw[3] || '' };
  }
  return { no, kind, q: raw[0], op: raw[1] || [], ans: raw[2], exp: raw[3] || '', src: raw[4] || '' };
}

function publicQuestion(item, idx) {
  const row = { idx, kind: item.kind, no: item.no, q: item.q };
  if (item.kind === 'single' || item.kind === 'multi') row.options = item.op || [];
  if (item.kind === 'fill') row.blanks = (item.ans || []).length;
  return row;
}

const PUNCT = /[\s\u3000，。、；：？！“”‘’（）《》〈〉【】〔〕·—…～,.;:?!"'()\[\]{}<>\/\\|`@#$%^&*+=~\-_]/g;

function normStr(s) {
  s = (s === null || s === undefined) ? '' : String(s);
  s = s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  s = s.replace(/\u3000/g, ' ');
  s = s.toLowerCase();
  s = s.replace(PUNCT, '');
  return s;
}

function asNum(s) {
  const t = String(s === null || s === undefined ? '' : s).trim().replace(/[\s\u3000,，]/g, '');
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

function numEq(a, b) {
  const x = asNum(a);
  const y = asNum(b);
  if (x === null || y === null) return false;
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

function coverage(needle, hay) {
  const H = normStr(hay);
  const Nd = normStr(needle);
  const seen = {};
  let uniq = 0;
  let hit = 0;
  for (let i = 0; i < Nd.length; i++) {
    const c = Nd[i];
    if (seen[c]) continue;
    seen[c] = 1;
    uniq++;
    if (H.indexOf(c) >= 0) hit++;
  }
  return uniq ? hit / uniq : 0;
}

function gradeSingle(it, ua, sc) {
  if (ua === undefined || ua === null || ua === '') return { score: 0, tag: '未作答' };
  return String(ua) === String(it.ans)
    ? { score: sc.single, tag: '正确' }
    : { score: 0, tag: '错误' };
}

function gradeMulti(it, ua, sc) {
  const ans = String(it.ans || '').split('').filter(Boolean).sort();
  const got = (Array.isArray(ua) ? ua : String(ua || '').split('')).map(String).filter(Boolean).sort();
  if (!got.length) return { score: 0, tag: '未作答' };
  const wrong = got.filter(c => ans.indexOf(c) < 0);
  if (wrong.length) return { score: 0, tag: '有错选（' + wrong.join('') + '）' };
  if (got.length === ans.length) return { score: sc.multi, tag: '全对' };
  return { score: got.length, tag: '少选（对 ' + got.length + ' 项）' };
}

function gradeFill(it, ua, sc) {
  const givenArr = Array.isArray(ua) ? ua : [ua];
  let total = 0;
  let okn = 0;
  const per = [];
  const answers = it.ans || [];
  for (let i = 0; i < answers.length; i++) {
    const given = givenArr[i] !== undefined ? givenArr[i] : '';
    let alts = String(answers[i]).split(/\s+[\/／]+\s+/).map(x => x.trim()).filter(Boolean);
    if (!alts.length) alts = [String(answers[i])];
    const g = normStr(given);
    let ok = false;
    if (g) {
      for (let j = 0; j < alts.length; j++) {
        if (g === normStr(alts[j]) || numEq(given, alts[j])) { ok = true; break; }
      }
    }
    if (ok) { total += sc.fill; okn++; }
    per.push({ ok, given, want: alts.join(' / ') });
  }
  const tag = okn === answers.length ? '正确' : (okn ? '部分正确' : (normStr(givenArr[0]) ? '错误' : '未作答'));
  return { score: total, tag, per, full: answers.length * sc.fill };
}

function kpSplit(k) {
  const m = String(k).match(/[（(](\d+)\s*分[)）]\s*$/);
  const pt = m ? parseInt(m[1], 10) : 0;
  const text = String(k).replace(/[（(]\d+\s*分[)）]\s*$/, '');
  return { raw: k, text, pt };
}

function gradeEssay(it, ua, sc) {
  const body = (ua === null || ua === undefined) ? '' : String(ua);
  const kps = (it.kps || []).map(kpSplit);
  const overall = coverage(it.ref || '', body);
  const fullHit = normStr(body).length >= 4 && overall >= REF_FULL_COV;
  let score = 0;
  const items = kps.map(k => {
    const cov = coverage(k.text, body);
    const hit = normStr(body).length >= 4 && (fullHit || cov >= SUGGEST_COV);
    if (hit) score += k.pt;
    return { text: k.text, pt: k.pt, hit };
  });
  return {
    score,
    tag: score === sc.essay ? '满分' : (score ? '部分给分' : '零分'),
    items,
    full: sc.essay,
  };
}

function answerText(it) {
  if (it.kind === 'single') {
    const letter = String(it.ans || '');
    const idx = letter.charCodeAt(0) - 65;
    const opt = (it.op || [])[idx];
    return opt ? letter + '. ' + opt : letter;
  }
  if (it.kind === 'multi') return String(it.ans || '');
  if (it.kind === 'fill') return (it.ans || []).join('；');
  const kps = (it.kps || []).join('；');
  return (it.ref || '') + (kps ? '\n要点：' + kps : '');
}

function userText(kind, ua) {
  if (ua === undefined || ua === null || ua === '') return '';
  if (kind === 'multi') return (Array.isArray(ua) ? ua : [ua]).join('');
  if (kind === 'fill') return (Array.isArray(ua) ? ua : [ua]).join('；');
  return String(ua);
}

function gradeItems(items, answers, score) {
  const sc = score || DEFAULT_SCORE;
  let sum = 0;
  let full = 0;
  const rows = items.map((it, idx) => {
    const ua = answers ? answers[idx] : undefined;
    let r;
    let itemFull;
    if (it.kind === 'single') { r = gradeSingle(it, ua, sc); itemFull = sc.single; }
    else if (it.kind === 'multi') { r = gradeMulti(it, ua, sc); itemFull = sc.multi; }
    else if (it.kind === 'fill') { r = gradeFill(it, ua, sc); itemFull = r.full; }
    else { r = gradeEssay(it, ua, sc); itemFull = r.full; }
    sum += r.score;
    full += itemFull;
    return {
      idx,
      kind: it.kind,
      no: it.no,
      q: it.q,
      user: userText(it.kind, ua),
      score: r.score,
      full: itemFull,
      tag: r.tag,
      correct: r.score === itemFull && itemFull > 0,
      answer: answerText(it),
      exp: it.exp || '',
    };
  });
  return {
    rows,
    score: sum,
    full,
    acc: full ? sum / full : 0,
  };
}

function presetFull(preset, score) {
  const sc = score || DEFAULT_SCORE;
  const p = preset || {};
  return (p.s || 0) * sc.single + (p.m || 0) * sc.multi + (p.f || 0) * sc.fill + (p.e || 0) * sc.essay;
}

module.exports = {
  OFF, DEFAULT_PRESETS, DEFAULT_SCORE, SUGGEST_COV, REF_FULL_COV,
  intSeed, newSeed, draw, normalizePreset, makePaper, itemFromRaw, publicQuestion,
  normStr, gradeSingle, gradeMulti, gradeFill, gradeEssay, gradeItems, presetFull, answerText,
};
