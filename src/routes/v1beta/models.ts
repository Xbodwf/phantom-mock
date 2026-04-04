import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { ChatCompletionRequest, PendingRequest, Message, Model } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../../websocket.js';
import { getModel, getAllModels, getPublicAndUserActions, validateApiKey, getAllApiKeys, selectProviderKeyRoundRobin, getProviderById } from '../../storage.js';
import { isModelForwardingConfigured } from '../../forwarder.js';

const router: RouterType = Router();

// 辅助函数：从请求中提取 API Key
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

// 辅助函数：获取消息内容的字符串表示
function getContentString(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

// 检查模型是否支持特定端点
function isModelSupportedByEndpoint(model: Model | null, endpoint: string): boolean {
  if (!model) return false;

  const modelType = model.type;

  switch (endpoint) {
    // 文本输出端点：支持 text, embedding, rerank, responses
    case 'chat':
    case 'messages':
    case 'generateContent':
    case 'streamGenerateContent':
      return ['text', 'embedding', 'rerank', 'responses'].includes(modelType);

    // 嵌入端点：仅支持 embedding
    case 'embeddings':
    case 'embedContent':
      return modelType === 'embedding';

    // 图片生成端点：仅支持 image
    case 'images':
      return modelType === 'image';

    // 视频生成端点：仅支持 video
    case 'videos':
      return modelType === 'video';

    // TTS 端点：仅支持 tts
    case 'audio/speech':
      return modelType === 'tts';

    // STT 端点：仅支持 stt
    case 'audio/transcriptions':
      return modelType === 'stt';

    // 重排序端点：仅支持 rerank
    case 'rerank':
      return modelType === 'rerank';

    // Responses 端点：仅支持 responses
    case 'responses':
      return modelType === 'responses';

    default:
      return false;
  }
}

// 辅助函数：从 Gemini 路径解析模型 ID 和操作类型
// Gemini API 路径格式: /v1beta/models/{modelId}:generateContent 或 :streamGenerateContent 或 :embedContent
function parseGeminiModelPath(path: string): { modelId: string; action: string } | null {
  // 匹配 /v1beta/models/{modelId}:{action}
  const match = path.match(/\/v1beta\/models\/(.+):(generateContent|streamGenerateContent|embedContent)$/);
  if (match) {
    return { modelId: decodeURIComponent(match[1]), action: match[2] };
  }
  return null;
}

function buildGeminiResponse(content: string, model: string) {
  return {
    candidates: [{
      content: {
        parts: [{ text: content }],
        role: 'model'
      },
      finishReason: 'STOP',
      safetyRatings: []
    }],
    modelVersion: model,
    usageMetadata: {
      promptTokenCount: 0,
      candidatesTokenCount: content.length,
      totalTokenCount: content.length
    }
  };
}

// 生成模拟的嵌入向量
function generateEmbedding(text: string): number[] {
  // 使用简单的哈希函数生成确定性向量
  // 在实际应用中应该使用真实的嵌入模型
  const dimension = 768; // 标准嵌入维度
  const embedding: number[] = [];

  // 使用文本的哈希值作为种子
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }

  // 生成确定性的向量
  for (let i = 0; i < dimension; i++) {
    // 使用伪随机数生成器生成向量值
    const seed = hash + i;
    const x = Math.sin(seed) * 10000;
    const value = x - Math.floor(x);
    // 归一化到 [-1, 1] 范围
    embedding.push(value * 2 - 1);
  }

  return embedding;
}

async function resolveProviderRuntimeModel(model: Model): Promise<Model | null> {
 if (model.forwardingMode !== 'provider') {
 return model;
 }

 if (!model.providerId) {
 return null;
 }

 const provider = getProviderById(model.providerId);
 if (!provider || !provider.enabled) {
 return null;
 }

 const selected = await selectProviderKeyRoundRobin(model.providerId);
 if (!selected) {
 return null;
 }

 return {
 ...model,
 api_key: selected.key.key,
 api_base_url: selected.provider.api_base_url,
 api_type: selected.provider.api_type,
 api_url_templates: selected.provider.api_url_templates,
 };
}

async function handleGeminiRequest(
  req: Request,
  res: Response,
  modelId: string,
  isStream: boolean
) {
  const body = req.body;

  // 验证 API Key
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;

  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
    if (!apiKeyObj) {
      return res.status(401).json({
        error: { code: 401, message: 'Invalid or expired API key', status: 'UNAUTHENTICATED' }
      });
    }
  }

  // 验证模型是否存在
  const model = getModel(modelId);
  if (!model) {
    return res.status(404).json({
      error: { code: 404, message: `Model ${modelId} not found`, status: 'NOT_FOUND' }
    });
  }

  const requestId = generateRequestId();

  // 转换 Gemini 格式到 OpenAI 格式
  const messages: ChatCompletionRequest['messages'] = [];

  if (body.systemInstruction?.parts) {
    const systemContent = body.systemInstruction.parts
      .map((p: { text?: string }) => p.text || '')
      .join('\n');
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }
  }

  if (body.contents) {
    body.contents.forEach((item: { role: string; parts: { text?: string }[] }) => {
      const content = item.parts
        .map((p: { text?: string }) => p.text || '')
        .join('\n');
      const role: 'system' | 'user' | 'assistant' | 'tool' = item.role === 'model' ? 'assistant' : item.role as 'system' | 'user' | 'assistant' | 'tool';
      messages.push({ role, content });
    });
  }

  const chatRequest: ChatCompletionRequest = {
    model: modelId,
    messages,
    stream: isStream,
  };

  // 检查是否配置了转发
  const runtimeModel = await resolveProviderRuntimeModel(model);
 if (model.forwardingMode === 'provider' && !runtimeModel) {
 return res.status(502).json({
 error: { code:502, message: 'Provider forwarding is not available', status: 'BAD_GATEWAY' }
 });
 }

 // 检查是否配置了转发
  const hasForwarding = model.forwardingMode === 'none'
 ? false
 : isModelForwardingConfigured(runtimeModel!);

  if (hasForwarding && runtimeModel) {
    // 配置了转发
    console.log(`[Gemini Forwarder] 转发模式：${runtimeModel.api_type || 'google'} API`);

    // 导入转发函数
    const { forwardGeminiRequest, forwardGeminiStreamRequest } = await import('../../forwarder.js');

    if (isStream) {
      // 流式转发
      console.log('[Gemini Forwarder] 流式转发');
      try {
        await forwardGeminiStreamRequest(runtimeModel, body, res);
      } catch (error: any) {
        console.error('[Gemini Forwarder] 流式转发失败:', error.message);
        if (!res.headersSent) {
          // 如果允许人工回复，则不返回错误，而是继续等待人工回复
          const allowManualReply = model?.allowManualReply !== false;
          if (allowManualReply) {
            console.log('[Gemini Forwarder] 转发失败，但允许人工回复，切换到人工回复模式');
            // 继续处理人工回复模式
          } else {
            return res.status(502).json({
              error: { code: 502, message: `转发失败: ${error.message}`, status: 'BAD_GATEWAY' }
            });
          }
        }
      }
      // 如果转发成功，已经返回了，不会执行到这里
      // 如果转发失败但允许人工回复，继续执行下面的人工回复逻辑
      if (res.headersSent) return;
    } else {
      // 非流式转发，允许用户抢先回复
      console.log('[Gemini Forwarder] 非流式转发，允许用户抢先回复');

      // 创建 pending request
      const pending: PendingRequest = {
        requestId,
        request: chatRequest,
        isStream: false,
        createdAt: Date.now(),
        resolve: () => {},
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
      const forwardPromise = forwardGeminiRequest(runtimeModel, body);

      // 竞速：用户回复 vs AI 转发
      const raceResult = await Promise.race([
        responsePromise.then(content => ({ type: 'user' as const, content })),
        forwardPromise.then(result => ({ type: 'forward' as const, result })),
      ]);

      removePendingRequest(requestId);

      if (raceResult.type === 'user') {
        // 用户抢先回复
        console.log('[Manual] 用户抢先回复');
        return res.json(buildGeminiResponse(raceResult.content, modelId));
      } else {
        // AI 转发先返回
        if (!raceResult.result.success) {
          console.log(`[Gemini Forwarder] 转发失败: ${raceResult.result.error}`);
          // 如果允许人工回复，则不返回错误，而是继续等待人工回复
          const allowManualReply = model?.allowManualReply !== false;
          if (allowManualReply) {
            console.log('[Gemini Forwarder] 转发失败，但允许人工回复，切换到人工回复模式');
            // 继续执行下面的人工回复逻辑
          } else {
            return res.status(502).json({
              error: { code: 502, message: raceResult.result.error, status: 'BAD_GATEWAY' }
            });
          }
        } else {
          console.log('[Gemini Forwarder] AI 转发成功');
          return res.json(raceResult.result.response);
        }
      }
    }
  }

  // 检查是否允许人工回复
  const allowManualReply = model?.allowManualReply !== false; // 默认允许

  console.log('\n========================================');
  console.log('收到新的 generateContent 请求 [Google Gemini]');
  console.log('请求ID:', requestId);
  console.log('模型:', modelId);
  console.log('流式:', isStream);
  console.log('允许人工回复:', allowManualReply);
  console.log('消息数:', messages.length);
  console.log('当前前端连接数:', getConnectedClientsCount());
  console.log('----------------------------------------');

  messages.forEach((msg, i) => {
    const content = getContentString(msg.content);
    console.log(`  [${i + 1}] ${msg.role}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
  });
  console.log('========================================\n');

  // 如果不允许人工回复，返回错误
  if (!allowManualReply) {
    return res.status(503).json({
      error: { code: 503, message: 'Model does not support manual reply and no forwarding configured', status: 'SERVICE_UNAVAILABLE' }
    });
  }

  if (isStream) {
    // Gemini 流式响应格式
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let streamEnded = false;
    const chunks: string[] = [];

    const pending: PendingRequest = {
      requestId,
      request: chatRequest,
      isStream: true,
      createdAt: Date.now(),
      resolve: () => {},
      streamController: {
        enqueue: (content: string) => {
          if (!streamEnded) {
            chunks.push(content);
            const chunk = {
              candidates: [{
                content: { parts: [{ text: content }], role: 'model' },
                finishReason: 'STOP'
              }]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        },
        close: () => {
          if (!streamEnded) {
            streamEnded = true;
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }
      }
    };

    addPendingRequest(pending);
    broadcastRequest(pending);

    const timeout = setTimeout(() => {
      if (!streamEnded) {
        streamEnded = true;
        removePendingRequest(requestId);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }, 10 * 60 * 1000);

    req.on('close', () => {
      clearTimeout(timeout);
      removePendingRequest(requestId);
    });
  } else {
    // 非流式响应
    const pending: PendingRequest = {
      requestId,
      request: chatRequest,
      isStream: false,
      createdAt: Date.now(),
      resolve: () => {},
    };

    const responsePromise = new Promise<string>((resolve) => {
      pending.resolve = resolve;
    });

    addPendingRequest(pending);
    broadcastRequest(pending);

    const timeout = setTimeout(() => {
      removePendingRequest(requestId);
      res.json(buildGeminiResponse('请求超时，请重试', modelId));
    }, 10 * 60 * 1000);

    try {
      const content = await responsePromise;
      clearTimeout(timeout);
      res.json(buildGeminiResponse(content, modelId));
    } catch {
      clearTimeout(timeout);
      res.status(500).json({
        error: { code: 500, message: 'Internal server error', status: 'INTERNAL' }
      });
    }
  }
}

async function handleGeminiEmbedContent(
  req: Request,
  res: Response,
  modelId: string
) {
  const body = req.body;

  // 验证 API Key
  const apiKeyStr = extractApiKey(req);
  let apiKeyObj: any = null;

  if (apiKeyStr) {
    apiKeyObj = await validateApiKey(apiKeyStr);
    if (!apiKeyObj) {
      return res.status(401).json({
        error: { code: 401, message: 'Invalid or expired API key', status: 'UNAUTHENTICATED' }
      });
    }
  }

  // 验证模型是否存在
  const model = getModel(modelId);
  if (!model) {
    return res.status(404).json({
      error: { code: 404, message: `Model ${modelId} not found`, status: 'NOT_FOUND' }
    });
  }

  // 验证模型类型是否为 embedding
  if (model.type !== 'embedding') {
    return res.status(400).json({
      error: { code: 400, message: `Model ${modelId} is not an embedding model`, status: 'BAD_REQUEST' }
    });
  }

  // 提取文本内容
  let textContent = '';

  if (body.content?.parts) {
    // 标准 Gemini embedContent 格式
    textContent = body.content.parts
      .map((p: { text?: string }) => p.text || '')
      .filter((t: string) => t)
      .join('\n');
  } else if (body.text) {
    // 简化格式
    textContent = body.text;
  }

  if (!textContent) {
    return res.status(400).json({
      error: { code: 400, message: 'No text content provided', status: 'BAD_REQUEST' }
    });
  }

  console.log('\n========================================');
  console.log('收到新的 embedContent 请求 [Google Gemini]');
  console.log('模型:', modelId);
  console.log('文本长度:', textContent.length);
  console.log('当前前端连接数:', getConnectedClientsCount());
  console.log('----------------------------------------');

  const requestId = generateRequestId();

  // 创建嵌入请求
  const pending: PendingRequest = {
    requestId,
    request: { model: modelId, messages: [] },
    isStream: false,
    createdAt: Date.now(),
    resolve: () => {},
    requestType: 'embedding' as any,
  };

  const responsePromise = new Promise<string>((resolve) => {
    pending.resolve = resolve;
  });

  addPendingRequest(pending);
  broadcastRequest(pending);

  const timeout = setTimeout(() => {
    removePendingRequest(requestId);
    res.json({
      embedding: {
        values: generateEmbedding(textContent)
      }
    });
  }, 10 * 60 * 1000);

  try {
    const content = await responsePromise;
    clearTimeout(timeout);

    // 解析嵌入向量
    let embedding: number[] = [];
    try {
      const parsed = JSON.parse(content);
      embedding = parsed.embedding || parsed.values || generateEmbedding(textContent);
    } catch {
      embedding = generateEmbedding(textContent);
    }

    console.log('生成的嵌入向量维度:', embedding.length);
    console.log('========================================\n');

    res.json({
      embedding: {
        values: embedding
      }
    });
  } catch {
    clearTimeout(timeout);
    res.status(500).json({
      error: { code: 500, message: 'Internal server error', status: 'INTERNAL' }
    });
  }
}

// GET /v1beta/models - Gemini models list (包括 Actions)
router.get('/', (req: Request, res: Response) => {
  const models = getAllModels().map(m => ({
    name: `models/${m.id}`,
    displayName: m.id,
    description: m.description || `${m.id} model`,
    inputTokenLimit: m.context_length || 1048576,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ['generateContent'],
  }));

  // 添加 Actions 作为模型
  const userId = (req as any).user?.id;
  const actions = getPublicAndUserActions(userId);
  const actionModels = actions.map(action => ({
    name: `models/actions/${action.name}`,
    displayName: `actions/${action.name}`,
    description: action.description || `Action: ${action.name}`,
    inputTokenLimit: 4096,
    outputTokenLimit: 2048,
    supportedGenerationMethods: ['generateContent'],
  }));

  res.json({ models: [...models, ...actionModels] });
});

// GET /v1beta/models/:modelId(*) - Gemini model info (支持模型ID包含斜杠)
router.get('/:modelId(*)', (req: Request, res: Response) => {
  const rawModelId = decodeURIComponent(req.params.modelId as string);
  console.log('[Gemini GET] modelId from params:', rawModelId, 'originalUrl:', req.originalUrl);

  // 检查是否带有操作后缀（如 :embedContent, :generateContent）
  const actionMatch = rawModelId.match(/^(.+):(embedContent|generateContent|streamGenerateContent)$/);
  if (actionMatch) {
    const modelId = actionMatch[1];
    const action = actionMatch[2];

    // embedContent 必须用 POST
    if (action === 'embedContent') {
      return res.status(405).json({
        error: {
          code: 405,
          message: `Method GET not allowed for ${action}. Use POST /v1beta/models/${modelId}:${action}`,
          status: 'METHOD_NOT_ALLOWED'
        }
      });
    }

    // generateContent/streamGenerateContent 也需要 POST
    return res.status(405).json({
      error: {
        code: 405,
        message: `Method GET not allowed for ${action}. Use POST /v1beta/models/${modelId}:${action}`,
        status: 'METHOD_NOT_ALLOWED'
      }
    });
  }

  const model = getModel(rawModelId);

  if (!model) {
    return res.status(404).json({
      error: { code: 404, message: `Model ${rawModelId} not found`, status: 'NOT_FOUND' }
    });
  }

  res.json({
    name: `models/${model.id}`,
    displayName: model.id,
    description: model.description || `${model.id} model`,
    inputTokenLimit: model.context_length || 1048576,
    outputTokenLimit: 8192,
    supportedGenerationMethods: ['generateContent'],
  });
});

// POST /v1beta/models/* - Gemini generateContent、streamGenerateContent 和 embedContent
// 使用通配符路由支持模型 ID 包含特殊字符（如斜杠）
router.post('/*', async (req: Request, res: Response) => {
  const rawPath = req.originalUrl.split('?')[0]; // 移除查询参数
  const path = decodeURIComponent(rawPath); // 解码 URL 编码（如 %3A -> :）
  console.log('[Gemini POST] rawPath:', rawPath, 'decoded:', path);
  const parsed = parseGeminiModelPath(path);

  if (!parsed) {
    return res.status(400).json({
      error: { code: 400, message: 'Invalid Gemini API path format', status: 'BAD_REQUEST' }
    });
  }

  const { modelId, action } = parsed;
  const model = getModel(modelId);

  // 验证模型存在
  if (!model) {
    return res.status(404).json({
      error: { code: 404, message: `Model ${modelId} not found`, status: 'NOT_FOUND' }
    });
  }

  // 验证模型类型是否支持该端点
  if (!isModelSupportedByEndpoint(model, action)) {
    return res.status(400).json({
      error: { code: 400, message: `Model ${modelId} (type: ${model.type}) does not support ${action}`, status: 'BAD_REQUEST' }
    });
  }

  // 处理 embedContent 请求
  if (action === 'embedContent') {
    return handleGeminiEmbedContent(req, res, modelId);
  }

  const isStream = action === 'streamGenerateContent';
  return handleGeminiRequest(req, res, modelId, isStream);
});

export default router;
