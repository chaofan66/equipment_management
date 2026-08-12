/**
 * Import Excel data into dict.js
 * Reads asset type codes and department-workshop codes from Excel files
 * and updates the backend/src/data/dict.js with the authoritative data.
 *
 * Usage: node scripts/import-excel-data.js
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
  // Skip header row
  const dataRows = rows.slice(1).filter(r => r[0] && r[1] && r[2]);

  const tree = {};
  const typeCodeMap = {};

  // First pass: ensure all major categories exist
  const majorCats = {};
  dataRows.forEach(row => {
    const majorCode = String(row[1]).trim();
    const majorName = String(row[2]).trim();
    if (!majorCats[majorCode]) {
      majorCats[majorCode] = majorName;
    }
  });

  // Build tree
  dataRows.forEach(row => {
    const majorCode = String(row[1]).trim();
    const majorName = String(row[2]).trim();
    const midCode = String(row[3]).trim();
    const midName = String(row[4]).trim();
    const minorCode = String(row[5]).trim();
    const minorName = String(row[6]).trim();
    const remark = row[7] ? String(row[7]).trim() : '';

    if (!tree[majorCode]) {
      tree[majorCode] = { name: majorName, children: {} };
    }
    if (!tree[majorCode].children[midCode]) {
      tree[majorCode].children[midCode] = { name: midName, children: {} };
    }
    const fullCode = majorCode + midCode + minorCode;
    tree[majorCode].children[midCode].children[minorCode] = {
      name: minorName,
      code: fullCode,
      remark: remark
    };

    // Build type code map (minor name → full code)
    typeCodeMap[minorName] = fullCode;
  });

  return { tree, typeCodeMap };
}

// ==================== PARSE DEPT/WORKSHOP ====================
function parseDeptWorkshop() {
  const wb = XLSX.readFile(DEPT_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  // Skip header row
  const dataRows = rows.slice(1).filter(r => r[0] && r[1] && r[2]);

  const deptList = [];           // Top-level department names
  const workshopDeptMap = {};    // workshop full name → parent dept name
  const deptCodeMap = {};        // dept name → code
  const workshopCodeMap = {};    // workshop full name → code
  const deptWorkshopTree = {};   // { deptName: { code, workshops: { code: { name, code } } } }
  const factoryArea = [];        // All workshop full names

  // First pass: identify departments (rows with empty parent)
  const deptRows = dataRows.filter(r => !r[3] || String(r[3]).trim() === '');
  deptRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    deptList.push(name);
    deptCodeMap[name] = code;
  });

  // Second pass: workshops (rows with parent)
  const wsRows = dataRows.filter(r => r[3] && String(r[3]).trim() !== '');

  // Collect parent departments that don't have their own row (inferred from children)
  const inferredDepts = new Map();
  wsRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    const parent = String(row[3]).trim();

    // Check if parent is already a known department
    if (!deptList.includes(parent) && !inferredDepts.has(parent)) {
      // Infer department code from workshop code: first 2 chars + "00"
      // For codes like "A101", use "A100"
      const inferredCode = code.substring(0, 2) + '00';
      inferredDepts.set(parent, inferredCode);
    }
  });

  // Add inferred departments
  inferredDepts.forEach((code, name) => {
    deptList.push(name);
    deptCodeMap[name] = code;
  });

  // Ensure all dept entries in tree (both explicit and inferred)
  deptList.forEach(name => {
    const code = deptCodeMap[name];
    if (!deptWorkshopTree[name]) {
      deptWorkshopTree[name] = { code, workshops: {} };
    }
    // A department that has no children is also its own "workshop"
    deptWorkshopTree[name].workshops[code] = { name, code };
  });

  // Process workshops
  wsRows.forEach(row => {
    const code = String(row[1]).trim();
    const name = String(row[2]).trim();
    const parent = String(row[3]).trim();

    workshopDeptMap[name] = parent;
    workshopCodeMap[name] = code;
    factoryArea.push(name);

    // Ensure parent dept exists in tree
    if (!deptWorkshopTree[parent]) {
      const parentCode = deptCodeMap[parent] || code.substring(0, 2) + '00';
      deptWorkshopTree[parent] = { code: parentCode, workshops: {} };
    }

    // Remove the dept-as-own-workshop entry if children exist
    const deptOwnCode = deptCodeMap[parent];
    if (deptOwnCode && deptWorkshopTree[parent].workshops[deptOwnCode] && deptWorkshopTree[parent].workshops[deptOwnCode].name === parent) {
      delete deptWorkshopTree[parent].workshops[deptOwnCode];
    }

    deptWorkshopTree[parent].workshops[code] = { name, code };
  });

  // Also add workshop-only entries to factoryArea (departments without children)
  deptList.forEach(name => {
    const hasChildren = wsRows.some(r => String(r[3]).trim() === name);
    if (!hasChildren) {
      factoryArea.push(name);
    }
  });

  // Build workshopCodeMap for dept-only entries too
  deptList.forEach(name => {
    const code = deptCodeMap[name];
    if (!workshopCodeMap[name]) {
      workshopCodeMap[name] = code;
    }
  });

  return {
    deptList,
    workshopDeptMap,
    deptCodeMap,
    workshopCodeMap,
    deptWorkshopTree,
    factoryArea
  };
}

// ==================== FORMAT JS CODE ====================
function formatObj(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map(item => pad1 + formatObj(item, indent + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    // Check if all keys look like codes (numeric/alphanumeric)
    const allCodeKeys = keys.every(k => /^[A-Z]?\d+$/.test(k));
    if (allCodeKeys) {
      // Sort keys naturally
      keys.sort((a, b) => {
        const na = parseInt(a) || 0;
        const nb = parseInt(b) || 0;
        return na - nb;
      });
    }
    const items = keys.map(k => {
      const v = formatObj(obj[k], indent + 1);
      // Use quotes for keys that aren't valid JS identifiers
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return pad1 + key + ': ' + v;
    });
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(obj);
}

function formatMap(obj, indent = 1) {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  const keys = Object.keys(obj).sort();
  const items = keys.map(k => pad1 + JSON.stringify(k) + ': ' + JSON.stringify(obj[k]));
  return '{\n' + items.join(',\n') + '\n' + pad + '}';
}

function formatWorshopDeptMap(obj, indent = 1) {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  const keys = Object.keys(obj).sort();
  const items = keys.map(k => pad1 + JSON.stringify(k) + ': ' + JSON.stringify(obj[k]));
  return '{\n' + items.join(',\n') + '\n' + pad + '}';
}
// ==================== MAIN ====================
console.log('Reading Excel files...');
const assetData = parseAssetTypes();
const deptData = parseDeptWorkshop();

console.log(`Asset types: ${Object.keys(assetData.tree).length} major categories, ${Object.keys(assetData.typeCodeMap).length} type codes`);
console.log(`Departments: ${deptData.deptList.length} departments, ${Object.keys(deptData.workshopDeptMap).length} workshops`);
console.log(`Factory areas: ${deptData.factoryArea.length} areas`);
console.log(`Dept-Workshop tree: ${Object.keys(deptData.deptWorkshopTree).length} departments`);

// Now update dict.js
console.log('\nUpdating dict.js...');
let dictContent = fs.readFileSync(DICT_FILE, 'utf-8');

// Replace FACTORY_AREA (inside DICT object — match "FACTORY_AREA: [...]")
const factoryAreaStr = '  FACTORY_AREA: [\n    ' +
  deptData.factoryArea.map(n => JSON.stringify(n)).join(',\n    ') +
  '\n  ]';
dictContent = dictContent.replace(/  FACTORY_AREA: \[[\s\S]*?\n  \]/, factoryAreaStr);

// Replace DEPT_LIST (inside DICT object — match "DEPT_LIST: [...]")
const deptListStr = '  DEPT_LIST: [\n    ' +
  deptData.deptList.map(n => JSON.stringify(n)).join(',\n    ') +
  '\n  ]';
dictContent = dictContent.replace(/  DEPT_LIST: \[[\s\S]*?\n  \]/, deptListStr);

// Replace WORKSHOP_DEPT_MAP (inside DICT object — match "WORKSHOP_DEPT_MAP: {...}")
const workshopDeptMapStr = '  WORKSHOP_DEPT_MAP: ' + formatWorshopDeptMap(deptData.workshopDeptMap, 2);
dictContent = dictContent.replace(/  WORKSHOP_DEPT_MAP: \{[\s\S]*?\n  \}/, workshopDeptMapStr);

// Replace DEPT_CODE_MAP
const deptCodeMapStr = 'const DEPT_CODE_MAP = ' + formatMap(deptData.deptCodeMap, 1) + ';';
dictContent = dictContent.replace(/const DEPT_CODE_MAP = \{[\s\S]*?\};/, deptCodeMapStr);

// Replace WORKSHOP_CODE_MAP
const workshopCodeMapStr = 'const WORKSHOP_CODE_MAP = ' + formatMap(deptData.workshopCodeMap, 1) + ';';
dictContent = dictContent.replace(/const WORKSHOP_CODE_MAP = \{[\s\S]*?\};/, workshopCodeMapStr);

// Replace DEPT_WORKSHOP_TREE
const deptWorkshopTreeStr = 'const DEPT_WORKSHOP_TREE = ' + formatObj(deptData.deptWorkshopTree, 1) + ';';
dictContent = dictContent.replace(/const DEPT_WORKSHOP_TREE = \{[\s\S]*?\};/, deptWorkshopTreeStr);

// Replace DEVICE_TYPE_TREE
const deviceTypeTreeStr = 'const DEVICE_TYPE_TREE = ' + formatObj(assetData.tree, 1) + ';';
dictContent = dictContent.replace(/const DEVICE_TYPE_TREE = \{[\s\S]*?\};/, deviceTypeTreeStr);

// Replace TYPE_CODE_MAP
const typeCodeMapStr = 'const TYPE_CODE_MAP = ' + formatMap(assetData.typeCodeMap, 1) + ';';
dictContent = dictContent.replace(/const TYPE_CODE_MAP = \{[\s\S]*?\};/, typeCodeMapStr);

fs.writeFileSync(DICT_FILE, dictContent, 'utf-8');
console.log('dict.js updated successfully!');
console.log('Done.');
