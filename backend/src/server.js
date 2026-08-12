const app = require('./app');

const PORT = process.env.PORT || 3001;

// V2 维保初始化：启动时按白名单生成当年非每日实例 + 当日点检（§5.3(7) 维保初始化）
try {
  const v2 = require('./data/maintenanceV2');
  const generated = v2.generateAll(new Date().getFullYear());
  // §5.9(1) 试点切换自动触发：白名单设备旧 plans 未来实例冻结（历史只读，避免双待办）
  const sw = v2.switchPilotDate(require('./data/helpers').fmtDate(new Date()));
  console.log(`[V2维保] 试点白名单实例已就绪，共 ${v2.generatedPlans.length} 条（本次新增 ${generated.length}）| 旧计划冻结 ${sw.frozenOldPlans} 条`);
} catch (e) {
  console.warn('[V2维保] 初始化跳过:', e.message);
}

app.listen(PORT, () => {
  console.log(`设备管理系统 API 服务器已启动 → http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/api/health`);
});
// touch
