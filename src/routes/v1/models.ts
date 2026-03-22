import { Router, Request, Response } from 'express';
import { getAllModels, getModel, getAllApiKeys, getPublicAndUserActions, getPublicActions } from '../../storage.js';
import { extractApiKey } from './utils.js';

const router: Router = Router();

/**
 * GET /v1/models - 获取模型列表（包括 Actions）
 */
router.get('/', (req: Request, res: Response) => {
  const models = getAllModels();

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

  // 添加 Actions 作为模型
  const actions = getPublicAndUserActions(userId);
  const actionModels = actions.map(action => ({
    id: `action/${action.name}`,
    object: 'model',
    created: action.createdAt,
    owned_by: 'user',
    description: action.description || `Action: ${action.name}`,
    context_length: 4096,
    max_output_tokens: 2048,
    type: 'action',
    actionId: action.id,
  }));

  res.json({
    object: 'list',
    data: [...models, ...actionModels],
  });
});

/**
 * GET /v1/models/:id(*) - 获取单个模型（支持模型ID包含"/"）
 */
router.get('/:id(*)', (req: Request, res: Response) => {
  const modelId = decodeURIComponent(req.params.id as string);
  const model = getModel(modelId);
  if (!model) {
    return res.status(404).json({
      error: { message: 'Model not found', type: 'invalid_request_error' }
    });
  }
  res.json(model);
});

export default router;
