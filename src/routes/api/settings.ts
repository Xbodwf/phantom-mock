import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getSettings, updateSettings, getServerConfig, updateServerConfig } from '../../storage.js';
import { adminMiddleware } from '../../middleware.js';

const router: RouterType = Router();

// GET /api/settings - 获取系统设置
router.get('/', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    const serverConfig = await getServerConfig();
    res.json({ ...settings, port: serverConfig.port });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /api/settings - 更新系统设置
router.put('/', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { port, ...settings } = req.body;

    // 更新设置
    await updateSettings(settings);

    // 如果包含端口配置，也更新服务器配置
    if (port !== undefined) {
      await updateServerConfig({ port });
    }

    const finalSettings = await getSettings();
    res.json({ success: true, settings: { ...finalSettings, port } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
