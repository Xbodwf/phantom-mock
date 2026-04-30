import { Router, Request, Response } from 'express';
import { getAllModels, getModel, getAllApiKeys, getPublicAndUserActions } from '../../storage.js';
import { extractApiKey } from './utils.js';

const router: Router = Router();

/**
 * 字段白名单过滤：只允许公开必要的模型信息，隐藏隐私数据
 * 解决原代码直接输出 api_key, api_base_url, nodeId 等风险
 */
const sanitizeModel = (model: any) => {
  return {
    id: model.id,
    object: 'model',
    created: model.created,
    owned_by: model.owned_by,
    description: model.description,
    context_length: model.context_length,
    max_output_tokens: model.max_output_tokens,
    supported_features: model.supported_features,
    pricing: model.pricing, // 价格信息通常是公开的
    icon: model.icon,
    type: model.type || 'text',
  };
};

/**
 * GET /v1/models - 获取过滤后的模型列表（包括 Actions）
 */
router.get('/', (req: Request, res: Response) => {
  // 获取原始模型数据
  const allModels = getAllModels() || [];

  // 1. 应用白名单过滤，移除敏感信息
  const filteredModels = allModels.map(model => sanitizeModel(model));

  // 获取用户ID逻辑（用于关联 Actions）
  let userId = (req as any).user?.id;

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

  // 2. 添加 Actions 作为虚拟模型
  const actions = getPublicAndUserActions(userId) || [];
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
    data: [...filteredModels, ...actionModels],
  });
});

/**
 * GET /v1/models/:id(*) - 获取单个模型
 * 同样应用了字段过滤以防止通过特定 ID 嗅探敏感配置
 */
router.get('/:id(*)', (req: Request, res: Response) => {
  const modelId = decodeURIComponent(req.params.id as string);
  const model = getModel(modelId);

  if (!model) {
    return res.status(404).json({
      error: { 
        message: 'Model not found', 
        type: 'invalid_request_error' 
      }
    });
  }

  // 返回过滤后的安全对象
  res.json(sanitizeModel(model));
});

export default router;
