import { Router, Request, Response } from 'express';
import { AuthRequest } from '../middleware.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../responseBuilder.js';
import { addPendingRequest, removePendingRequest, type PendingRequest } from '../requestStore.js';
import { broadcastRequest, getConnectedClientsCount } from '../websocket.js';
import { hasReverseClients, broadcastRequestToReverseClients } from '../reverseWebSocket.js';
import { getModel, getUserById, updateUser, createUsageRecord, getAllModels, getNodeById, selectProviderKeyRoundRobin, getProviderById } from '../storage.js';
import { calculateCost, calculateTokens } from '../billing.js';
import { forwardChatRequest, forwardStreamRequest, isModelForwardingConfigured, shouldUseNodeForwarding, hideKey, resolveForwardUrl, getForwardModelName } from '../forwarder.js';
import { sendRequestToNode, isNodeConnected } from '../reverseWebSocket.js';
import { getContentString, extractApiKey } from '../routes/v1/utils.js';
import type { Message } from '../types.js';
import {
  createChatSession,
  getChatSessionById,
  updateChatSession,
  deleteChatSession,
  getUserChatSessions
} from '../db/chatSessions.js';

const router: Router = Router();

// 节点请求超时时间（30秒）
const NODE_REQUEST_TIMEOUT = 30000;

/**
 * POST /api/chat - 用户聊天接口（使用 JWT 认证）
 * 这个接口专门用于前端 chatui，使用 JWT 令牌而不是 API Key
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body;

    if (!body.model || !body.messages || !Array.isArray(body.messages)) {
      return res.status(400).json({
        error: {
          message: 'Invalid request: model and messages are required',
          type: 'invalid_request_error',
        }
      });
    }

    // 从 JWT 认证中间件获取用户信息
    const userId = req.userId;
    const user = req.user;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    // 自动会话更新：如果提供了sessionId，自动更新会话
    const sessionId = body.sessionId;
    if (sessionId) {
      try {
        const { getChatSessionById, updateChatSession } = await import('../db/chatSessions.js');
        const session = await getChatSessionById(sessionId);
        
        if (session && session.userId === userId) {
          // 更新会话：添加用户消息
          const userMessage = body.messages[body.messages.length - 1];
          if (userMessage && userMessage.role === 'user') {
            const newMessages = [...session.messages, {
              role: userMessage.role,
              content: typeof userMessage.content === 'string' 
                ? userMessage.content 
                : JSON.stringify(userMessage.content),
              timestamp: Date.now(),
            }];
            
            await updateChatSession(sessionId, { 
              messages: newMessages,
              updatedAt: Date.now(),
            });
            
            console.log(`[User Chat] Updated session ${sessionId} with user message`);
          }
        }
      } catch (error) {
        console.error('[User Chat] Failed to update session with user message:', error);
      }
    }

    // 检查模型是否存在
    const model = getModel(body.model);
    if (!model) {
      return res.status(400).json({
        error: {
          message: `Model '${body.model}' not found. Available models: ${getAllModels().map(m => m.id).join(', ')}`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        }
      });
    }

    // 验证模型类型
    const supportedTypes = ['text', 'embedding', 'rerank', 'responses'];
    if (!supportedTypes.includes(model.type)) {
      return res.status(400).json({
        error: {
          message: `Model '${body.model}' (type: ${model.type}) does not support chat completions`,
          type: 'invalid_request_error',
          code: 'model_type_not_supported',
        }
      });
    }

    // 获取用户的 API Key（如果有）
    const userData = getUserById(userId);
    let apiKeyId = '';

    // 如果用户有 API Key，使用第一个可用的
    // 这里简化处理，实际应用中可能需要让用户选择
    if (userData && userData.apiKeys && userData.apiKeys.length > 0) {
      apiKeyId = userData.apiKeys[0].id;
    }

    const requestId = generateRequestId();
    const isStream = body.stream === true;

    console.log('[User Chat] Chat request from user:', userId, 'model:', body.model, 'stream:', isStream);

    // 添加内部 headers，让 completions 路由知道这是内部调用
    req.headers['x-internal-user-id'] = userId;
    req.headers['x-internal-api-key-id'] = apiKeyId;

    // 处理聊天请求
    await handleUserChatRequest(body, requestId, isStream, res, userId, apiKeyId, model);

  } catch (error: any) {
    console.error('[User Chat] Error:', error);
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'server_error',
      }
    });
  }
});

async function handleUserChatRequest(
  body: any,
  requestId: string,
  isStream: boolean,
  res: Response,
  userId: string,
  apiKeyId: string,
  model: any
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

  // 检查是否应该通过节点转发
  if (shouldUseNodeForwarding(model)) {
    const node = getNodeById(model.nodeId!);
    console.log('[User Chat] Using node forwarding, node:', model.nodeId);
    if (node) {
      console.log('[User Chat] Node key:', hideKey(node.key));
    }

    if (!isNodeConnected(model.nodeId!)) {
      return res.status(503).json({
        error: {
          message: `Node ${model.nodeId} is not connected`,
          type: 'node_error',
          code: 'node_offline',
        }
      });
    }

    // 计算预估 token 数（用于计费）
    const promptContent = body.messages.map((m: Message) => getContentString(m.content)).join('\n');
    const estimatedPromptTokens = calculateTokens(promptContent);

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let streamEnded = false;
      let totalContent = '';
      let completionTokens = 0;

      const pending: PendingRequest = {
        requestId,
        request: body,
        isStream: true,
        createdAt: Date.now(),
        resolve: () => {},
        streamController: {
          enqueue: (content: string) => {
            if (!streamEnded) {
              totalContent += content;
              completionTokens = calculateTokens(totalContent);
              res.write(buildStreamChunk(requestId, body.model, content, false));
            }
          },
          close: () => {
            if (!streamEnded) {
              streamEnded = true;
              
              // 记录使用情况
              const totalTokens = estimatedPromptTokens + completionTokens;
              const cost = calculateCost(estimatedPromptTokens, completionTokens, model);
              
              createUsageRecord({
                userId,
                apiKeyId: 'chat-ui',
                model: body.model,
                modelId: model.id,
                endpoint: 'chat',
                promptTokens: estimatedPromptTokens,
                completionTokens,
                totalTokens,
                cost,
                timestamp: Date.now(),
                requestId,
              }).catch(err => console.error('[User Chat] Failed to create usage record:', err));
              
              // 更新用户余额
              const user = getUserById(userId);
              if (user) {
                updateUser(userId, {
                  balance: user.balance - cost,
                  totalUsage: user.totalUsage + totalTokens,
                }).catch(err => console.error('[User Chat] Failed to update user balance:', err));
              }
              
              res.write(buildStreamChunk(requestId, body.model, '', false, true));
              res.write(buildStreamDone());
              res.end();
            }
          }
        },
        requestParams,
        requestType: 'chat',
      };

      addPendingRequest(pending);
      sendRequestToNode(model.nodeId!, pending);

      const timeout = setTimeout(() => {
        if (!streamEnded) {
          streamEnded = true;
          removePendingRequest(requestId);
          console.log('[User Chat] 节点请求超时:', requestId);
          res.write(buildStreamChunk(requestId, body.model, '请求超时，请重试', false, true));
          res.write(buildStreamDone());
          res.end();
        }
      }, NODE_REQUEST_TIMEOUT);

      res.on('close', () => {
        clearTimeout(timeout);
        removePendingRequest(requestId);
      });
      return;
    } else {
      const pending: PendingRequest = {
        requestId,
        request: body,
        isStream: false,
        createdAt: Date.now(),
        resolve: () => {},
        requestParams,
        requestType: 'chat',
      };

      const responsePromise = new Promise<string>((resolve) => {
        pending.resolve = resolve;
      });

      addPendingRequest(pending);
      sendRequestToNode(model.nodeId!, pending);

      try {
        const content = await responsePromise;
        const promptContent = body.messages.map((m: Message) => getContentString(m.content)).join('\n');
        const response = buildResponse(content, body.model, requestId, promptContent);
        
        // 记录使用情况（非流式）
        const completionTokens = calculateTokens(content);
        const totalTokens = estimatedPromptTokens + completionTokens;
        const cost = calculateCost(estimatedPromptTokens, completionTokens, model);
        
        await createUsageRecord({
          userId,
          apiKeyId: 'chat-ui',
          model: body.model,
          modelId: model.id,
          endpoint: 'chat',
          promptTokens: estimatedPromptTokens,
          completionTokens,
          totalTokens,
          cost,
          timestamp: Date.now(),
          requestId,
        });
        
        // 更新用户余额
        const user = getUserById(userId);
        if (user) {
          await updateUser(userId, {
            balance: user.balance - cost,
            totalUsage: user.totalUsage + totalTokens,
          });
        }
        
        // 自动更新会话：添加AI消息
        if (sessionId) {
          try {
            const { getChatSessionById, updateChatSession } = await import('../db/chatSessions.js');
            const session = await getChatSessionById(sessionId);
            
            if (session && session.userId === userId) {
              const newMessages = [...session.messages, {
                role: 'assistant' as const,
                content: content,
                timestamp: Date.now(),
                model: body.model,
              }];
              
              await updateChatSession(sessionId, { 
                messages: newMessages,
                updatedAt: Date.now(),
              });
              
              console.log(`[User Chat] Updated session ${sessionId} with AI message`);
            }
          } catch (error) {
            console.error('[User Chat] Failed to update session with AI message:', error);
          }
        }
        
        res.json(response);
      } catch (error) {
        res.status(500).json({
          error: { message: 'Node request failed', type: 'server_error' }
        });
      }
      return;
    }
  }

  // 处理 provider 模式：选择 key 并构建 runtimeModel
  let runtimeModel = model;

  if (model.forwardingMode === 'provider' && model.providerId) {
    const selected = await selectProviderKeyRoundRobin(model.providerId);
    if (!selected) {
      return res.status(502).json({
        error: {
          message: `No enabled API key available for provider '${model.providerId}'`,
          type: 'forwarding_error',
          code: 'provider_key_unavailable',
        }
      });
    }

    runtimeModel = {
      ...model,
      api_key: selected.key.key,
      api_base_url: selected.provider.api_base_url,
      api_type: selected.provider.api_type,
    };
  }

  const hasForwarding = isModelForwardingConfigured(runtimeModel);

  if (hasForwarding) {
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      try {
        await forwardStreamRequest(runtimeModel, body, res);
      } catch (error: any) {
        console.error('[User Chat] Stream forwarding failed:', error.message);
        if (!res.headersSent) {
          return res.status(502).json({
            error: {
              message: `Forwarding failed: ${error.message}`,
              type: 'forwarding_error',
              code: 'forwarding_failed',
            }
          });
        }
      }
      return;
    } else {
      const forwardResult = await forwardChatRequest(runtimeModel, body);

      if (!forwardResult.success) {
        console.error('[User Chat] Forwarding failed:', forwardResult.error);
        return res.status(502).json({
          error: {
            message: forwardResult.error,
            type: 'forwarding_error',
            code: 'forwarding_failed',
          }
        });
      }

      const response = forwardResult.response;

      // 记录使用情况
      if (userId && apiKeyId) {
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

      return res.json(response);
    }
  }

  // 手动模拟模式
  console.log('[User Chat] Manual simulation mode');

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
        requestType: 'chat',
    };

    addPendingRequest(pending);

    // 优先使用反向 WebSocket 客户端
    if (hasReverseClients()) {
      const sentCount = broadcastRequestToReverseClients(pending);
      if (sentCount > 0) {
        console.log(`[User Chat] Request ${requestId} sent to ${sentCount} reverse clients`);
      } else {
        broadcastRequest(pending);
      }
    } else {
      broadcastRequest(pending);
    }

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
        requestType: 'chat',
    };

    const responsePromise = new Promise<string>((resolve) => {
      pending.resolve = resolve;
    });

    addPendingRequest(pending);

    // 优先使用反向 WebSocket 客户端
    if (hasReverseClients()) {
      const sentCount = broadcastRequestToReverseClients(pending);
      if (sentCount > 0) {
        console.log(`[User Chat] Request ${requestId} sent to ${sentCount} reverse clients`);
      } else {
        broadcastRequest(pending);
      }
    } else {
      broadcastRequest(pending);
    }

    const timeout = setTimeout(() => {
      removePendingRequest(requestId);
      const promptContent = body.messages.map((m: Message) => getContentString(m.content)).join('\n');
      res.json(buildResponse('请求超时，请重试', body.model, requestId, promptContent));
    }, 10 * 60 * 1000);

    try {
      const content = await responsePromise;
      clearTimeout(timeout);
      const promptContent = body.messages.map((m: Message) => getContentString(m.content)).join('\n');
      const response = buildResponse(content, body.model, requestId, promptContent);

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

      res.json(response);
    } catch (error) {
      clearTimeout(timeout);
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error' }
      });
    }
  }
}

/**
 * POST /api/chat/sessions - 创建新会话
 */
router.post('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const user = req.user;
    const body = req.body;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    const newSession = {
      id: Date.now().toString(),
      title: body.title || '新对话',
      model: body.model || '',
      systemPrompt: body.systemPrompt || 'You are a helpful AI assistant.',
      apiType: body.apiType || 'openai-chat',
      stream: body.stream !== false,
      timeout: body.timeout || 60,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: false,
      ownerId: user?.id || 'anonymous',
    };

    await createChatSession(newSession);
    return res.status(201).json(newSession);
  } catch (error) {
    console.error('Error creating chat session:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

/**
 * GET /api/chat/sessions - 获取用户的所有会话
 */
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: ' authentication required',
          type: 'authentication_error',
        }
      });
    }

    const sessions = await getUserChatSessions(userId);
    return res.json(sessions);
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

/**
 * PUT /api/chat/sessions/:id - 更新会话
 */
router.put('/sessions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const sessionId = id as string;
    const updates = req.body;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    const session = await getChatSessionById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        error: {
          message: 'Chat session not found',
          type: 'not_found_error'
        }
      });
    }

    // 检查权限
    if (session.ownerId !== userId) {
      return res.status(403).json({
        error: {
          message: 'You do not have permission to modify this session',
          type: 'permission_error'
        }
      });
    }

    const success = await updateChatSession(sessionId, updates);
    
    if (success) {
      const updatedSession = await getChatSessionById(sessionId);
      return res.json(updatedSession);
    } else {
      return res.status(500).json({
        error: {
          message: 'Failed to update session',
          type: 'internal_error'
        }
      });
    }
  } catch (error) {
    console.error('Error updating chat session:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

/**
 * DELETE /api/chat/sessions/:id - 删除会话
 */
router.delete('/sessions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const sessionId = id as string;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    const session = await getChatSessionById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        error: {
          message: 'Chat session not found',
          type: 'not_found_error'
        }
      });
    }

    // 检查权限
    if (session.ownerId !== userId) {
      return res.status(403).json({
        error: {
          message: 'You do not have permission to delete this session',
          type: 'permission_error'
        }
      });
    }

    const success = await deleteChatSession(sessionId);
    
    if (success) {
      return res.json({ success: true });
    } else {
      return res.status(500).json({
        error: {
          message: 'Failed to delete session',
          type: 'internal_error'
        }
      });
    }
  } catch (error) {
    console.error('Error deleting chat session:', error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

export default router;