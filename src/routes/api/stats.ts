import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getPendingCount } from '../../requestStore.js';
import { getConnectedClientsCount } from '../../websocket.js';
import { getAllModels } from '../../storage.js';
import { adminMiddleware } from '../../middleware.js';

const router: RouterType = Router();

// GET /api/stats - 获取统计信息
router.get('/', adminMiddleware, (req: Request, res: Response) => {
  res.json({
    pendingRequests: getPendingCount(),
    connectedClients: getConnectedClientsCount(),
    totalModels: getAllModels().length,
  });
});

export default router;
