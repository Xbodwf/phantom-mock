import { Router, Request, Response } from 'express';
import type { Model, PendingRequest } from '../../types.js';
import { getModel, selectProviderKeyRoundRobin, getProviderById, getNodeById } from '../../storage.js';
import { generateRequestId } from '../../responseBuilder.js';
import { isModelForwardingConfigured, shouldUseNodeForwarding } from '../../forwarder.js';
import { transmuxEmbeddingForward } from '../../transmux/connect.js';
import { addPendingRequest, removePendingRequest } from '../../requestStore.js';
import { sendRequestToNode, isNodeConnected } from '../../reverseWebSocket.js';
import { modelRateLimitMiddleware, recordModelTpmUsage } from '../../middleware.js';

const router: Router = Router();

/**
 * POST /v1/embeddings - 向量嵌入
 */
router.post('/', modelRateLimitMiddleware(), async (req: Request, res: Response) => {
 const modelId = req.body.model;

 if (!modelId) {
 return res.status(400).json({
 error: {
 message: 'model is required',
 type: 'invalid_request_error',
 },
 });
 }

 const model = getModel(modelId);
 if (!model) {
 return res.status(404).json({
 error: {
 message: `Model '${modelId}' not found`,
 type: 'invalid_request_error',
 code: 'model_not_found',
 },
 });
 }

 // 验证模型类型是否为 embedding
 if (model.type !== 'embedding') {
 return res.status(400).json({
 error: {
 message: `Model '${modelId}' (type: ${model.type}) does not support embeddings`,
 type: 'invalid_request_error',
 code: 'model_type_not_supported',
 },
 });
 }

 // 检查是否应该通过节点转发
 if (shouldUseNodeForwarding(model)) {
 const node = getNodeById(model.nodeId!);
 console.log('[Embeddings] Using node forwarding, node:', model.nodeId);

 if (!isNodeConnected(model.nodeId!)) {
 return res.status(503).json({
 error: {
 message: `Node ${model.nodeId} is not connected`,
 type: 'node_error',
 code: 'node_offline',
 }
 });
 }

 const requestId = generateRequestId();

 // 创建 pending request，包含实际的embedding请求参数
 const pending: PendingRequest = {
 requestId,
 request: { 
 model: modelId, 
 messages: [],
 },
 isStream: false,
 createdAt: Date.now(),
 resolve: () => {},
 requestType: 'embedding' as any,
 requestParams: req.body, // 包含完整的请求参数
 embeddingRequest: {
 model: modelId,
 input: req.body.input,
 encoding_format: req.body.encoding_format,
 },
 };

 const responsePromise = new Promise<string>((resolve) => {
 pending.resolve = resolve;
 });

 addPendingRequest(pending);
 sendRequestToNode(model.nodeId!, pending);

 const timeout = setTimeout(() => {
 removePendingRequest(requestId);
 res.json({
 object: 'list',
 data: [{
 object: 'embedding',
 embedding: new Array(1536).fill(0),
 index: 0,
 }],
 model: modelId,
 usage: {
 prompt_tokens: 0,
 total_tokens: 0,
 },
 id: requestId,
 });
 }, 10 * 60 * 1000);

 try {
 const content = await responsePromise;
 clearTimeout(timeout);
 removePendingRequest(requestId);

 // 尝试解析响应
 try {
 const parsed = JSON.parse(content);
 return res.json(parsed);
 } catch {
 // 如果无法解析，返回原始内容
 return res.json({
 object: 'list',
 data: [{
 object: 'embedding',
 embedding: new Array(1536).fill(0),
 index: 0,
 }],
 model: modelId,
 usage: {
 prompt_tokens: 0,
 total_tokens: 0,
 },
 id: requestId,
 });
 }
 } catch (error) {
 clearTimeout(timeout);
 removePendingRequest(requestId);
 return res.status(500).json({
 error: {
 message: 'Internal server error',
 type: 'server_error',
 code: 'internal_error',
 },
 });
 }
 }

 let runtimeModel: Model = model;

 if (model.forwardingMode === 'provider') {
 if (!model.providerId) {
 return res.status(400).json({
 error: {
 message: `Model '${modelId}' forwardingMode=provider but providerId is missing`,
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

 const hasForwarding = (model.forwardingMode === 'provider')
 || (model.forwardingMode !== 'none' && isModelForwardingConfigured(runtimeModel));

  if (hasForwarding) {
  const result = await transmuxEmbeddingForward({
  model: runtimeModel,
  entryVariant: 'embeddings',
  body: req.body,
  requestedModel: modelId,
  });
  if (!result.success) {
  const errObj = result.error?.error ?? result.error;
  const errMsg = typeof errObj === 'string' ? errObj : errObj?.message ?? '转发失败';
  let errorResponse: any;
  try {
  errorResponse = typeof result.error === 'string'
  ? JSON.parse(result.error)
  : result.error;
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

  return res.json(result.response);
  }

 res.json({
 object: 'list',
 data: [{
 object: 'embedding',
 embedding: new Array(1536).fill(0),
 index:0,
 }],
 model: modelId,
 usage: {
 prompt_tokens:0,
 total_tokens:0,
 },
 id: generateRequestId(),
 });
});

export default router;
