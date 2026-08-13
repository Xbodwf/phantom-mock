import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import type { ChatCompletionRequest, PendingRequest, Message } from '../../types.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { generateRequestId } from '../../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../../websocket.js';
import { hasReverseClients, broadcastRequestToReverseClients } from '../../reverseWebSocket.js';
import { getModel } from '../../storage.js';
import { isModelForwardingConfigured } from '../../forwarder.js';
import { transmuxForward, transmuxForwardStream } from '../../transmux/connect.js';
import { modelRateLimitMiddleware, recordModelTpmUsage } from '../../middleware.js';

const router: RouterType = Router();

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

function buildAnthropicResponse(content: string, model: string, requestId: string, outputTokens?: number) {
 return {
 id: `msg_${requestId}`,
 type: 'message',
 role: 'assistant',
 content: [{ type: 'text', text: content }],
 model,
 stop_reason: 'end_turn',
 stop_sequence: null,
 usage: {
 input_tokens:0,
 output_tokens: outputTokens ?? content.length,
 }
 };
}

function dispatchPendingRequest(pending: PendingRequest) {
 if (hasReverseClients()) {
 const sentCount = broadcastRequestToReverseClients(pending);
 if (sentCount >0) {
 console.log(`[Reverse WS] 请求 ${pending.requestId} 已发送到 ${sentCount} 个反向客户端`);
 return;
 }
 }

 broadcastRequest(pending);
}

// POST /v1/messages - Anthropic Messages API
router.post('/', modelRateLimitMiddleware(), async (req: Request, res: Response) => {
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
 console.log(` [${i +1}] ${msg.role}: ${content.substring(0,100)}${content.length >100 ? '...' : ''}`);
 });
 console.log('========================================\n');

 const chatRequest: ChatCompletionRequest = {
 model: body.model,
 messages,
 stream: isStream,
 max_tokens: body.max_tokens ||4096,
 };

 const model = getModel(body.model);
 const hasForwarding = !!(model && isModelForwardingConfigured(model));

 const requestParams = {
 temperature: body.temperature,
 top_p: body.top_p,
 max_tokens: body.max_tokens,
 presence_penalty: body.presence_penalty,
 frequency_penalty: body.frequency_penalty,
 stop: body.stop,
 n: body.n,
 user: body.user,
 };

  if (isStream) {
  // 检查是否需要转发（流式转发）
  if (hasForwarding && model) {
  console.log('[Forwarder] 流式转发模式（transmux pipeline）');
  try {
  const forwarded = await transmuxForwardStream({
  model,
  entryVariant: 'messages',
  body,
  requestedModel: body.model,
  stream: true,
  }, res);
  if (forwarded) return;
  } catch (error: any) {
  console.error('[Messages] 流式转发失败:', error.message);
  }
  // 转发失败或未配置：若已开始写流则结束；否则回退人工回复（下面继续执行）
  if (res.headersSent) return;
  if (model.allowManualReply === false) {
  return res.status(502).json({
  type: 'error',
  error: {
  type: 'streaming_forward_error',
  message: 'Streaming forward failed: no valid forwarding target'
  }
  });
  }
  console.log('[Messages] 流式转发失败，但允许人工回复，切换到人工回复模式');
  }

 // Anthropic 流式响应格式（本地处理）
 res.setHeader('Content-Type', 'text/event-stream');
 res.setHeader('Cache-Control', 'no-cache');
 res.setHeader('Connection', 'keep-alive');
 res.setHeader('X-Accel-Buffering', 'no');

 let streamEnded = false;
 const chunks: string[] = [];

 //发送消息开始事件
 res.write(`event: message_start\ndata: ${JSON.stringify({
 type: 'message_start',
 message: {
 id: `msg_${requestId}`,
 type: 'message',
 role: 'assistant',
 content: [],
 model: body.model,
 stop_reason: null,
 usage: { input_tokens:0, output_tokens:0 }
 }
 })}\n\n`);

 res.write(`event: content_block_start\ndata: ${JSON.stringify({
 type: 'content_block_start',
 index:0,
 content_block: { type: 'text', text: '' }
 })}\n\n`);

 const writeStreamStop = () => {
 if (streamEnded) return;
 streamEnded = true;

 res.write(`event: content_block_stop\ndata: ${JSON.stringify({
 type: 'content_block_stop',
 index:0
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
 };

 const pending: PendingRequest = {
 requestId,
 request: chatRequest,
 isStream: true,
 createdAt: Date.now(),
 resolve: () => {},
 requestParams,
  streamController: {
  enqueue: (content: string) => {
  if (!streamEnded) {
  chunks.push(content);
  res.write(`event: content_block_delta\ndata: ${JSON.stringify({
  type: 'content_block_delta',
  index:0,
  delta: { type: 'text_delta', text: content }
  })}\n\n`);
  }
  },
  writeRaw: (sseChunk: string) => {
  if (!streamEnded) {
  res.write(sseChunk);
  }
  },
  close: () => {
  if (!streamEnded) {
  removePendingRequest(requestId);
  writeStreamStop();
  }
  }
  }
 };

 addPendingRequest(pending);
 dispatchPendingRequest(pending);

 const timeout = setTimeout(() => {
 if (!streamEnded) {
 removePendingRequest(requestId);
 writeStreamStop();
 }
 },10 *60 *1000);

 req.on('close', () => {
 clearTimeout(timeout);
 removePendingRequest(requestId);
 });

 return;
 }

 // 非流式响应
 const pending: PendingRequest = {
 requestId,
 request: chatRequest,
 isStream: false,
 createdAt: Date.now(),
 resolve: () => {},
 requestParams,
 };

 const responsePromise = new Promise<string>((resolve) => {
 pending.resolve = resolve;
 });

 addPendingRequest(pending);
 dispatchPendingRequest(pending);

 let timeoutId: NodeJS.Timeout | null = null;
 const timeoutPromise = new Promise<{ type: 'timeout' }>((resolve) => {
 timeoutId = setTimeout(() => resolve({ type: 'timeout' }),10 *60 *1000);
 });

 try {
  if (hasForwarding && model) {
  const raceResult = await Promise.race([
  responsePromise.then((content) => ({ type: 'manual' as const, content })),
  transmuxForward({
  model,
  entryVariant: 'messages',
  body: { ...body, stream: false },
  requestedModel: body.model,
  stream: false,
  }).then((result) => ({ type: 'forward' as const, result })),
  timeoutPromise,
  ]);

  if (raceResult.type === 'manual') {
  if (timeoutId) clearTimeout(timeoutId);
  removePendingRequest(requestId);
  return res.json(buildAnthropicResponse(raceResult.content, body.model, requestId));
  }

  if (raceResult.type === 'forward') {
  if (raceResult.result.success) {
  if (timeoutId) clearTimeout(timeoutId);
  removePendingRequest(requestId);
  // transmux 已把上游响应转换为 Anthropic 格式
  return res.json(raceResult.result.response);
  }

 const fallbackResult = await Promise.race([
 responsePromise.then((content) => ({ type: 'manual' as const, content })),
 timeoutPromise,
 ]);

 if (timeoutId) clearTimeout(timeoutId);
 removePendingRequest(requestId);

 if (fallbackResult.type === 'manual') {
 return res.json(buildAnthropicResponse(fallbackResult.content, body.model, requestId));
 }

 return res.json(buildAnthropicResponse('请求超时，请重试', body.model, requestId));
 }

 if (timeoutId) clearTimeout(timeoutId);
 removePendingRequest(requestId);
 return res.json(buildAnthropicResponse('请求超时，请重试', body.model, requestId));
 }

 const result = await Promise.race([
 responsePromise.then((content) => ({ type: 'manual' as const, content })),
 timeoutPromise,
 ]);

 if (timeoutId) clearTimeout(timeoutId);
 removePendingRequest(requestId);

 if (result.type === 'manual') {
 return res.json(buildAnthropicResponse(result.content, body.model, requestId));
 }

 return res.json(buildAnthropicResponse('请求超时，请重试', body.model, requestId));
 } catch {
 if (timeoutId) clearTimeout(timeoutId);
 removePendingRequest(requestId);
 return res.status(500).json({
 type: 'error',
 error: { type: 'server_error', message: 'Internal server error' }
 });
 }
});

export default router;
