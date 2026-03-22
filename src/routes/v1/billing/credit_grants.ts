import { Router, Request, Response } from 'express';
import { validateApiKey, getUserById } from '../../../storage.js';
import { extractApiKey } from '../utils.js';

const router: Router = Router();

/**
 * GET /v1/dashboard/billing/credit_grants - OpenAI 格式信用额度查询
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

  res.json({
    object: 'list',
    data: [{
      object: 'credit_grant',
      id: `cg_${user.id}`,
      grant_amount: user.balance,
      used_amount: user.totalUsage || 0,
      remaining_amount: user.balance,
      effective_at: Math.floor((user.createdAt || Date.now()) / 1000),
      expires_at: null,
    }],
  });
});

export default router;
