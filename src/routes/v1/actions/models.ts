import { Router, Request, Response } from 'express';
import { getPublicAndUserActions, getAllApiKeys, getPublicActions } from '../../../storage.js';
import { extractApiKey } from '../utils.js';

const router: Router = Router();

/**
 * GET /v1/actions/models - 获取 Actions 列表（用户私有 + 所有公开）
 */
router.get('/', (req: Request, res: Response) => {
  // 获取用户ID（支持 JWT 和 API Key）
  let userId = (req as any).user?.id;

  // 如果没有 JWT，尝试从 API Key 获取
  if (!userId) {
    const apiKeyStr = extractApiKey(req);
    if (apiKeyStr) {
      const allApiKeys = getAllApiKeys();
      const apiKeyObj = allApiKeys.find(k => k.key === apiKeyStr && k.enabled);
      if (apiKeyObj) {
        userId = apiKeyObj.userId;
      }
    }
  }

  // 获取用户的私有 actions + 所有公开 actions
  const userActions = userId ? getPublicAndUserActions(userId) : getPublicActions();

  res.json(userActions);
});

export default router;
