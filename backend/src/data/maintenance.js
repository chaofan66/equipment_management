const dict = require('./dict');
const { DEFAULT_OWNERSHIP_UNIT, DEFAULT_MANAGE_DEPT, DEFAULT_MANAGE_DEPT_CODE } = require('./constants');
const { devices } = require('./devices');
const auth = require('./auth');
const { fmtDate, fmtDateTime } = require('./helpers');

// Destructure for compatibility
const { DICT, TYPE_CODE_MAP } = dict;

// =====================
const maintenanceRecords = [
	  { id:'MT-2025-001',deviceCode:'60012318020201050001',deviceName:'龙门起重机',deviceArea:'总装一部-船体车间',mtType:'设备维修',mtPerson:'袁涛 (10862253)-生产技术室',arriveTime:'2025-06-14 09:30:00',faultAnalysis:'钢丝绳磨损严重，制动器间隙超出标准范围0.5mm以上，限位开关灵敏度下降约30%',repairContent:'更换主起升钢丝绳2根（Φ32mm×120m）、调整制动器间隙至标准值0.3mm、更换限位开关2个并进行功能测试、对卷筒及滑轮组进行润滑保养',checkDate:'',checkBasis:'',checkRecord:'',issueSummary:'',handlingOpinion:'',createdAt:'2025-06-14 10:00'},
	  { id:'MT-2025-002',deviceCode:'60012375010301110001',deviceName:'平板车',deviceArea:'水运部-船坞一车间',mtType:'设备检查',mtPerson:'袁涛 (10862253)-生产技术室',arriveTime:'',faultAnalysis:'',repairContent:'',checkDate:'2025-07-05',checkBasis:'《厂内机动车辆安全检查规程》(HG-AQ-03-12)',checkRecord:'车辆制动系统正常，制动距离符合标准；轮胎磨损程度在允许范围内；灯光信号系统完好；货叉无明显变形或裂纹；但发动机怠速时存在轻微异响，需进一步诊断',issueSummary:'1. 发动机怠速异响（疑似气门间隙过大或喷油器故障）\n2. 左前轮胎花纹深度接近磨损极限标记\n3. 液压油管接头处有轻微渗油痕迹',handlingOpinion:'列入维修计划（建议完成时限）',createdAt:'2025-07-05 14:30'},
	  { id:'MT-2025-003',deviceCode:'60012317000902050001',deviceName:'喷气泵',deviceArea:'涂装一部',mtType:'设备维修',mtPerson:'刘明辉 (10862254)-生产技术室',arriveTime:'2025-06-19 08:15:00',faultAnalysis:'喷嘴堵塞导致喷涂不均匀，滤网已超过使用寿命，压力表读数偏差约0.05MPa',repairContent:'拆卸清洗喷嘴组件（共12个喷嘴）、更换进气管路滤网3个、校准压力表并更换密封垫圈、测试喷涂均匀性合格',checkDate:'',checkBasis:'',checkRecord:'',issueSummary:'',handlingOpinion:'',createdAt:'2025-06-19 09:00'},
	  { id:'MT-2025-004',deviceCode:'60012375030201060001',deviceName:'门座起重机',deviceArea:'生产管理部-码头调度室',mtType:'设备检查',mtPerson:'袁涛 (10862253)-生产技术室',arriveTime:'',faultAnalysis:'',repairContent:'',checkDate:'2025-07-10',checkBasis:'《起重机械定期检验规则》(TSG Q7015)及公司《门座起重机月度检查标准》',checkRecord:'回转机构运行时存在间歇性异响，声音频率与回转速度正相关；回转支承齿面润滑脂不足且颜色发黑；回转减速机齿轮油位偏低；变幅机构、起升机构运行正常，制动器动作可靠',issueSummary:'1. 回转支承异响（可能原因：滚道磨损、滚动体损坏或润滑不足）\n2. 回转支承齿面润滑脂变质需更换\n3. 回转减速机齿轮油位偏低，需补充并检查是否泄漏',handlingOpinion:'立即停机处理',createdAt:'2025-07-10 11:00'},
	  { id:'MT-2025-005',deviceCode:'60012325020404010001',deviceName:'等离子切割机',deviceArea:'加工一部-钢加车间',mtType:'设备维修',mtPerson:'陈志强 (10862255)-生产技术室',arriveTime:'2025-06-30 14:00:00',faultAnalysis:'切割精度偏差0.5mm以上，割嘴电极磨损严重，冷却液管路有轻微堵塞，导轨积累粉尘影响运动精度',repairContent:'更换等离子割嘴电极5套、清洗冷却管路并更换冷却液（型号HPR260XD专用）、清洁导轨并重新校准运动精度至±0.1mm以内、更换空气滤清器滤芯',checkDate:'',checkBasis:'',checkRecord:'',issueSummary:'',handlingOpinion:'',createdAt:'2025-06-30 15:30'},
	];

// ===================== SCRAP RECORDS =====================
const scrapRecords = [
  { id:'SCP-2025-001',deviceId:'DEV009',deviceCode:'60012325040104060001',deviceName:'数控弯曲机',currentStatus:'封存',value:950000,scrapDate:'2025-08-01',disposal:'变卖处置',residual:120000,reason:'液压系统严重损坏',applicant:'张建国',applyTime:'2025-07-02 14:00',status:'审批中',approvalOpinion:''},
];

// ===================== TRANSFER RECORDS =====================
const transferRecords = [
  { id:'TRF-2025-001',deviceId:'DEV003',deviceCode:'60012375010301110001',deviceName:'平板车',currentArea:'水运部-船坞一车间',targetArea:'总装一部-船体车间',newPerson:'孙晓峰',reason:'总装一部生产任务增加',transferDate:'2025-07-10',applicant:'张建国',applyTime:'2025-07-01 09:30',status:'待审批'},
];

// ===================== APPROVAL REQUESTS (combined) =====================
const approvalRequests = [
  { id:'APP001',type:'调拨',deviceId:'DEV003',deviceCode:'60012375010301110001',deviceName:'平板车',currentArea:'水运部-船坞一车间',targetArea:'总装一部-船体车间',newPerson:'孙晓峰',reason:'生产任务增加',transferDate:'2025-07-10',applicant:'张建国',applyTime:'2025-07-01 09:30',approver:'周大伟',approvalOpinion:'',status:'待审批'},
  { id:'APP002',type:'报废',deviceId:'DEV009',deviceCode:'60012325040104060001',deviceName:'数控弯曲机',currentStatus:'封存',value:950000,scrapDate:'2025-08-01',disposal:'变卖处置',residual:120000,reason:'液压系统严重损坏',applicant:'张建国',applyTime:'2025-07-02 14:00',approver:'周大伟',approvalOpinion:'',status:'审批中'},
  { id:'APP003',type:'调拨',deviceId:'DEV005',deviceCode:'60012317000902050001',deviceName:'喷气泵',currentArea:'涂装一部',targetArea:'涂装二部',newPerson:'王海波',reason:'涂装二部设备不足',transferDate:'2025-07-15',applicant:'张建国',applyTime:'2025-06-28 11:00',approver:'周大伟',approvalOpinion:'同意调拨',status:'已通过'},
];

// ===================== PURCHASE RECORDS =====================
const purchaseRecords = [{
    id:'CK-2025-002',date:'2025-06-22',deviceId:'DEV003',deviceName:'平板车',
    parts:[
      {lineNo:'10',materialType:'滤清器',materialCode:'LB-LF9009-001',materialName:'机油滤清器',materialSpec:'LF9009 配套康明斯',manageUnit:'个',manageQty:2,priceUnit:'个',priceQty:2},
      {lineNo:'20',materialType:'机油',materialCode:'JY-15W40-18L',materialName:'柴油机油',materialSpec:'15W-40 18L/桶',manageUnit:'桶',manageQty:3,priceUnit:'桶',priceQty:3}
    ],
    approval:{status:'已出库',approver:'陈海明',approveTime:'2025-06-23 09:15',remark:''}
  },
  {
    id:'CK-2025-003',date:'2025-07-03',deviceId:'DEV004',deviceName:'等离子切割机',
    parts:[
      {lineNo:'10',materialType:'割嘴',materialCode:'GZ-HPR260XD-003',materialName:'等离子割嘴',materialSpec:'HPR260XD 260A',manageUnit:'个',manageQty:5,priceUnit:'个',priceQty:5}
    ],
    approval:{status:'审批中',approver:'陈海明',approveTime:'',remark:'配件库存不足，待补货后出库'}
  },
  {
    id:'CK-2025-004',date:'2025-08-08',deviceId:'DEV007',deviceName:'30T门座式起重机',
    parts:[
      {lineNo:'10',materialType:'轴承',materialCode:'ZC-01130500-001',materialName:'回转支承轴承',materialSpec:'011.30.500 外齿式',manageUnit:'套',manageQty:1,priceUnit:'套',priceQty:1},
      {lineNo:'20',materialType:'密封件',materialCode:'MF-NBR-280X320',materialName:'丁腈橡胶密封圈',materialSpec:'280×320×18 NBR',manageUnit:'个',manageQty:4,priceUnit:'个',priceQty:4},
      {lineNo:'30',materialType:'螺栓',materialCode:'LS-M24X120-88',materialName:'高强度六角螺栓',materialSpec:'M24×120 8.8级',manageUnit:'套',manageQty:16,priceUnit:'套',priceQty:16}
    ],
    approval:{status:'待审批',approver:'陈海明',approveTime:'',remark:'大件配件，需设备部门负责人加签'}
  },
  {
    id:'CK-2025-005',date:'2025-09-18',deviceId:'DEV018',deviceName:'焊接机器人工作站',
    parts:[
      {lineNo:'10',materialType:'传感器',materialCode:'CG-CS200-001',materialName:'碰撞传感器',materialSpec:'CS-200 机器人专用',manageUnit:'个',manageQty:1,priceUnit:'个',priceQty:1}
    ],
    approval:{status:'已出库',approver:'陈海明',approveTime:'2025-09-19 14:00',remark:''}
  },
  {
    id:'CK-2025-006',date:'2025-10-08',deviceId:'DEV024',deviceName:'纵骨焊接机',
    parts:[
      {lineNo:'10',materialType:'送丝轮',materialCode:'SSL-1.2-004',materialName:'送丝轮',materialSpec:'Φ1.2mm V型槽 双驱',manageUnit:'个',manageQty:8,priceUnit:'个',priceQty:8},
      {lineNo:'20',materialType:'导电嘴',materialCode:'DDZ-M6-1.2',materialName:'铬锆铜导电嘴',materialSpec:'M6×1.2mm',manageUnit:'个',manageQty:20,priceUnit:'个',priceQty:20}
    ],
    approval:{status:'已驳回',approver:'陈海明',approveTime:'2025-10-09 11:00',remark:'请料单规格与设备不匹配，请核实后重新提交'}
  }
];;

let applications = [
  { id:'APP001',type:'调拨',deviceId:'DEV003',deviceCode:'60012375010301110001',deviceName:'平板车',currentArea:'钢材堆场',targetArea:'2号船坞',newPerson:'孙晓峰',reason:'2号船坞生产任务增加，需调配运输设备',transferDate:'2025-07-10',applicant:'张建国',applyTime:'2025-07-01 09:30',approver:'周大伟',approvalOpinion:'',status:'待审批' },
  { id:'APP002',type:'报废',deviceId:'DEV009',deviceCode:'60012325040104060001',deviceName:'数控弯曲机',currentStatus:'封存',value:950000,scrapDate:'2025-08-01',disposal:'变卖处置',residual:120000,reason:'液压系统严重损坏，维修成本超过设备残值，建议报废处置',applicant:'张建国',applyTime:'2025-07-02 14:00',approver:'周大伟',approvalOpinion:'',status:'审批中' },
  { id:'APP003',type:'调拨',deviceId:'DEV005',deviceCode:'60012317000902050001',deviceName:'喷气泵',currentArea:'涂装车间',targetArea:'船体装配车间',newPerson:'王海波',reason:'涂装车间设备冗余，调配至装配车间补充产能',transferDate:'2025-07-15',applicant:'张建国',applyTime:'2025-06-28 11:00',approver:'周大伟',approvalOpinion:'同意调拨，请做好交接',status:'已通过' },
  { id:'APP004',type:'报废',deviceId:'DEV010',deviceCode:'60012305000301010001',deviceName:'叉车',currentStatus:'在用',value:220000,scrapDate:'2025-09-01',disposal:'报废回收',residual:30000,reason:'使用年限到期，整体车况恶化，维修频繁',applicant:'张建国',applyTime:'2025-06-15 08:30',approver:'周大伟',approvalOpinion:'驳回，该设备仍在维保合同期内，续签合同后可继续使用',status:'已驳回' }
];

// ===================== CHECKIN RECORDS =====================
const checkinRecords = [
  { id:'WC-2025-001',deviceId:'DEV001',deviceName:'龙门起重机',checkType:'月度点检',checkDate:'2025-06-01',checker:'张建国',result:'正常',abnormal:'',files:[]},
  { id:'WC-2025-002',deviceId:'DEV004',deviceName:'等离子切割机',checkType:'周检',checkDate:'2025-06-28',checker:'陈志强',result:'异常',abnormal:'切割精度偏差0.5mm',files:[]},
];

// ===================== PENDING APPROVALS =====================
const pendingApprovals = [
  { id:'APP001',type:'调拨',deviceId:'DEV003',deviceName:'平板车',applicant:'张建国',applyTime:'2025-07-01 09:30'},
  { id:'APP002',type:'报废',deviceId:'DEV009',deviceName:'数控弯曲机',applicant:'张建国',applyTime:'2025-07-02 14:00'},
];

// ===================== DAILY CHECK ITEMS (by device category type code prefix) =====================
const DAILY_CHECK_ITEMS = {
  '通用': ['设备外部清洁、工作台擦拭','清理铁屑、油污、灰尘','检查油位/油窗','手动加油点班前润滑','检查紧固易松动的螺栓螺母','检查皮带/链条松紧','检查安全防护装置有效性','检查设备运行异响','检查设备运行振动','检查设备运行温升','检查油/水/气泄漏','检查仪表指示是否正常','检查表面锈蚀/防腐层'],
  '02': ['钢丝绳磨损/断丝检查','吊钩变形/裂纹检查','限位器灵敏度测试','制动器制动力矩检查','轨道连接与压板检查','滑轮组转动灵活性','起升高度限位器功能测试','行走机构异响检查','电气控制柜清洁'],
  '04': ['电缆绝缘完好检查','焊接参数校准确认','送丝机构通畅检查','气体流量正常检查','接地可靠性检查','焊枪/割枪状态检查','冷却液液位与浓度','过滤网清洁'],
  '03': ['轮胎/履带磨损检查','液压系统压力检查','转向机构灵活性','灯光/喇叭/信号正常','制动系统可靠性','电池/电瓶状态','货叉/平板变形检查'],
  '00': ['导轨润滑与磨损检查','冷却液液位与浓度','刀架锁紧可靠性','主轴精度检查','进给机构灵活性','切屑清理'],
  '06': ['压力表/温度表检查','安全阀校验标牌检查','管路密封检查','过滤网清洁','运行参数记录','排水阀功能检查'],
  '05': ['绝缘电阻测试','接线端子温度检查','接地完好检查','柜内清洁干燥','保护装置功能测试','指示灯/仪表正常'],
};

// ===================== MAINTENANCE PLAN DATA =====================
const maintenancePlans = [];
// Generate plans for devices that have a 'typeCode' matching regex (non '000000')
devices.forEach(function(d) {
  var cat = (d.typeCode||'').substring(0,2) || '通用';
  // A类设备 (起重02/电气05/动能06/专用08) → 2次/年
  // B类设备 (其他) → 1次/年
  var isA = ['02','05','06','08'].indexOf(cat) >= 0;
  var times = isA ? 2 : 1;
  for (var i = 0; i < times; i++) {
    var m = isA ? (i === 0 ? 3 : 9) : (6); // A: Mar+Sep, B: Jun
    maintenancePlans.push({
      id: 'MP-'+d.id+'-'+String(i+1).padStart(2,'0'),
      deviceId: d.id, deviceCode: d.code, deviceName: d.name, spec: d.spec||'', area: d.area,
      company: d.ownershipUnit||DEFAULT_OWNERSHIP_UNIT,
      dept: DICT.WORKSHOP_DEPT_MAP[d.area]||'', category: isA?'A':'B',
      level: (i===0?'一级保养':'二级保养'), year: 2026, month: m,
      status: '待执行', // 待执行/进行中/待验收/已完成/已超期
      planDate: '2026-'+String(m).padStart(2,'0')+'-01',
      processes: [
        {name:'清洁与外观检查',standard:'设备外部清洁无油污，外观完好',done:false},
        {name:'润滑系统检查与补油',standard:'各润滑点润滑良好，油位正常',done:false},
        {name:'紧固件检查与复紧',standard:'主要螺栓/螺母无松动',done:false},
        {name:'安全装置功能测试',standard:'安全装置动作可靠',done:false},
        {name:'运行试机',standard:'空载运行正常，无异响/异振',done:false},
      ],
      safetyNotice: [
        '保养前确认设备处于停电状态、停机工位',
        '保养前确认劳保护具佩戴齐全，工器具完好合格',
        '保养中合理使用工器具，按保养工艺要求操作，做好互联互保',
        '保养后清理现场，保持清洁；废旧零部件按要求回收',
        '保养后试车正常，做好交接',
      ],
      operatorSign:'', deptSign:'', supervisorSign:'', completedDate:''
    });
  }
});

// Mark some as different statuses for demo
if(maintenancePlans[0]) maintenancePlans[0].status = '进行中';
if(maintenancePlans[1]) maintenancePlans[1].status = '已完成';
if(maintenancePlans[1]) { maintenancePlans[1].operatorSign='张建国'; maintenancePlans[1].deptSign='李琳'; maintenancePlans[1].supervisorSign='邹伟林'; maintenancePlans[1].completedDate='2026-03-18'; }
if(maintenancePlans[4]) maintenancePlans[4].status = '已超期';

// ===================== INSPECTION RECORDS (定期检查 + 专项检查) =====================
const inspectionRecords = [];   // V1.61 旧数据清理：旧格式 60012318020201050001-2026-0710-001 / ZX-JC-001 已清除（新编号=yyyy+mmdd+6位）

// ===================== RECTIFICATION TRACKING =====================
const rectificationItems = [];   // V1.61 旧数据清理：RT-001/002/003 关联旧检查记录已清除

// ===================== MAINTENANCE WORK ORDERS (完整工单) =====================
const workOrders = [];   // V1.61 旧数据清理：SBWX 旧格式工单已清除（V2 维修走 generatedPlans projectType='repair'）

// ===================== DAILY CHECK RECORDS (mock for current month) =====================
const dailyCheckRecords = [];
var now = new Date();
var year = now.getFullYear(), month = now.getMonth()+1;
devices.slice(0,8).forEach(function(d) {
  dailyCheckRecords.push({
    id: 'DC-'+d.id+'-'+year+'-'+String(month).padStart(2,'0'),
    deviceCode: d.code, deviceName: d.name, model: d.spec||'', unit: DICT.WORKSHOP_DEPT_MAP[d.area]||'', location: d.area,
    year: year, month: month,
    checker: d.person||'张建国',
    checks: {}, // {day: {itemIndex: '√'|'×'|'△', repairNo: '', issueNote: ''}}
  });
});

const DEPT_CODE_MAP = {
  "总经办": "0100",
  "财务管理部": "0200",
  "采购一部": "0300",
  "采购二部": "0400",
  "仓库": "0500",
  "法务部": "0600",
  "行政部": "0700",
  "信息中心": "0800",
  "土建部": "0900",
  "人事部": "1000",
  "安环部": "1100",
  "造船安环部": "1200",
  "商务部": "1300",
  "品管部": "1400",
  "船舶设计研究中心": "1500",
  "分段一部": "1600",
  "涂装一部": "1700",
  "总装一部": "1800",
  "生产管理部": "1900",
  "关务部": "2100",
  "生产保障部": "2200",
  "精度部": "2300",
  "项目部": "2400",
  "加工一部": "2500",
  "基础管理": "2600",
  "外协管理部": "2700",
  "对外联络办": "2800",
  "资金管理部": "2900",
  "宿管办": "3200",
  "工法部": "5000",
  "装备制造部": "5700",
  "分段二部": "5800",
  "加工二部": "5900",
  "总装二部": "6200",
  "管舾部": "6300",
  "铁舾部": "6400",
  "镀锌车间": "6500",
  "商务二部": "6600",
  "居装二部": "6700",
  "分段三部": "6800",
  "电装调试部": "6900",
  "新闻宣传部": "7000",
  "企管部": "7100",
  "研发部": "7300",
  "工程部": "7400",
  "水运部": "7500",
  "大连国际船舶设计中心": "7600",
  "居装一部": "7700",
  "总装三部": "7800",
  "工程仓库": "8400",
  "售后服务部": "8500",
  "造船-上海虹桥分公司": "8600",
  "造船-南通分公司": "8700",
  "工程公司安全管理部": "8800",
  "工程公司综合管理部": "8900",
  "工程公司成本核算部": "9000",
  "工程公司舾装部": "9100",
  "工程公司生产计划部": "9200",
  "工程公司机装部": "9300",
  "工程公司调试部": "9400",
  "工程公司船体部": "9500",
  "涂装二部": "9600",
  "制造技术部": "9700",
  "总装四部": "9800",
  "恒力造船水稳料现场": "9900",
  "工程公司精度部": "A100",
  "工程公司船装部": "A200",
};
const WORKSHOP_CODE_MAP = {
  "总经办": "0100",
  "财务管理部": "0200",
  "采购一部": "0300",
  "采购二部": "0400",
  "仓库": "0500",
  "法务部": "0600",
  "行政部-车队": "0701",
  "行政部-迎宾馆": "0702",
  "行政部-办公室": "0703",
  "行政部-接待餐厅": "0706",
  "信息中心": "0800",
  "土建部": "0900",
  "人事部-人事": "1001",
  "安环部-保安": "1101",
  "安环部-安环": "1102",
  "安环部-消防": "1103",
  "造船安环部": "1200",
  "商务部": "1300",
  "品管部-船体检查一室": "1401",
  "品管部-机电检查一室": "1402",
  "品管部-售后服务室": "1403",
  "品管部-无损检测室": "1404",
  "品管部-质量管理室": "1405",
  "品管部-物资检验室": "1406",
  "品管部-计量理化实验中心": "1407",
  "品管部-机电检查二室": "1408",
  "品管部-船体检查二室": "1409",
  "品管部-焊接管理室": "1410",
  "船舶设计研究中心-综合室": "1501",
  "船舶设计研究中心-海工室": "1502",
  "船舶设计研究中心-船装室": "1503",
  "船舶设计研究中心-船体室": "1504",
  "船舶设计研究中心-电装室": "1505",
  "船舶设计研究中心-机装室": "1506",
  "船舶设计研究中心-总体室": "1507",
  "船舶设计研究中心-居装室": "1508",
  "船舶设计研究中心-上海分部": "1510",
  "分段一部-综合管理室": "1601",
  "分段一部-平组车间": "1602",
  "分段一部-曲组车间": "1603",
  "分段一部-分段一车间": "1604",
  "分段一部-分段二车间": "1605",
  "分段一部-分段三车间": "1607",
  "分段一部-分段四车间": "1608",
  "分段一部-支援车间": "1612",
  "分段一部-先行舾装车间": "1613",
  "分段一部-曲组三车间": "1614",
  "分段一部-曲组四车间": "1615",
  "分段一部-曲组五车间": "1616",
  "涂装一部": "1700",
  "总装一部-综合管理室": "1801",
  "总装一部-船体车间": "1802",
  "总装一部-机装车间": "1803",
  "总装一部-调试中心": "1804",
  "总装一部-电装车间": "1805",
  "总装一部-支援车间": "1806",
  "总装一部-居装车间": "1807",
  "总装一部-船装车间": "1808",
  "总装一部-安装中心": "1809",
  "总装一部-涂装车间": "1810",
  "总装一部-作业车间": "1811",
  "总装一部-工程计划室": "1812",
  "生产管理部-生产计划室": "1901",
  "生产管理部-项目管理室": "1902",
  "生产管理部-生产支援室": "1903",
  "生产管理部-码头调度室": "1904",
  "关务部": "2100",
  "生产保障部-动能管理室": "2201",
  "生产保障部-焊机工具一室": "2202",
  "生产保障部-起重设备一室": "2203",
  "生产保障部-通用设备一室": "2204",
  "生产保障部-综合管理室": "2205",
  "生产保障部-焊机工具二室": "2212",
  "生产保障部-通用设备二室": "2213",
  "生产保障部-起重设备二室": "2214",
  "精度部-生产技术室": "2301",
  "项目部": "2400",
  "加工一部-钢加车间": "2502",
  "加工一部-综合管理室": "2503",
  "加工一部-组立车间": "2504",
  "基础管理-基础管理车间": "2601",
  "基础管理-准备车间": "2602",
  "基础管理-6S": "2603",
  "基础管理-环卫": "2604",
  "基础管理-维保车间": "2605",
  "基础管理-水运车间": "2606",
  "基础管理-三供车间": "2607",
  "外协管理部-委外加工室": "2701",
  "外协管理部-劳务管理室": "2702",
  "外协管理部-计价室": "2703",
  "外协管理部-成本室": "2704",
  "外协管理部-数据管理室": "2705",
  "对外联络办": "2800",
  "资金管理部": "2900",
  "宿管办": "3200",
  "工法部-综合管理室": "5001",
  "工法部-起运室": "5002",
  "工法部-工艺室": "5003",
  "工法部-焊接室": "5004",
  "装备制造部-综合管理室": "5701",
  "装备制造部-船配一车间": "5702",
  "装备制造部-绿色能源一车间": "5703",
  "装备制造部-绿色能源二车间": "5704",
  "分段二部-曲组三车间": "5801",
  "分段二部-曲组二车间": "5802",
  "分段二部-综合管理室": "5803",
  "分段二部-平组车间": "5804",
  "分段二部-曲组一车间": "5805",
  "分段二部-先行舾装车间": "5806",
  "加工二部-组立车间": "5901",
  "加工二部-钢加车间": "5902",
  "加工二部-准备车间": "5903",
  "加工二部-综合管理室": "5904",
  "总装二部-综合管理室": "6201",
  "总装二部-船体车间": "6202",
  "总装二部-机装车间": "6203",
  "总装二部-调试中心": "6204",
  "总装二部-电装车间": "6205",
  "总装二部-船装车间": "6206",
  "总装二部-支援车间": "6207",
  "总装二部-涂装车间": "6208",
  "管舾部": "6300",
  "铁舾部": "6400",
  "镀锌车间": "6500",
  "商务二部": "6600",
  "居装二部-综合管理室": "6701",
  "居装二部-总组车间": "6702",
  "居装二部-分段车间": "6703",
  "居装二部-居装车间": "6705",
  "分段三部-平组内业车间": "6801",
  "分段三部-平组外业车间": "6802",
  "分段三部-先行舾装": "6803",
  "分段三部-综合管理室": "6804",
  "分段三部-支援车间": "6805",
  "电装调试部-电装一车间": "6901",
  "电装调试部-电装二车间": "6902",
  "电装调试部-调试一车间": "6903",
  "电装调试部-调试二车间": "6904",
  "电装调试部-综合管理室": "6905",
  "新闻宣传部": "7000",
  "企管部": "7100",
  "研发部": "7300",
  "工程部-材料组": "7401",
  "水运部-船坞一车间": "7501",
  "水运部-船坞二车间": "7502",
  "水运部-船台车间": "7503",
  "水运部-综合管理室": "7504",
  "大连国际船舶设计中心": "7600",
  "居装一部-总组车间": "7701",
  "居装一部-居装车间": "7702",
  "居装一部-综合管理室": "7703",
  "居装一部-分段车间": "7704",
  "总装三部-涂装一车间": "7801",
  "总装三部-支援一车间": "7802",
  "总装三部-船体一车间": "7803",
  "总装三部-船装一车间": "7804",
  "总装三部-机装一车间": "7805",
  "总装三部-综合管理一室": "7806",
  "总装三部-涂装二车间": "7807",
  "总装三部-支援二车间": "7808",
  "总装三部-船体二车间": "7809",
  "总装三部-船装二车间": "7810",
  "总装三部-机装二车间": "7811",
  "总装三部-综合管理二室": "7812",
  "总装三部-工程计划一室": "7813",
  "总装三部-工程计划二室": "7814",
  "总装三部-精度管理一室": "7815",
  "总装三部-精度管理二室": "7816",
  "总装三部-质量工艺一室": "7817",
  "总装三部-质量工艺二室": "7818",
  "工程仓库": "8400",
  "售后服务部": "8500",
  "造船-上海虹桥分公司-总经办-上海": "8601",
  "造船-上海虹桥分公司-机装室-上海": "8602",
  "造船-上海虹桥分公司-船体室-上海": "8603",
  "造船-上海虹桥分公司-行政部-上海": "8604",
  "造船-上海虹桥分公司-电装室-上海": "8605",
  "造船-上海虹桥分公司-商务部二部-上海": "8606",
  "造船-上海虹桥分公司-总体室-上海": "8607",
  "造船-上海虹桥分公司-居装室-上海": "8608",
  "造船-上海虹桥分公司-舾装室-上海": "8609",
  "造船-上海虹桥分公司-人事部-上海": "8610",
  "造船-南通分公司-行政部-南通": "8701",
  "造船-南通分公司-人事部-南通": "8702",
  "造船-南通分公司-居装室-南通": "8703",
  "造船-南通分公司-机装室-南通": "8704",
  "造船-南通分公司-船体室-南通": "8705",
  "造船-南通分公司-船装室-南通": "8706",
  "造船-南通分公司-电装室-南通": "8707",
  "工程公司安全管理部": "8800",
  "工程公司综合管理部": "8900",
  "工程公司成本核算部": "9000",
  "工程公司舾装部-舾装一车间": "9101",
  "工程公司舾装部-舾装二车间": "9102",
  "工程公司舾装部-舾装三车间": "9103",
  "工程公司舾装部-舾装四车间": "9104",
  "工程公司舾装部-舾装五车间": "9105",
  "工程公司舾装部-舾装六车间": "9106",
  "工程公司舾装部-舾装七车间": "9107",
  "工程公司生产计划部-材料组": "9201",
  "工程公司生产计划部-电装管理室": "9202",
  "工程公司生产计划部-机装管理室": "9203",
  "工程公司生产计划部-涂装管理室": "9204",
  "工程公司生产计划部-船体管理室": "9205",
  "工程公司生产计划部-支援车间": "9206",
  "工程公司生产计划部-船装管理室": "9207",
  "工程公司机装部-机装一车间": "9301",
  "工程公司机装部-机装二车间": "9302",
  "工程公司机装部-机装三车间": "9303",
  "工程公司机装部-机装四车间": "9304",
  "工程公司调试部-调试一车间": "9401",
  "工程公司调试部-调试二车间": "9402",
  "工程公司调试部-调试三车间": "9403",
  "工程公司调试部-调试四车间": "9404",
  "工程公司船体部-船体一车间": "9501",
  "工程公司船体部-船体二车间": "9502",
  "工程公司船体部-船体三车间": "9503",
  "工程公司船体部-船体四车间": "9504",
  "工程公司船体部-船体五车间": "9505",
  "工程公司船体部-船体六车间": "9506",
  "工程公司船体部-船体七车间": "9507",
  "工程公司船体部-船体八车间": "9508",
  "涂装二部": "9600",
  "制造技术部-总装精控一室": "9701",
  "制造技术部-总装精控二室": "9702",
  "制造技术部-分段精控一室": "9703",
  "制造技术部-分段精控二室": "9704",
  "制造技术部-加工精控一室": "9705",
  "制造技术部-加工精控二室": "9706",
  "制造技术部-先行脚手支援室": "9707",
  "制造技术部-生产技术室": "9708",
  "总装四部-船装车间": "9801",
  "总装四部-船体车间": "9802",
  "总装四部-综合管理室": "9803",
  "总装四部-涂装车间": "9804",
  "总装四部-机装车间": "9805",
  "总装四部-支援车间": "9806",
  "恒力造船水稳料现场": "9900",
  "工程公司精度部-精度车间": "A101",
  "工程公司精度部-定位车间": "A102",
  "工程公司船装部-船装一车间": "A201",
  "工程公司船装部-船装二车间": "A202",
  "工程公司船装部-涂装一车间": "A203",
  "工程公司船装部-涂装二车间": "A204",
};
// ===================== DEVICE DATA NORMALIZATION =====================
// Fill in fields from the standard asset ledger schema that were not originally in the mock data.
function normalizeDevices() {
  var now = new Date();
  devices.forEach(function(d, idx) {
    // --- 基本信息 ---
    if (!d.spec) d.spec = d.name;                          // 规格/型号 — default to device name
    if (!d.typeCode) d.typeCode = TYPE_CODE_MAP[d.type]||'QT'; // 资产类别编码
    if (d.qty === undefined) d.qty = 1;                     // 数量
    if (!d.unit) d.unit = '台';      // 计量单位

    // --- 配置信息 ---
    if (!d.purpose) d.purpose = '生产用'; // 资产用途
    if (!d.acquisitionMethod) d.acquisitionMethod = '采购';          // 取得方式
    if (!d.valueType) d.valueType = '原值';                          // 价值类型

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
    if (d.useMonths === undefined) d.useMonths = 120;
    // accrualMonths: months from purchaseDate to now (or 0 if impossible)
    if (d.accrualMonths === undefined) {
      if (d.purchaseDate && d.status !== '待修') {
        var pd = new Date(d.purchaseDate);
        var m = (now.getFullYear()-pd.getFullYear())*12 + (now.getMonth()-pd.getMonth());
        d.accrualMonths = Math.max(0, Math.min(m, d.useMonths));
      } else {
        d.accrualMonths = 0;
      }
    }
    // netValue: simplified straight-line residual
    if (d.netValue === undefined) {
      var rate = d.useMonths > 0 ? Math.max(0, 1 - d.accrualMonths / d.useMonths) : 0;
      d.netValue = Math.round((d.value||0) * rate);
    }
    if (!d.bookingDate) d.bookingDate = d.purchaseDate||'';                    // 入账日期
    if (!d.voucherNo) d.voucherNo = d.purchaseDate ? 'PZ-'+d.purchaseDate.substring(0,4)+'-'+String(idx+1).padStart(3,'0') : ''; // 记账凭证号

    // --- 归属信息 ---
    if (!d.ownershipUnit) d.ownershipUnit = DEFAULT_OWNERSHIP_UNIT;               // 归属单位
    if (!d.manageDeptCode) d.manageDeptCode = DEPT_CODE_MAP[DEFAULT_MANAGE_DEPT]||DEFAULT_MANAGE_DEPT_CODE;  // 管理部门编码
    if (!d.manageDept) d.manageDept = DEFAULT_MANAGE_DEPT;             // 管理部门
    if (!d.useDeptCode) d.useDeptCode = DEPT_CODE_MAP[d.department]||'';        // 使用部门编码
    if (!d.factoryNo) d.factoryNo = 'F-'+ (TYPE_CODE_MAP[d.type]||'QT') + '-' + String(idx+1).padStart(4,'0'); // 出厂编号
    if (!d.projectNo) d.projectNo = DICT.WORKSHOP_DEPT_MAP[d.area] ? DICT.WORKSHOP_DEPT_MAP[d.area] + '-PRJ' : ''; // 项目号
  });
}
normalizeDevices();

// ===================== GLOBAL STATE =====================
let currentDetailDeviceId = null;
let editingDeviceId = null;
let modalCallback = null;
let deviceFormFiles = [];

const DEPT_WORKSHOP_TREE = {
  "总经办": {
    code: "0100",
    workshops: {
      "0100": { name: "总经办", code: "0100" }
    }
  },
  "财务管理部": {
    code: "0200",
    workshops: {
      "0200": { name: "财务管理部", code: "0200" }
    }
  },
  "采购一部": {
    code: "0300",
    workshops: {
      "0300": { name: "采购一部", code: "0300" }
    }
  },
  "采购二部": {
    code: "0400",
    workshops: {
      "0400": { name: "采购二部", code: "0400" }
    }
  },
  "仓库": {
    code: "0500",
    workshops: {
      "0500": { name: "仓库", code: "0500" }
    }
  },
  "法务部": {
    code: "0600",
    workshops: {
      "0600": { name: "法务部", code: "0600" }
    }
  },
  "行政部": {
    code: "0700",
    workshops: {
      "0701": { name: "行政部-车队", code: "0701" },
      "0702": { name: "行政部-迎宾馆", code: "0702" },
      "0703": { name: "行政部-办公室", code: "0703" },
      "0706": { name: "行政部-接待餐厅", code: "0706" }
    }
  },
  "信息中心": {
    code: "0800",
    workshops: {
      "0800": { name: "信息中心", code: "0800" }
    }
  },
  "土建部": {
    code: "0900",
    workshops: {
      "0900": { name: "土建部", code: "0900" }
    }
  },
  "人事部": {
    code: "1000",
    workshops: {
      "1001": { name: "人事部-人事", code: "1001" }
    }
  },
  "安环部": {
    code: "1100",
    workshops: {
      "1101": { name: "安环部-保安", code: "1101" },
      "1102": { name: "安环部-安环", code: "1102" },
      "1103": { name: "安环部-消防", code: "1103" }
    }
  },
  "造船安环部": {
    code: "1200",
    workshops: {
      "1200": { name: "造船安环部", code: "1200" }
    }
  },
  "商务部": {
    code: "1300",
    workshops: {
      "1300": { name: "商务部", code: "1300" }
    }
  },
  "品管部": {
    code: "1400",
    workshops: {
      "1401": { name: "品管部-船体检查一室", code: "1401" },
      "1402": { name: "品管部-机电检查一室", code: "1402" },
      "1403": { name: "品管部-售后服务室", code: "1403" },
      "1404": { name: "品管部-无损检测室", code: "1404" },
      "1405": { name: "品管部-质量管理室", code: "1405" },
      "1406": { name: "品管部-物资检验室", code: "1406" },
      "1407": { name: "品管部-计量理化实验中心", code: "1407" },
      "1408": { name: "品管部-机电检查二室", code: "1408" },
      "1409": { name: "品管部-船体检查二室", code: "1409" },
      "1410": { name: "品管部-焊接管理室", code: "1410" }
    }
  },
  "船舶设计研究中心": {
    code: "1500",
    workshops: {
      "1501": { name: "船舶设计研究中心-综合室", code: "1501" },
      "1502": { name: "船舶设计研究中心-海工室", code: "1502" },
      "1503": { name: "船舶设计研究中心-船装室", code: "1503" },
      "1504": { name: "船舶设计研究中心-船体室", code: "1504" },
      "1505": { name: "船舶设计研究中心-电装室", code: "1505" },
      "1506": { name: "船舶设计研究中心-机装室", code: "1506" },
      "1507": { name: "船舶设计研究中心-总体室", code: "1507" },
      "1508": { name: "船舶设计研究中心-居装室", code: "1508" },
      "1510": { name: "船舶设计研究中心-上海分部", code: "1510" }
    }
  },
  "分段一部": {
    code: "1600",
    workshops: {
      "1601": { name: "分段一部-综合管理室", code: "1601" },
      "1602": { name: "分段一部-平组车间", code: "1602" },
      "1603": { name: "分段一部-曲组车间", code: "1603" },
      "1604": { name: "分段一部-分段一车间", code: "1604" },
      "1605": { name: "分段一部-分段二车间", code: "1605" },
      "1607": { name: "分段一部-分段三车间", code: "1607" },
      "1608": { name: "分段一部-分段四车间", code: "1608" },
      "1612": { name: "分段一部-支援车间", code: "1612" },
      "1613": { name: "分段一部-先行舾装车间", code: "1613" },
      "1614": { name: "分段一部-曲组三车间", code: "1614" },
      "1615": { name: "分段一部-曲组四车间", code: "1615" },
      "1616": { name: "分段一部-曲组五车间", code: "1616" }
    }
  },
  "涂装一部": {
    code: "1700",
    workshops: {
      "1700": { name: "涂装一部", code: "1700" }
    }
  },
  "总装一部": {
    code: "1800",
    workshops: {
      "1801": { name: "总装一部-综合管理室", code: "1801" },
      "1802": { name: "总装一部-船体车间", code: "1802" },
      "1803": { name: "总装一部-机装车间", code: "1803" },
      "1804": { name: "总装一部-调试中心", code: "1804" },
      "1805": { name: "总装一部-电装车间", code: "1805" },
      "1806": { name: "总装一部-支援车间", code: "1806" },
      "1807": { name: "总装一部-居装车间", code: "1807" },
      "1808": { name: "总装一部-船装车间", code: "1808" },
      "1809": { name: "总装一部-安装中心", code: "1809" },
      "1810": { name: "总装一部-涂装车间", code: "1810" },
      "1811": { name: "总装一部-作业车间", code: "1811" },
      "1812": { name: "总装一部-工程计划室", code: "1812" }
    }
  },
  "生产管理部": {
    code: "1900",
    workshops: {
      "1901": { name: "生产管理部-生产计划室", code: "1901" },
      "1902": { name: "生产管理部-项目管理室", code: "1902" },
      "1903": { name: "生产管理部-生产支援室", code: "1903" },
      "1904": { name: "生产管理部-码头调度室", code: "1904" }
    }
  },
  "关务部": {
    code: "2100",
    workshops: {
      "2100": { name: "关务部", code: "2100" }
    }
  },
  "生产保障部": {
    code: "2200",
    workshops: {
      "2201": { name: "生产保障部-动能管理室", code: "2201" },
      "2202": { name: "生产保障部-焊机工具一室", code: "2202" },
      "2203": { name: "生产保障部-起重设备一室", code: "2203" },
      "2204": { name: "生产保障部-通用设备一室", code: "2204" },
      "2205": { name: "生产保障部-综合管理室", code: "2205" },
      "2212": { name: "生产保障部-焊机工具二室", code: "2212" },
      "2213": { name: "生产保障部-通用设备二室", code: "2213" },
      "2214": { name: "生产保障部-起重设备二室", code: "2214" }
    }
  },
  "精度部": {
    code: "2300",
    workshops: {
      "2301": { name: "精度部-生产技术室", code: "2301" }
    }
  },
  "项目部": {
    code: "2400",
    workshops: {
      "2400": { name: "项目部", code: "2400" }
    }
  },
  "加工一部": {
    code: "2500",
    workshops: {
      "2502": { name: "加工一部-钢加车间", code: "2502" },
      "2503": { name: "加工一部-综合管理室", code: "2503" },
      "2504": { name: "加工一部-组立车间", code: "2504" }
    }
  },
  "基础管理": {
    code: "2600",
    workshops: {
      "2601": { name: "基础管理-基础管理车间", code: "2601" },
      "2602": { name: "基础管理-准备车间", code: "2602" },
      "2603": { name: "基础管理-6S", code: "2603" },
      "2604": { name: "基础管理-环卫", code: "2604" },
      "2605": { name: "基础管理-维保车间", code: "2605" },
      "2606": { name: "基础管理-水运车间", code: "2606" },
      "2607": { name: "基础管理-三供车间", code: "2607" }
    }
  },
  "外协管理部": {
    code: "2700",
    workshops: {
      "2701": { name: "外协管理部-委外加工室", code: "2701" },
      "2702": { name: "外协管理部-劳务管理室", code: "2702" },
      "2703": { name: "外协管理部-计价室", code: "2703" },
      "2704": { name: "外协管理部-成本室", code: "2704" },
      "2705": { name: "外协管理部-数据管理室", code: "2705" }
    }
  },
  "对外联络办": {
    code: "2800",
    workshops: {
      "2800": { name: "对外联络办", code: "2800" }
    }
  },
  "资金管理部": {
    code: "2900",
    workshops: {
      "2900": { name: "资金管理部", code: "2900" }
    }
  },
  "宿管办": {
    code: "3200",
    workshops: {
      "3200": { name: "宿管办", code: "3200" }
    }
  },
  "工法部": {
    code: "5000",
    workshops: {
      "5001": { name: "工法部-综合管理室", code: "5001" },
      "5002": { name: "工法部-起运室", code: "5002" },
      "5003": { name: "工法部-工艺室", code: "5003" },
      "5004": { name: "工法部-焊接室", code: "5004" }
    }
  },
  "装备制造部": {
    code: "5700",
    workshops: {
      "5701": { name: "装备制造部-综合管理室", code: "5701" },
      "5702": { name: "装备制造部-船配一车间", code: "5702" },
      "5703": { name: "装备制造部-绿色能源一车间", code: "5703" },
      "5704": { name: "装备制造部-绿色能源二车间", code: "5704" }
    }
  },
  "分段二部": {
    code: "5800",
    workshops: {
      "5801": { name: "分段二部-曲组三车间", code: "5801" },
      "5802": { name: "分段二部-曲组二车间", code: "5802" },
      "5803": { name: "分段二部-综合管理室", code: "5803" },
      "5804": { name: "分段二部-平组车间", code: "5804" },
      "5805": { name: "分段二部-曲组一车间", code: "5805" },
      "5806": { name: "分段二部-先行舾装车间", code: "5806" }
    }
  },
  "加工二部": {
    code: "5900",
    workshops: {
      "5901": { name: "加工二部-组立车间", code: "5901" },
      "5902": { name: "加工二部-钢加车间", code: "5902" },
      "5903": { name: "加工二部-准备车间", code: "5903" },
      "5904": { name: "加工二部-综合管理室", code: "5904" }
    }
  },
  "总装二部": {
    code: "6200",
    workshops: {
      "6201": { name: "总装二部-综合管理室", code: "6201" },
      "6202": { name: "总装二部-船体车间", code: "6202" },
      "6203": { name: "总装二部-机装车间", code: "6203" },
      "6204": { name: "总装二部-调试中心", code: "6204" },
      "6205": { name: "总装二部-电装车间", code: "6205" },
      "6206": { name: "总装二部-船装车间", code: "6206" },
      "6207": { name: "总装二部-支援车间", code: "6207" },
      "6208": { name: "总装二部-涂装车间", code: "6208" }
    }
  },
  "管舾部": {
    code: "6300",
    workshops: {
      "6300": { name: "管舾部", code: "6300" }
    }
  },
  "铁舾部": {
    code: "6400",
    workshops: {
      "6400": { name: "铁舾部", code: "6400" }
    }
  },
  "镀锌车间": {
    code: "6500",
    workshops: {
      "6500": { name: "镀锌车间", code: "6500" }
    }
  },
  "商务二部": {
    code: "6600",
    workshops: {
      "6600": { name: "商务二部", code: "6600" }
    }
  },
  "居装二部": {
    code: "6700",
    workshops: {
      "6701": { name: "居装二部-综合管理室", code: "6701" },
      "6702": { name: "居装二部-总组车间", code: "6702" },
      "6703": { name: "居装二部-分段车间", code: "6703" },
      "6705": { name: "居装二部-居装车间", code: "6705" }
    }
  },
  "分段三部": {
    code: "6800",
    workshops: {
      "6801": { name: "分段三部-平组内业车间", code: "6801" },
      "6802": { name: "分段三部-平组外业车间", code: "6802" },
      "6803": { name: "分段三部-先行舾装", code: "6803" },
      "6804": { name: "分段三部-综合管理室", code: "6804" },
      "6805": { name: "分段三部-支援车间", code: "6805" }
    }
  },
  "电装调试部": {
    code: "6900",
    workshops: {
      "6901": { name: "电装调试部-电装一车间", code: "6901" },
      "6902": { name: "电装调试部-电装二车间", code: "6902" },
      "6903": { name: "电装调试部-调试一车间", code: "6903" },
      "6904": { name: "电装调试部-调试二车间", code: "6904" },
      "6905": { name: "电装调试部-综合管理室", code: "6905" }
    }
  },
  "新闻宣传部": {
    code: "7000",
    workshops: {
      "7000": { name: "新闻宣传部", code: "7000" }
    }
  },
  "企管部": {
    code: "7100",
    workshops: {
      "7100": { name: "企管部", code: "7100" }
    }
  },
  "研发部": {
    code: "7300",
    workshops: {
      "7300": { name: "研发部", code: "7300" }
    }
  },
  "工程部": {
    code: "7400",
    workshops: {
      "7401": { name: "工程部-材料组", code: "7401" }
    }
  },
  "水运部": {
    code: "7500",
    workshops: {
      "7501": { name: "水运部-船坞一车间", code: "7501" },
      "7502": { name: "水运部-船坞二车间", code: "7502" },
      "7503": { name: "水运部-船台车间", code: "7503" },
      "7504": { name: "水运部-综合管理室", code: "7504" }
    }
  },
  "大连国际船舶设计中心": {
    code: "7600",
    workshops: {
      "7600": { name: "大连国际船舶设计中心", code: "7600" }
    }
  },
  "居装一部": {
    code: "7700",
    workshops: {
      "7701": { name: "居装一部-总组车间", code: "7701" },
      "7702": { name: "居装一部-居装车间", code: "7702" },
      "7703": { name: "居装一部-综合管理室", code: "7703" },
      "7704": { name: "居装一部-分段车间", code: "7704" }
    }
  },
  "总装三部": {
    code: "7800",
    workshops: {
      "7801": { name: "总装三部-涂装一车间", code: "7801" },
      "7802": { name: "总装三部-支援一车间", code: "7802" },
      "7803": { name: "总装三部-船体一车间", code: "7803" },
      "7804": { name: "总装三部-船装一车间", code: "7804" },
      "7805": { name: "总装三部-机装一车间", code: "7805" },
      "7806": { name: "总装三部-综合管理一室", code: "7806" },
      "7807": { name: "总装三部-涂装二车间", code: "7807" },
      "7808": { name: "总装三部-支援二车间", code: "7808" },
      "7809": { name: "总装三部-船体二车间", code: "7809" },
      "7810": { name: "总装三部-船装二车间", code: "7810" },
      "7811": { name: "总装三部-机装二车间", code: "7811" },
      "7812": { name: "总装三部-综合管理二室", code: "7812" },
      "7813": { name: "总装三部-工程计划一室", code: "7813" },
      "7814": { name: "总装三部-工程计划二室", code: "7814" },
      "7815": { name: "总装三部-精度管理一室", code: "7815" },
      "7816": { name: "总装三部-精度管理二室", code: "7816" },
      "7817": { name: "总装三部-质量工艺一室", code: "7817" },
      "7818": { name: "总装三部-质量工艺二室", code: "7818" }
    }
  },
  "工程仓库": {
    code: "8400",
    workshops: {
      "8400": { name: "工程仓库", code: "8400" }
    }
  },
  "售后服务部": {
    code: "8500",
    workshops: {
      "8500": { name: "售后服务部", code: "8500" }
    }
  },
  "造船-上海虹桥分公司": {
    code: "8600",
    workshops: {
      "8601": { name: "造船-上海虹桥分公司-总经办-上海", code: "8601" },
      "8602": { name: "造船-上海虹桥分公司-机装室-上海", code: "8602" },
      "8603": { name: "造船-上海虹桥分公司-船体室-上海", code: "8603" },
      "8604": { name: "造船-上海虹桥分公司-行政部-上海", code: "8604" },
      "8605": { name: "造船-上海虹桥分公司-电装室-上海", code: "8605" },
      "8606": { name: "造船-上海虹桥分公司-商务部二部-上海", code: "8606" },
      "8607": { name: "造船-上海虹桥分公司-总体室-上海", code: "8607" },
      "8608": { name: "造船-上海虹桥分公司-居装室-上海", code: "8608" },
      "8609": { name: "造船-上海虹桥分公司-舾装室-上海", code: "8609" },
      "8610": { name: "造船-上海虹桥分公司-人事部-上海", code: "8610" }
    }
  },
  "造船-南通分公司": {
    code: "8700",
    workshops: {
      "8701": { name: "造船-南通分公司-行政部-南通", code: "8701" },
      "8702": { name: "造船-南通分公司-人事部-南通", code: "8702" },
      "8703": { name: "造船-南通分公司-居装室-南通", code: "8703" },
      "8704": { name: "造船-南通分公司-机装室-南通", code: "8704" },
      "8705": { name: "造船-南通分公司-船体室-南通", code: "8705" },
      "8706": { name: "造船-南通分公司-船装室-南通", code: "8706" },
      "8707": { name: "造船-南通分公司-电装室-南通", code: "8707" }
    }
  },
  "工程公司安全管理部": {
    code: "8800",
    workshops: {
      "8800": { name: "工程公司安全管理部", code: "8800" }
    }
  },
  "工程公司综合管理部": {
    code: "8900",
    workshops: {
      "8900": { name: "工程公司综合管理部", code: "8900" }
    }
  },
  "工程公司成本核算部": {
    code: "9000",
    workshops: {
      "9000": { name: "工程公司成本核算部", code: "9000" }
    }
  },
  "工程公司舾装部": {
    code: "9100",
    workshops: {
      "9101": { name: "工程公司舾装部-舾装一车间", code: "9101" },
      "9102": { name: "工程公司舾装部-舾装二车间", code: "9102" },
      "9103": { name: "工程公司舾装部-舾装三车间", code: "9103" },
      "9104": { name: "工程公司舾装部-舾装四车间", code: "9104" },
      "9105": { name: "工程公司舾装部-舾装五车间", code: "9105" },
      "9106": { name: "工程公司舾装部-舾装六车间", code: "9106" },
      "9107": { name: "工程公司舾装部-舾装七车间", code: "9107" }
    }
  },
  "工程公司生产计划部": {
    code: "9200",
    workshops: {
      "9201": { name: "工程公司生产计划部-材料组", code: "9201" },
      "9202": { name: "工程公司生产计划部-电装管理室", code: "9202" },
      "9203": { name: "工程公司生产计划部-机装管理室", code: "9203" },
      "9204": { name: "工程公司生产计划部-涂装管理室", code: "9204" },
      "9205": { name: "工程公司生产计划部-船体管理室", code: "9205" },
      "9206": { name: "工程公司生产计划部-支援车间", code: "9206" },
      "9207": { name: "工程公司生产计划部-船装管理室", code: "9207" }
    }
  },
  "工程公司机装部": {
    code: "9300",
    workshops: {
      "9301": { name: "工程公司机装部-机装一车间", code: "9301" },
      "9302": { name: "工程公司机装部-机装二车间", code: "9302" },
      "9303": { name: "工程公司机装部-机装三车间", code: "9303" },
      "9304": { name: "工程公司机装部-机装四车间", code: "9304" }
    }
  },
  "工程公司调试部": {
    code: "9400",
    workshops: {
      "9401": { name: "工程公司调试部-调试一车间", code: "9401" },
      "9402": { name: "工程公司调试部-调试二车间", code: "9402" },
      "9403": { name: "工程公司调试部-调试三车间", code: "9403" },
      "9404": { name: "工程公司调试部-调试四车间", code: "9404" }
    }
  },
  "工程公司船体部": {
    code: "9500",
    workshops: {
      "9501": { name: "工程公司船体部-船体一车间", code: "9501" },
      "9502": { name: "工程公司船体部-船体二车间", code: "9502" },
      "9503": { name: "工程公司船体部-船体三车间", code: "9503" },
      "9504": { name: "工程公司船体部-船体四车间", code: "9504" },
      "9505": { name: "工程公司船体部-船体五车间", code: "9505" },
      "9506": { name: "工程公司船体部-船体六车间", code: "9506" },
      "9507": { name: "工程公司船体部-船体七车间", code: "9507" },
      "9508": { name: "工程公司船体部-船体八车间", code: "9508" }
    }
  },
  "涂装二部": {
    code: "9600",
    workshops: {
      "9600": { name: "涂装二部", code: "9600" }
    }
  },
  "制造技术部": {
    code: "9700",
    workshops: {
      "9701": { name: "制造技术部-总装精控一室", code: "9701" },
      "9702": { name: "制造技术部-总装精控二室", code: "9702" },
      "9703": { name: "制造技术部-分段精控一室", code: "9703" },
      "9704": { name: "制造技术部-分段精控二室", code: "9704" },
      "9705": { name: "制造技术部-加工精控一室", code: "9705" },
      "9706": { name: "制造技术部-加工精控二室", code: "9706" },
      "9707": { name: "制造技术部-先行脚手支援室", code: "9707" },
      "9708": { name: "制造技术部-生产技术室", code: "9708" }
    }
  },
  "总装四部": {
    code: "9800",
    workshops: {
      "9801": { name: "总装四部-船装车间", code: "9801" },
      "9802": { name: "总装四部-船体车间", code: "9802" },
      "9803": { name: "总装四部-综合管理室", code: "9803" },
      "9804": { name: "总装四部-涂装车间", code: "9804" },
      "9805": { name: "总装四部-机装车间", code: "9805" },
      "9806": { name: "总装四部-支援车间", code: "9806" }
    }
  },
  "恒力造船水稳料现场": {
    code: "9900",
    workshops: {
      "9900": { name: "恒力造船水稳料现场", code: "9900" }
    }
  },
  "工程公司精度部": {
    code: "A100",
    workshops: {
      "A101": { name: "工程公司精度部-精度车间", code: "A101" },
      "A102": { name: "工程公司精度部-定位车间", code: "A102" }
    }
  },
  "工程公司船装部": {
    code: "A200",
    workshops: {
      "A201": { name: "工程公司船装部-船装一车间", code: "A201" },
      "A202": { name: "工程公司船装部-船装二车间", code: "A202" },
      "A203": { name: "工程公司船装部-涂装一车间", code: "A203" },
      "A204": { name: "工程公司船装部-涂装二车间", code: "A204" }
    }
  }
};

// ===================== 定期检查·检查记录审批工作流（V1.35） =====================
// 镜像 maintenanceV2 步骤引擎（§5.2/§5.12），检查记录由扁平 status 升级为 steps[] 审批流：
//   提交(维保人员)→确认(操作人员)→验收(维保主管)→审核(维保主任)→归档(维保归档)
// 检查记录与 V2 计划流互不依赖（防循环 require），本文件自包含步骤模板。

const INSPECTION_STEPS = [
  { seq: 1, name: '提交',   action: '提交',   role: 'mtPersonnel' },
  { seq: 2, name: '确认',   action: '确认',   role: 'operator' },
  { seq: 3, name: '验收',   action: '验收',   role: 'mtSupervisor' },
  { seq: 4, name: '审核',   action: '审核',   role: 'mtDirector' },
  { seq: 5, name: '归档',   action: '归档',   role: 'archiver' },
];

// 检查编号 = yyyy+mmdd+6位流水号（当日全局递增，对齐 V1.58 点检编号口径），如 20260812000001（V1.61）
function genInspectionId(checkDate) {
  const yyyymmdd = String(checkDate || fmtDate(new Date())).replace(/-/g, '');
  let max = 0;
  inspectionRecords.forEach(r => {
    if (String(r.id || '').startsWith(yyyymmdd)) {
      const seq = parseInt(String(r.id).slice(8), 10);
      if (!isNaN(seq)) max = Math.max(max, seq);
    }
  });
  return yyyymmdd + String(max + 1).padStart(6, '0');
}

// 状态派生：无 steps（旧记录）→ 已完成；全 done → 已归档；否则 待+当前步名
function deriveInspectionStatus(record) {
  if (!record || !Array.isArray(record.steps) || !record.steps.length) return '已完成';
  const doneCount = record.steps.filter(s => s.status === 'done').length;
  if (doneCount === record.steps.length) return '已归档';
  const current = record.steps[doneCount];
  return '待' + (current ? current.name : '归档');
}

// 签名写时快照（镜像 V2 signatureSnapshot）：姓名/工号/职务/角色/时间固存，人员后续变更不影响留痕
function inspectionSignature(user) {
  return {
    personnelId: user.id, name: user.name,
    employeeId: user.employeeId || '', dept: user.dept || '',
    roleId: user.roleId || '', roleName: (auth.getRoleById(user.roleId) || {}).name || '',
    date: fmtDate(new Date()) + 'T' + new Date().toTimeString().substring(0, 5),
  };
}

// 步骤权限（镜像 V2 canExecuteStep）：admin 全通过，否则人员.roleId === step.role
function canExecuteInspectionStep(step, personnelId) {
  const user = auth.getPersonnelById(personnelId);
  if (user && user.roleId === 'admin') return { allowed: true, note: '管理员' };
  if (user && user.roleId === step.role) return { allowed: true, note: step.role };
  return { allowed: false, note: '该步骤由角色「' + step.role + '」执行' };
}

// 步骤流转（镜像 V2 advanceStep）：乐观锁 409、仅当前步可流转、驳回退回上一执行步（定期检查=提交）、approve 签名+done+进下一步
function advanceInspectionStep(id, stepNo, payload) {
  const record = inspectionRecords.find(r => r.id === id);
  if (!record) throw new Error('检查记录不存在');
  if (record.status === '已归档') throw new Error('检查记录已归档');
  if (payload.version !== undefined && payload.version !== record.version) {
    throw new Error('409:数据已变更，请刷新后重试');
  }
  const step = record.steps.find(s => s.seq === parseInt(stepNo));
  if (!step) throw new Error('步骤不存在');
  const currentStep = record.steps.find(s => s.status !== 'done');
  if (!currentStep) throw new Error('检查记录已完成');
  if (step.seq !== currentStep.seq) throw new Error('当前应在第' + currentStep.seq + '步「' + currentStep.name + '」');

  const user = auth.getPersonnelById(payload.personnelId);
  if (!user) throw new Error('人员不存在');

  if (payload.action === 'reject') {
    if (!payload.reason) throw new Error('驳回必须填写原因');
    const execSteps = record.steps.filter(s => s.action !== '归档');
    const toReject = execSteps.filter(s => s.status === 'done').slice(-1)[0] || currentStep;
    record.steps.forEach(s => { if (s.seq >= toReject.seq) { s.status = 'pending'; } });
    record.rejectLog = record.rejectLog || [];
    record.rejectLog.push({ from: currentStep.seq, to: toReject.seq, reason: payload.reason, by: user.name, date: fmtDate(new Date()) + 'T' + new Date().toTimeString().substring(0, 5) });
    record.version += 1;
    record.status = deriveInspectionStatus(record);
    return { record, rejectedTo: toReject.seq };
  }

  const perm = canExecuteInspectionStep(currentStep, payload.personnelId);
  if (!perm.allowed) throw new Error('403:' + perm.note);

  // 定期检查审批步（确认/验收/审核/归档）为纯校核，无表单数据合并（表单数据在 POST 发起时已存）
  if (payload.data && currentStep.seq === 1 && payload.data.remark) {
    record.remark = payload.data.remark;
  }

  currentStep.signatures = currentStep.signatures || [];
  currentStep.signatures.push(inspectionSignature(user));
  currentStep.date = fmtDate(new Date());
  currentStep.status = 'done';
  if (!record.startedAt) record.startedAt = fmtDateTime(new Date());   // V1.61：首次执行时间（只写一次）
  // V1.43 自动归档：后续「归档」步自动完成（签名=当前操作人），无需 archiver 人工操作
  let next = record.steps.find(s => s.status !== 'done');
  while (next && next.action === '归档') {
    next.status = 'done';
    next.date = fmtDate(new Date());
    next.signatures = next.signatures || [];
    next.signatures.push(inspectionSignature(user));
    next = record.steps.find(s => s.status !== 'done');
  }
  if (next) next.status = 'pending';
  record.version += 1;
  record.status = deriveInspectionStatus(record);
  if (record.status === '已归档' && !record.completedAt) record.completedAt = fmtDateTime(new Date());   // V1.61：归档完成时间
  return { record, currentStepNo: next ? next.seq : record.steps.length };
}

module.exports = { maintenanceRecords, scrapRecords, transferRecords, approvalRequests, purchaseRecords, applications, checkinRecords, pendingApprovals, maintenancePlans, inspectionRecords, rectificationItems, workOrders, dailyCheckRecords, INSPECTION_STEPS, genInspectionId, deriveInspectionStatus, inspectionSignature, canExecuteInspectionStep, advanceInspectionStep };
