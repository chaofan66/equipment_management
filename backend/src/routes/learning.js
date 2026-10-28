const express = require('express');
const router = express.Router();
const auth = require('../data/auth');
const exam = require('../data/examStore');

function fail(res, err) {
  const status = err.statusCode || 500;
  res.status(status).json({ success: false, error: err.message || '请求失败' });
}

function requirePerm(res, perm) {
  if (auth.hasPermission(perm)) return true;
  res.status(403).json({ success: false, error: '无权限' });
  return false;
}

router.get('/exam/roles', (req, res) => {
  res.json({ success: true, data: exam.EXAM_ROLES });
});

router.get('/exam/banks', (req, res) => {
  if (!requirePerm(res, 'exam.config.view')) return;
  res.json({ success: true, data: exam.listBanks() });
});

router.put('/exam/banks/:typeCode/plan', (req, res) => {
  if (!requirePerm(res, 'exam.config.edit')) return;
  try {
    res.json({ success: true, data: exam.savePlan(req.params.typeCode, req.body || {}) });
  } catch (err) { fail(res, err); }
});

router.get('/exam/practice', (req, res) => {
  if (!requirePerm(res, 'exam.practice')) return;
  try {
    res.json({ success: true, data: exam.practiceList(exam.currentPersonnel()) });
  } catch (err) { fail(res, err); }
});

router.post('/exam/practice/:typeCode/start', (req, res) => {
  if (!requirePerm(res, 'exam.practice')) return;
  try {
    res.json({ success: true, data: exam.startPractice(req.params.typeCode) });
  } catch (err) { fail(res, err); }
});

router.get('/exam/papers/:id', (req, res) => {
  if (!requirePerm(res, 'exam.practice')) return;
  try {
    res.json({ success: true, data: exam.getOpenPaper(req.params.id) });
  } catch (err) { fail(res, err); }
});

router.post('/exam/papers/:id/submit', (req, res) => {
  if (!requirePerm(res, 'exam.practice')) return;
  try {
    res.json({ success: true, data: exam.submitPractice(req.params.id, (req.body && req.body.answers) || []) });
  } catch (err) { fail(res, err); }
});

router.get('/exam/attempts', (req, res) => {
  const scopeAll = req.query.scope === 'all';
  if (scopeAll && !auth.hasPermission('exam.config.view')) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  if (!scopeAll && !auth.hasPermission('exam.practice') && !auth.hasPermission('exam.config.view')) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  try {
    res.json({ success: true, data: exam.listAttempts(req.query, exam.currentPersonnel()) });
  } catch (err) { fail(res, err); }
});

router.get('/exam/attempts/:id', (req, res) => {
  if (!auth.hasPermission('exam.practice') && !auth.hasPermission('exam.config.view')) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  try {
    res.json({ success: true, data: exam.getAttempt(req.params.id, exam.currentPersonnel()) });
  } catch (err) { fail(res, err); }
});

router.get('/course/catalog', (req, res) => {
  if (!requirePerm(res, 'course.config.view')) return;
  try {
    res.json({ success: true, data: exam.listProcedures() });
  } catch (err) { fail(res, err); }
});

router.put('/course/:typeCode', (req, res) => {
  if (!requirePerm(res, 'course.config.edit')) return;
  try {
    res.json({ success: true, data: exam.saveCourse(req.params.typeCode, req.body || {}) });
  } catch (err) { fail(res, err); }
});

router.get('/course/mine', (req, res) => {
  if (!requirePerm(res, 'course.view')) return;
  try {
    res.json({ success: true, data: exam.myCourses(exam.currentPersonnel()) });
  } catch (err) { fail(res, err); }
});

router.get('/course/:typeCode', (req, res) => {
  const preview = req.query.preview === '1';
  if (preview) {
    if (!requirePerm(res, 'course.config.view')) return;
  } else if (!requirePerm(res, 'course.view')) return;
  try {
    res.json({ success: true, data: exam.courseContent(req.params.typeCode, exam.currentPersonnel(), preview) });
  } catch (err) { fail(res, err); }
});

module.exports = router;
