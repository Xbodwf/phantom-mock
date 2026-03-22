import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, extname } from 'path';
import multer from 'multer';
import { adminMiddleware } from '../../middleware.js';

const router: RouterType = Router();

// 静态模型图标目录路径
const staticModelsPath = join(process.cwd(), 'static', 'models');

// 配置 multer 用于模型图标上传
const modelIconStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, staticModelsPath);
  },
  filename: (_req, file, cb) => {
    // 使用原始文件名，添加时间戳防止重名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    const baseName = file.originalname.replace(ext, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  }
});

const uploadModelIcon = multer({
  storage: modelIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 限制 2MB
  fileFilter: (_req, file, cb) => {
    // 只允许图片文件
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PNG, JPG, GIF, SVG, WEBP 格式的图片'));
    }
  }
});

// GET /api/model-icons - 获取已上传的模型图标列表
router.get('/', adminMiddleware, (_req: Request, res: Response) => {
  try {
    const files = readdirSync(staticModelsPath);
    const icons = files
      .filter(file => {
        const ext = extname(file).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext);
      })
      .map(file => {
        const filePath = join(staticModelsPath, file);
        const stats = statSync(filePath);
        return {
          filename: file,
          url: `/static/models/${file}`,
          size: stats.size,
          createdAt: stats.mtime.getTime(),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ icons });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list icons' });
  }
});

// POST /api/model-icons/upload - 上传模型图标
router.post('/upload', adminMiddleware, uploadModelIcon.single('icon'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    success: true,
    icon: {
      filename: req.file.filename,
      url: `/static/models/${req.file.filename}`,
      size: req.file.size,
    },
  });
});

// DELETE /api/model-icons/:filename - 删除模型图标
router.delete('/:filename', adminMiddleware, (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  // 安全检查：防止路径遍历攻击
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = join(staticModelsPath, filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Icon not found' });
  }

  try {
    unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete icon' });
  }
});

export default router;
