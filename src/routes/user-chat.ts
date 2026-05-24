import { Router, Request, Response } from 'express';
import { AuthRequest } from '../middleware.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../responseBuilder.js';
import { addPendingRequest, removePendingRequest, type PendingRequest } from '../requestStore.js';
import { broadcastRequest, getConnectedClientsCount } from '../websocket.js';
import { hasReverseClients, broadcastRequestToReverseClients } from '../reverseWebSocket.js';
import { getModel, getUserById, updateUser, createUsageRecord, getAllModels, getNodeById, selectProviderKeyRoundRobin, getProviderById } from '../storage.js';
import { calculateCost, calculateTokens } from '../billing.js';
import { forwardChatRequest, forwardStreamRequest, isModelForwardingConfigured, shouldUseNodeForwarding, hideKey, resolveForwardUrl, getForwardModelName, getEffectiveApiKey, mergeHeaders, forwardImageRequest } from '../forwarder.js';
import { sendRequestToNode, isNodeConnected } from '../reverseWebSocket.js';

// 存储流式响应的内容（用于会话自动更新）
const streamContentMap = new Map<string, string>();
import { getContentString, extractApiKey } from '../routes/v1/utils.js';
import type { Message } from '../types.js';
import { BUILTIN_TOOLS, BUILTIN_TOOL_NAMES, executeBuiltinTool, hasBuiltinTools } from '../tools/builtin.js';
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
        
        if (session && session.ownerId === userId) {
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
    const supportedTypes = ['text', 'embedding', 'rerank', 'responses', 'image'];
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

    // 为 ChatUI 注入内置工具
    if (!body.tools) body.tools = [];
    const existingNames = new Set(body.tools.map((t: any) => t.function?.name));
    for (const tool of BUILTIN_TOOLS) {
      if (!existingNames.has(tool.function.name)) {
        body.tools.push(tool);
      }
    }

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

/**
 * 流式转发 + 内置工具拦截
 * 1. 透传 text delta 给客户端
 * 2. 检测到 tool_calls 时 buffering，不转发 finish_reason
 * 3. stream 结束后执行工具，自动发起 follow-up 请求
 * 4. follow-up 的结果继续流式输出给客户端
 */
async function streamWithBuiltinTools(
  runtimeModel: any,
  body: any,
  res: any,
  requestId: string,
): Promise<string> {
  const { default: axios } = await import('axios');

  console.log('[streamWithBuiltinTools] Starting, model:', body.model, 'forwardModel:', getForwardModelName(runtimeModel, body.model));

  let allContent = '';
  const forwardModel = getForwardModelName(runtimeModel, body.model);
  let currentBody = { ...body, stream: true, model: forwardModel };
  const maxRounds = 5;

  for (let round = 0; round < maxRounds; round++) {
    console.log('[streamWithBuiltinTools] Round', round, 'messages count:', currentBody.messages?.length);
    const url = resolveForwardUrl(runtimeModel, 'chat', body.model, forwardModel);
    const apiKey = getEffectiveApiKey(runtimeModel);
    const headers = mergeHeaders(runtimeModel.defaultHeaders, {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    });
    console.log('[streamWithBuiltinTools] URL:', url, 'Key:', apiKey.slice(0, 8) + '...');

    // 收集本轮工具调用（keyed by index）
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    let currentReasoning = '';
    let finishReason: string | null = null;

    const response = await axios.post(url, currentBody, {
      headers,
      timeout: 120000,
      responseType: 'stream',
    });

    let chunkCount = 0;
    await new Promise<void>((resolveStream, rejectStream) => {
      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta || {};
            finishReason = choice.finish_reason || null;

            chunkCount++;
            if (chunkCount <= 3) {
              console.log('[streamWithBuiltinTools] chunk', chunkCount, 'delta:', JSON.stringify(delta), 'finish:', finishReason);
            }

            // 转义 reasoning_content
            if ((delta as any).reasoning_content) {
              currentReasoning += (delta as any).reasoning_content;
            }

            // 文本/推理 delta → 直接转发给客户端（保留 role、reasoning_content 等原始字段）
            if (delta.content || (delta as any).reasoning_content) {
              if (delta.content) allContent += delta.content;
              res.write(`data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model,
                choices: [{ index: 0, delta, finish_reason: null }],
              })}\n\n`);
            }

            // 工具调用 → buffering（不转发给客户端）
            if (delta.tool_calls) {
              console.log('[streamWithBuiltinTools] Tool calls detected:', JSON.stringify(delta.tool_calls));
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallBuffers.has(idx)) {
                  toolCallBuffers.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
                }
                const buf = toolCallBuffers.get(idx)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }

            // 流结束标记（仅记录，不转发 finish chunk — 由外层统一处理）
          } catch { /* skip parse error */ }
        }
      });

      response.data.on('end', () => {
        console.log('[streamWithBuiltinTools] Stream ended, total chunks:', chunkCount, 'toolBuffers:', toolCallBuffers.size);
        resolveStream();
      });

      response.data.on('error', (err: Error) => {
        console.error('[streamWithBuiltinTools] Stream error:', err.message);
        rejectStream(err);
      });
    });

    // 没有工具调用 → 结束流
    if (toolCallBuffers.size === 0) {
      console.log('[streamWithBuiltinTools] No tool calls, returning content length:', allContent.length);
      return allContent;
    }

    console.log('[streamWithBuiltinTools] Tool calls found:', toolCallBuffers.size);

    // 有工具调用 → 执行内置工具
    const toolCalls = Array.from(toolCallBuffers.values()).filter(tc =>
      BUILTIN_TOOL_NAMES.has(tc.name)
    );

    if (toolCalls.length === 0) {
      console.log('[streamWithBuiltinTools] No builtin tools found among', toolCallBuffers.size, 'calls');
      return allContent;
    }

    console.log('[streamWithBuiltinTools] Executing builtin tools:', toolCalls.map(tc => tc.name).join(','));

    const toolResults = await Promise.all(
      toolCalls.map(tc => executeBuiltinTool({ name: tc.name, arguments: tc.args }))
    );

    // 构建 follow-up 消息
    const newMessages = [...(currentBody.messages || [])];
    newMessages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      })),
    });
    for (const r of toolResults) newMessages.push(r);
    currentBody = { ...currentBody, messages: newMessages, stream: true };
  }

  console.log('[streamWithBuiltinTools] Exceeded max rounds, returning:', allContent.length);
  return allContent;
}

async function handleUserChatRequest(
  body: any,
  requestId: string,
  isStream: boolean,
  res: Response,
  userId: string,
  apiKeyId: string,
  model: any
) {
  const sessionId = body.sessionId; // 获取sessionId用于会话更新
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

  // 图片生成模型处理
  if (model.type === 'image') {
    const lastMsg = body.messages?.[body.messages.length - 1];
    const prompt = getContentString(lastMsg?.content || '').trim();
    if (!prompt) {
      return res.status(400).json({
        error: { message: 'Prompt is required for image generation', type: 'invalid_request_error' }
      });
    }

    // 尝试通过上游转发
    const runtimeModel = model as any;
    if (isModelForwardingConfigured(runtimeModel)) {
      try {
        const result = await forwardImageRequest(runtimeModel, { model: body.model, prompt, n: 1 }, 'imageGenerations');
        if (result.success) {
          const images = result.response?.data || [];
          const imageUrl = images[0]?.url || images[0]?.b64_json || '';
          const content = imageUrl ? `![generated image](${imageUrl})` : 'No image generated';
          if (isStream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.write(buildStreamChunk(requestId, body.model, content, true));
            res.write(buildStreamChunk(requestId, body.model, '', false, true));
            res.write(buildStreamDone());
            res.end();
          } else {
            return res.json(buildResponse(content, body.model, requestId, prompt));
          }
        }
        console.error('[User Chat] Image forward failed:', (result as any).error);
      } catch (e) {
        console.error('[User Chat] Image forward error:', e);
      }
    }

    // 转发失败或未配置转发，走管理员手动处理
    const imageRequest = {
      model: body.model,
      prompt,
      n: 1,
      size: body.size || '1024x1024',
      quality: body.quality || 'standard',
      style: body.style || 'vivid',
      response_format: body.response_format || 'url',
      user: body.user,
    };

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }

    const pending: PendingRequest = {
      requestId,
      request: { model: body.model, messages: [] },
      isStream: false,
      createdAt: Date.now(),
      resolve: (data: string) => {
        try {
          const images = JSON.parse(data);
          const imageUrl = Array.isArray(images) ? (images[0]?.url || images[0]?.b64_json || '') : '';
          const content = imageUrl ? `![generated image](${imageUrl})` : 'No image generated';
          if (isStream) {
            res.write(buildStreamChunk(requestId, body.model, content, true));
            res.write(buildStreamChunk(requestId, body.model, '', false, true));
            res.write(buildStreamDone());
            res.end();
          } else {
            res.json(buildResponse(content, body.model, requestId, prompt));
          }
        } catch {
          res.status(500).json({ error: { message: 'Failed to parse image response', type: 'server_error' } });
        }
      },
      requestType: 'image',
      imageRequest,
    };

    addPendingRequest(pending);
    broadcastRequest(pending);

    const timeout = setTimeout(() => {
      removePendingRequest(requestId);
      if (isStream) {
        res.write(buildStreamChunk(requestId, body.model, '', false, true));
        res.write(buildStreamDone());
        res.end();
      } else {
        res.json(buildResponse('Image generation timeout', body.model, requestId, prompt));
      }
    }, 10 * 60 * 1000);

    res.on('close', () => {
      clearTimeout(timeout);
      removePendingRequest(requestId);
    });
    return;
  }

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

      // ===== 服务器托管流：立即创建AI消息到DB =====
      let streamEnded = false;
      let totalContent = '';
      let completionTokens = 0;
      let lastDbFlush = 0;
      let nodeAiMsgCreated = false;

      if (sessionId) {
        try {
          const session = await getChatSessionById(sessionId);
          if (session && session.ownerId === userId) {
            const newMessages = [...session.messages, {
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              model: body.model,
              _isStreaming: true,
            }];
            await updateChatSession(sessionId, { messages: newMessages, updatedAt: Date.now() });
            nodeAiMsgCreated = true;
          }
        } catch (e) {
          console.error('[User Chat] Failed to create AI message for node stream:', e);
        }
      }

      const flushNodeToDb = async (content: string) => {
        if (!sessionId || !nodeAiMsgCreated || streamEnded) return;
        try {
          const s = await getChatSessionById(sessionId);
          if (!s || s.ownerId !== userId) return;
          const msgs = [...s.messages];
          const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
          if (idx === -1) return;
          msgs[idx] = { ...msgs[idx], content };
          await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
        } catch {}
      };

      const finalizeNodeStream = async () => {
        if (!sessionId || !nodeAiMsgCreated) return;
        try {
          const s = await getChatSessionById(sessionId);
          if (!s || s.ownerId !== userId) return;
          const msgs = [...s.messages];
          const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
          if (idx === -1) return;
          msgs[idx] = {
            ...msgs[idx],
            content: totalContent,
            _isStreaming: false,
          };
          await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
          console.log(`[User Chat] Node stream finalized, session=${sessionId}`);
        } catch {}
      };

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
              
              const now = Date.now();
              if (sessionId && nodeAiMsgCreated && now - lastDbFlush > 300) {
                lastDbFlush = now;
                flushNodeToDb(totalContent).catch(() => {});
              }
            }
          },
          writeRaw: (sseChunk: string) => {
            if (!streamEnded) {
              res.write(sseChunk);
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
              
              const user = getUserById(userId);
              if (user) {
                updateUser(userId, {
                  balance: user.balance - cost,
                  totalUsage: user.totalUsage + totalTokens,
                }).catch(err => console.error('[User Chat] Failed to update user balance:', err));
              }
              
              finalizeNodeStream().catch(() => {});
              
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
          finalizeNodeStream().catch(() => {});
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
            
            if (session && session.ownerId === userId) {
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

  // 思考模式：通过 body.thinking 控制是否启用思考（仅对非节点转发生效）
  if (body.thinking && runtimeModel.forwardingMode !== 'node') {
    runtimeModel = {
      ...runtimeModel,
      defaultHeaders: {
        ...(runtimeModel.defaultHeaders || {}),
        'thinking_mode': 'true',
      },
    };
  }

  const hasForwarding = isModelForwardingConfigured(runtimeModel);

  if (hasForwarding) {
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // ===== 服务器托管流：立即创建AI消息到DB =====
      let streamingContent = '';
      let streamingReasoning = '';
      let streamEnded = false;
      let lastDbFlush = 0;
      let aiMsgCreated = false;

      // 流开始前：创建AI消息（_isStreaming: true）确保刷新不丢失
      if (sessionId) {
        try {
          const session = await getChatSessionById(sessionId);
          if (session && session.ownerId === userId) {
            const newMessages = [...session.messages, {
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              model: body.model,
              _isStreaming: true,
            }];
            await updateChatSession(sessionId, { messages: newMessages, updatedAt: Date.now() });
            aiMsgCreated = true;
            console.log(`[User Chat] Created AI message in DB for session ${sessionId}`);
          }
        } catch (e) {
          console.error('[User Chat] Failed to create AI message in DB:', e);
        }
      }

      // 节流：每300ms刷一次DB，让刷新页面能看到进度
      const flushToDb = async () => {
        if (!sessionId || streamEnded) return;
        try {
          const s = await getChatSessionById(sessionId);
          if (!s || s.ownerId !== userId) return;
          const msgs = [...s.messages];
          const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
          if (idx === -1) return;
          msgs[idx] = {
            ...msgs[idx],
            content: streamingContent,
            reasoning_content: streamingReasoning || undefined,
          };
          await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
        } catch (e) {
          // ignore flush errors
        }
      };

      // 判断是否包含内置工具 — 走流式拦截+工具执行
      const useToolLoop = hasBuiltinTools(body.tools);

      if (useToolLoop) {
        console.log('[User Chat] Starting streamWithBuiltinTools');
        try {
          const allContent = await streamWithBuiltinTools(runtimeModel, body, res, requestId);
          streamingContent = allContent;
          console.log('[User Chat] streamWithBuiltinTools done, content length:', allContent.length);
        } catch (error: any) {
          console.error('[User Chat] Stream with tools failed:', error.message, error.stack);
          if (!res.headersSent) {
            res.write(buildStreamChunk(requestId, body.model, '系统错误: ' + error.message, true));
          } else {
            res.write(buildStreamChunk(requestId, body.model, '系统错误: ' + error.message, false));
          }
        }
        streamEnded = true;
        if (sessionId && aiMsgCreated) {
          try {
            const s = await getChatSessionById(sessionId);
            if (s && s.ownerId === userId) {
              const msgs = [...s.messages];
              const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
              if (idx !== -1) {
                msgs[idx] = {
                  ...msgs[idx],
                  content: streamingContent,
                  _isStreaming: false,
                };
                await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
              }
            }
          } catch {}
        }
        res.write(buildStreamChunk(requestId, body.model, '', false, true));
        res.write(buildStreamDone());
        res.end();
      } else {
        // 无内置工具 — 直接流式转发
        try {
          await forwardStreamRequest(runtimeModel, body, res, (info) => {
            if (!streamEnded) {
              if (info.content) streamingContent += info.content;
              if (info.reasoningContent) streamingReasoning += info.reasoningContent || '';
              
              const now = Date.now();
              if (sessionId && aiMsgCreated && now - lastDbFlush > 300) {
                lastDbFlush = now;
                flushToDb().catch(() => {});
              }
            }
          });
          
          streamEnded = true;
          if (sessionId && aiMsgCreated) {
            try {
              const s = await getChatSessionById(sessionId);
              if (s && s.ownerId === userId) {
                const msgs = [...s.messages];
                const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
                if (idx !== -1) {
                  msgs[idx] = {
                    ...msgs[idx],
                    content: streamingContent,
                    reasoning_content: streamingReasoning || undefined,
                    _isStreaming: false,
                  };
                  await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
                  console.log(`[User Chat] Forward stream finalized, session=${sessionId}, content=${streamingContent.length} chars`);
                }
              }
            } catch (e) {
              console.error('[User Chat] Failed to finalize forward stream:', e);
            }
          }
        } catch (error: any) {
          streamEnded = true;
          console.error('[User Chat] Stream forwarding failed:', error.message);
          if (sessionId && aiMsgCreated) {
            try {
              const s = await getChatSessionById(sessionId);
              if (s && s.ownerId === userId) {
                const msgs = [...s.messages];
                const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
                if (idx !== -1) {
                  msgs[idx] = {
                    ...msgs[idx],
                    content: streamingContent || `请求失败: ${error.message}`,
                    _isStreaming: false,
                  };
                  await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
                }
              }
            } catch (e) {}
          }
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
      }
      return;
    } else {
      // 内置工具执行循环（非流式转发）
      let currentBody = body;
      let finalResponse: any = null;
      const maxToolRounds = 5;
      let toolRound = 0;

      while (toolRound < maxToolRounds) {
        const forwardResult = await forwardChatRequest(runtimeModel, currentBody);

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
        const choice = response.choices?.[0];
        const message = choice?.message;

        // 检查是否有内置工具调用
        const toolCalls = message?.tool_calls || [];
        const builtinToolCalls = toolCalls.filter((tc: any) =>
          BUILTIN_TOOLS.some(t => t.function.name === tc.function?.name)
        );

        if (builtinToolCalls.length === 0) {
          finalResponse = response;
          break;
        }

        toolRound++;
        console.log(`[User Chat] Built-in tool round ${toolRound}: ${builtinToolCalls.map((tc: any) => tc.function?.name).join(', ')}`);

        // 执行内置工具
        const toolResults = await Promise.all(
          builtinToolCalls.map((tc: any) =>
            executeBuiltinTool({ name: tc.function.name, arguments: tc.function.arguments })
          )
        );

        // 构建新的消息列表
        const newMessages = [...(currentBody.messages || [])];
        newMessages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: toolCalls,
        });
        for (const result of toolResults) {
          newMessages.push(result);
        }

        currentBody = { ...currentBody, messages: newMessages };
      }

      if (!finalResponse) {
        finalResponse = { choices: [{ message: { role: 'assistant', content: 'Tool execution exceeded maximum rounds' } }] };
      }

      // 记录使用情况（JWT认证用户也要计费）
      if (userId) {
        const cost = calculateCost(
          finalResponse.usage?.prompt_tokens || 0,
          finalResponse.usage?.completion_tokens || 0,
          model
        );

        await createUsageRecord({
          userId,
          apiKeyId: apiKeyId || 'jwt-auth',
          model: body.model,
          endpoint: 'chat',
          promptTokens: finalResponse.usage?.prompt_tokens || 0,
          completionTokens: finalResponse.usage?.completion_tokens || 0,
          totalTokens: finalResponse.usage?.total_tokens || 0,
          cost,
          timestamp: Date.now(),
          requestId,
        });

        const user = getUserById(userId);
        if (user) {
          await updateUser(userId, {
            balance: user.balance - cost,
            totalUsage: user.totalUsage + (finalResponse.usage?.total_tokens || 0),
          });
        }
      }

      // 自动更新会话：添加AI回复
      if (sessionId) {
        try {
          const session = await getChatSessionById(sessionId);
          
          if (session && session.ownerId === userId) {
            if (finalResponse.choices && finalResponse.choices[0]?.message) {
              const aiMessage = finalResponse.choices[0].message;
              const newMessage: any = {
                role: aiMessage.role,
                content: typeof aiMessage.content === 'string' 
                  ? aiMessage.content 
                  : JSON.stringify(aiMessage.content),
                timestamp: Date.now(),
              };
              if (aiMessage.reasoning_content) {
                newMessage.reasoning_content = aiMessage.reasoning_content;
              }
              const newMessages = [...session.messages, newMessage];
              
              await updateChatSession(sessionId, { 
                messages: newMessages,
                updatedAt: Date.now(),
              });
              
              console.log(`[User Chat] Updated session ${sessionId} with AI response`);
            }
          }
        } catch (error) {
          console.error('[User Chat] Failed to update session with AI response:', error);
        }
      }

      return res.json(finalResponse);
    }
  }

  // 手动模拟模式
  console.log('[User Chat] Manual simulation mode');

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // ===== 服务器托管流：立即创建AI消息到DB =====
    let streamEnded = false;
    let streamingMessageContent = '';
    let manualAiMsgCreated = false;
    let lastDbFlush = 0;

    if (sessionId) {
      try {
        const session = await getChatSessionById(sessionId);
        if (session && session.ownerId === userId) {
          const newMessages = [...session.messages, {
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            model: body.model,
            _isStreaming: true,
          }];
          await updateChatSession(sessionId, { messages: newMessages, updatedAt: Date.now() });
          manualAiMsgCreated = true;
        }
      } catch (e) {
        console.error('[User Chat] Failed to create AI message for manual stream:', e);
      }
    }

    const flushManualToDb = async (content: string) => {
      if (!sessionId || !manualAiMsgCreated || streamEnded) return;
      try {
        const s = await getChatSessionById(sessionId);
        if (!s || s.ownerId !== userId) return;
        const msgs = [...s.messages];
        const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
        if (idx === -1) return;
        msgs[idx] = { ...msgs[idx], content };
        await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
      } catch {}
    };

    const finalizeManualStream = async () => {
      if (!sessionId || !manualAiMsgCreated) return;
      try {
        const s = await getChatSessionById(sessionId);
        if (!s || s.ownerId !== userId) return;
        const msgs = [...s.messages];
        const idx = msgs.findIndex((m: any) => m.role === 'assistant' && m._isStreaming);
        if (idx === -1) return;
        msgs[idx] = {
          ...msgs[idx],
          content: streamingMessageContent,
          _isStreaming: false,
        };
        await updateChatSession(sessionId, { messages: msgs, updatedAt: Date.now() });
        console.log(`[User Chat] Manual stream finalized, session=${sessionId}, length=${streamingMessageContent.length}`);
      } catch (e) {
        console.error('[User Chat] Failed to finalize manual stream:', e);
      }
    };

    const pending: PendingRequest = {
      requestId,
      request: body,
      isStream: true,
      createdAt: Date.now(),
      resolve: () => {},
      streamController: {
        enqueue: async (content: string) => {
          if (!streamEnded) {
            res.write(buildStreamChunk(requestId, body.model, content, false));
            streamingMessageContent += content;

            const now = Date.now();
            if (sessionId && manualAiMsgCreated && now - lastDbFlush > 300) {
              lastDbFlush = now;
              flushManualToDb(streamingMessageContent).catch(() => {});
            }
          }
        },
        writeRaw: (sseChunk: string) => {
          if (!streamEnded) {
            res.write(sseChunk);
          }
        },
        close: async () => {
          if (!streamEnded) {
            streamEnded = true;
            await finalizeManualStream().catch(() => {});
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
        finalizeManualStream().catch(() => {});
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

      // 记录使用情况（JWT认证用户也要计费）
      if (userId) {
        const cost = calculateCost(
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          model
        );

        await createUsageRecord({
          userId,
          apiKeyId: apiKeyId || 'jwt-auth', // JWT认证使用虚拟ID
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