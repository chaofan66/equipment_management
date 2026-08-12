const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const errorHandler = require('./middleware/errorHandler');

// Route imports
const dictRoutes = require('./routes/dict');
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const maintenanceRoutes = require('./routes/maintenance');
const maintenanceV2Routes = require('./routes/maintenanceV2');
const assignmentsRoutes = require('./routes/assignments');   // V1.46 设备分配
const approvalRoutes = require('./routes/approval');
const configRoutes = require('./routes/config');

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Static file serving for uploaded files
app.use('/uploads', express.static(uploadsDir));

// Multer config (exported for use in routes)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const { typeCode, fileCode } = req.params
    // 修复 multer 对中文文件名的编码问题 — 正确提取扩展名
    let originalName = file.originalname
    try {
      originalName = Buffer.from(originalName, 'latin1').toString('utf8')
    } catch (_) {}
    const ext = path.extname(originalName) || '.bin'
    const uniqueName = `${typeCode}-${fileCode}-${Date.now()}${ext}`
    cb(null, uniqueName)
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Share multer config with routes
app.set('upload', upload);
app.set('uploadsDir', uploadsDir);

// API Routes
app.use('/api/dict', dictRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/maintenance', maintenanceV2Routes);   // V2 维保业务逻辑（模板/配置/绑定/步骤引擎/报表）
app.use('/api/maintenance', assignmentsRoutes);     // V1.46 设备分配
app.use('/api/approval', approvalRoutes);
app.use('/api/config', configRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

module.exports = app;
