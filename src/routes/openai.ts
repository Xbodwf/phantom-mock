import { Router, Request, Response } from 'express';
import type { ChatCompletionRequest, PendingRequest, RerankRequest, RerankResponse } from '../types.js';
import { addPendingRequest, removePendingRequest } from '../requestStore.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../websocket.js';
import { getAllModels, getModel, validateApiKey, getUserById, updateUser, createUsageRecord, getAllActions, getActionByName, getPublicAndUserActions, getAllApiKeys, getPublicActions } from '../storage.js';
import { calculateCost, calculateTokens } from '../billing.js';
import { executeAction } from '../actions/executor.js';
import { forwardChatRequest, forwardStreamRequest } from '../forwarder.js';
import axios from 'axios';

const router: Router = Router();

// 辅助函数：获取消息内容的字符串表示
function getContentString(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

// 从请求中提取 API Key
function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string') {
    return xApiKey;
  }
  return null;
}

/**
 * GET /v1/models - 获取模型列表（包括 Actions）
 */
router.get('/models', (req: Request, res: Response) => {
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
router.get('/models/:id(*)', (req: Request, res: Response) => {
  const modelId = decodeURIComponent(req.params.id as string);
  const model = getModel(modelId);
  if (!model) {
    return res.status(404).json({
      error: { message: 'Model not found', type: 'invalid_request_error' }
    });
  }
  res.json(model);
});

/**
 * GET /v1/actions/models - 获取 Actions 列表（用户私有 + 所有公开）
 */
router.get('/actions/models', (req: Request, res: Response) => {
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

/**
 * POST /v1/chat/completions - 聊天补全
 */
router.post('/chat/completions', async (req: Request, res: Response) => {
  const body = req.body as ChatCompletionRequest;

  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: model and messages are required',
        type: 'invalid_request_error',
      }
    });
  }

  // 检查是否为 Action 模型
  if (body.model.startsWith('action/')) {
    const actionName = body.model.replace('action/', '');
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
    let userId = (req as any).user?.id;
    let apiKeyId = '';

    // 如果没有 JWT，尝试从 API Key 获取
    if (!userId) {
      const apiKeyStr = extractApiKey(req);
      if (apiKeyStr) {
        const allApiKeys = getAllApiKeys();
        const apiKeyObj = allApiKeys.find(k => k.key === apiKeyStr && k.enabled);
        if (apiKeyObj) {
          userId = apiKeyObj.userId;
          apiKeyId = apiKeyObj.id;

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
        }
      }
    }

    if (!action.isPublic && action.createdBy !== userId) {
      return res.status(403).json({
        error: {
          message: `You don't have permission to access this action`,
          type: 'permission_error',
          code: 'action_permission_denied',
        }
      });
    }

    // 从 messages 中提取输入参数
    // 假设最后一条消息的内容是 JSON 格式的输入
    const lastMessage = body.messages[body.messages.length - 1];
    let input: Record<string, any> = {};

    try {
      if (typeof lastMessage.content === 'string') {
        // 尝试解析为 JSON
        try {
          input = JSON.parse(lastMessage.content);
        } catch {
          // 如果不是 JSON，作为 prompt 参数传递
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
      // 执行 Action
      console.log('[ACTION] Executing action:', action.name, 'with userId:', userId, 'apiKeyId:', apiKeyId);
      const executionResult = await executeAction(action, input, 30000, userId, apiKeyId);
      console.log('[ACTION] Execution completed successfully');

      // ACTION 内部调用的模型会通过 /v1/chat 端点自动计费
      // 这里不需要额外的计费逻辑

      // 返回结果
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
      console.error('[ACTION] Execution failed:', error);
      return res.status(400).json({
        error: {
          message: error instanceof Error ? error.message : 'Action execution failed',
          type: 'action_execution_error',
        }
      });
    }
  }

  const modelExists = getModel(body.model);
  if (!modelExists) {
    return res.status(400).json({
      error: {
        message: `Model '${body.model}' not found. Available models: ${getAllModels().map(m => m.id).join(', ')}`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
  }

  // 计费检查和权限检查
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;
  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
  }

  // 检查 API Key 的模型权限
  if (apiKeyObj) {
    const permissions = apiKeyObj.permissions;
    if (permissions?.models && permissions.models.length > 0) {
      if (permissions.modelsMode === 'blacklist') {
        // 黑名单模式：排除指定的模型
        if (permissions.models.includes(body.model)) {
          return res.status(403).json({
            error: {
              message: `This API key is not allowed to access this model`,
              type: 'permission_error',
              code: 'model_permission_denied',
            }
          });
        }
      } else {
        // 白名单模式（默认）：只包含指定的模型
        if (!permissions.models.includes(body.model)) {
          return res.status(403).json({
            error: {
              message: `This API key is not allowed to access this model`,
              type: 'permission_error',
              code: 'model_permission_denied',
            }
          });
        }
      }
    }
    // 如果 permissions.models 为空或不存在，允许访问所有模型
  }

  if (apiKeyObj && apiKeyObj.userId) {
    const user = getUserById(apiKeyObj.userId);
    if (user) {
      const promptTokens = calculateTokens(
        body.messages.map(m => getContentString(m.content)).join('\n'),
        body.model
      );
      const estimatedCost = calculateCost(promptTokens, 0, modelExists);

      if (user.balance < estimatedCost) {
        return res.status(402).json({
          error: {
            message: `Insufficient balance. Required: $${estimatedCost.toFixed(4)}, Available: $${user.balance.toFixed(4)}`,
            type: 'insufficient_balance',
            code: 'insufficient_balance',
          }
        });
      }
    }
  }

  const requestId = generateRequestId();
  const isStream = body.stream === true;

  console.log('\n========================================');
  console.log('收到新的 ChatCompletion 请求 [OpenAI]');
  console.log('请求ID:', requestId);
  console.log('模型:', body.model);
  console.log('流式:', isStream);
  console.log('消息数:', body.messages.length);
  console.log('当前前端连接数:', getConnectedClientsCount());
  console.log('----------------------------------------');

  body.messages.forEach((msg, i) => {
    const content = getContentString(msg.content);
    console.log(`  [${i + 1}] ${msg.role}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
  });
  console.log('========================================\n');

  await handleChatRequest(body, requestId, isStream, res, apiKeyObj);
});

/**
 * POST /v1/completions - 文本补全（旧版）
 */
router.post('/completions', (req: Request, res: Response) => {
  res.status(400).json({
    error: {
      message: 'This endpoint is deprecated. Please use /v1/chat/completions',
      type: 'invalid_request_error',
    }
  });
});

/**
 * POST /v1/embeddings - 向量嵌入
 */
router.post('/embeddings', (req: Request, res: Response) => {
  res.json({
    object: 'list',
    data: [{
      object: 'embedding',
      embedding: new Array(1536).fill(0),
      index: 0,
    }],
    model: req.body.model || 'text-embedding-ada-002',
    usage: {
      prompt_tokens: 0,
      total_tokens: 0,
    }
  });
});

/**
 * POST /v1/moderations - 内容审核
 */
router.post('/moderations', (req: Request, res: Response) => {
  res.json({
    id: `modr-${generateRequestId()}`,
    model: 'text-moderation-latest',
    results: [{
      flagged: false,
      categories: {},
      category_scores: {},
    }]
  });
});

async function handleChatRequest(
  body: ChatCompletionRequest,
  requestId: string,
  isStream: boolean,
  res: Response,
  apiKeyObj?: any
) {
  const requestParams = {
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    presence_penalty: body.presence_penalty,
    frequency_penalty: body.frequency_penalty,
    stop: body.stop,
    n: body.n,
    user: body.user,
  };

  // 检查是否来自 ACTION 内部调用（通过特殊 header）
  let userId = apiKeyObj?.userId;
  let apiKeyId = apiKeyObj?.id;

  // 如果没有 apiKeyObj，检查是否有内部调用的 header
  if (!userId) {
    // Express 会将 header 转换为小写
    const internalUserId = (res.req as any).headers['x-internal-user-id'];
    const internalApiKeyId = (res.req as any).headers['x-internal-api-key-id'];
    console.log('[handleChatRequest] Checking internal headers:', { internalUserId, internalApiKeyId, allHeaders: (res.req as any).headers });
    if (internalUserId) {
      userId = internalUserId;
      apiKeyId = internalApiKeyId || 'internal';
      console.log('[handleChatRequest] Using internal headers - userId:', userId, 'apiKeyId:', apiKeyId);
    }
  }

  const model = getModel(body.model);

  // 检查是否配置了转发
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    // 配置了转发：尝试转发，失败则返回错误（不回退到手动模拟）
    console.log(`[Forwarder] 转发模式：${model.api_type || 'openai'} API`);

    if (isStream) {
      // 流式转发：直接透传流式响应
      console.log('[Forwarder] 流式转发，直接透传');

      try {
        await forwardStreamRequest(model, body, res);
      } catch (error: any) {
        console.error('[Forwarder] 流式转发失败:', error.message);
        if (!res.headersSent) {
          return res.status(502).json({
            error: {
              message: `转发失败: ${error.message}`,
              type: 'forwarding_error',
              code: 'forwarding_failed',
            }
          });
        }
      }
      return;
    } else {
      // 非流式转发：允许用户抢先回复
      console.log('[Forwarder] 非流式转发，允许用户抢先回复');

      // 创建 pending request，允许用户模拟
      const pending: PendingRequest = {
        requestId,
        request: body,
        isStream: false,
        createdAt: Date.now(),
        resolve: () => {},
        requestParams,
      };

      let userResponded = false;
      const responsePromise = new Promise<string>((resolve) => {
        pending.resolve = (content: string) => {
          userResponded = true;
          resolve(content);
        };
      });

      addPendingRequest(pending);
      broadcastRequest(pending);

      // 同时发起转发请求
      const forwardPromise = forwardChatRequest(model, body);

      // 竞速：用户回复 vs AI 转发
      const raceResult = await Promise.race([
        responsePromise.then(content => ({ type: 'user' as const, content })),
        forwardPromise.then(result => ({ type: 'forward' as const, result })),
      ]);

      removePendingRequest(requestId);

      if (raceResult.type === 'user') {
        // 用户抢先回复
        console.log('[Manual] 用户抢先回复');
        const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
        const response = buildResponse(raceResult.content, body.model, requestId, promptContent);

        // 记录使用情况
        if (userId && apiKeyId) {
          const cost = calculateCost(
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            model
          );

          await createUsageRecord({
            userId,
            apiKeyId,
            model: body.model,
            endpoint: 'chat',
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            cost,
            timestamp: Date.now(),
            requestId,
          });

          const user = getUserById(userId);
          if (user) {
            await updateUser(userId, {
              balance: user.balance - cost,
              totalUsage: user.totalUsage + response.usage.total_tokens,
            });
          }
        }

        return res.json(response);
      } else {
        // AI 转发先返回
        if (!raceResult.result.success) {
          console.log(`[Forwarder] 转发失败: ${raceResult.result.error}`);
          return res.status(502).json({
            error: {
              message: `转发失败: ${raceResult.result.error}`,
              type: 'forwarding_error',
              code: 'forwarding_failed',
            }
          });
        }

        console.log('[Forwarder] AI 转发成功');

        // 记录使用情况
        if (userId && apiKeyId) {
          const response = raceResult.result.response;
          const cost = calculateCost(
            response.usage?.prompt_tokens || 0,
            response.usage?.completion_tokens || 0,
            model
          );

          await createUsageRecord({
            userId,
            apiKeyId,
            model: body.model,
            endpoint: 'chat',
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
            cost,
            timestamp: Date.now(),
            requestId,
          });

          const user = getUserById(userId);
          if (user) {
            await updateUser(userId, {
              balance: user.balance - cost,
              totalUsage: user.totalUsage + (response.usage?.total_tokens || 0),
            });
          }
        }

        return res.json(raceResult.result.response);
      }
    }
  }

  // 没有配置转发：纯手动模拟模式
  console.log('[Manual] 纯手动模拟模式，等待前端用户回复...');

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let streamEnded = false;

    const pending: PendingRequest = {
      requestId,
      request: body,
      isStream: true,
      createdAt: Date.now(),
      resolve: () => {},
      streamController: {
        enqueue: (content: string) => {
          if (!streamEnded) {
            res.write(buildStreamChunk(requestId, body.model, content, false));
          }
        },
        close: () => {
          if (!streamEnded) {
            streamEnded = true;
            res.write(buildStreamChunk(requestId, body.model, '', false, true));
            res.write(buildStreamDone());
            res.end();
          }
        }
      },
      requestParams,
    };

    addPendingRequest(pending);
    broadcastRequest(pending);

    const timeout = setTimeout(() => {
      if (!streamEnded) {
        streamEnded = true;
        removePendingRequest(requestId);
        res.write(buildStreamDone());
        res.end();
      }
    }, 10 * 60 * 1000);

    res.on('close', () => {
      clearTimeout(timeout);
      removePendingRequest(requestId);
    });
  } else {
    const pending: PendingRequest = {
      requestId,
      request: body,
      isStream: false,
      createdAt: Date.now(),
      resolve: () => {},
      requestParams,
    };

    const responsePromise = new Promise<string>((resolve) => {
      pending.resolve = resolve;
    });

    addPendingRequest(pending);
    broadcastRequest(pending);

    const timeout = setTimeout(() => {
      removePendingRequest(requestId);
      const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
      res.json(buildResponse('请求超时，请重试', body.model, requestId, promptContent));
    }, 10 * 60 * 1000);

    try {
      const content = await responsePromise;
      clearTimeout(timeout);
      const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
      const response = buildResponse(content, body.model, requestId, promptContent);

      // 记录使用情况
      if (userId && apiKeyId && model) {
        const cost = calculateCost(
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          model
        );

        await createUsageRecord({
          userId,
          apiKeyId,
          model: body.model,
          endpoint: 'chat',
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          cost,
          timestamp: Date.now(),
          requestId,
        });

        const user = getUserById(userId);
        if (user) {
          await updateUser(userId, {
            balance: user.balance - cost,
            totalUsage: user.totalUsage + response.usage.total_tokens,
          });
        }
      }

      res.json(response);
    } catch {
      clearTimeout(timeout);
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error' }
      });
    }
  }
}

/**
 * GET /v1/actions/models - 获取此 API Key 可访问的 Actions 列表
 */
router.get('/actions/models', (req: Request, res: Response) => {
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

  // 获取用户可访问的 actions
  const userId = apiKeyObj.userId;
  const actions = getPublicAndUserActions(userId);

  // 检查 API Key 的权限
  const permissions = apiKeyObj.permissions;
  let filteredActions = actions;

  if (permissions?.actions && permissions.actions.length > 0) {
    if (permissions.actionsMode === 'blacklist') {
      // 黑名单模式：排除指定的 actions
      filteredActions = actions.filter(a => !permissions.actions!.includes(a.id));
    } else {
      // 白名单模式（默认）：只包含指定的 actions
      filteredActions = actions.filter(a => permissions.actions!.includes(a.id));
    }
  }

  const actionModels = filteredActions.map(action => ({
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
    data: actionModels,
  });
});

/**
 * POST /v1/actions/completions - 调用 Action 模型
 */
router.post('/actions/completions', async (req: Request, res: Response) => {
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
  // 如果 permissions.actions 为空或不存在，允许访问所有 actions

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
    // 执行 Action
    const executionResult = await executeAction(action, input, 30000, userId, apiKeyId);

    // ACTION 内部调用的模型会通过 /v1/chat 端点自动计费
    // 这里不需要额外的计费逻辑

    // 返回结果
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

/**
 * POST /v1/rerank - 文档重排序
 * 支持 Cohere 风格的 Rerank API
 */
router.post('/rerank', async (req: Request, res: Response) => {
  const body = req.body as RerankRequest;

  if (!body.model || !body.query || !body.documents || !Array.isArray(body.documents)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: model, query, and documents are required',
        type: 'invalid_request_error',
      }
    });
  }

  // 检查模型是否存在
  const model = getModel(body.model);
  if (!model) {
    return res.status(400).json({
      error: {
        message: `Model '${body.model}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
  }

  // 认证和计费
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;
  let userId: string | undefined;
  let apiKeyId: string | undefined;

  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
    if (apiKeyObj) {
      userId = apiKeyObj.userId;
      apiKeyId = apiKeyObj.id;
    }
  }

  const requestId = generateRequestId();
  console.log('\n========================================');
  console.log('收到新的 Rerank 请求');
  console.log('请求ID:', requestId);
  console.log('模型:', body.model);
  console.log('查询:', body.query.substring(0, 100));
  console.log('文档数:', body.documents.length);
  console.log('========================================\n');

  // 检查是否配置了转发
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    try {
      // 构建转发请求
      const forwardModel = model.forwardModelName || body.model;
      let url = model.api_base_url!;
      
      // 智能处理 URL
      if (!url.includes('/rerank')) {
        url = `${url}/rerank`;
      }

      const forwardBody = {
        model: forwardModel,
        query: body.query,
        documents: body.documents,
        top_n: body.top_n || body.documents.length,
        return_documents: body.return_documents,
        max_chunks_per_doc: body.max_chunks_per_doc,
      };

      console.log(`[Forwarder] 转发 Rerank 请求到 ${url}`);

      const response = await axios.post(url, forwardBody, {
        headers: {
          'Authorization': `Bearer ${model.api_key}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      });

      // 统一响应格式
      let rerankResponse: RerankResponse;

      if (response.data.results) {
        // 已经是标准格式
        rerankResponse = {
          id: requestId,
          results: response.data.results,
          model: body.model,
          usage: response.data.usage || { total_tokens: 0 },
        };
      } else {
        // 需要转换格式
        rerankResponse = {
          id: requestId,
          results: response.data.data || response.data,
          model: body.model,
          usage: response.data.usage || { total_tokens: 0 },
        };
      }

      // 记录使用情况
      if (userId && apiKeyId) {
        const cost = calculateCost(rerankResponse.usage.total_tokens, 0, model);
        await createUsageRecord({
          userId,
          apiKeyId,
          model: body.model,
          endpoint: 'rerank',
          promptTokens: rerankResponse.usage.total_tokens,
          completionTokens: 0,
          totalTokens: rerankResponse.usage.total_tokens,
          cost,
          timestamp: Date.now(),
          requestId,
        });

        const user = getUserById(userId);
        if (user) {
          await updateUser(userId, {
            balance: user.balance - cost,
            totalUsage: user.totalUsage + rerankResponse.usage.total_tokens,
          });
        }
      }

      return res.json(rerankResponse);
    } catch (error: any) {
      console.error('[Forwarder] Rerank 转发失败:', error.message);
      return res.status(502).json({
        error: {
          message: `转发失败: ${error.message}`,
          type: 'forwarding_error',
          code: 'forwarding_failed',
        }
      });
    }
  }

  // 没有配置转发：模拟响应
  console.log('[Manual] Rerank 模拟模式');

  // 生成模拟的重排序结果
  const topN = body.top_n || body.documents.length;
  const results = body.documents
    .map((doc, index) => ({
      index,
      relevance_score: Math.random() * 0.5 + 0.5, // 0.5 - 1.0 的随机分数
      document: body.return_documents ? doc : undefined,
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, topN);

  const rerankResponse: RerankResponse = {
    id: requestId,
    results,
    model: body.model,
    usage: {
      total_tokens: body.query.length + body.documents.reduce((sum, doc) => sum + doc.length, 0),
    },
  };

  // 记录使用情况
  if (userId && apiKeyId) {
    const cost = calculateCost(rerankResponse.usage.total_tokens, 0, model);
    await createUsageRecord({
      userId,
      apiKeyId,
      model: body.model,
      endpoint: 'rerank',
      promptTokens: rerankResponse.usage.total_tokens,
      completionTokens: 0,
      totalTokens: rerankResponse.usage.total_tokens,
      cost,
      timestamp: Date.now(),
      requestId,
    });

    const user = getUserById(userId);
    if (user) {
      await updateUser(userId, {
        balance: user.balance - cost,
        totalUsage: user.totalUsage + rerankResponse.usage.total_tokens,
      });
    }
  }

  res.json(rerankResponse);
});

export default router;
