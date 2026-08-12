/**
 * Regenerate dict.js completely from Excel data + hand-coded DICT categories.
 * This avoids regex-related issues with the DICT object structure.
 *
 * Usage: node scripts/regenerate-dict.js
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const ASSET_FILE = '/Users/chaofan/Documents/AI设备管理系统/参考资料/文件/资产类别编码规则-设备表格.xlsx';
const DEPT_FILE = '/Users/chaofan/Documents/AI设备管理系统/参考资料/文件/部门-车间编号规则完整版.xlsx';
const DICT_FILE = path.resolve(__dirname, '../src/data/dict.js');

// ==================== PARSE ASSET TYPES ====================
function parseAssetTypes() {
  const wb = XLSX.readFile(ASSET_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const dataRows = rows.slice(1).filter(r => r[0] && r[1] && r[2]);

  const tree = {};
  const typeCodeMap = {};

  // Fix Excel typos: determine canonical major code per name (most frequent wins)
  const nameToCodes = {};
  dataRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    if (!nameToCodes[name]) nameToCodes[name] = {};
    nameToCodes[name][code] = (nameToCodes[name][code] || 0) + 1;
  });
  const canonicalCode = {};
  for (const [name, codes] of Object.entries(nameToCodes)) {
    let bestCode = null, bestCount = 0;
    for (const [code, count] of Object.entries(codes)) {
      if (count > bestCount) { bestCode = code; bestCount = count; }
    }
    canonicalCode[name] = bestCode;
  }

  dataRows.forEach(row => {
    const majorName = String(row[2]).trim();
    const majorCode = canonicalCode[majorName]; // Use canonical (corrected) code
    const midCode = String(row[3]).trim();
    const midName = String(row[4]).trim();
    const minorCode = String(row[5]).trim();
    const minorName = String(row[6]).trim();
    const remark = row[7] ? String(row[7]).trim() : '';

    if (!tree[majorCode]) tree[majorCode] = { name: majorName, children: {} };
    if (!tree[majorCode].children[midCode]) tree[majorCode].children[midCode] = { name: midName, children: {} };
    const fullCode = majorCode + midCode + minorCode;
    tree[majorCode].children[midCode].children[minorCode] = { name: minorName, code: fullCode, remark: remark };
    typeCodeMap[minorName] = fullCode;
  });

  return { tree, typeCodeMap };
}

// ==================== PARSE DEPT/WORKSHOP ====================
function parseDeptWorkshop() {
  const wb = XLSX.readFile(DEPT_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const dataRows = rows.slice(1).filter(r => r[0] && r[1] && r[2]);

  const deptList = [];
  const workshopDeptMap = {};
  const deptCodeMap = {};
  const workshopCodeMap = {};
  const deptWorkshopTree = {};
  const factoryArea = [];

  // Explicit departments (empty parent)
  const deptRows = dataRows.filter(r => !r[3] || String(r[3]).trim() === '');
  deptRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    deptList.push(name);
    deptCodeMap[name] = code;
  });

  // Workshops (have parent)
  const wsRows = dataRows.filter(r => r[3] && String(r[3]).trim() !== '');

  // Infer missing departments from workshop parents
  const inferredDepts = new Map();
  wsRows.forEach(row => {
    const code = String(row[1]).trim();
    const parent = String(row[3]).trim();
    if (!deptList.includes(parent) && !inferredDepts.has(parent)) {
      const inferredCode = code.substring(0, 2) + '00';
      inferredDepts.set(parent, inferredCode);
    }
  });

  inferredDepts.forEach((code, name) => {
    deptList.push(name);
    deptCodeMap[name] = code;
  });

  // Build dept workshop tree
  deptList.forEach(name => {
    const code = deptCodeMap[name];
    deptWorkshopTree[name] = { code, workshops: {} };
    // Standalone dept (no children) → it's also its own workshop
    deptWorkshopTree[name].workshops[code] = { name, code };
  });

  // Add workshops
  wsRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    const parent = String(row[3]).trim();
    workshopDeptMap[name] = parent;
    workshopCodeMap[name] = code;
    factoryArea.push(name);

    // Remove the dept-as-own-workshop placeholder
    const deptOwnCode = deptCodeMap[parent];
    if (deptOwnCode && deptWorkshopTree[parent] && deptWorkshopTree[parent].workshops[deptOwnCode]
        && deptWorkshopTree[parent].workshops[deptOwnCode].name === parent) {
      delete deptWorkshopTree[parent].workshops[deptOwnCode];
    }
    deptWorkshopTree[parent].workshops[code] = { name, code };
  });

  // Add standalone departments to factoryArea
  deptList.forEach(name => {
    const hasChildren = wsRows.some(r => String(r[3]).trim() === name);
    if (!hasChildren) factoryArea.push(name);
  });

  // Add dept codes to workshopCodeMap
  deptList.forEach(name => {
    if (!workshopCodeMap[name]) workshopCodeMap[name] = deptCodeMap[name];
  });

  return { deptList, workshopDeptMap, deptCodeMap, workshopCodeMap, deptWorkshopTree, factoryArea };
}

// ==================== FORMATTERS ====================
function fmt(v, indent = 0) {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);

  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    // For short strings, pack multiple per line
    if (v.every(x => typeof x === 'string' && x.length < 20)) {
      const lines = [];
      let line = pad1;
      for (const item of v) {
        const s = JSON.stringify(item) + ', ';
        if (line.length + s.length > 100 && line !== pad1) {
          lines.push(line.trimEnd());
          line = pad1 + s;
        } else {
          line += s;
        }
      }
      if (line !== pad1) lines.push(line.trimEnd().replace(/,$/, ''));
      return '[\n' + lines.join('\n') + '\n' + pad + ']';
    }
    const items = v.map(x => pad1 + fmt(x, indent + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }

  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    keys.sort();
    const items = keys.map(k => {
      const val = fmt(v[k], indent + 1);
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return pad1 + key + ': ' + val;
    });
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(v);
}

// ==================== GENERATE ====================
console.log('Parsing Excel files...');
const assetData = parseAssetTypes();
const deptData = parseDeptWorkshop();

console.log(`Asset types: ${Object.keys(assetData.tree).length} major cats, ${Object.keys(assetData.typeCodeMap).length} types`);
console.log(`Departments: ${deptData.deptList.length}, Workshops: ${Object.keys(deptData.workshopDeptMap).length}`);
console.log(`Factory areas: ${deptData.factoryArea.length}`);

const content = `// ===================== DICTIONARIES & TYPE DATA =====================
const DICT = {
  FACTORY_AREA: ${fmt(deptData.factoryArea, 1)},
  DEPT_LIST: ${fmt(deptData.deptList, 1)},

  WORKSHOP_DEPT_MAP: ${fmt(deptData.workshopDeptMap, 1)},

  DEVICE_STATUS: ['在用','封存','闲置','待修','报废'],
  MAINTENANCE_TYPE: ['定期维保','临时维保'],
  MAINTENANCE_RESULT: ['正常','异常'],
  SCRAP_DISPOSAL: ['变卖处置','报废回收','留存拆解','其他'],
  ASSET_PURPOSE: ['生产用','管理用','辅助用'],
  UNIT: ['台','辆','套','个','桶','米','平方米','吨','件'],
  ACQUISITION_METHOD: ['新购','自建','调入','捐赠','租赁','投资者投入','其他'],
  VALUE_TYPE: ['原值','净值','评估值','重置成本'],
  BOOKING_STATUS: ['已入账','未入账','部分入账'],
  DEPRECIATION_STATUS: ['正常计提','暂停计提','已提足','无需计提'],
  DEPRECIATION_METHOD: ['年限平均法','工作量法','双倍余额递减法','年数总和法'],
  APPROVAL_STATUS: ['待审批','审批中','已通过','已驳回'],
  APPLICATION_TYPE: ['调拨','报废'],
  PLAN_LEVEL: ['一级保养','二级保养'],
  PLAN_STATUS: ['待执行','进行中','已完成','已超期'],
  INSPECTION_TYPE: ['定期检查','专项检查'],
  WORK_ORDER_TYPE: ['故障维修','预防性维修','改善性维修'],
  WORK_ORDER_STATUS: ['待派工','待维修','维修中','待验收','已完成'],
};

var DEFAULT_OWNERSHIP_UNIT = '恒力造船（大连）有限公司';
var DEFAULT_MANAGE_DEPT = '生产保障部';
var DEFAULT_MANAGE_DEPT_CODE = '2200';

// Get top-level asset category names from DEVICE_TYPE_TREE
function getTopLevelCategories() {
  if (typeof DEVICE_TYPE_TREE === 'undefined') return [];
  return Object.keys(DEVICE_TYPE_TREE).sort().map(function(k) { return DEVICE_TYPE_TREE[k].name; });
}

// Get top-level category codes from DEVICE_TYPE_TREE
function getCategoryCodes() {
  if (typeof DEVICE_TYPE_TREE === 'undefined') return [];
  return Object.keys(DEVICE_TYPE_TREE).sort();
}

var DEVICE_TYPE_TREE = ${fmt(assetData.tree, 1)};

const TYPE_CODE_MAP = ${fmt(assetData.typeCodeMap, 1)};

const TYPE_UNIT_MAP = {};
const TYPE_PURPOSE_MAP = {};

const DEPT_CODE_MAP = ${fmt(deptData.deptCodeMap, 1)};

const WORKSHOP_CODE_MAP = ${fmt(deptData.workshopCodeMap, 1)};

const DEPT_WORKSHOP_TREE = ${fmt(deptData.deptWorkshopTree, 1)};

module.exports = { DICT, DEVICE_TYPE_TREE, TYPE_CODE_MAP, DEPT_CODE_MAP, WORKSHOP_CODE_MAP, DEPT_WORKSHOP_TREE, getTopLevelCategories, getCategoryCodes };
`;

fs.writeFileSync(DICT_FILE, content, 'utf-8');
console.log('dict.js regenerated successfully!');
console.log('Done.');
