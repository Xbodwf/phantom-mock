import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { PendingRequest } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest } from '../../websocket.js';
import { getModel, validateApiKey } from '../../storage.js';

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

// POST /v1/videos/generations - 视频生成
router.post('/generations', async (req: Request, res: Response) => {
  // 验证 API Key
  const apiKeyStr = extractApiKey(req);
  if (apiKeyStr) {
    const apiKeyObj = await validateApiKey(apiKeyStr);
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

  const body = req.body as import('../../types.js').VideoGenerationRequest;

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

export default router;
