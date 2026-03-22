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

// POST /v1/images/generations - 图片生成
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

  const body = req.body as import('../../types.js').ImageGenerationRequest;

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
router.post('/edits', async (req: Request, res: Response) => {
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

export default router;
