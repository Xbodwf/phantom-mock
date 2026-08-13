import { Router, Request, Response } from 'express';
import { getActionByName, getAllApiKeys } from '../../../storage.js';
import { generateRequestId } from '../../../responseBuilder.js';
import { executeAction } from '../../../actions/executor.js';
import { extractApiKey } from '../utils.js';
import { modelRateLimitMiddleware, recordModelTpmUsage } from '../../../middleware.js';

const router: Router = Router();

/**
 * 校验 parameters 是否符合 Action 定义
 * 返回错误信息数组（为空则通过）
 */
function validateParameters(
  params: Record<string, any>,
  actionParams?: Array<{ name: string; type: string; required: boolean; description?: string }>
): string[] {
  const errors: string[] = [];
  if (!actionParams || actionParams.length === 0) return errors;

  for (const p of actionParams) {
    const hasKey = p.name in params;
    if (p.required && !hasKey) {
      errors.push(`Missing required parameter '${p.name}'`);
      continue;
    }
    if (hasKey && params[p.name] !== null && params[p.name] !== undefined) {
      const value = params[p.name];
      let typeOk = true;
      switch (p.type) {
        case 'string':
          typeOk = typeof value === 'string';
          break;
        case 'number':
          typeOk = typeof value === 'number' && !Number.isNaN(value);
          break;
        case 'boolean':
          typeOk = typeof value === 'boolean';
          break;
        case 'object':
          typeOk = typeof value === 'object' && value !== null && !Array.isArray(value);
          break;
        default:
          break;
      }
      if (!typeOk) {
        errors.push(`Parameter '${p.name}' must be ${p.type}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      }
    }
  }
  return errors;
}

/**
 * POST /v1/action/:name - 调用 Action（原生格式）
 *
 * 请求体：
 * {
 *   "parameters": { ... },   // 对应 action.parameters 定义的必需/可选参数
 *   "metadata"?: { ... }     // 可选元数据（预留）
 * }
 *
 * 响应：
 * { "result": <execute 返回值>, "usage": { "promptTokens": n, "completionTokens": n } }
 */
router.post('/:name', modelRateLimitMiddleware(), async (req: Request, res: Response) => {
  const { name } = req.params as { name: string };

  // 认证
  const apiKeyStr = extractApiKey(req);
  if (!apiKeyStr) {
    return res.status(401).json({ error: { message: 'API key is required', type: 'authentication_error', code: 'missing_api_key' } });
  }
  const allApiKeys = getAllApiKeys();
  const apiKeyObj = allApiKeys.find(k => k.key === apiKeyStr && k.enabled);
  if (!apiKeyObj) {
    return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error', code: 'invalid_api_key' } });
  }

  // 校验 action 存在
  const action = getActionByName(name);
  if (!action) {
    return res.status(404).json({ error: { message: `Action '${name}' not found`, type: 'invalid_request_error', code: 'action_not_found' } });
  }

  // 权限：仅公开或创建者
  const userId = apiKeyObj.userId;
  const apiKeyId = apiKeyObj.id;
  if (!action.isPublic && action.createdBy !== userId) {
    return res.status(403).json({ error: { message: 'You do not have permission to access this action', type: 'permission_error', code: 'action_permission_denied' } });
  }

  // API Key 的 action 权限
  const permissions = apiKeyObj.permissions;
  if (permissions?.actions && permissions.actions.length > 0) {
    const actionAllowed = permissions.actionsMode === 'blacklist'
      ? !permissions.actions.includes(action.id)
      : permissions.actions.includes(action.id);
    if (!actionAllowed) {
      return res.status(403).json({ error: { message: 'This API key is not allowed to access this action', type: 'permission_error', code: 'action_permission_denied' } });
    }
  }

  // 解析请求体
  const body = req.body ?? {};
  const parameters = body.parameters ?? {};

  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    return res.status(400).json({ error: { message: "'parameters' must be an object", type: 'invalid_request_error', code: 'invalid_parameters' } });
  }

  // 校验必需参数和类型
  const paramErrors = validateParameters(parameters, action.parameters);
  if (paramErrors.length > 0) {
    return res.status(400).json({
      error: {
        message: `Invalid parameters: ${paramErrors.join('; ')}`,
        type: 'invalid_request_error',
        code: 'invalid_parameters',
        details: paramErrors,
      },
    });
  }

  try {
    const executionResult = await executeAction(action, parameters, 30000, userId, apiKeyId);
    const totalTokens = (executionResult.usage?.promptTokens || 0) + (executionResult.usage?.completionTokens || 0);
    recordModelTpmUsage(`action/${name}`, totalTokens, userId);

    return res.json({
      id: generateRequestId(),
      result: executionResult.result,
      usage: {
        prompt_tokens: executionResult.usage?.promptTokens || 0,
        completion_tokens: executionResult.usage?.completionTokens || 0,
        total_tokens: totalTokens,
      },
    });
  } catch (error) {
    return res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : 'Action execution failed',
        type: 'action_execution_error',
        code: 'action_execution_failed',
      },
    });
  }
});

export default router;
