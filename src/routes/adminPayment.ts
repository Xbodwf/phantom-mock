/**
 * 管理员支付管理路由
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { RedeemCodeManager, RedeemCodeCreateRequest } from '../payment/redeemCodeManager.js';

export function createAdminPaymentRoutes(redeemCodeManager: RedeemCodeManager): RouterType {
  const router: RouterType = Router();

  /**
   * POST /api/admin/redeem-codes - 创建兑换码
   */
  router.post('/redeem-codes', async (req: Request, res: Response) => {
    const { code, amount, description, expiresAt } = req.body;

    // 批量生成模式
    if (req.body.batch) {
      const { count, prefix } = req.body;
      if (!count || !prefix || !amount) {
        return res.status(400).json({ error: 'Count, prefix and amount are required for batch creation' });
      }

      try {
        const requests: RedeemCodeCreateRequest[] = [];
        for (let i = 0; i < count; i++) {
          const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
          requests.push({
            code: `${prefix}${randomSuffix}`,
            amount,
            description,
            expiresAt,
          });
        }

        const codes = await redeemCodeManager.batchCreateCodes(requests);

        res.status(201).json({
          codes,
          count: codes.length,
        });
      } catch (error: any) {
        if (error.code === 11000) {
          return res.status(409).json({ error: 'Redeem code already exists' });
        }
        res.status(500).json({ error: error.message });
      }
      return;
    }

    // 单个创建模式
    if (!code || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    try {
      const redeemCode = await redeemCodeManager.createCode({
        code,
        amount,
        description,
        expiresAt,
      });

      res.json({
        success: true,
        redeemCode,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/redeem-codes - 获取兑换码列表
   */
  router.get('/redeem-codes', async (req: Request, res: Response) => {
    const status = (req.query.status as string) || undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    try {
      const codes = await redeemCodeManager.listCodes(status, limit, offset);
      const stats = await redeemCodeManager.getStats();

      res.json({
        codes,
        stats,
        pagination: {
          limit,
          offset,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/redeem-codes/:id - 获取兑换码详情
   */
  router.get('/redeem-codes/:id', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const code = await redeemCodeManager.getCodeById(id);

      if (!code) {
        return res.status(404).json({ error: 'Redeem code not found' });
      }

      res.json(code);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/admin/redeem-codes/:id - 删除兑换码
   */
  router.delete('/redeem-codes/:id', async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const success = await redeemCodeManager.deleteCode(id);

      if (!success) {
        return res.status(404).json({ error: 'Redeem code not found' });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/redeem-codes-stats - 获取兑换码统计信息
   */
  router.get('/redeem-codes-stats', async (req: Request, res: Response) => {
    try {
      const stats = await redeemCodeManager.getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
