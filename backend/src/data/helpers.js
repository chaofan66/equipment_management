// 资产编码映射（V1.44 bug 修复：原代码以裸全局引用 DICT/DEPT_CODE_MAP/WORKSHOP_CODE_MAP，从未定义，导致 POST /devices 生成编码 500）
const dict = require('./dict');

function formatAreaDisplay(area) {
  var dept = dict.DICT.WORKSHOP_DEPT_MAP[area];
  return dept ? dept + ' / ' + area : area;
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '-';
  var parts = Number(n).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '¥' + parts.join('.');
}

function fmtDate(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') d = new Date(d);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function fmtDateTime(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') d = new Date(d);
  return fmtDate(d) + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

function getDeviceById(id) {
  return (typeof devices !== 'undefined') ? devices.find(function(d) { return d.id === id; }) : undefined;
}

function genId() {
  var max = 0;
  if (typeof devices !== 'undefined') {
    devices.forEach(function(d) {
      var m = d.id.match(/^DEV(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
  }
  return 'DEV' + String(max + 1).padStart(3, '0');
}

function genMtId() {
  var max = 0;
  if (typeof maintenanceRecords !== 'undefined') {
    maintenanceRecords.forEach(function(r) {
      var m = r.id.match(/^MT-(\d+)-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[2]));
    });
  }
  var now = new Date();
  return 'MT-' + now.getFullYear() + '-' + String(max + 1).padStart(3, '0');
}

// ===================== 20-DIGIT ASSET CODE GENERATION =====================
var ASSET_UNIT_ID = '600123'; // 6-digit unit ID (positions 01-06), group finance assigned

function extractDeptCode2Digit(deptName) {
  var fullCode = dict.DEPT_CODE_MAP[deptName] || '0000';
  var digits = fullCode.replace(/[^0-9]/g, '');
  if (digits.length >= 2) return digits.substring(0, 2);
  return digits.padStart(2, '0');
}

function extractWorkshopCode2Digit(workshopName) {
  var fullCode = dict.WORKSHOP_CODE_MAP[workshopName] || '00';
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

module.exports = { formatAreaDisplay, fmtMoney, fmtDate, fmtDateTime, getDeviceById, genId, genMtId, generateAssetCode, extractDeptCode2Digit, extractWorkshopCode2Digit, getNextSerialNumber };
