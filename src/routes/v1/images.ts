import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { PendingRequest, ImageGenerationRequest } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest } from '../../websocket.js';
import { getModel, validateApiKey } from '../../storage.js';
import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const router: RouterType = Router();

const uploadsDir = join(process.cwd(), 'static', 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

// 每30分钟清理一次超过1小时的临时上传文件
const CLEANUP_INTERVAL = 30 * 60 * 1000;
const FILE_MAX_AGE = 60 * 60 * 1000;
setInterval(() => {
  try {
    const now = Date.now();
    for (const f of readdirSync(uploadsDir)) {
      const fp = join(uploadsDir, f);
      try {
        const stat = existsSync(fp) ? statSync(fp) : null;
        if (stat && now - stat.mtimeMs > FILE_MAX_AGE) unlinkSync(fp);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, CLEANUP_INTERVAL);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const name = path.basename(file.originalname, ext);
    const hash = crypto.createHash('md5').update(name + Date.now()).digest('hex').slice(0, 8);
    cb(null, `edit_${hash}${ext}`);
  },
});

const upload = multer({ storage });

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

// 辅助函数：提取并校验 API Key，返回 keyObj 或发送响应并 return false
async function authenticateRequest(req: Request, res: Response): Promise<object | false | null> {
  const apiKeyStr = extractApiKey(req);
  if (apiKeyStr) {
    const apiKeyObj = await validateApiKey(apiKeyStr);
    if (!apiKeyObj) {
      res.status(401).json({
        error: {
          message: 'Invalid or expired API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        }
      });
      return false;
    }
    return apiKeyObj;
  }
  return null;
}

// 辅助函数：校验模型存在且为 image 类型，返回 model 或发送响应并 return null
function validateImageModel(modelId: string, res: Response): object | null {
  const model = getModel(modelId);
  if (!model) {
    res.status(404).json({
      error: {
        message: `Model '${modelId}' not found`,
        type: 'invalid_request_error',
        code: 'model_not_found',
      }
    });
    return null;
  }
  if (model.type !== 'image') {
    res.status(400).json({
      error: {
        message: `Model '${modelId}' (type: ${model.type}) does not support image generation`,
        type: 'invalid_request_error',
        code: 'model_type_not_supported',
      }
    });
    return null;
  }
  return model;
}

// 辅助函数：创建图片待处理请求并等待响应
async function waitForImageResponse(
  pending: PendingRequest,
  res: Response,
  timeoutMs: number = 10 * 60 * 1000
): Promise<void> {
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
    removePendingRequest(pending.requestId);
    res.json({
      created: Math.floor(Date.now() / 1000),
      data: [{ url: 'https://placeholder.com/timeout.png' }],
    });
  }, timeoutMs);

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
}

// POST /v1/images/generations - 图片生成
router.post('/generations', async (req: Request, res: Response) => {
  const body = req.body as ImageGenerationRequest;

  if (!body.prompt) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: prompt is required',
        type: 'invalid_request_error',
      }
    });
  }

  const apiKeyResult = await authenticateRequest(req, res);
  if (apiKeyResult === false) return;

  const modelId = body.model || 'dall-e-3';
  const model = validateImageModel(modelId, res);
  if (!model) return;

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

  await waitForImageResponse(pending, res);
});

// POST /v1/images/edits - 图片编辑（支持 multipart 上传 + JSON 两种格式）
router.post('/edits', upload.single('image'), async (req: Request, res: Response) => {
  const body = req.body;
  const file = req.file;

  if (!body.prompt) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: prompt is required',
        type: 'invalid_request_error',
      }
    });
  }

  const apiKeyResult = await authenticateRequest(req, res);
  if (apiKeyResult === false) return;

  const modelId = body.model || 'dall-e-2';
  const model = validateImageModel(modelId, res);
  if (!model) return;

  const requestId = generateRequestId();
  const isEdit = !!file || !!body.image;

  let referenceImageUrl: string | undefined;

  if (file) {
    referenceImageUrl = `/static/uploads/${file.filename}`;
  } else if (typeof body.image === 'string') {
    referenceImageUrl = body.image;
  }

  console.log('\n========================================');
  console.log(isEdit ? '收到新的图片编辑请求' : '收到新的图片生成请求（通过 /edits）');
  console.log('请求ID:', requestId);
  console.log('模型:', modelId);
  console.log('提示词:', body.prompt.substring(0, 100));
  console.log('数量:', body.n || 1);
  console.log('尺寸:', body.size || '1024x1024');
  if (referenceImageUrl) console.log('参考图:', referenceImageUrl);
  console.log('========================================\n');

  const imageRequest: ImageGenerationRequest = {
    model: modelId,
    prompt: isEdit ? `[编辑图片] ${body.prompt}` : body.prompt,
    n: body.n || 1,
    size: body.size || '1024x1024',
    quality: body.quality,
    style: body.style,
    response_format: body.response_format,
    user: body.user,
    reference_image_url: referenceImageUrl,
  };

  const pending: PendingRequest = {
    requestId,
    request: { model: modelId, messages: [] },
    isStream: false,
    createdAt: Date.now(),
    resolve: () => {},
    requestType: 'image',
    imageRequest,
  };

  await waitForImageResponse(pending, res);
});

export default router;
