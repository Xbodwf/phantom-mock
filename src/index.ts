import express, { Request, Response, Application } from 'express';
import type { Message } from './types.js';
import { initWebSocket, getConnectedClientsCount, broadcastModelsUpdate } from './websocket.js';
import { createServer } from 'http';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { formatEndpointsForConsole } from './apiEndpoints.js';
import {
  initializeDatabase,
  loadModels,
  loadApiKeys,
  loadUsers,
  loadUsageRecords,
  loadInvoices,
  loadActions,
  loadWorkflows,
  getServerConfig,
  getSettings,
  getAllModels,
  getModel,
  validateApiKey,
} from './storage.js';
import { getDB } from './db/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import actionsRoutes from './routes/actions.js';
import workflowRoutes from './routes/workflows.js';
import workflowRunRoutes from './routes/workflow-runs.js';
import openaiRoutes from './routes/openai.js';
import apiRoutes from './routes/api/index.js';
import v1Routes from './routes/v1/index.js';
import v1betaRoutes from './routes/v1beta/index.js';
import { authMiddleware, adminMiddleware, errorHandler } from './middleware.js';
import { startTCPServer } from './tcpServer.js';
import { tcpClientManager } from './tcpClient.js';
import { initializePaymentSystem } from './payment/initialize.js';
import { createPaymentRoutes } from './routes/payment.js';
import { createAdminPaymentRoutes } from './routes/adminPayment.js';

// 辅助函数：获取消息内容的字符串表示（供各路由模块使用）
export function getContentString(content: Message['content']): string {
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

    // 初始化支付系统
    const db = getDB();
    await initializePaymentSystem(db);

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

// ==================== 支付路由 ====================
// 支付路由需要在初始化后才能使用，所以在 startServer 中动态挂载

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

  // 获取请求中的模型
  const modelId = req.body?.model || req.params?.modelId;
  const model = modelId ? getModel(modelId) : null;

  // 验证 API Key
  const apiKey = extractApiKey(req);

  if (apiKey) {
    // 如果提供了 API key，必须验证它
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
      (req as any).apiKey = validKey;
    }

    return next();
  }

  // 没有提供 API key，检查是否需要
  if (settings.requireApiKey) {
    return res.status(401).json({
      error: {
        message: 'API key is required. Please provide a valid API key in Authorization header or x-api-key header.',
        type: 'authentication_error',
        code: 'missing_api_key',
      }
    });
  }

  // 如果模型设置为需要 API Key，拒绝
  if (model && model.require_api_key === true) {
    return res.status(401).json({
      error: {
        message: 'This model requires an API key.',
        type: 'authentication_error',
        code: 'missing_api_key',
      }
    });
  }

  // 验证通过
  next();
}

// ==================== 挂载拆分后的路由 ====================

// /api/* 路由（模型、图标、统计、设置、密钥、配置等）
app.use('/api', apiRoutes);

// /v1/* 路由应用 API Key 认证中间件
app.use('/v1', apiKeyAuthMiddleware);
app.use('/v1', v1Routes);

// ==================== 主流 API 端点别名 ====================
// DeepSeek API (OpenAI 兼容格式)
app.use('/deepseek/v1', apiKeyAuthMiddleware);
app.use('/deepseek/v1', openaiRoutes);
app.use('/deepseek/chat', apiKeyAuthMiddleware);
app.use('/deepseek/chat', openaiRoutes);

// Moonshot AI (OpenAI 兼容格式)
app.use('/moonshot/v1', apiKeyAuthMiddleware);
app.use('/moonshot/v1', openaiRoutes);

// Zhipu AI / GLM (OpenAI 兼容格式)
app.use('/zhipu/v1', apiKeyAuthMiddleware);
app.use('/zhipu/v1', openaiRoutes);

// Qwen / Tongyi (OpenAI 兼容格式)
app.use('/qwen/v1', apiKeyAuthMiddleware);
app.use('/qwen/v1', openaiRoutes);
app.use('/tongyi/v1', apiKeyAuthMiddleware);
app.use('/tongyi/v1', openaiRoutes);

// Baidu Wenxin (OpenAI 兼容格式)
app.use('/wenxin/v1', apiKeyAuthMiddleware);
app.use('/wenxin/v1', openaiRoutes);

// ByteDance / Doubao (OpenAI 兼容格式)
app.use('/doubao/v1', apiKeyAuthMiddleware);
app.use('/doubao/v1', openaiRoutes);

// Minimax (OpenAI 兼容格式)
app.use('/minimax/v1', apiKeyAuthMiddleware);
app.use('/minimax/v1', openaiRoutes);

// SiliconFlow (OpenAI 兼容格式)
app.use('/siliconflow/v1', apiKeyAuthMiddleware);
app.use('/siliconflow/v1', openaiRoutes);

// Groq (OpenAI 兼容格式)
app.use('/groq/v1', apiKeyAuthMiddleware);
app.use('/groq/v1', openaiRoutes);

// Together AI (OpenAI 兼容格式)
app.use('/together/v1', apiKeyAuthMiddleware);
app.use('/together/v1', openaiRoutes);

// OpenRouter (OpenAI 兼容格式)
app.use('/openrouter/v1', apiKeyAuthMiddleware);
app.use('/openrouter/v1', openaiRoutes);

// /v1beta/* 路由应用 API Key 认证中间件 (Google Gemini)
app.use('/v1beta', apiKeyAuthMiddleware);
app.use('/v1beta', v1betaRoutes);

// ==================== 静态文件服务 ====================

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

// ==================== 错误处理中间件 ====================
app.use(errorHandler);

// ==================== 启动服务 ====================
async function start() {
  // 初始化数据库和数据
  await initializeApp();

  // 初始化支付系统后，挂载支付路由
  const { getRedeemCodeManager } = await import('./payment/initialize.js');
  const redeemCodeManager = getRedeemCodeManager();

  // 挂载支付路由
  app.use('/api/payment', createPaymentRoutes(redeemCodeManager));
  app.use('/api/admin', authMiddleware, adminMiddleware, createAdminPaymentRoutes(redeemCodeManager));

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
