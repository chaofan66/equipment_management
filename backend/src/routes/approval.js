const express = require('express');
const router = express.Router();
const { approval, maintenance } = require('../data');

// GET /api/approval/applications - my applications
router.get('/applications', (req, res) => {
  let result = [...approval.applications];
  const { type, status, applicant } = req.query;
  if (type) result = result.filter(a => a.type === type);
  if (status) result = result.filter(a => a.status === status);
  if (applicant) result = result.filter(a => a.applicant === applicant);
  res.json({ success: true, data: result, total: result.length });
});

// GET /api/approval/applications/:id
router.get('/applications/:id', (req, res) => {
  const app = approval.applications.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ success: false, error: '申请不存在' });

  // Build timeline
  const timeline = [];
  if (app.type === '调拨') {
    timeline.push({ name: '提交申请', status: 'done', time: app.applyTime, operator: app.applicant });
    if (app.status === '审批中' || app.status === '已通过' || app.status === '已驳回') {
      timeline.push({ name: '部门审批', status: app.status === '审批中' ? 'active' : (app.status === '已通过' ? 'done' : 'rejected'), time: '', operator: app.approver || '' });
    }
    if (app.status === '已通过') {
      timeline.push({ name: '设备交接', status: 'pending', time: '', operator: '' });
      timeline.push({ name: '完成', status: 'pending', time: '', operator: '' });
    }
  } else if (app.type === '报废') {
    timeline.push({ name: '提交申请', status: 'done', time: app.applyTime, operator: app.applicant });
    if (app.status === '审批中' || app.status === '已通过' || app.status === '已驳回') {
      timeline.push({ name: '部门审批', status: app.status === '审批中' ? 'active' : (app.status === '已通过' ? 'done' : 'rejected'), time: '', operator: app.approver || '' });
    }
    if (app.status === '已通过') {
      timeline.push({ name: '财务审核', status: 'pending', time: '', operator: '' });
      timeline.push({ name: '报废处置', status: 'pending', time: '', operator: '' });
      timeline.push({ name: '完成', status: 'pending', time: '', operator: '' });
    }
  }

  res.json({ success: true, data: { ...app, timeline } });
});

// PUT /api/approval/applications/:id/status - approve/reject
router.put('/applications/:id/status', (req, res) => {
  const idx = approval.applications.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '申请不存在' });

  const { status, opinion, approver } = req.body;
  const allowed = ['已通过', '已驳回', '审批中'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, error: '无效的状态值' });
  }

  approval.applications[idx].status = status;
  if (opinion) approval.applications[idx].approvalOpinion = opinion;
  if (approver) approval.applications[idx].approver = approver;

  // Sync with approvalRequests
  const reqIdx = maintenance.approvalRequests.findIndex(r => r.id === req.params.id);
  if (reqIdx !== -1) {
    maintenance.approvalRequests[reqIdx].status = status;
    if (opinion) maintenance.approvalRequests[reqIdx].approvalOpinion = opinion;
  }

  // Sync with transfer/scrap records
  const transferIdx = maintenance.transferRecords.findIndex(r => r.id && r.id.includes(req.params.id) || r.deviceId && approval.applications[idx].deviceId === r.deviceId);
  const scrapIdx = maintenance.scrapRecords.findIndex(r => r.deviceId && approval.applications[idx].deviceId === r.deviceId);

  if (status === '已通过') {
    if (approval.applications[idx].type === '调拨' && transferIdx !== -1) {
      maintenance.transferRecords[transferIdx].status = '已通过';
      // Update device area
      const { devices } = require('../data');
      const device = devices.devices.find(d => d.id === approval.applications[idx].deviceId);
      if (device && approval.applications[idx].targetArea) {
        device.area = approval.applications[idx].targetArea;
        if (approval.applications[idx].newPerson) device.person = approval.applications[idx].newPerson;
      }
    }
    if (approval.applications[idx].type === '报废' && scrapIdx !== -1) {
      maintenance.scrapRecords[scrapIdx].status = '已通过';
      const { devices } = require('../data');
      const device = devices.devices.find(d => d.id === approval.applications[idx].deviceId);
      if (device) device.status = '报废';
    }
  }

  res.json({ success: true, data: approval.applications[idx] });
});

// GET /api/approval/pending - pending approvals
router.get('/pending', (req, res) => {
  const pending = approval.applications.filter(a => a.status === '待审批' || a.status === '审批中');
  res.json({ success: true, data: pending, total: pending.length });
});

// GET /api/approval/applications/:id/timeline
router.get('/applications/:id/timeline', (req, res) => {
  const app = approval.applications.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ success: false, error: '申请不存在' });
  // Return the timeline built in the main get endpoint
  const { buildTimeline } = require('./approval');
  res.json({ success: true, data: buildTimeline ? buildTimeline(app) : [] });
});

module.exports = router;
