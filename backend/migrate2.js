/**
 * Simplified migration: reads js/data.js, copies relevant sections with proper headers.
 */
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'js', 'data.js');
const dataDir = path.join(__dirname, 'src', 'data');

// Read the entire data.js
const lines = fs.readFileSync(dataPath, 'utf8').split('\n');
const src = lines.join('\n');

// Write helper: takes line range [startLine, endLine] (1-indexed, inclusive)
function writeSection(outFile, startLine, endLine, trailer) {
  let content = lines.slice(startLine - 1, endLine).join('\n');
  if (trailer) content += '\n' + trailer;
  fs.writeFileSync(path.join(dataDir, outFile), content);
  console.log('✓ ' + outFile);
}

// 1. helpers.js (lines 400-490: formatAreaDisplay through generateAssetCode)
let helpersLines = [];
for (let i = 399; i <= 489; i++) { // 0-indexed
  helpersLines.push(lines[i]);
}
let helpersContent = helpersLines.join('\n');
helpersContent += '\n\nmodule.exports = { formatAreaDisplay, fmtMoney, fmtDate, fmtDateTime, getDeviceById, genId, genMtId, generateAssetCode, extractDeptCode2Digit, extractWorkshopCode2Digit, getNextSerialNumber };\n';
fs.writeFileSync(path.join(dataDir, 'helpers.js'), helpersContent);
console.log('✓ helpers.js');

// 2. dict.js (DICT lines 4-307, DEVICE_TYPE_TREE line 327, TYPE_CODE_MAP lines 330-389,
//    DEPT_CODE_MAP lines 762-830, WORKSHOP_CODE_MAP lines 831-1126, DEPT_WORKSHOP_TREE lines 1141-1721,
//    plus helper functions and constants)
let dictLines = ['// ===================== DICTIONARIES & TYPE DATA ====================='];
// DICT object (lines 4-307)
for (let i = 3; i <= 306; i++) dictLines.push(lines[i]);
// Close DICT with semicolon (already has }; )
dictLines.push('');

// System constants + helper functions (lines 310-324)
for (let i = 309; i <= 323; i++) dictLines.push(lines[i]);
dictLines.push('');
// DEVICE_TYPE_TREE (line 327)
dictLines.push(lines[326]);
dictLines.push('');

// TYPE_CODE_MAP (lines 330-389)
for (let i = 329; i <= 388; i++) dictLines.push(lines[i]);
dictLines.push('');

// TYPE_UNIT_MAP, TYPE_PURPOSE_MAP
dictLines.push('const TYPE_UNIT_MAP = {};');
dictLines.push('const TYPE_PURPOSE_MAP = {};');
dictLines.push('');

// DEPT_CODE_MAP (lines 762-830)
for (let i = 761; i <= 829; i++) dictLines.push(lines[i]);
dictLines.push('');

// WORKSHOP_CODE_MAP (lines 831-1076)
for (let i = 830; i <= 1075; i++) dictLines.push(lines[i]);
dictLines.push('');

// DEPT_WORKSHOP_TREE (lines 1141-1721)
for (let i = 1140; i <= 1720; i++) dictLines.push(lines[i]);
dictLines.push('');

// Export
dictLines.push('module.exports = { DICT, DEVICE_TYPE_TREE, TYPE_CODE_MAP, DEPT_CODE_MAP, WORKSHOP_CODE_MAP, DEPT_WORKSHOP_TREE, getTopLevelCategories, getCategoryCodes };');

fs.writeFileSync(path.join(dataDir, 'dict.js'), dictLines.join('\n'));
console.log('✓ dict.js');

// 3. devices.js (lines 454-509 + normalizeDevices 1079-1132)
let deviceLines = [];
// ASSET_UNIT_ID and helper functions (lines 454-490 - code generation helpers)
for (let i = 453; i <= 489; i++) deviceLines.push(lines[i]);
deviceLines.push('');
// require helpers for getDeviceById, getNextSerialNumber used in genId
deviceLines.unshift("const helpers = require('./helpers');");
deviceLines.unshift("const dict = require('./dict');");
deviceLines.unshift("// ===================== MOCK DEVICES =====================");
// devices array (lines 493-509)
for (let i = 492; i <= 508; i++) deviceLines.push(lines[i]);
deviceLines.push('');
// normalizeDevices (lines 1079-1132)
for (let i = 1078; i <= 1131; i++) deviceLines.push(lines[i]);
deviceLines.push('normalizeDevices();');
deviceLines.push('');
deviceLines.push('module.exports = { devices, normalizeDevices };');

fs.writeFileSync(path.join(dataDir, 'devices.js'), deviceLines.join('\n'));
console.log('✓ devices.js');

// 4. maintenance.js — use extractBetween for reliability
function extractSection(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return '';
  const contentStart = start + startMarker.length;
  const end = endMarker ? src.indexOf(endMarker, contentStart) : src.length;
  if (end === -1) return src.substring(contentStart);
  return src.substring(contentStart, end).trim();
}

let mtRaw = extractSection('// ===================== MAINTENANCE RECORDS', '// ===================== 权限与人员配置');
// The extraction strips the start marker, so prepend comment back
mtRaw = '// ' + mtRaw;
const mtContent = "const dict = require('./dict');\n"
  + "const { DEFAULT_OWNERSHIP_UNIT } = require('./constants');\n\n"
  + mtRaw
  + '\n\nmodule.exports = { maintenanceRecords, scrapRecords, transferRecords, approvalRequests, purchaseRecords, applications, checkinRecords, pendingApprovals, maintenancePlans, lubricationCards, lubricationOrders, oilTestReports, wasteOilRecords, inspectionRecords, rectificationItems, workOrders, dailyCheckRecords };\n';

fs.writeFileSync(path.join(dataDir, 'maintenance.js'), mtContent);
console.log('✓ maintenance.js');

// 5. auth.js (lines 1723-1803)
let authLines = ['// ===================== AUTH & PERSONNEL ====================='];
// CURRENT_USER, USERS (lines 2-3)
authLines.push(lines[1]); // USERS
authLines.push(lines[2]); // CURRENT_USER
authLines.push('');
// ROLES, PERMISSION_CATALOG, MAINTENANCE_TEAMS, PERSONNEL, helper functions (lines 1726-1803)
for (let i = 1725; i <= 1803; i++) authLines.push(lines[i]);
authLines.push('');
authLines.push('module.exports = { USERS, CURRENT_USER, ROLES, PERMISSION_CATALOG, MAINTENANCE_TEAMS, PERSONNEL, getRoleById, getPersonnelByRole, getPersonnelByTeam, getMaintenanceTeams, getPersonnelById, getTeamById, hasPermission };');

fs.writeFileSync(path.join(dataDir, 'auth.js'), authLines.join('\n'));
console.log('✓ auth.js');

// 6. approval.js (re-exports from maintenance)
const approvalContent = `// ===================== APPROVAL DATA =====================
const mt = require('./maintenance');

module.exports = {
  applications: mt.applications,
  approvalRequests: mt.approvalRequests,
  pendingApprovals: mt.pendingApprovals,
  transferRecords: mt.transferRecords,
  scrapRecords: mt.scrapRecords,
};
`;
fs.writeFileSync(path.join(dataDir, 'approval.js'), approvalContent);
console.log('✓ approval.js');

// 7. index.js (already correct)
console.log('\nMigration complete!');
