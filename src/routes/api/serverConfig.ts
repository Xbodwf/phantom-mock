import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getServerConfig } from '../../storage.js';

const router: RouterType = Router();

// GET /api/server-config - 获取服务器配置
router.get('/', async (req: Request, res: Response) => {
  try {
    const serverConfig = await getServerConfig();
    res.json(serverConfig);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get server config' });
  }
});

export default router;
