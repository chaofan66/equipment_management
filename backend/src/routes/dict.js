const express = require('express');
const router = express.Router();
const { dict } = require('../data');

// GET /api/dict/categories - list all dict category metadata
router.get('/categories', (req, res) => {
  const CATEGORY_LABELS = {
    DEVICE_STATUS: '设备状态',
    MAINTENANCE_TYPE: '维保类型',
    MAINTENANCE_RESULT: '维保结果',
    SCRAP_DISPOSAL: '报废处置方式',
    ASSET_PURPOSE: '资产用途',
    UNIT: '计量单位',
    ACQUISITION_METHOD: '购置方式',
    VALUE_TYPE: '价值类型',
    BOOKING_STATUS: '入账状态',
    DEPRECIATION_STATUS: '折旧状态',
    DEPRECIATION_METHOD: '折旧方法',
    APPROVAL_STATUS: '审批状态',
    APPLICATION_TYPE: '申请类型',
    PLAN_LEVEL: '保养级别',
    PLAN_STATUS: '计划状态',
    INSPECTION_TYPE: '检查类型',
    WORK_ORDER_TYPE: '工单类型',
    WORK_ORDER_STATUS: '工单状态'
  };
  const categories = Object.keys(dict.DICT).filter(k => k !== 'FACTORY_AREA' && k !== 'DEPT_LIST' && k !== 'WORKSHOP_DEPT_MAP').map(k => ({
    name: k,
    label: CATEGORY_LABELS[k] || k,
    count: Array.isArray(dict.DICT[k]) ? dict.DICT[k].length : (typeof dict.DICT[k] === 'object' ? Object.keys(dict.DICT[k]).length : 0),
    struct: 'array'
  }));
  res.json({ success: true, data: categories });
});

// GET /api/dict/device-types/tree - full device type tree
router.get('/device-types/tree', (req, res) => {
  res.json({ success: true, data: dict.DEVICE_TYPE_TREE });
});

// GET /api/dict/dept-workshop/tree - full department workshop tree
router.get('/dept-workshop/tree', (req, res) => {
  res.json({ success: true, data: dict.DEPT_WORKSHOP_TREE });
});

// GET /api/dict/lookup/type-codes - TYPE_CODE_MAP
router.get('/lookup/type-codes', (req, res) => {
  res.json({ success: true, data: dict.TYPE_CODE_MAP });
});

// GET /api/dict/lookup/dept-codes - DEPT_CODE_MAP
router.get('/lookup/dept-codes', (req, res) => {
  res.json({ success: true, data: dict.DEPT_CODE_MAP });
});

// GET /api/dict/lookup/workshop-codes - WORKSHOP_CODE_MAP
router.get('/lookup/workshop-codes', (req, res) => {
  res.json({ success: true, data: dict.WORKSHOP_CODE_MAP });
});

// GET /api/dict/top-categories - get top-level asset categories
router.get('/top-categories', (req, res) => {
  res.json({ success: true, data: dict.getTopLevelCategories() });
});

// GET /api/dict/category-codes - get top-level category codes
router.get('/category-codes', (req, res) => {
  res.json({ success: true, data: dict.getCategoryCodes() });
});

// PUT /api/dict/device-types - update device type tree (must be before :category)
router.put('/device-types', (req, res) => {
  const { tree } = req.body;
  if (!tree || typeof tree !== 'object') {
    return res.status(400).json({ success: false, error: 'tree 必须是对象' });
  }
  dict.DEVICE_TYPE_TREE = tree;
  // Rebuild TYPE_CODE_MAP from tree
  const newTypeCodeMap = {};
  function collectTypes(node) {
    if (node.children) {
      Object.values(node.children).forEach(child => collectTypes(child));
    } else if (node.code && node.name) {
      newTypeCodeMap[node.name] = node.code;
    }
  }
  Object.values(tree).forEach(node => collectTypes(node));
  dict.TYPE_CODE_MAP = newTypeCodeMap;
  res.json({ success: true, data: { tree, typeCodeCount: Object.keys(newTypeCodeMap).length } });
});

// PUT /api/dict/dept-workshop - update department workshop tree (must be before :category)
router.put('/dept-workshop', (req, res) => {
  const { tree } = req.body;
  if (!tree || typeof tree !== 'object') {
    return res.status(400).json({ success: false, error: 'tree 必须是对象' });
  }
  dict.DEPT_WORKSHOP_TREE = tree;
  // Rebuild related maps from tree
  const newDeptList = [];
  const newDeptCodeMap = {};
  const newWorkshopCodeMap = {};
  const newWorkshopDeptMap = {};
  const newFactoryArea = [];

  Object.entries(tree).forEach(([deptName, deptInfo]) => {
    newDeptList.push(deptName);
    newDeptCodeMap[deptName] = deptInfo.code;
    const workshops = deptInfo.workshops || {};
    Object.entries(workshops).forEach(([wsCode, wsInfo]) => {
      newWorkshopCodeMap[wsInfo.name] = wsInfo.code;
      newWorkshopDeptMap[wsInfo.name] = deptName;
      newFactoryArea.push(wsInfo.name);
    });
  });

  dict.DICT.DEPT_LIST = newDeptList;
  dict.DEPT_CODE_MAP = newDeptCodeMap;
  dict.WORKSHOP_CODE_MAP = newWorkshopCodeMap;
  dict.DICT.WORKSHOP_DEPT_MAP = newWorkshopDeptMap;
  dict.DICT.FACTORY_AREA = newFactoryArea;

  res.json({ success: true, data: { deptCount: newDeptList.length, workshopCount: Object.keys(newWorkshopCodeMap).length } });
});

// GET /api/dict/:category - get items for a specific category (catch-all, after specific routes)
router.get('/:category', (req, res) => {
  const { category } = req.params;

  if (category === 'device-types') {
    return res.json({ success: true, data: dict.DEVICE_TYPE_TREE });
  }

  if (category === 'dept-workshop') {
    return res.json({ success: true, data: dict.DEPT_WORKSHOP_TREE });
  }

  const data = dict.DICT[category];
  if (data === undefined) {
    return res.status(404).json({ success: false, error: `字典分类 "${category}" 不存在` });
  }

  if (Array.isArray(data)) {
    res.json({ success: true, data });
  } else if (typeof data === 'object') {
    res.json({ success: true, data });
  } else {
    res.json({ success: true, data });
  }
});

// PUT /api/dict/:category - update dictionary items (catch-all, after specific routes)
router.put('/:category', (req, res) => {
  const { category } = req.params;
  const { items } = req.body;

  if (category === 'FACTORY_AREA' || category === 'DEPT_LIST' || category === 'WORKSHOP_DEPT_MAP') {
    return res.status(400).json({ success: false, error: '此字典分类不允许直接修改' });
  }

  if (!Array.isArray(items)) {
    return res.status(400).json({ success: false, error: 'items 必须是数组' });
  }

  dict.DICT[category] = items;
  res.json({ success: true, data: dict.DICT[category] });
});

module.exports = router;
