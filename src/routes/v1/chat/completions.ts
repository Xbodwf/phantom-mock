import { Router, Request, Response } from 'express';
import type { ChatCompletionRequest, PendingRequest, Model } from '../../../types.js';
import { addPendingRequest, removePendingRequest } from '../../../requestStore.js';
import { buildResponse, buildStreamChunk, buildStreamDone, generateRequestId } from '../../../responseBuilder.js';
import { broadcastRequest, getConnectedClientsCount } from '../../../websocket.js';
import { hasReverseClients, broadcastRequestToReverseClients, sendRequestToNode, isNodeConnected } from '../../../reverseWebSocket.js';
import {
 getModel,
 validateApiKey,
 getUserById,
 updateUser,
 createUsageRecord,
 getAllModels,
 getActionByName,
 getAllApiKeys,
 selectProviderKeyRoundRobin,
 getProviderById,
 getNodeById,
 getUserByUid,
 getSettings,
} from '../../../storage.js';
import { calculateCost, calculateTokens } from '../../../billing.js';
import { executeAction } from '../../../actions/executor.js';
import { isModelForwardingConfigured } from '../../../forwarder.js';
import { transmuxForward, transmuxForwardStream } from '../../../transmux/connect.js';
import { getContentString, extractApiKey } from '../utils.js';
import { modelRateLimitMiddleware, recordModelTpmUsage, type AuthRequest } from '../../../middleware.js';

const router: Router = Router();

// 速率限制：读取模型配置中的 rpm / tpm / maxConcurrentRequests
router.post('/', modelRateLimitMiddleware());

/**
 * POST /v1/chat/completions - 聊天补全
 */
router.post('/', async (req: Request, res: Response) => {
 const body = req.body as ChatCompletionRequest;

 if (!body.model || !body.messages || !Array.isArray(body.messages)) {
 return res.status(400).json({
 error: {
 message: 'Invalid request: model and messages are required',
 type: 'invalid_request_error',
 },
 });
 }

 // 检查是否为 Action 模型
 if (body.model.startsWith('action/')) {
 const actionName = body.model.replace('action/', '');
 const action = getActionByName(actionName);

 if (!action) {
 return res.status(404).json({
 error: {
 message: `Action '${actionName}' not found`,
 type: 'invalid_request_error',
 code: 'action_not_found',
 },
 });
 }

 // 检查权限：只有公开的 action 或创建者才能访问
 let userId = (req as any).user?.id;
 let apiKeyId = '';

 // 如果没有 JWT，尝试从 API Key 获取
 if (!userId) {
 const apiKeyStr = extractApiKey(req);
 if (apiKeyStr) {
 const allApiKeys = getAllApiKeys();
 const apiKeyObj = allApiKeys.find(k => k.key === apiKeyStr && k.enabled);
 if (apiKeyObj) {
 userId = apiKeyObj.userId;
 apiKeyId = apiKeyObj.id;

 // 检查 API Key 的 action 权限
 const permissions = apiKeyObj.permissions;
 if (permissions?.actions && permissions.actions.length >0) {
 if (permissions.actionsMode === 'blacklist') {
 // 黑名单模式：排除指定的 actions
 if (permissions.actions.includes(action.id)) {
 return res.status(403).json({
 error: {
 message: 'This API key is not allowed to access this action',
 type: 'permission_error',
 code: 'action_permission_denied',
 },
 });
 }
 } else {
 // 白名单模式（默认）：只包含指定的 actions
 if (!permissions.actions.includes(action.id)) {
 return res.status(403).json({
 error: {
 message: 'This API key is not allowed to access this action',
 type: 'permission_error',
 code: 'action_permission_denied',
 },
 });
 }
 }
 }
 }
 }
 }

 if (!action.isPublic && action.createdBy !== userId) {
 return res.status(403).json({
 error: {
 message: `You don't have permission to access this action`,
 type: 'permission_error',
 code: 'action_permission_denied',
 },
 });
 }

 // 从 messages 中提取输入参数
 const lastMessage = body.messages[body.messages.length -1];
 let input: Record<string, any> = {};

 try {
 if (typeof lastMessage.content === 'string') {
 try {
 input = JSON.parse(lastMessage.content);
 } catch {
 input = { prompt: lastMessage.content };
 }
 }
 } catch {
 return res.status(400).json({
 error: {
 message: 'Invalid input format for Action',
 type: 'invalid_request_error',
 },
 });
 }

  try {
  console.log('[ACTION] Executing action:', action.name, 'with userId:', userId, 'apiKeyId:', apiKeyId);
  const executionResult = await executeAction(action, input,30000, userId, apiKeyId);
  console.log('[ACTION] Execution completed successfully');

  const totalTokens = (executionResult.usage?.promptTokens ||0) + (executionResult.usage?.completionTokens ||0);
  recordModelTpmUsage(body.model, totalTokens, userId);

  return res.json({
  id: generateRequestId(),
  object: 'chat.completion',
  created: Math.floor(Date.now() /1000),
  model: body.model,
  choices: [{
  index:0,
  message: {
  role: 'assistant',
  content: JSON.stringify(executionResult.result),
  },
  finish_reason: 'stop',
  }],
  usage: {
  prompt_tokens: executionResult.usage?.promptTokens ||0,
  completion_tokens: executionResult.usage?.completionTokens ||0,
  total_tokens: totalTokens,
  },
  });
 } catch (error) {
 console.error('[ACTION] Execution failed:', error);
 return res.status(400).json({
 error: {
 message: error instanceof Error ? error.message : 'Action execution failed',
 type: 'action_execution_error',
 },
 });
 }
 }

 const modelExists = getModel(body.model);
 if (!modelExists) {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' not found. Available models: ${getAllModels().map(m => m.id).join(', ')}`,
 type: 'invalid_request_error',
 code: 'model_not_found',
 },
 });
 }

 // 验证模型类型是否支持聊天端点
 const supportedTypes = ['text', 'embedding', 'rerank', 'responses'];
 if (!supportedTypes.includes(modelExists.type)) {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' (type: ${modelExists.type}) does not support chat completions`,
 type: 'invalid_request_error',
 code: 'model_type_not_supported',
 },
 });
 }

 //计费检查和权限检查
 const apiKeyStr = extractApiKey(req);
 let apiKeyObj: any = null;

 if (apiKeyStr) {
 apiKeyObj = await validateApiKey(apiKeyStr);
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

 // 检查 API Key 的模型权限
 if (apiKeyObj) {
 const permissions = apiKeyObj.permissions;
 if (permissions?.models && permissions.models.length >0) {
 if (permissions.modelsMode === 'blacklist') {
 if (permissions.models.includes(body.model)) {
 return res.status(403).json({
 error: {
 message: 'This API key is not allowed to access this model',
 type: 'permission_error',
 code: 'model_permission_denied',
 },
 });
 }
 } else {
 if (!permissions.models.includes(body.model)) {
 return res.status(403).json({
 error: {
 message: 'This API key is not allowed to access this model',
 type: 'permission_error',
 code: 'model_permission_denied',
 },
 });
 }
 }
 }
 }

 if (apiKeyObj && apiKeyObj.userId) {
 const user = getUserById(apiKeyObj.userId);
 if (user) {
 const promptTokens = calculateTokens(
 body.messages.map(m => getContentString(m.content)).join('\n'),
 body.model,
 );
 const estimatedCost = calculateCost(promptTokens,0, modelExists);

 if (user.balance < estimatedCost) {
 return res.status(402).json({
 error: {
 message: `Insufficient balance. Required: $${estimatedCost.toFixed(4)}, Available: $${user.balance.toFixed(4)}`,
 type: 'insufficient_balance',
 code: 'insufficient_balance',
 },
 });
 }
 }
 }

 const requestId = generateRequestId();
 const isStream = body.stream === true;

 console.log('\n========================================');
 console.log('收到新的 ChatCompletion 请求 [OpenAI]');
 console.log('请求ID:', requestId);
 console.log('模型:', body.model);
 console.log('流式:', isStream);
 console.log('消息数:', body.messages.length);
 console.log('当前前端连接数:', getConnectedClientsCount());
 console.log('----------------------------------------');

 body.messages.forEach((msg, i) => {
 const content = getContentString(msg.content);
 console.log(` [${i +1}] ${msg.role}: ${content.substring(0,100)}${content.length >100 ? '...' : ''}`);
 });
 console.log('========================================\n');

 await handleChatRequest(body, requestId, isStream, res, req, apiKeyObj);
});

async function recordUsageAndApplyBilling(params: {
 userId: string;
 apiKeyId: string;
 model: Model;
 modelName: string;
 endpoint: string;
 promptTokens: number;
 completionTokens: number;
 totalTokens: number;
 requestId: string;
}) {
 const {
 userId,
 apiKeyId,
 model,
 modelName,
 endpoint,
 promptTokens,
 completionTokens,
 totalTokens,
 requestId,
 } = params;

 const grossCost = calculateCost(promptTokens, completionTokens, model);
 let commissionCost =0;
 let providerUserId: string | undefined;
 let providerUid: string | undefined;
 let providerPayoutApplied = false;

 const settings = await getSettings();
 const commissionEnabled = settings.commission?.enabled === true;

 if (commissionEnabled && model.providerUid) {
 const normalizedUid = model.providerUid.startsWith('@') ? model.providerUid : `@${model.providerUid}`;
 const pureUid = normalizedUid.slice(1);
 const providerUser = getUserByUid(pureUid);

 if (providerUser && providerUser.id !== userId) {
 const rawRatio = model.commissionRatio ?? settings.commission?.defaultRatio ??0;
 const ratio = Math.max(0, Math.min(1, rawRatio));

 if (ratio >0) {
 commissionCost = grossCost * ratio;
 providerUserId = providerUser.id;
 providerUid = normalizedUid;
 providerPayoutApplied = true;

 await updateUser(providerUser.id, {
 balance: providerUser.balance + commissionCost,
 });
 }
 }
 }

 await createUsageRecord({
 userId,
 apiKeyId,
 model: modelName,
 endpoint,
 promptTokens,
 completionTokens,
 totalTokens,
 cost: grossCost,
 grossCost,
 commissionCost,
 providerUserId,
 providerUid,
 providerPayoutApplied,
 timestamp: Date.now(),
 requestId,
 });

 const user = getUserById(userId);
 if (user) {
 await updateUser(userId, {
 balance: user.balance - grossCost,
 totalUsage: user.totalUsage + totalTokens,
 });
 }
}

async function handleChatRequest(
 body: ChatCompletionRequest,
 requestId: string,
 isStream: boolean,
 res: Response,
 req: Request,
 apiKeyObj?: any,
) {
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

 let userId = apiKeyObj?.userId;
 let apiKeyId = apiKeyObj?.id;

 if (!userId) {
 const internalUserId = req.headers['x-internal-user-id'] as string;
 const internalApiKeyId = req.headers['x-internal-api-key-id'] as string;
 console.log('[handleChatRequest] Checking internal headers:', { internalUserId, internalApiKeyId, allHeaders: req.headers });
 if (internalUserId) {
 userId = internalUserId;
 apiKeyId = internalApiKeyId || 'internal';
 console.log('[handleChatRequest] Using internal headers - userId:', userId, 'apiKeyId:', apiKeyId);
 }
 }

 const model = getModel(body.model);
 if (!model) {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' not found`,
 type: 'invalid_request_error',
 code: 'model_not_found',
 },
 });
 }

 let runtimeModel: Model = model;

 if (model.forwardingMode === 'provider') {
 if (!model.providerId) {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' forwardingMode=provider but providerId is missing`,
 type: 'invalid_request_error',
 code: 'provider_not_configured',
 },
 });
 }

 const selected = await selectProviderKeyRoundRobin(model.providerId);
 if (!selected) {
 return res.status(502).json({
 error: {
 message: `No enabled API key available for provider '${model.providerId}'`,
 type: 'forwarding_error',
 code: 'provider_key_unavailable',
 },
 });
 }

 runtimeModel = {
 ...model,
 api_key: selected.key.key,
 api_base_url: selected.provider.api_base_url,
 api_type: selected.provider.api_type,
 api_url_templates: selected.provider.api_url_templates,
 };
 }

 if (model.forwardingMode === 'node') {
 if (!model.nodeId) {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' forwardingMode=node but nodeId is missing`,
 type: 'invalid_request_error',
 code: 'node_not_configured',
 },
 });
 }

 const node = getNodeById(model.nodeId);
 if (!node || !node.enabled) {
 return res.status(400).json({
 error: {
 message: `Node '${model.nodeId}' not found or disabled`,
 type: 'invalid_request_error',
 code: 'node_not_available',
 },
 });
 }

 if (!isNodeConnected(model.nodeId)) {
 const allowManualReply = model.allowManualReply !== false;
 if (!allowManualReply) {
 return res.status(502).json({
 error: {
 message: `Node '${model.nodeId}' is offline`,
 type: 'forwarding_error',
 code: 'node_offline',
 },
 });
 }
 }
 }

 // 节点模式：通过 WebSocket 转发，不使用 HTTP 转发
 const isNodeMode = model.forwardingMode === 'node' && model.nodeId && isNodeConnected(model.nodeId);
 // provider 模式下 key 选择已成功，HTTP 转发一定可用，无需再次检查缓存
 const hasHttpForwarding = (model.forwardingMode === 'provider')
 || (model.forwardingMode !== 'none'
 && model.forwardingMode !== 'node'
 && isModelForwardingConfigured(runtimeModel));

  if (hasHttpForwarding) {
  console.log(`[Forwarder] HTTP 转发模式：${runtimeModel.api_type || 'openai'} API`);

  if (isStream) {
  console.log('[Forwarder] 流式转发（transmux pipeline）');

  let forwarded = false;
  try {
  forwarded = await transmuxForwardStream({
  model: runtimeModel,
  entryVariant: 'chat-completions',
  body,
  requestedModel: body.model,
  stream: true,
  }, res);
  } catch (error: any) {
  console.error('[Forwarder] 流式转发失败:', error.message);
  }

  if (forwarded) return;
  // 转发失败或目标不可用：若已开始写流，直接结束
  if (res.headersSent) return;
  const allowManualReply = model.allowManualReply !== false;
  if (allowManualReply) {
  console.log('[Forwarder] 流式转发失败/未配置，但允许人工回复，切换到人工回复模式');
  } else {
  return res.status(502).json({
  error: {
  message: '转发失败: no valid forwarding target',
  type: 'forwarding_error',
  code: 'forwarding_failed',
  },
  });
  }
  } else {
 console.log('[Forwarder] 非流式转发，允许用户抢先回复');

 const pending: PendingRequest = {
 requestId,
 request: body,
 isStream: false,
 createdAt: Date.now(),
 resolve: () => {},
 requestParams,
 };

 const responsePromise = new Promise<string>((resolve) => {
 pending.resolve = (content: string) => {
 resolve(content);
 };
 });

 addPendingRequest(pending);

 // 优先使用反向 WebSocket 客户端
 if (hasReverseClients()) {
 const sentCount = broadcastRequestToReverseClients(pending);
 if (sentCount >0) {
 console.log(`[Reverse WS] 请求 ${requestId} 已发送到 ${sentCount} 个反向客户端`);
 } else {
 // 如果没有反向客户端可用，回退到普通广播
 broadcastRequest(pending);
 }
 } else {
 // 没有反向客户端，使用普通广播
 broadcastRequest(pending);
 }

 const forwardPromise = transmuxForward({
 model: runtimeModel,
 entryVariant: 'chat-completions',
 body: { ...body, stream: false },
 requestedModel: body.model,
 stream: false,
 });

 const raceResult = await Promise.race([
 responsePromise.then(content => ({ type: 'user' as const, content })),
 forwardPromise.then(result => ({ type: 'forward' as const, result })),
 ]);

 removePendingRequest(requestId);

  if (raceResult.type === 'user') {
  console.log('[Manual] 用户抢先回复');
  const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
  const response = buildResponse(raceResult.content, body.model, requestId, promptContent);

  recordModelTpmUsage(body.model, response.usage.total_tokens, userId);

  if (userId && apiKeyId) {
  await recordUsageAndApplyBilling({
  userId,
  apiKeyId,
  model,
  modelName: body.model,
  endpoint: 'chat',
  promptTokens: response.usage.prompt_tokens,
  completionTokens: response.usage.completion_tokens,
  totalTokens: response.usage.total_tokens,
  requestId,
  });
  }

  return res.json(response);
  }

  if (!raceResult.result.success) {
  const errObj = raceResult.result.error?.error ?? raceResult.result.error;
  const errMsg = typeof errObj === 'string' ? errObj : errObj?.message ?? '转发失败';
  console.log(`[Forwarder] 转发失败: ${errMsg}`);

  const allowManualReply = model.allowManualReply !== false;
  if (allowManualReply) {
  console.log('[Forwarder] 转发失败，但允许人工回复，切换到人工回复模式');
  } else {
  let errorResponse: any;
  try {
  errorResponse = typeof raceResult.result.error === 'string'
  ? JSON.parse(raceResult.result.error)
  : raceResult.result.error;
  } catch {
  errorResponse = {
  error: {
  message: errMsg,
  type: 'forwarding_error',
  code: 'forwarding_failed',
  },
  };
  }

  return res.status(502).json(errorResponse);
  }
  } else {
  console.log('[Forwarder] AI 转发成功');

  const forwardResponse = raceResult.result.response;
  const totalFwdTokens = (forwardResponse.usage?.prompt_tokens ||0) + (forwardResponse.usage?.completion_tokens ||0);
  recordModelTpmUsage(body.model, totalFwdTokens, userId);

  if (userId && apiKeyId) {
  await recordUsageAndApplyBilling({
  userId,
  apiKeyId,
  model,
  modelName: body.model,
  endpoint: 'chat',
  promptTokens: forwardResponse.usage?.prompt_tokens ||0,
  completionTokens: forwardResponse.usage?.completion_tokens ||0,
  totalTokens: totalFwdTokens,
  requestId,
  });
  }

  return res.json(forwardResponse);
  }
 }
 }

 console.log('[Manual]纯手动模拟模式，等待前端用户回复...');

 if (isStream) {
 res.setHeader('Content-Type', 'text/event-stream');
 res.setHeader('Cache-Control', 'no-cache');
 res.setHeader('Connection', 'keep-alive');
 res.setHeader('X-Accel-Buffering', 'no');

 let streamEnded = false;

 const pending: PendingRequest = {
 requestId,
 request: body,
 isStream: true,
 createdAt: Date.now(),
 resolve: () => {},
  streamController: {
  enqueue: (content: string) => {
  if (!streamEnded) {
  res.write(buildStreamChunk(requestId, body.model, content, false));
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
  res.write(buildStreamChunk(requestId, body.model, '', false, true));
  res.write(buildStreamDone());
  res.end();
  }
  },
  },
 requestParams,
 };

 addPendingRequest(pending);

 if (model.forwardingMode === 'node' && model.nodeId && isNodeConnected(model.nodeId)) {
 const sent = sendRequestToNode(model.nodeId, pending);
 if (!sent) {
 removePendingRequest(requestId);
 if (model.allowManualReply === false) {
 return res.status(502).json({
 error: {
 message: `Node '${model.nodeId}' is unavailable`,
 type: 'forwarding_error',
 code: 'node_offline',
 },
 });
 }
 broadcastRequest(pending);
 }
 } else {
 broadcastRequest(pending);
 }

 const timeout = setTimeout(() => {
 if (!streamEnded) {
 streamEnded = true;
 removePendingRequest(requestId);
 res.write(buildStreamDone());
 res.end();
 }
 },10 *60 *1000);

 res.on('close', () => {
 clearTimeout(timeout);
 removePendingRequest(requestId);
 });
 } else {
 const pending: PendingRequest = {
 requestId,
 request: body,
 isStream: false,
 createdAt: Date.now(),
 resolve: () => {},
 requestParams,
 };

 const responsePromise = new Promise<string>((resolve) => {
 pending.resolve = resolve;
 });

 addPendingRequest(pending);

 if (model.forwardingMode === 'node' && model.nodeId && isNodeConnected(model.nodeId)) {
 const sent = sendRequestToNode(model.nodeId, pending);
 if (!sent) {
 removePendingRequest(requestId);
 if (model.allowManualReply === false) {
 return res.status(502).json({
 error: {
 message: `Node '${model.nodeId}' is unavailable`,
 type: 'forwarding_error',
 code: 'node_offline',
 },
 });
 }
 broadcastRequest(pending);
 }
 } else {
 broadcastRequest(pending);
 }

 const timeout = setTimeout(() => {
 removePendingRequest(requestId);
 const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
 res.json(buildResponse('请求超时，请重试', body.model, requestId, promptContent));
 },10 *60 *1000);

  try {
    const content = await responsePromise;
    clearTimeout(timeout);

    // 检查是否是工具调用响应（由 tool_call WS 消息产生）
    if (content.startsWith('{') && content.includes('"tool_calls"')) {
      try {
        const toolCallResponse = JSON.parse(content);
        res.json(toolCallResponse);
        return;
      } catch {}
    }

    const promptContent = body.messages.map(m => getContentString(m.content)).join('\n');
    const response = buildResponse(content, body.model, requestId, promptContent);

    recordModelTpmUsage(body.model, response.usage.total_tokens, userId);

    if (userId && apiKeyId) {
      await recordUsageAndApplyBilling({
        userId,
        apiKeyId,
        model,
        modelName: body.model,
        endpoint: 'chat',
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
        requestId,
      });
    }

    res.json(response);
  } catch {
  clearTimeout(timeout);
  res.status(500).json({
  error: { message: 'Internal server error', type: 'server_error' },
  });
  }
 }
}

export default router;
