import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { ChatCompletionRequest, PendingRequest, Message, Model } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest } from '../../websocket.js';
import { getModel, validateApiKey, selectProviderKeyRoundRobin, getProviderById } from '../../storage.js';
import { getConnectedClientsCount } from '../../websocket.js';
import { isModelForwardingConfigured } from '../../forwarder.js';
import { transmuxForward, transmuxForwardStream } from '../../transmux/connect.js';
import { modelRateLimitMiddleware, recordModelTpmUsage } from '../../middleware.js';

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
 created_at: Math.floor(Date.now() /1000),
 model,
 output: [{
 id: `msg_${requestId}`,
 type: 'message',
 status: 'completed',
 role: 'assistant',
 content: [{
 type: 'output_text',
 text: content,
 annotations: [],
 }],
 }],
 usage: {
 input_tokens:0,
 output_tokens: content.length,
 total_tokens: content.length,
 },
 };
}

function buildResponsesStreamChunk(text: string) {
 return {
 type: 'response.output_item.added',
 item: {
 type: 'message',
 id: `msg_${generateRequestId()}`,
 status: 'in_progress',
 role: 'assistant',
 content: [{ type: 'output_text', text }],
 },
 };
}

function buildResponsesStreamDone(requestId: string) {
 return {
 type: 'response.completed',
 response: {
 id: `resp_${requestId}`,
 object: 'response',
 status: 'completed',
 },
 };
}

async function resolveRuntimeModel(model: Model, modelId: string, res: Response): Promise<Model | null> {
 if (model.forwardingMode !== 'provider') {
 return model;
 }

 if (!model.providerId) {
 res.status(400).json({
 error: {
 message: `Model '${modelId}' forwardingMode=provider but providerId is missing`,
 type: 'invalid_request_error',
 code: 'provider_not_configured',
 },
 });
 return null;
 }

 const selected = await selectProviderKeyRoundRobin(model.providerId);
 if (!selected) {
 res.status(502).json({
 error: {
 message: `No enabled API key available for provider '${model.providerId}'`,
 type: 'forwarding_error',
 code: 'provider_key_unavailable',
 },
 });
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

// POST /v1/responses - OpenAI Responses API
router.post('/', modelRateLimitMiddleware(), async (req: Request, res: Response) => {
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
 },
 });
 }
 }
 const body = req.body;

 if (!body.model) {
 return res.status(400).json({
 error: {
 message: 'Invalid request: model is required',
 type: 'invalid_request_error',
 },
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
 },
 });
 }

 const requestId = generateRequestId();
 const isStream = body.stream === true;

 // 转换 input 为 messages 格式
 let messages: ChatCompletionRequest['messages'] = [];

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
 const role = item.role || 'user';
 return { role: role as 'user', content: item.content || '' };
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
 console.log(` [${i +1}] ${msg.role}: ${content.substring(0,100)}${content.length >100 ? '...' : ''}`);
 });
 console.log('========================================\n');

 const chatRequest: ChatCompletionRequest = {
 model: body.model,
 messages,
 stream: false,
 };

 const runtimeModel = await resolveRuntimeModel(modelExists, body.model, res);
 if (!runtimeModel) return;

 const hasForwarding = modelExists.forwardingMode === 'none'
 ? false
 : isModelForwardingConfigured(runtimeModel);

  if (hasForwarding) {
  if (isStream) {
  let forwarded = false;
  try {
  forwarded = await transmuxForwardStream({
  model: runtimeModel,
  entryVariant: 'responses',
  body,
  requestedModel: body.model,
  stream: true,
  }, res);
  } catch (error: any) {
  console.error('[Responses] 流式转发失败:', error.message);
  }
  if (forwarded) return;
  if (res.headersSent) return;
  const allowManualReply = modelExists.allowManualReply !== false;
  if (allowManualReply) {
  console.log('[Responses] 流式转发失败，但允许人工回复，切换到人工回复模式');
  } else {
  return res.status(502).json({
  error: { message: 'Streaming forward failed: no valid forwarding target', type: 'forwarding_error', code: 'forwarding_failed' },
  });
  }
  }

  // 非流式：transmux 直接输出 Responses 格式
  const forwardResult = await transmuxForward({
  model: runtimeModel,
  entryVariant: 'responses',
  body: { ...body, stream: false },
  requestedModel: body.model,
  stream: false,
  });
  if (!forwardResult.success) {
  const errObj = forwardResult.error?.error ?? forwardResult.error;
  const errMsg = typeof errObj === 'string' ? errObj : errObj?.message ?? '转发失败';
  let errorResponse: any;
  try {
  errorResponse = typeof forwardResult.error === 'string'
  ? JSON.parse(forwardResult.error)
  : forwardResult.error;
  } catch {
  errorResponse = {
  error: {
  message: errMsg,
  type: 'forwarding_error',
  code: 'forwarding_failed',
  },
  };
  }
  if (modelExists.allowManualReply !== false) {
  console.log('[Responses] 非流式转发失败，但允许人工回复，切换到人工回复模式');
  } else {
  return res.status(502).json(errorResponse);
  }
  }

  // 转发成功：直接返回 transmux 序列化好的 Responses 格式
  if (forwardResult.success) {
  return res.json(forwardResult.response);
  }
  }

 if (isStream) {
 // 流式响应 - 使用 Responses API 格式
 res.setHeader('Content-Type', 'text/event-stream');
 res.setHeader('Cache-Control', 'no-cache');
 res.setHeader('Connection', 'keep-alive');
 res.setHeader('X-Accel-Buffering', 'no');

 let streamEnded = false;

 const pending: PendingRequest = {
 requestId,
 request: {
 ...chatRequest,
 stream: true,
 },
 isStream: true,
 createdAt: Date.now(),
 resolve: () => {},
  streamController: {
  enqueue: (content: string) => {
  if (!streamEnded) {
  res.write(`data: ${JSON.stringify(buildResponsesStreamChunk(content))}\n\n`);
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
  res.write(`data: ${JSON.stringify(buildResponsesStreamDone(requestId))}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
  }
  },
  },
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
 },10 *60 *1000);

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
 },10 *60 *1000);

 try {
 const content = await responsePromise;
 clearTimeout(timeout);
 res.json(buildResponsesApiResponse(content, body.model, requestId));
 } catch {
 clearTimeout(timeout);
 res.status(500).json({
 error: { message: 'Internal server error', type: 'server_error' },
 });
 }
 }
});

export default router;
