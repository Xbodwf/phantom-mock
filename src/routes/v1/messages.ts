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

// POST /v1/messages - Anthropic Messages API
router.post('/', async (req: Request, res: Response) => {
  // 验证 API Key
  const apiKeyStr = extractApiKey(req);
  if (apiKeyStr) {
    const apiKeyObj = await validateApiKey(apiKeyStr);
    if (!apiKeyObj) {
      return res.status(401).json({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid or expired API key' }
      });
    }
  }

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

export default router;
