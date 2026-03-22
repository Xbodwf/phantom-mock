import { Router } from 'express';
import type { Router as RouterType } from 'express';
import modelsRouter from './models.js';
import chatRouter from './chat/index.js';
import embeddingsRouter from './embeddings.js';
import moderationsRouter from './moderations.js';
import rerankRouter from './rerank.js';
import actionsRouter from './actions/index.js';
import billingRouter from './billing/index.js';
import responsesRoutes from './responses.js';
import imagesRoutes from './images.js';
import videosRoutes from './videos.js';
import messagesRoutes from './messages.js';
import { Request, Response } from 'express';

const router: RouterType = Router();

// 模型相关路由
router.use('/models', modelsRouter);

// 聊天补全
router.use('/chat', chatRouter);

// 向量嵌入
router.use('/embeddings', embeddingsRouter);

// 内容审核
router.use('/moderations', moderationsRouter);

// 文档重排序
router.use('/rerank', rerankRouter);

// Actions 相关路由
router.use('/actions', actionsRouter);

// 计费相关路由
router.use('/me', billingRouter);
router.use('/dashboard/billing', billingRouter);
router.use('/organizations', billingRouter);

// 已弃用的端点
router.post('/completions', (req: Request, res: Response) => {
  res.status(400).json({
    error: {
      message: 'This endpoint is deprecated. Please use /v1/chat/completions',
      type: 'invalid_request_error',
    }
  });
});

// Responses API
router.use('/responses', responsesRoutes);

// 图片生成 API
router.use('/images', imagesRoutes);

// 视频生成 API
router.use('/videos', videosRoutes);

// Anthropic Messages API
router.use('/messages', messagesRoutes);

export default router;
