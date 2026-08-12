/**
 * Migration script: reads js/data.js and splits it into backend/src/data/ modules.
 * Run: node migrate.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');

// Extract sections by finding specific comment markers
// We'll extract data between these markers and write to corresponding files

// Extract content between markers; skipPastStart removes the marker itself from the result
function extractBetween(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return '';
  const contentStart = start + startMarker.length;
  const end = endMarker ? src.indexOf(endMarker, contentStart) : src.length;
  if (end === -1) return src.substring(contentStart);
  return src.substring(contentStart, end).trim();
}

// ---- constants.js (already created manually) ----

// ---- dict.js ----
const dictHeader = `// ===================== DICTIONARIES & TYPE DATA =====================

`;
// extractBetween now skips past the start marker, so we get just the value
let dictRaw = extractBetween('const DICT = {', '};\n\n// ===================== SYSTEM CONSTANTS');
const dictSection = `const DICT = {${dictRaw}};\n\n`;
const sysConstants = `const DEFAULT_OWNERSHIP_UNIT = '恒力造船（大连）有限公司';
const DEFAULT_MANAGE_DEPT = '生产保障部';
const DEFAULT_MANAGE_DEPT_CODE = '2200';

function getTopLevelCategories() {
  return Object.keys(DEVICE_TYPE_TREE).sort().map(function(k) { return DEVICE_TYPE_TREE[k].name; });
}

function getCategoryCodes() {
  return Object.keys(DEVICE_TYPE_TREE).sort();
}
`;
const deviceTypeTreeSection = extractBetween('var DEVICE_TYPE_TREE = {', ';\n\n// ===================== TYPE MAPS');
const typeCodeMapSection = extractBetween('const TYPE_CODE_MAP = {', ';\n\nconst TYPE_UNIT_MAP');
const deptCodeMapSection = extractBetween('const DEPT_CODE_MAP = {', ';\nconst WORKSHOP_CODE_MAP');
const workshopCodeMapSection = extractBetween('const WORKSHOP_CODE_MAP = {', ';\nconst DEPT_WORKSHOP_TREE');
const deptWorkshopTreeSection = extractBetween('const DEPT_WORKSHOP_TREE = {', ';\n\n// ===================== 权限与人员配置');

const dictContent = dictHeader
  + dictSection + '\n'
  + 'var DEVICE_TYPE_TREE = {' + deviceTypeTreeSection + ';\n\n'
  + 'const TYPE_CODE_MAP = {' + typeCodeMapSection + ';\n\n'
  + 'const TYPE_UNIT_MAP = {};\n\n'
  + 'const TYPE_PURPOSE_MAP = {};\n\n'
  + 'const DEPT_CODE_MAP = {' + deptCodeMapSection + ';\n\n'
  + 'const WORKSHOP_CODE_MAP = {' + workshopCodeMapSection + ';\n\n'
  + 'const DEPT_WORKSHOP_TREE = {' + deptWorkshopTreeSection + ';\n\n'
  + sysConstants + '\n'
  + 'module.exports = { DICT, DEVICE_TYPE_TREE, TYPE_CODE_MAP, DEPT_CODE_MAP, WORKSHOP_CODE_MAP, DEPT_WORKSHOP_TREE, getTopLevelCategories, getCategoryCodes };\n';

fs.writeFileSync(path.join(__dirname, 'src', 'data', 'dict.js'), dictContent);
console.log('✓ dict.js written');

// ---- helpers.js ----
const helpersContent = extractBetween('// ===================== HELPER FUNCTIONS', '// ===================== MOCK DEVICES');
const helpersFooter = `
module.exports = { formatAreaDisplay, fmtMoney, fmtDate, fmtDateTime, getDeviceById, genId, genMtId, generateAssetCode, extractDeptCode2Digit, extractWorkshopCode2Digit, getNextSerialNumber };
`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'helpers.js'), helpersContent + helpersFooter);
console.log('✓ helpers.js written');

// ---- devices.js ----
const normalizeFunc = extractBetween('function normalizeDevices()', 'normalizeDevices();');
const devicesSection = extractBetween('// ===================== MOCK DEVICES', '// ===================== MAINTENANCE RECORDS');

const devicesContent = `// ===================== MOCK DEVICES =====================
const constants = require('./constants');
const dict = require('./dict');
const helpers = require('./helpers');

${devicesSection}\n\n${normalizeFunc}
\nnormalizeDevices();
\nmodule.exports = { devices, normalizeDevices };
`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'devices.js'), devicesContent);
console.log('✓ devices.js written');

// ---- maintenance.js ----
const mtContent = extractBetween('// ===================== MAINTENANCE RECORDS', '// ===================== 权限与人员配置');
const mtFooter = `\nmodule.exports = { maintenanceRecords, scrapRecords, transferRecords, approvalRequests, purchaseRecords, applications, checkinRecords, pendingApprovals, maintenancePlans, lubricationCards, lubricationOrders, oilTestReports, wasteOilRecords, inspectionRecords, rectificationItems, workOrders, dailyCheckRecords };\n`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'maintenance.js'), mtContent + mtFooter);
console.log('✓ maintenance.js written');

// ---- auth.js ----
// Extract auth content but include the full hasPermission function
let authRaw = extractBetween('// ===================== 权限与人员配置', '');
// Replace the last "function" with export-friendly format
const authContent = authRaw
  + '\n\nmodule.exports = { ROLES, PERMISSION_CATALOG, MAINTENANCE_TEAMS, PERSONNEL, CURRENT_USER, USERS, getRoleById, getPersonnelByRole, getPersonnelByTeam, getMaintenanceTeams, getPersonnelById, getTeamById, hasPermission };\n';
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'auth.js'), authContent);
console.log('✓ auth.js written');

// ---- approval.js (subset already in maintenance.js, create alias) ----
const approvalContent = `// ===================== APPROVAL DATA (re-exports from maintenance) =====================
const mt = require('./maintenance');

module.exports = {
  applications: mt.applications,
  approvalRequests: mt.approvalRequests,
  pendingApprovals: mt.pendingApprovals,
  transferRecords: mt.transferRecords,
  scrapRecords: mt.scrapRecords,
};
`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'approval.js'), approvalContent);
console.log('✓ approval.js written');

// ---- index.js ----
const indexContent = `// ===================== DATA INDEX =====================
const constants = require('./constants');
const dict = require('./dict');
const helpers = require('./helpers');
const devices = require('./devices');
const maintenance = require('./maintenance');
const auth = require('./auth');
const approval = require('./approval');

module.exports = {
  constants,
  dict,
  helpers,
  devices,
  maintenance,
  auth,
  approval,
};
`;
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'index.js'), indexContent);
console.log('✓ index.js written');

console.log('\nMigration complete!');
