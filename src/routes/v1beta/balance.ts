import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getUserById } from '../../storage.js';

const router: RouterType = Router();

// GET /v1beta/balance - Gemini 格式余额查询
router.get('/balance', async (req: Request, res: Response) => {
  const apiKey = (req as any).apiKey;
  if (!apiKey) {
    return res.status(401).json({
      error: { code: 401, message: 'Missing API key', status: 'UNAUTHENTICATED' }
    });
  }

  const user = getUserById(apiKey.userId);
  if (!user) {
    return res.status(404).json({
      error: { code: 404, message: 'User not found', status: 'NOT_FOUND' }
    });
  }

  res.json({
    balance: user.balance,
    totalUsage: user.totalUsage || 0,
    currency: 'USD',
    freeTierQuota: 0,
    paidTierQuota: user.balance,
  });
});

// GET /v1beta/usage - Gemini 格式使用量查询
router.get('/usage', async (req: Request, res: Response) => {
  const apiKey = (req as any).apiKey;
  if (!apiKey) {
    return res.status(401).json({
      error: { code: 401, message: 'Missing API key', status: 'UNAUTHENTICATED' }
    });
  }

  const user = getUserById(apiKey.userId);
  if (!user) {
    return res.status(404).json({
      error: { code: 404, message: 'User not found', status: 'NOT_FOUND' }
    });
  }

  res.json({
    usage: {
      totalTokens: user.totalUsage || 0,
      totalCost: user.totalUsage || 0,
    },
    limits: {
      balance: user.balance,
      currency: 'USD',
    },
  });
});

export default router;
