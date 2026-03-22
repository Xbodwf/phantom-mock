import { Router, Request, Response } from 'express';
import type { ChatCompletionRequest, PendingRequest } from '../../../types.js';
import { addPendingRequest, removePendingRequest } from '../../../requestStore.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../../../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../../../websocket.js';
import { getModel, validateApiKey, getUserById, updateUser, createUsageRecord, getAllModels, getActionByName, getAllApiKeys } from '../../../storage.js';
import { calculateCost, calculateTokens } from '../../../billing.js';
import { executeAction } from '../../../actions/executor.js';
import { forwardChatRequest, forwardStreamRequest } from '../../../forwarder.js';
import { getContentString, extractApiKey } from '../utils.js';

const router: Router = Router();

/**
 * POST /v1/chat/completions - 聊天补全
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
      console.log('[ACTION] Executing action:', action.name, 'with userId:', userId, 'apiKeyId:', apiKeyId);
      const executionResult = await executeAction(action, input, 30000, userId, apiKeyId);
      console.log('[ACTION] Execution completed successfully');

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

  // 验证模型类型是否支持聊天端点
  const supportedTypes = ['text', 'embedding', 'rerank', 'responses'];
  if (!supportedTypes.includes(modelExists.type)) {
    return res.status(400).json({
      error: {
        message: `Model '${body.model}' (type: ${modelExists.type}) does not support chat completions`,
        type: 'invalid_request_error',
        code: 'model_type_not_supported',
      }
    });
  }

  // 计费检查和权限检查
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;

  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
    if (!apiKeyObj) {
      return res.status(401).json({
        error: {
          message: 'Invalid or expired API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        }
      });
    }
  }

  // 检查 API Key 的模型权限
  if (apiKeyObj) {
    const permissions = apiKeyObj.permissions;
    if (permissions?.models && permissions.models.length > 0) {
      if (permissions.modelsMode === 'blacklist') {
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

  await handleChatRequest(body, requestId, isStream, res, req, apiKeyObj);
});

async function handleChatRequest(
  body: ChatCompletionRequest,
  requestId: string,
  isStream: boolean,
  res: Response,
  req: Request,
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

  let userId = apiKeyObj?.userId;
  let apiKeyId = apiKeyObj?.id;

  if (!userId) {
    const internalUserId = req.headers['x-internal-user-id'] as string;
    const internalApiKeyId = req.headers['x-internal-api-key-id'] as string;
    console.log('[handleChatRequest] Checking internal headers:', { internalUserId, internalApiKeyId, allHeaders: req.headers });
    if (internalUserId) {
      userId = internalUserId;
      apiKeyId = internalApiKeyId || 'internal';
      console.log('[handleChatRequest] Using internal headers - userId:', userId, 'apiKeyId:', apiKeyId);
    }
  }

  const model = getModel(body.model);
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    console.log(`[Forwarder] 转发模式：${model.api_type || 'openai'} API`);

    if (isStream) {
      console.log('[Forwarder] 流式转发，直接透传');

      try {
        await forwardStreamRequest(model, body, res);
      } catch (error: any) {
        console.error('[Forwarder] 流式转发失败:', error.message);
        if (!res.headersSent) {
          const allowManualReply = model?.allowManualReply !== false;
          if (allowManualReply) {
            console.log('[Forwarder] 流式转发失败，但允许人工回复，切换到人工回复模式');
          } else {
            return res.status(502).json({
              error: {
                message: `转发失败: ${error.message}`,
                type: 'forwarding_error',
                code: 'forwarding_failed',
              }
            });
          }
        }
      }
      if (res.headersSent) return;
    } else {
      console.log('[Forwarder] 非流式转发，允许用户抢先回复');

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

      const forwardPromise = forwardChatRequest(model, body);

      const raceResult = await Promise.race([
        responsePromise.then(content => ({ type: 'user' as const, content })),
        forwardPromise.then(result => ({ type: 'forward' as const, result })),
      ]);

      removePendingRequest(requestId);

      if (raceResult.type === 'user') {
        console.log('[Manual] 用户抢先回复');
        const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
        const response = buildResponse(raceResult.content, body.model, requestId, promptContent);

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
        if (!raceResult.result.success) {
          console.log(`[Forwarder] 转发失败: ${raceResult.result.error}`);

          const allowManualReply = model?.allowManualReply !== false;
          if (allowManualReply) {
            console.log('[Forwarder] 转发失败，但允许人工回复，切换到人工回复模式');
          } else {
            let errorResponse: any;
            try {
              errorResponse = JSON.parse(raceResult.result.error);
            } catch {
              errorResponse = {
                error: {
                  message: raceResult.result.error,
                  type: 'forwarding_error',
                  code: 'forwarding_failed',
                }
              };
            }

            return res.status(502).json(errorResponse);
          }
        } else {
          console.log('[Forwarder] AI 转发成功');

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
  }

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
