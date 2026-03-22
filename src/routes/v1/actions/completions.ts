import { Router, Request, Response } from 'express';
import type { ChatCompletionRequest } from '../../../types.js';
import { getActionByName, getAllApiKeys, getUserById } from '../../../storage.js';
import { generateRequestId } from '../../../responseBuilder.js';
import { executeAction } from '../../../actions/executor.js';
import { extractApiKey } from '../utils.js';

const router: Router = Router();

/**
 * POST /v1/actions/completions - 调用 Action 模型
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as ChatCompletionRequest;

  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: model and messages are required',
        type: 'invalid_request_error',
      }
    });
  }

  // 获取 API Key
  const apiKeyStr = extractApiKey(req);
  if (!apiKeyStr) {
    return res.status(401).json({
      error: {
        message: 'API key is required',
        type: 'invalid_request_error',
      }
    });
  }

  const allApiKeys = getAllApiKeys();
  const apiKeyObj = allApiKeys.find(k => k.key === apiKeyStr && k.enabled);
  if (!apiKeyObj) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
      }
    });
  }

  // 获取 action 名称（支持 action/name 或 name 格式）
  let actionName = body.model;
  if (actionName.startsWith('action/')) {
    actionName = actionName.replace('action/', '');
  }

  const action = getActionByName(actionName);
  if (!action) {
    return res.status(404).json({
      error: {
        message: `Action '${actionName}' not found`,
        type: 'invalid_request_error',
        code: 'action_not_found',
      }
    });
  }

  // 检查权限：只有公开的 action 或创建者才能访问
  const userId = apiKeyObj.userId;
  const apiKeyId = apiKeyObj.id;
  if (!action.isPublic && action.createdBy !== userId) {
    return res.status(403).json({
      error: {
        message: `You don't have permission to access this action`,
        type: 'permission_error',
        code: 'action_permission_denied',
      }
    });
  }

  // 检查 API Key 的 action 权限
  const permissions = apiKeyObj.permissions;
  if (permissions?.actions && permissions.actions.length > 0) {
    if (permissions.actionsMode === 'blacklist') {
      // 黑名单模式：排除指定的 actions
      if (permissions.actions.includes(action.id)) {
        return res.status(403).json({
          error: {
            message: `This API key is not allowed to access this action`,
            type: 'permission_error',
            code: 'action_permission_denied',
          }
        });
      }
    } else {
      // 白名单模式（默认）：只包含指定的 actions
      if (!permissions.actions.includes(action.id)) {
        return res.status(403).json({
          error: {
            message: `This API key is not allowed to access this action`,
            type: 'permission_error',
            code: 'action_permission_denied',
          }
        });
      }
    }
  }

  // 从 messages 中提取输入参数
  const lastMessage = body.messages[body.messages.length - 1];
  let input: Record<string, any> = {};

  try {
    if (typeof lastMessage.content === 'string') {
      try {
        input = JSON.parse(lastMessage.content);
      } catch {
        input = { prompt: lastMessage.content };
      }
    }
  } catch (error) {
    return res.status(400).json({
      error: {
        message: 'Invalid input format for Action',
        type: 'invalid_request_error',
      }
    });
  }

  try {
    const executionResult = await executeAction(action, input, 30000, userId, apiKeyId);

    return res.json({
      id: generateRequestId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(executionResult.result),
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: executionResult.usage?.promptTokens || 0,
        completion_tokens: executionResult.usage?.completionTokens || 0,
        total_tokens: (executionResult.usage?.promptTokens || 0) + (executionResult.usage?.completionTokens || 0),
      },
    });
  } catch (error) {
    return res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : 'Action execution failed',
        type: 'action_execution_error',
      }
    });
  }
});

export default router;
