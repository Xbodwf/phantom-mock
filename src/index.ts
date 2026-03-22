import express, { Request, Response, Application } from 'express';
import type { ChatCompletionRequest, PendingRequest, Model, Message, ApiKey } from './types.js';
import { addPendingRequest, getPendingRequest, removePendingRequest, getPendingCount } from './requestStore.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from './responseBuilder.js';
import { broadcastRequest, initWebSocket, getConnectedClientsCount, broadcastModelsUpdate } from './websocket.js';
import { createServer } from 'http';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, extname } from 'path';
import multer from 'multer';
import { formatEndpointsForConsole } from './apiEndpoints.js';
import {
  initializeDatabase,
  loadModels,
  getAllModels,
  getModel,
  addModel as storageAddModel,
  updateModel as storageUpdateModel,
  deleteModel as storageDeleteModel,
  getServerConfig,
  getSettings,
  updateSettings,
  loadApiKeys,
  getAllApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  validateApiKey,
  loadUsers,
  loadUsageRecords,
  loadInvoices,
  loadActions,
  loadWorkflows,
  createUsageRecord,
  getUserById,
  updateUser,
  getPublicAndUserActions,
} from './storage.js';
import { calculateCost, estimateTokens } from './billing.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import actionsRoutes from './routes/actions.js';
import workflowRoutes from './routes/workflows.js';
import workflowRunRoutes from './routes/workflow-runs.js';
import openaiRoutes from './routes/openai.js';
import { authMiddleware, adminMiddleware, errorHandler } from './middleware.js';
import { startTCPServer, getTCPServer } from './tcpServer.js';
import { tcpClientManager } from './tcpClient.js';

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

const app: Application = express();
const server = createServer(app);

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==================== 初始化数据 ====================
// 创建 static/models 目录（用于存储模型图标）
const staticModelsPath = join(process.cwd(), 'static', 'models');
if (!existsSync(staticModelsPath)) {
  mkdirSync(staticModelsPath, { recursive: true });
}

// 配置 multer 用于模型图标上传
const modelIconStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, staticModelsPath);
  },
  filename: (_req, file, cb) => {
    // 使用原始文件名，添加时间戳防止重名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = extname(file.originalname);
    const baseName = file.originalname.replace(ext, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  }
});
const uploadModelIcon = multer({
  storage: modelIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 限制 2MB
  fileFilter: (_req, file, cb) => {
    // 只允许图片文件
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PNG, JPG, GIF, SVG, WEBP 格式的图片'));
    }
  }
});

// ==================== 初始化数据 ====================



async function initializeApp() {

  try {

    // 初始化数据库连接

    await initializeDatabase();

    

    // 加载所有数据到内存缓存

    await loadModels();

    await loadApiKeys();

    await loadUsers();

    await loadUsageRecords();

    await loadInvoices();

    await loadActions();

    await loadWorkflows();

    

    console.log('[Server] All data loaded successfully');

  } catch (error) {

    console.error('[Server] Failed to initialize:', error);

    process.exit(1);

  }

}



// ==================== 认证路由 ====================
app.use('/api/auth', authRoutes);

// ==================== 用户路由 ====================
app.use('/api/user', authMiddleware, userRoutes);

// ==================== Actions 路由 ====================
app.use('/api', actionsRoutes);

// ==================== 工作流路由 ====================
app.use('/api', authMiddleware, workflowRoutes);
app.use('/api', authMiddleware, workflowRunRoutes);

// ==================== 管理员路由 ====================
app.use('/api/admin', authMiddleware, adminMiddleware, adminRoutes);

// ==================== API Key 认证中间件 ====================

// 从请求中提取 API Key
function extractApiKey(req: Request): string | null {
  // 1. 从 Authorization header 获取 (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  // 2. 从 x-api-key header 获取
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string') {
    return xApiKey;
  }
  return null;
}

// API Key 认证中间件
async function apiKeyAuthMiddleware(req: Request, res: Response, next: () => void) {
  const settings = await getSettings();

  // 如果全局不需要 API Key，直接放行
  if (!settings.requireApiKey) {
    return next();
  }

  // 获取请求中的模型
  const modelId = req.body?.model || req.params?.modelId;
  const model = modelId ? getModel(modelId) : null;

  // 如果模型设置为不需要 API Key，放行
  if (model && model.require_api_key === false) {
    return next();
  }

  // 验证 API Key
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'API key is required. Please provide a valid API key in Authorization header or x-api-key header.',
        type: 'authentication_error',
        code: 'missing_api_key',
      }
    });
  }

  const validKey = await validateApiKey(apiKey);
  if (!validKey) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key provided.',
        type: 'authentication_error',
        code: 'invalid_api_key',
      }
    });
  }

  // 检查权限
  if (validKey.permissions) {
    // 检查模型权限
    if (validKey.permissions.models && validKey.permissions.models.length > 0) {
      if (modelId && !validKey.permissions.models.includes(modelId)) {
        return res.status(403).json({
          error: {
            message: `API key does not have permission to access model: ${modelId}`,
            type: 'permission_error',
            code: 'model_not_allowed',
          }
        });
      }
    }
  }

  // 将 API Key 关联的用户信息附加到请求
  if (validKey.userId) {
    (req as any).user = { id: validKey.userId };
  }

  // 验证通过
  next();
}

// ==================== 管理 API ====================

// GET /api/models - 获取模型列表（所有登录用户可访问）
// GET /api/models - 获取模型列表（仅返回真实模型，不包括 Actions）
app.get('/api/models', authMiddleware, (req: Request, res: Response) => {
  const models = getAllModels();

  res.json({
    models: models,
    data: models // 兼容两种格式
  });
});

// POST /api/models - 添加模型
app.post('/api/models', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { id, owned_by, description, context_length, aliases, max_output_tokens, pricing, api_key, api_base_url, api_type, supported_features, require_api_key, icon, type } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Model ID is required' });
  }

  if (!type) {
    return res.status(400).json({ error: 'Model type is required' });
  }

  if (getModel(id)) {
    return res.status(400).json({ error: 'Model already exists' });
  }

  try {
    const newModel = await storageAddModel({
      id,
      owned_by: owned_by || 'custom',
      description: description || '',
      context_length: context_length || 4096,
      aliases,
      max_output_tokens,
      pricing,
      api_key,
      api_base_url,
      api_type,
      supported_features,
      require_api_key: require_api_key ?? true, // 默认需要 API Key
      icon,
      type,
    });
    broadcastModelsUpdate(getAllModels());
    res.json({ success: true, model: newModel });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add model' });
  }
});

// PUT /api/models/:id(*) - 更新模型（支持模型ID包含"/"）
app.put('/api/models/:id(*)', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id as string);
  const { 
    newId, owned_by, description, context_length, aliases, max_output_tokens, 
    pricing, api_key, api_base_url, api_type, forwardModelName, supported_features, 
    require_api_key, icon, allowManualReply,
    rpm, tpm, maxConcurrentRequests, concurrentQueues, allowOveruse
  } = req.body;

  try {
    // 如果要修改ID，先检查新ID是否已存在
    if (newId && newId !== id) {
      if (getModel(newId)) {
        return res.status(400).json({ error: 'Model with new ID already exists' });
      }
    }

    const updated = await storageUpdateModel(id, {
      ...(newId && newId !== id ? { id: newId } : {}), // 只在需要修改ID时才传递
      owned_by,
      description,
      context_length,
      aliases,
      max_output_tokens,
      pricing,
      api_key,
      api_base_url,
      api_type,
      forwardModelName,
      supported_features,
      require_api_key,
      icon,
      allowManualReply,
      rpm,
      tpm,
      maxConcurrentRequests,
      concurrentQueues,
      allowOveruse,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Model not found' });
    }

    broadcastModelsUpdate(getAllModels());
    res.json({ success: true, model: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update model' });
  }
});

// DELETE /api/models/:id(*) - 删除模型（支持模型ID包含"/"）
app.delete('/api/models/:id(*)', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id as string);

  try {
    const deleted = await storageDeleteModel(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Model not found' });
    }
    broadcastModelsUpdate(getAllModels());
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// ==================== 模型图标 API ====================

// GET /api/model-icons - 获取已上传的模型图标列表
app.get('/api/model-icons', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  try {
    const files = readdirSync(staticModelsPath);
    const icons = files
      .filter(file => {
        const ext = extname(file).toLowerCase();
        return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext);
      })
      .map(file => {
        const filePath = join(staticModelsPath, file);
        const stats = statSync(filePath);
        return {
          filename: file,
          url: `/static/models/${file}`,
          size: stats.size,
          createdAt: stats.mtime.getTime(),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ icons });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list icons' });
  }
});

// POST /api/model-icons/upload - 上传模型图标
app.post('/api/model-icons/upload', authMiddleware, adminMiddleware, uploadModelIcon.single('icon'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    success: true,
    icon: {
      filename: req.file.filename,
      url: `/static/models/${req.file.filename}`,
      size: req.file.size,
    },
  });
});

// DELETE /api/model-icons/:filename - 删除模型图标
app.delete('/api/model-icons/:filename', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const filename = req.params.filename as string;
  // 安全检查：防止路径遍历攻击
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = join(staticModelsPath, filename);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Icon not found' });
  }

  try {
    unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete icon' });
  }
});

// GET /api/stats - 获取统计信息
app.get('/api/stats', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  res.json({
    pendingRequests: getPendingCount(),
    connectedClients: getConnectedClientsCount(),
    totalModels: getAllModels().length,
  });
});

// GET /api/settings - 获取系统设置
app.get('/api/settings', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    const serverConfig = await getServerConfig();
    res.json({ ...settings, port: serverConfig.port });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /api/settings - 更新系统设置
app.put('/api/settings', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { port, ...settings } = req.body;

    // 更新设置
    await updateSettings(settings);

    // 如果包含端口配置，也更新服务器配置
    if (port !== undefined) {
      const { updateServerConfig } = await import('./storage.js');
      await updateServerConfig({ port });
    }

    const finalSettings = await getSettings();
    res.json({ success: true, settings: { ...finalSettings, port } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ==================== API Key 管理 ====================

// GET /api/keys - 获取所有 API Keys（不包含完整 key）
app.get('/api/keys', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const keys = getAllApiKeys().map(k => ({
      ...k,
      key: undefined, // 不返回完整 key
    }));
    res.json({ keys });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

// GET /api/keys/:id/reveal - 查看 API Key 完整内容（增加查看计数）
app.get('/api/keys/:id/reveal', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const apiKey = getAllApiKeys().find(k => k.id === id);

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // 增加查看计数
    const viewCount = (apiKey.viewCount || 0) + 1;

    if (viewCount > 3) {
      return res.status(403).json({
        error: 'View limit exceeded',
        message: '此 API Key 已超过查看次数限制（最多3次）'
      });
    }

    await updateApiKey(id, { viewCount });

    res.json({
      success: true,
      key: apiKey.key,
      viewCount,
      remainingViews: 3 - viewCount
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reveal API key' });
  }
});

// POST /api/keys - 创建新的 API Key
app.post('/api/keys', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newKey = await createApiKey(name, permissions);
    res.json({ success: true, key: newKey });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// PUT /api/keys/:id - 更新 API Key
app.put('/api/keys/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, enabled, permissions } = req.body;

    const updated = await updateApiKey(id, { name, enabled, permissions });

    if (!updated) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ success: true, key: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// DELETE /api/keys/:id - 删除 API Key
app.delete('/api/keys/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deleted = await deleteApiKey(id);

    if (!deleted) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// GET /api/server-config - 获取服务器配置
app.get('/api/server-config', async (req: Request, res: Response) => {
  try {
    const serverConfig = await getServerConfig();
    res.json(serverConfig);
  } catch (e) {
    res.status(500).json({ error: 'Failed to get server config' });
  }
});

// ==================== OpenAI API 路由 ====================

// 所有 /v1/* 路由应用 API Key 认证中间件
app.use('/v1', apiKeyAuthMiddleware);

// 使用 OpenAI 路由
app.use('/v1', openaiRoutes);

// POST /v1/responses - OpenAI Responses API
app.post('/v1/responses', async (req: Request, res: Response) => {
  const body = req.body;

  if (!body.model) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: model is required',
        type: 'invalid_request_error',
      }
    });
  }

  // 验证模型是否存在
  const modelExists = getModel(body.model);
  if (!modelExists) {
    return res.status(400).json({
      error: {
        message: `Model '${body.model}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
  }

  const requestId = generateRequestId();
  const isStream = body.stream === true;

  // 转换 input 为 messages 格式
  let messages: ChatCompletionRequest['messages'] = [];

  // input 可以是字符串或消息数组
  if (typeof body.input === 'string') {
    if (body.instructions) {
      messages.push({ role: 'system', content: body.instructions });
    }
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    messages = body.input.map((item: { role?: string; content?: string }) => {
      if (item.role === 'assistant') {
        return { role: 'assistant' as const, content: item.content || '' };
      }
      return { role: item.role || 'user' as const, content: item.content || '' };
    });
    if (body.instructions && messages[0]?.role !== 'system') {
      messages.unshift({ role: 'system', content: body.instructions });
    }
  }

  console.log('\n========================================');
  console.log('收到新的 Responses 请求 [OpenAI Responses API]');
  console.log('请求ID:', requestId);
  console.log('模型:', body.model);
  console.log('流式:', isStream);
  console.log('消息数:', messages.length);
  console.log('当前前端连接数:', getConnectedClientsCount());
  console.log('----------------------------------------');

  messages.forEach((msg, i) => {
    const content = getContentString(msg.content);
    console.log(`  [${i + 1}] ${msg.role}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
  });
  console.log('========================================\n');

  const chatRequest: ChatCompletionRequest = {
    model: body.model,
    messages,
    stream: isStream,
  };

  if (isStream) {
    // 流式响应 - 使用 Responses API 格式
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
            // Responses API 流式格式
            const responseChunk = {
              type: 'response.output_item.added',
              item: {
                type: 'message',
                id: `msg_${generateRequestId()}`,
                status: 'in_progress',
                role: 'assistant',
                content: [{ type: 'output_text', text: content }]
              }
            };
            res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);
          }
        },
        close: () => {
          if (!streamEnded) {
            streamEnded = true;
            const doneChunk = {
              type: 'response.completed',
              response: {
                id: `resp_${requestId}`,
                object: 'response',
                status: 'completed'
              }
            };
            res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
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
      res.json(buildResponsesApiResponse('请求超时，请重试', body.model, requestId));
    }, 10 * 60 * 1000);

    try {
      const content = await responsePromise;
      clearTimeout(timeout);
      res.json(buildResponsesApiResponse(content, body.model, requestId));
    } catch (e) {
      clearTimeout(timeout);
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error' }
      });
    }
  }
});


// ==================== 图片生成 API ====================

// POST /v1/images/generations - 图片生成
app.post('/v1/images/generations', async (req: Request, res: Response) => {
  const body = req.body as import('./types.js').ImageGenerationRequest;

  if (!body.prompt) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: prompt is required',
        type: 'invalid_request_error',
      }
    });
  }

  const modelId = body.model || 'dall-e-3';
  const model = getModel(modelId);

  // 验证模型存在
  if (!model) {
    return res.status(404).json({
      error: {
        message: `Model '${modelId}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
  }

  // 验证模型类型是否为 image
  if (model.type !== 'image') {
    return res.status(400).json({
      error: {
        message: `Model '${modelId}' (type: ${model.type}) does not support image generation`,
        type: 'invalid_request_error',
        code: 'model_type_not_supported',
      }
    });
  }

  const requestId = generateRequestId();
  const n = body.n || 1;
  const size = body.size || '1024x1024';

  console.log('\n========================================');
  console.log('收到新的图片生成请求');
  console.log('请求ID:', requestId);
  console.log('模型:', modelId);
  console.log('提示词:', body.prompt.substring(0, 100));
  console.log('数量:', n);
  console.log('尺寸:', size);
  console.log('质量:', body.quality || 'standard');
  console.log('========================================\n');

  // 创建待处理请求
  const pending: PendingRequest = {
    requestId,
    request: { model: modelId, messages: [] },
    isStream: false,
    createdAt: Date.now(),
    resolve: () => {},
    requestType: 'image',
    imageRequest: {
      model: modelId,
      prompt: body.prompt,
      n,
      size,
      quality: body.quality,
      style: body.style,
      response_format: body.response_format,
      user: body.user,
    },
  };

  const responsePromise = new Promise<Array<{ url?: string; b64_json?: string }>>((resolve) => {
    pending.resolve = (data: string) => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve([]);
      }
    };
  });

  addPendingRequest(pending);
  broadcastRequest(pending);

  const timeout = setTimeout(() => {
    removePendingRequest(requestId);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: [{ url: 'https://placeholder.com/timeout.png' }],
    });
  }, 10 * 60 * 1000);

  try {
    const images = await responsePromise;
    clearTimeout(timeout);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: images,
    });
  } catch {
    clearTimeout(timeout);
    res.status(500).json({
      error: { message: 'Internal server error', type: 'server_error' }
    });
  }
});

// POST /v1/images/edits - 图片编辑
app.post('/v1/images/edits', async (req: Request, res: Response) => {
  const body = req.body;

  if (!body.image || !body.prompt) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: image and prompt are required',
        type: 'invalid_request_error',
      }
    });
  }

  const requestId = generateRequestId();
  console.log('\n========================================');
  console.log('收到新的图片编辑请求');
  console.log('请求ID:', requestId);
  console.log('提示词:', body.prompt?.substring(0, 100));
  console.log('========================================\n');

  // 创建待处理请求（复用图片生成逻辑）
  const pending: PendingRequest = {
    requestId,
    request: { model: body.model || 'dall-e-2', messages: [] },
    isStream: false,
    createdAt: Date.now(),
    resolve: () => {},
    requestType: 'image',
    imageRequest: {
      model: body.model || 'dall-e-2',
      prompt: `[编辑图片] ${body.prompt}`,
      n: body.n || 1,
      size: body.size || '1024x1024',
      response_format: body.response_format,
    },
  };

  const responsePromise = new Promise<Array<{ url?: string; b64_json?: string }>>((resolve) => {
    pending.resolve = (data: string) => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve([]);
      }
    };
  });

  addPendingRequest(pending);
  broadcastRequest(pending);

  const timeout = setTimeout(() => {
    removePendingRequest(requestId);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: [{ url: 'https://placeholder.com/timeout.png' }],
    });
  }, 10 * 60 * 1000);

  try {
    const images = await responsePromise;
    clearTimeout(timeout);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: images,
    });
  } catch {
    clearTimeout(timeout);
    res.status(500).json({
      error: { message: 'Internal server error', type: 'server_error' }
    });
  }
});

// ==================== 视频生成 API ====================

// POST /v1/videos/generations - 视频生成
app.post('/v1/videos/generations', async (req: Request, res: Response) => {
  const body = req.body as import('./types.js').VideoGenerationRequest;

  if (!body.prompt) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: prompt is required',
        type: 'invalid_request_error',
      }
    });
  }

  const modelId = body.model || 'sora';
  const model = getModel(modelId);

  // 验证模型存在
  if (!model) {
    return res.status(404).json({
      error: {
        message: `Model '${modelId}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
  }

  // 验证模型类型是否为 video
  if (model.type !== 'video') {
    return res.status(400).json({
      error: {
        message: `Model '${modelId}' (type: ${model.type}) does not support video generation`,
        type: 'invalid_request_error',
        code: 'model_type_not_supported',
      }
    });
  }

  const requestId = generateRequestId();
  const duration = body.duration || 5;
  const aspectRatio = body.aspect_ratio || '16:9';

  console.log('\n========================================');
  console.log('收到新的视频生成请求');
  console.log('请求ID:', requestId);
  console.log('模型:', modelId);
  console.log('提示词:', body.prompt.substring(0, 100));
  console.log('时长:', duration, '秒');
  console.log('宽高比:', aspectRatio);
  console.log('========================================\n');

  // 创建待处理请求
  const pending: PendingRequest = {
    requestId,
    request: { model: modelId, messages: [] },
    isStream: false,
    createdAt: Date.now(),
    resolve: () => {},
    requestType: 'video',
    videoRequest: {
      model: modelId,
      prompt: body.prompt,
      size: body.size,
      duration,
      aspect_ratio: aspectRatio,
      response_format: body.response_format,
      user: body.user,
    },
  };

  const responsePromise = new Promise<Array<{ url?: string; b64_json?: string }>>((resolve) => {
    pending.resolve = (data: string) => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve([]);
      }
    };
  });

  addPendingRequest(pending);
  broadcastRequest(pending);

  const timeout = setTimeout(() => {
    removePendingRequest(requestId);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: [{ url: 'https://placeholder.com/timeout.mp4' }],
    });
  }, 30 * 60 * 1000); // 视频生成给更长超时

  try {
    const videos = await responsePromise;
    clearTimeout(timeout);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: videos,
    });
  } catch {
    clearTimeout(timeout);
    res.status(500).json({
      error: { message: 'Internal server error', type: 'server_error' }
    });
  }
});

// ==================== Anthropic API 路由 ====================

// POST /v1/messages - Anthropic Messages API
app.post('/v1/messages', async (req: Request, res: Response) => {
  const body = req.body;

  if (!body.model) {
    return res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'model is required' }
    });
  }

  // 验证模型是否存在
  const modelExists = getModel(body.model);
  if (!modelExists) {
    return res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Model '${body.model}' not found`
      }
    });
  }

  // 验证模型类型是否支持消息端点
  const supportedTypes = ['text', 'embedding', 'rerank', 'responses'];
  if (!supportedTypes.includes(modelExists.type)) {
    return res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Model '${body.model}' (type: ${modelExists.type}) does not support messages`
      }
    });
  }

  const requestId = generateRequestId();
  const isStream = body.stream === true;
  const maxTokens = body.max_tokens || 4096;

  // 转换 Anthropic 格式到 OpenAI 格式
  const messages: ChatCompletionRequest['messages'] = [];

  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }

  if (Array.isArray(body.messages)) {
    body.messages.forEach((msg: { role: string; content: string | { type: string; text: string }[] }) => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text)
          .join('\n');
      }
      messages.push({ role: msg.role as 'system' | 'user' | 'assistant' | 'tool', content });
    });
  }

  console.log('\n========================================');
  console.log('收到新的 Messages 请求 [Anthropic]');
  console.log('请求ID:', requestId);
  console.log('模型:', body.model);
  console.log('流式:', isStream);
  console.log('消息数:', messages.length);
  console.log('当前前端连接数:', getConnectedClientsCount());
  console.log('----------------------------------------');

  messages.forEach((msg, i) => {
    const content = getContentString(msg.content);
    console.log(`  [${i + 1}] ${msg.role}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
  });
  console.log('========================================\n');

  const chatRequest: ChatCompletionRequest = {
    model: body.model,
    messages,
    stream: isStream,
    max_tokens: maxTokens,
  };

  if (isStream) {
    // Anthropic 流式响应格式
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let streamEnded = false;
    const chunks: string[] = [];

    // 发送消息开始事件
    res.write(`event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: `msg_${requestId}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model: body.model,
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })}\n\n`);

    res.write(`event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })}\n\n`);

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
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: content }
            })}\n\n`);
          }
        },
        close: () => {
          if (!streamEnded) {
            streamEnded = true;
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: 'content_block_stop',
              index: 0
            })}\n\n`);

            res.write(`event: message_delta\ndata: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: chunks.join('').length }
            })}\n\n`);

            res.write(`event: message_stop\ndata: ${JSON.stringify({
              type: 'message_stop'
            })}\n\n`);
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
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
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
      res.json(buildAnthropicResponse('请求超时，请重试', body.model, requestId, maxTokens));
    }, 10 * 60 * 1000);

    try {
      const content = await responsePromise;
      clearTimeout(timeout);
      res.json(buildAnthropicResponse(content, body.model, requestId, maxTokens));
    } catch (e) {
      clearTimeout(timeout);
      res.status(500).json({
        type: 'error',
        error: { type: 'server_error', message: 'Internal server error' }
      });
    }
  }
});

// ==================== 模型类型验证函数 ====================

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

// ==================== Google Gemini API 路由 ====================

// 所有 /v1beta/* 路由应用 API Key 认证中间件
app.use('/v1beta', apiKeyAuthMiddleware);

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

// POST /v1beta/models/* - Gemini generateContent、streamGenerateContent 和 embedContent
// 使用通配符路由支持模型 ID 包含特殊字符（如斜杠）
app.post('/v1beta/models/*', async (req: Request, res: Response) => {
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

// GET /v1beta/models - Gemini models list (包括 Actions)
app.get('/v1beta/models', (req: Request, res: Response) => {
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
app.get('/v1beta/models/:modelId(*)', (req: Request, res: Response) => {
  const modelId = decodeURIComponent(req.params.modelId as string);
  console.log('[Gemini GET] modelId from params:', modelId, 'originalUrl:', req.originalUrl);
  const model = getModel(modelId);

  if (!model) {
    return res.status(404).json({
      error: { code: 404, message: `Model ${modelId} not found`, status: 'NOT_FOUND' }
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

async function handleGeminiRequest(
  req: Request,
  res: Response,
  modelId: string,
  isStream: boolean
) {
  const body = req.body;

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
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    // 配置了转发
    console.log(`[Gemini Forwarder] 转发模式：${model.api_type || 'google'} API`);
    
    // 导入转发函数
    const { forwardGeminiRequest, forwardGeminiStreamRequest } = await import('./forwarder.js');
    
    if (isStream) {
      // 流式转发
      console.log('[Gemini Forwarder] 流式转发');
      try {
        await forwardGeminiStreamRequest(model, body, res);
      } catch (error: any) {
        console.error('[Gemini Forwarder] 流式转发失败:', error.message);
        if (!res.headersSent) {
          return res.status(502).json({
            error: { code: 502, message: `转发失败: ${error.message}`, status: 'BAD_GATEWAY' }
          });
        }
      }
      return;
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
      const forwardPromise = forwardGeminiRequest(model, body);

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
          return res.status(502).json({
            error: { code: 502, message: raceResult.result.error, status: 'BAD_GATEWAY' }
          });
        }

        console.log('[Gemini Forwarder] AI 转发成功');
        return res.json(raceResult.result.response);
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
  const embeddingRequest = {
    model: modelId,
    input: textContent,
  };

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

function buildAnthropicResponse(content: string, model: string, requestId: string, maxTokens: number) {
  return {
    id: `msg_${requestId}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: content.length,
    }
  };
}

function buildResponsesApiResponse(content: string, model: string, requestId: string) {
  return {
    id: `resp_${requestId}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output: [{
      id: `msg_${requestId}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: content,
        annotations: []
      }]
    }],
    usage: {
      input_tokens: 0,
      output_tokens: content.length,
      total_tokens: content.length
    }
  };
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

// 静态文件服务 - 模型图标
const staticPath = join(process.cwd(), 'static');
if (existsSync(staticPath)) {
  app.use('/static', express.static(staticPath));
}

// 静态文件服务（前端构建产物）
// 仅在生产模式下提供静态文件
const distPath = join(process.cwd(), 'dist/frontend');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

// SPA fallback - 使用中间件处理所有未匹配的路由
app.use((req: Request, res: Response) => {
  // 如果是 API 请求但未匹配到路由，返回 404
  if (req.path.startsWith('/api/') || req.path.startsWith('/v1/') || req.path.startsWith('/v1beta/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  // 否则返回前端页面（如果存在）
  const indexPath = join(distPath, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath, { root: '/' });
  } else {
    // 开发模式下，返回提示信息
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Phantom Mock - Development Mode</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { color: #333; }
            p { color: #666; line-height: 1.6; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
          </style>
        </head>
        <body>
          <h1>Phantom Mock - Development Mode</h1>
          <p>Frontend is running in development mode.</p>
          <p>To access the frontend, please run:</p>
          <code>pnpm dev:frontend</code>
          <p>This will start the Vite development server on port 5173.</p>
          <p>The backend API is available at:</p>
          <ul>
            <li>Chat Completions: POST /v1/chat/completions</li>
            <li>Models: GET /v1/models</li>
            <li>Auth: POST /api/auth/login</li>
          </ul>
        </body>
      </html>
    `);
  }
});

// 启动服务
// ==================== 错误处理中间件 ====================
app.use(errorHandler);

async function start() {
  // 初始化数据库和数据
  await initializeApp();

  // 加载配置
  const serverConfig = await getServerConfig();
  const settings = await getSettings();
  const PORT = process.env.PORT || serverConfig.port;

  server.listen(PORT, async () => {
    initWebSocket(server);
    console.log('========================================');
    console.log('Phantom Mock 已启动');
    console.log('端口:', PORT);
    console.log('前端地址:', `http://localhost:${PORT}`);
    console.log('========================================');

    // 启动 TCP 服务器（如果启用）
    if ((settings as any).tcpServerEnabled) {
      try {
        const tcpPort = (settings as any).tcpServerPort || 7144;
        await startTCPServer(tcpPort);
        console.log(`TCP 服务器已启动，端口: ${tcpPort}`);
      } catch (error) {
        console.error('TCP 服务器启动失败:', error);
      }
    }

    // 连接 TCP 客户端（如果配置）
    if ((settings as any).tcpClients && (settings as any).tcpClients.length > 0) {
      for (const clientConfig of (settings as any).tcpClients) {
        if (clientConfig.enabled) {
          const client = tcpClientManager.addClient(
            clientConfig.name,
            clientConfig.host,
            clientConfig.port
          );
          client.connect();
          console.log(`TCP 客户端 ${clientConfig.name} 正在连接到 ${clientConfig.host}:${clientConfig.port}`);
        }
      }
    }

    console.log('========================================');
    console.log('支持的 API 端点:');
    console.log(formatEndpointsForConsole());
    console.log('========================================');
    console.log('模型数量:', getAllModels().length);
  });
}

start().catch(console.error);

export { app, server };