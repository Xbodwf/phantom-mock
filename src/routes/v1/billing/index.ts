import { Router, Request, Response } from 'express';
import subscriptionRouter from './subscription.js';
import creditGrantsRouter from './credit_grants.js';
import { validateApiKey, getUserById } from '../../../storage.js';
import { extractApiKey } from '../utils.js';

const router: Router = Router();

// 计费相关路由
router.use('/subscription', subscriptionRouter);
router.use('/credit_grants', creditGrantsRouter);

/**
 * GET /v1/me/balance - 通用余额查询端点
 */
router.get('/balance', async (req: Request, res: Response) => {
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
    object: 'balance',
    balance: user.balance,
    total_usage: user.totalUsage || 0,
    currency: 'USD',
  });
});

/**
 * POST /v1/organizations/:orgId/balance - Anthropic 格式余额查询
 */
router.post('/organizations/:orgId/balance', async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API Key' }
    });
  }

  const key = await validateApiKey(apiKey);
  if (!key || !key.userId) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API Key' }
    });
  }

  const user = getUserById(key.userId);
  if (!user) {
    return res.status(404).json({
      type: 'error',
      error: { type: 'not_found_error', message: 'User not found' }
    });
  }

  // Anthropic 格式响应
  res.json({
    type: 'balance',
    balance: user.balance,
    total_usage: user.totalUsage || 0,
    currency: 'USD',
  });
});

/**
 * GET /v1/organizations/:orgId/prepaid/credits - Anthropic 预付信用查询
 */
router.get('/organizations/:orgId/prepaid/credits', async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API Key' }
    });
  }

  const key = await validateApiKey(apiKey);
  if (!key || !key.userId) {
    return res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid API Key' }
    });
  }

  const user = getUserById(key.userId);
  if (!user) {
    return res.status(404).json({
      type: 'error',
      error: { type: 'not_found_error', message: 'User not found' }
    });
  }

  res.json({
    type: 'prepaid_credits',
    total_credits: user.balance,
    used_credits: user.totalUsage || 0,
    remaining_credits: user.balance,
    currency: 'USD',
  });
});

export default router;
