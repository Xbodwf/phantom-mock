import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { ChatCompletionRequest, PendingRequest, Message } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest } from '../../websocket.js';
import { getModel, validateApiKey } from '../../storage.js';
import { getConnectedClientsCount } from '../../websocket.js';

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

// POST /v1/responses - OpenAI Responses API
router.post('/', async (req: Request, res: Response) => {
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

export default router;
