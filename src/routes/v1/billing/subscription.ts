import { Router, Request, Response } from 'express';
import { validateApiKey, getUserById } from '../../../storage.js';
import { extractApiKey } from '../utils.js';

const router: Router = Router();

/**
 * GET /v1/dashboard/billing/subscription - OpenAI 格式余额查询
 * 返回用户订阅和余额信息
 */
router.get('/', async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    return res.status(401).json({
      error: { message: 'Missing API key', type: 'invalid_request_error' }
    });
  }

  const key = await validateApiKey(apiKey);
  if (!key || !key.userId) {
    return res.status(401).json({
      error: { message: 'Invalid API key', type: 'invalid_request_error' }
    });
  }

  const user = getUserById(key.userId);
  if (!user) {
    return res.status(404).json({
      error: { message: 'User not found', type: 'invalid_request_error' }
    });
  }

  // OpenAI 格式的订阅响应
  res.json({
    object: 'subscription',
    id: `sub_${user.id}`,
    status: 'active',
    plan: {
      object: 'plan',
      id: 'free',
      name: 'Free Plan',
      type: 'free',
    },
    current_period_start: Math.floor((user.createdAt || Date.now()) / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    soft_limit: 0,
    hard_limit: 1000000,
    system_hard_limit: 1000000,
    soft_limit_usd: 0,
    hard_limit_usd: user.balance,
    system_hard_limit_usd: user.balance,
    usage: user.totalUsage || 0,
    balance: user.balance,
    has_payment_method: false,
    canceled: false,
    canceled_at: null,
    delinquent: null,
    access_until: null,
  });
});

export default router;
