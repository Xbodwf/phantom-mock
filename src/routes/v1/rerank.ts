import { Router, Request, Response } from 'express';
import type { RerankRequest, RerankResponse, Model } from '../../types.js';
import {
  getModel,
  validateApiKey,
  getUserById,
  updateUser,
  createUsageRecord,
  selectProviderKeyRoundRobin,
  getUserByUid,
  getSettings,
} from '../../storage.js';
import { calculateCost } from '../../billing.js';
import { generateRequestId } from '../../responseBuilder.js';
import { extractApiKey } from './utils.js';
import { isModelForwardingConfigured } from '../../forwarder.js';
import { transmuxRerankForward } from '../../transmux/connect.js';
import { modelRateLimitMiddleware, recordModelTpmUsage } from '../../middleware.js';

const router: Router = Router();

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

/**
 * POST /v1/rerank - 文档重排序
 * 支持 Cohere 风格的 Rerank API
 */
router.post('/', modelRateLimitMiddleware(), async (req: Request, res: Response) => {
 const body = req.body as RerankRequest;

 if (!body.model || !body.query || !body.documents || !Array.isArray(body.documents)) {
 return res.status(400).json({
 error: {
 message: 'Invalid request: model, query, and documents are required',
 type: 'invalid_request_error',
 },
 });
 }

 // 检查模型是否存在
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

 // 验证模型类型是否为 rerank
 if (model.type !== 'rerank') {
 return res.status(400).json({
 error: {
 message: `Model '${body.model}' (type: ${model.type}) does not support reranking`,
 type: 'invalid_request_error',
 code: 'model_type_not_supported',
 },
 });
 }

 //认证和计费
 const apiKeyStr = extractApiKey(req);
 let apiKeyObj: any = null;
 let userId: string | undefined;
 let apiKeyId: string | undefined;

 if (apiKeyStr) {
 apiKeyObj = await validateApiKey(apiKeyStr);
 if (apiKeyObj) {
 userId = apiKeyObj.userId;
 apiKeyId = apiKeyObj.id;
 }
 }

 const requestId = generateRequestId();
 console.log('\n========================================');
 console.log('收到新的 Rerank 请求');
 console.log('请求ID:', requestId);
 console.log('模型:', body.model);
 console.log('查询:', body.query.substring(0,100));
 console.log('文档数:', body.documents.length);
 console.log('========================================\n');

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

 // 检查是否配置了转发
 const hasForwarding = (model.forwardingMode === 'provider')
 || (model.forwardingMode !== 'none' && isModelForwardingConfigured(runtimeModel));

  if (hasForwarding) {
  const forwardResult = await transmuxRerankForward({
  model: runtimeModel,
  entryVariant: 'rerank',
  body,
  requestedModel: body.model,
  });
  if (!forwardResult.success) {
  const errObj = forwardResult.error?.error ?? forwardResult.error;
  const errMsg = typeof errObj === 'string' ? errObj : errObj?.message ?? '转发失败';
  return res.status(502).json({
  error: { message: errMsg, type: 'forwarding_error', code: 'forwarding_failed' },
  });
  }

  const rerankResponse = forwardResult.response as RerankResponse;

  //记录使用情况
  if (userId && apiKeyId) {
  await recordUsageAndApplyBilling({
  userId,
  apiKeyId,
  model,
  modelName: body.model,
  endpoint: 'rerank',
  promptTokens: rerankResponse.usage.total_tokens,
  completionTokens:0,
  totalTokens: rerankResponse.usage.total_tokens,
  requestId,
  });
  }

  return res.json(rerankResponse);
  }

  // 没有配置转发：返回错误（不再伪造随机分数）
  console.log('[Rerank] 未配置转发');
  return res.status(503).json({
  error: {
  message: `Model '${body.model}' has no forwarding configured and does not support manual rerank`,
  type: 'forwarding_error',
  code: 'no_forwarding',
  },
  });
});

export default router;
