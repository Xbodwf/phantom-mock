import { Router } from 'express';
import type { Router as RouterType } from 'express';
import { authMiddleware } from '../../middleware.js';
import modelsRoutes from './models.js';
import modelIconsRoutes from './modelIcons.js';
import statsRoutes from './stats.js';
import settingsRoutes from './settings.js';
import keysRoutes from './keys.js';
import serverConfigRoutes from './serverConfig.js';

const router: RouterType = Router();

// 所有 /api/* 路由需要认证
router.use(authMiddleware);

// 挂载子路由
router.use('/models', modelsRoutes);
router.use('/model-icons', modelIconsRoutes);
router.use('/stats', statsRoutes);
router.use('/settings', settingsRoutes);
router.use('/keys', keysRoutes);
router.use('/server-config', serverConfigRoutes);

export default router;
