import { Router, Request, Response } from 'express';
import type { ChatCompletionRequest, PendingRequest } from '../types.js';
import { addPendingRequest, removePendingRequest } from '../requestStore.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../websocket.js';
import { getAllModels, getModel, validateApiKey, getUserById, updateUser, createUsageRecord, getAllActions, getActionByName, getPublicAndUserActions } from '../storage.js';
import { calculateCost, calculateTokens } from '../billing.js';
import { executeAction } from '../actions/executor.js';
import { forwardChatRequest } from '../forwarder.js';

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

  // 添加 Actions 作为模型
  const userId = (req as any).user?.id;
  const actions = getPublicAndUserActions(userId);
  const actionModels = actions.map(action => ({
    id: `actions/${action.name}`,
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
 * GET /v1/models/:id - 获取单个模型
 */
router.get('/models/:id', (req: Request, res: Response) => {
  const model = getModel(req.params.id as string);
  if (!model) {
    return res.status(404).json({
      error: { message: 'Model not found', type: 'invalid_request_error' }
    });
  }
  res.json(model);
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
  if (body.model.startsWith('actions/')) {
    const actionName = body.model.replace('actions/', '');
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
          // 如果不是 JSON，作为单个参数传递
          input = { text: lastMessage.content };
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
      const result = await executeAction(action, input);

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
            content: JSON.stringify(result),
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
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

  // 计费检查
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;
  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
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

  const userId = apiKeyObj?.userId;
  const apiKeyId = apiKeyObj?.id;
  const model = getModel(body.model);

  // 检查是否配置了转发
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    // 配置了转发：尝试转发，失败则返回错误（不回退到手动模拟）
    console.log(`[Forwarder] 转发模式：${model.api_type || 'openai'} API`);

    if (isStream) {
      // 流式转发：不允许用户模拟
      console.log('[Forwarder] 流式转发，不允许用户模拟');

      const forwardResult = await forwardChatRequest(model, body);

      if (!forwardResult.success) {
        return res.status(502).json({
          error: {
            message: `转发失败: ${forwardResult.error}`,
            type: 'forwarding_error',
            code: 'forwarding_failed',
          }
        });
      }

      // 记录使用情况
      if (userId && apiKeyId) {
        const response = forwardResult.response;
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

      return res.json(forwardResult.response);
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

export default router;
