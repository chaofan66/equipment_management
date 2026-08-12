/**
 * Import Excel data (设备台账-1615-试验版.xlsx) → devices.js
 * Usage: node scripts/import-devices.js
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const EXCEL_PATH = '/Users/chaofan/Documents/AI设备管理系统/参考资料/文件/设备台账-1615-试验版.xlsx';
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'devices.js');

// --- Read Excel ---
const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets['设备资产台账'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

// Data starts at row index 5 (row 6 in Excel, 1-indexed)
const dataRows = rows.slice(5);

console.log(`Total data rows: ${dataRows.length}`);

// --- Helpers ---
function normalizeDate(val) {
  if (!val) return '';
  let s = String(val).trim();
  // Handle Excel serial date number
  if (/^\d{5}$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(parseInt(s));
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  // "2026-04-15 00:00:00" → "2026-04-15"
  s = s.replace(/\s*00:00:00$/, '');
  // "2026.03.30" → "2026-03-30"
  s = s.replace(/\./g, '-');
  return s;
}

function normalizeStatus(val) {
  if (!val) return '';
  // "在 用" → "在用" (remove whitespace within CJK)
  return String(val).replace(/\s+/g, '');
}

function parseNum(val, def) {
  if (val === '' || val === null || val === undefined) return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

function parseIntVal(val, def) {
  if (val === '' || val === null || val === undefined) return def;
  const n = parseInt(val, 10);
  return isNaN(n) ? def : n;
}

function extractDepartment(useDept) {
  // "分段一部-曲四车间" → "分段一部"
  if (!useDept) return '';
  const dashIdx = useDept.indexOf('-');
  return dashIdx > 0 ? useDept.substring(0, dashIdx) : useDept;
}

// --- Map columns (0-based index → field) ---
const FIELD_MAP = [
  null,                    // 0:A  总序号 (skip)
  'seqNo',                 // 1:B  分序号
  'code',                  // 2:C  资产编码
  'name',                  // 3:D  资产名称
  'spec',                  // 4:E  规格/型号
  'typeCode',              // 5:F  资产类别编码
  'type',                  // 6:G  资产类别
  'qty',                   // 7:H  数量
  'unit',                  // 8:I  计量单位
  'assetCategory',         // 9:J  资产分类
  'status',                // 10:K 资产状况
  'acquisitionMethod',     // 11:L 取得方式
  'purchaseDate',          // 12:M 投用日期
  'supplier',              // 13:N 供应商
  'contractNo',            // 14:O 合同编号
  'valueType',             // 15:P 价值类型
  'value',                 // 16:Q 资产原值
  'bookingStatus',         // 17:R 入账状态
  'depreciationStatus',    // 18:S 折旧状态
  'depreciationMethod',    // 19:T 折旧方法
  'useMonths',             // 20:U 使用月限
  'accrualMonths',         // 21:V 计提月份
  'netValue',              // 22:W 资产净值
  'bookingDate',           // 23:X 入账日期
  'voucherNo',             // 24:Y 记账凭证号
  'ownershipUnit',         // 25:Z 归属单位
  'manageDeptCode',        // 26:AA 管理部门编码
  'manageDept',            // 27:AB 管理部门
  'useDeptCode',           // 28:AC 使用部门编码
  'department_raw',        // 29:AD 使用部门 (raw, for extraction)
  'person',                // 30:AE 使用人
  'area',                  // 31:AF 存放地点
  'manageNo',              // 32:AG 管理编号
  'factoryNo',             // 33:AH 出厂编号
  'projectNo',             // 34:AI 项目号
  'remark',                // 35:AJ 备注
  'remark_extra',          // 36:AK 备注续
];

// --- Convert ---
const devices = [];
let idx = 0;

for (const row of dataRows) {
  if (!row || row.every(c => c === '' || c === undefined)) continue;

  const dev = { id: `DEV${idx + 1}`, files: [] };
  let deptRaw = '';

  for (let ci = 0; ci < FIELD_MAP.length; ci++) {
    const field = FIELD_MAP[ci];
    if (!field) continue;
    let val = ci < row.length ? row[ci] : '';
    if (val === undefined) val = '';

    switch (field) {
      // Dates
      case 'purchaseDate':
      case 'bookingDate':
        dev[field] = normalizeDate(val);
        break;
      // Status
      case 'status':
        dev.status = normalizeStatus(val);
        break;
      // Depreciation status
      case 'depreciationStatus':
        dev.depreciationStatus = String(val).trim() === '提折旧' ? '正常计提' : String(val).trim();
        break;
      // Booking status
      case 'bookingStatus':
        dev.bookingStatus = String(val).trim() || '';
        break;
      // Numeric
      case 'qty':
        dev.qty = parseIntVal(val, 1);
        break;
      case 'value':
        dev.value = parseNum(val, 0);
        break;
      case 'useMonths':
        dev.useMonths = parseIntVal(val, 120);
        break;
      case 'accrualMonths':
        dev.accrualMonths = parseIntVal(val, 0);
        break;
      case 'netValue':
        dev.netValue = parseNum(val, 0);
        break;
      // SeqNo
      case 'seqNo':
        dev.seqNo = parseIntVal(val, idx + 1);
        break;
      // Dept raw (for extraction)
      case 'department_raw':
        deptRaw = String(val).trim();
        break;
      // Remark merge
      case 'remark':
        dev.remark = String(val).trim();
        break;
      case 'remark_extra':
        const extra = String(val).trim();
        if (extra && dev.remark && !dev.remark.includes(extra)) {
          dev.remark = dev.remark + '; ' + extra;
        } else if (extra && !dev.remark) {
          dev.remark = extra;
        }
        break;
      // Everything else
      default:
        dev[field] = String(val).trim();
        break;
    }
  }

  // Post-process: extract department from dept_raw
  dev.department = extractDepartment(deptRaw);
  // Use dept_raw as workshop if not set (backward compat)
  if (!dev.workshop) dev.workshop = deptRaw;

  // Default manufacturer from supplier
  dev.manufacturer = dev.supplier || '';

  // Default unit if empty
  if (!dev.unit) dev.unit = '台';

  // Default acquisitionMethod
  if (!dev.acquisitionMethod) dev.acquisitionMethod = '采购';

  // Default valueType
  if (!dev.valueType) dev.valueType = '原值';

  // Default ownershipUnit
  if (!dev.ownershipUnit) dev.ownershipUnit = '恒力造船（大连）有限公司';

  // Default manageDept
  if (!dev.manageDept) dev.manageDept = '生产保障部';
  if (!dev.manageDeptCode) dev.manageDeptCode = '2205';

  // Default depreciationMethod
  if (!dev.depreciationMethod) dev.depreciationMethod = '年限平均法';

  // Default bookingStatus
  if (!dev.bookingStatus) dev.bookingStatus = '已入账';

  // Default depreciationStatus
  if (!dev.depreciationStatus) dev.depreciationStatus = '正常计提';

  devices.push(dev);
  idx++;
}

console.log(`Parsed ${devices.length} devices`);

// --- Generate devices.js ---
const devicesJS = `// ===================== DEVICE DATA (imported from Excel) =====================
// ${devices.length} devices imported from 设备台账-1615-试验版.xlsx
const dict = require('./dict');
const helpers = require('./helpers');
const { DEFAULT_OWNERSHIP_UNIT, DEFAULT_MANAGE_DEPT, DEFAULT_MANAGE_DEPT_CODE } = require('./constants');

const { DICT, TYPE_CODE_MAP, DEPT_CODE_MAP, WORKSHOP_CODE_MAP } = dict;

// ===================== 20-DIGIT ASSET CODE GENERATION =====================
var ASSET_UNIT_ID = '600123';

function extractDeptCode2Digit(deptName) {
  var fullCode = DEPT_CODE_MAP[deptName] || '0000';
  var digits = fullCode.replace(/[^0-9]/g, '');
  if (digits.length >= 2) return digits.substring(0, 2);
  return digits.padStart(2, '0');
}

function extractWorkshopCode2Digit(workshopName) {
  var fullCode = WORKSHOP_CODE_MAP[workshopName] || '00';
  if (fullCode.length >= 2) return fullCode.substring(fullCode.length - 2);
  return fullCode.padStart(2, '0');
}

function getNextSerialNumber(typeCode, deptCode2, wsCode2) {
  var prefix = ASSET_UNIT_ID + deptCode2 + wsCode2 + typeCode;
  var maxSeq = 0;
  if (typeof devices !== 'undefined') {
    devices.forEach(function(d) {
      if (d.code && d.code.length === 20 && d.code.substring(0, 16) === prefix) {
        var seq = parseInt(d.code.substring(16, 20), 10);
        if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
      }
    });
  }
  return String(maxSeq + 1).padStart(4, '0');
}

function generateAssetCode(typeCode, workshopName, deptName) {
  var typeCode6 = (typeCode || '000000').padStart(6, '0').substring(0, 6);
  var deptCode2 = extractDeptCode2Digit(deptName);
  var wsCode2 = extractWorkshopCode2Digit(workshopName);
  var serial4 = getNextSerialNumber(typeCode6, deptCode2, wsCode2);
  return ASSET_UNIT_ID + deptCode2 + wsCode2 + typeCode6 + serial4;
}

const devices = ${JSON.stringify(devices, null, 2)};

function normalizeDevices() {
  var now = new Date();
  devices.forEach(function(d, idx) {
    // --- 基本信息 ---
    if (!d.spec) d.spec = d.name;
    if (!d.typeCode) d.typeCode = TYPE_CODE_MAP[d.type] || 'QT';
    if (d.qty === undefined || d.qty === null) d.qty = 1;
    if (!d.unit) d.unit = '台';
    if (!d.assetCategory) d.assetCategory = 'B';

    // --- 配置信息 ---
    if (!d.acquisitionMethod) d.acquisitionMethod = '采购';
    if (!d.valueType) d.valueType = '原值';
    if (!d.manufacturer) d.manufacturer = d.supplier || '';

    // --- 财务信息 ---
    if (!d.bookingStatus) {
      if (d.status === '待修') d.bookingStatus = '未入账';
      else d.bookingStatus = '已入账';
    }
    if (!d.depreciationStatus) {
      if (d.status === '报废') d.depreciationStatus = '已提足';
      else if (d.status === '封存') d.depreciationStatus = '暂停计提';
      else if (d.status === '待修') d.depreciationStatus = '未开始';
      else d.depreciationStatus = '正常计提';
    }
    if (!d.depreciationMethod) d.depreciationMethod = '年限平均法';
    if (d.useMonths === undefined || d.useMonths === null) d.useMonths = 120;

    // accrualMonths: compute if not set
    if (d.accrualMonths === undefined || d.accrualMonths === null || d.accrualMonths === 0) {
      if (d.purchaseDate && d.status !== '待修') {
        var pd = new Date(d.purchaseDate);
        var m = (now.getFullYear() - pd.getFullYear()) * 12 + (now.getMonth() - pd.getMonth());
        d.accrualMonths = Math.max(0, Math.min(m, d.useMonths));
      } else {
        d.accrualMonths = d.accrualMonths || 0;
      }
    }

    // netValue: compute if not set
    if (d.netValue === undefined || d.netValue === null || d.netValue === 0) {
      var rate = d.useMonths > 0 ? Math.max(0, 1 - d.accrualMonths / d.useMonths) : 0;
      d.netValue = Math.round((d.value || 0) * rate);
    }

    if (!d.bookingDate) d.bookingDate = d.purchaseDate || '';
    if (!d.voucherNo) d.voucherNo = d.purchaseDate ? 'PZ-' + d.purchaseDate.substring(0, 4) + '-' + String(idx + 1).padStart(3, '0') : '';

    // --- 归属信息 ---
    if (!d.ownershipUnit) d.ownershipUnit = DEFAULT_OWNERSHIP_UNIT;
    if (!d.manageDeptCode) d.manageDeptCode = DEPT_CODE_MAP[DEFAULT_MANAGE_DEPT] || DEFAULT_MANAGE_DEPT_CODE;
    if (!d.manageDept) d.manageDept = DEFAULT_MANAGE_DEPT;
    if (!d.useDeptCode) d.useDeptCode = DEPT_CODE_MAP[d.department] || '';
    if (!d.manageNo) d.manageNo = '';

    // factoryNo and projectNo are already from Excel — only set if truly absent
    if (!d.factoryNo) d.factoryNo = 'F-' + (TYPE_CODE_MAP[d.type] || 'QT') + '-' + String(idx + 1).padStart(4, '0');
    if (!d.projectNo) d.projectNo = d.department ? d.department + '-PRJ' : '';
  });
}
normalizeDevices();

module.exports = { devices, normalizeDevices, generateAssetCode };
`;

fs.writeFileSync(OUTPUT_PATH, devicesJS, 'utf-8');
console.log(`Written ${devices.length} devices to ${OUTPUT_PATH}`);
console.log('Done!');
