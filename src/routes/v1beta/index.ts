import { Router } from 'express';
import type { Router as RouterType } from 'express';
import modelsRoutes from './models.js';
import balanceRoutes from './balance.js';

const router: RouterType = Router();

// 模型相关端点
router.use('/models', modelsRoutes);

// 余额和使用量端点
router.use('/', balanceRoutes);

export default router;
