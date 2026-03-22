import { Router, Request, Response } from 'express';
import type { RerankRequest, RerankResponse } from '../../types.js';
import { getModel, validateApiKey, getUserById, updateUser, createUsageRecord } from '../../storage.js';
import { calculateCost } from '../../billing.js';
import { generateRequestId } from '../../responseBuilder.js';
import { extractApiKey } from './utils.js';
import axios from 'axios';

const router: Router = Router();

/**
 * POST /v1/rerank - 文档重排序
 * 支持 Cohere 风格的 Rerank API
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as RerankRequest;

  if (!body.model || !body.query || !body.documents || !Array.isArray(body.documents)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: model, query, and documents are required',
        type: 'invalid_request_error',
      }
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
      }
    });
  }

  // 验证模型类型是否为 rerank
  if (model.type !== 'rerank') {
    return res.status(400).json({
      error: {
        message: `Model '${body.model}' (type: ${model.type}) does not support reranking`,
        type: 'invalid_request_error',
        code: 'model_type_not_supported',
      }
    });
  }

  // 认证和计费
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
  console.log('查询:', body.query.substring(0, 100));
  console.log('文档数:', body.documents.length);
  console.log('========================================\n');

  // 检查是否配置了转发
  const hasForwarding = model && model.api_base_url && model.api_key;

  if (hasForwarding) {
    try {
      // 构建转发请求
      const forwardModel = model.forwardModelName || body.model;
      let url = model.api_base_url!;

      // 智能处理 URL
      if (!url.includes('/rerank')) {
        url = `${url}/rerank`;
      }

      const forwardBody = {
        model: forwardModel,
        query: body.query,
        documents: body.documents,
        top_n: body.top_n || body.documents.length,
        return_documents: body.return_documents,
        max_chunks_per_doc: body.max_chunks_per_doc,
      };

      console.log(`[Forwarder] 转发 Rerank 请求到 ${url}`);

      const response = await axios.post(url, forwardBody, {
        headers: {
          'Authorization': `Bearer ${model.api_key}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      });

      // 统一响应格式
      let rerankResponse: RerankResponse;

      if (response.data.results) {
        // 已经是标准格式
        rerankResponse = {
          id: requestId,
          results: response.data.results,
          model: body.model,
          usage: response.data.usage || { total_tokens: 0 },
        };
      } else {
        // 需要转换格式
        rerankResponse = {
          id: requestId,
          results: response.data.data || response.data,
          model: body.model,
          usage: response.data.usage || { total_tokens: 0 },
        };
      }

      // 记录使用情况
      if (userId && apiKeyId) {
        const cost = calculateCost(rerankResponse.usage.total_tokens, 0, model);
        await createUsageRecord({
          userId,
          apiKeyId,
          model: body.model,
          endpoint: 'rerank',
          promptTokens: rerankResponse.usage.total_tokens,
          completionTokens: 0,
          totalTokens: rerankResponse.usage.total_tokens,
          cost,
          timestamp: Date.now(),
          requestId,
        });

        const user = getUserById(userId);
        if (user) {
          await updateUser(userId, {
            balance: user.balance - cost,
            totalUsage: user.totalUsage + rerankResponse.usage.total_tokens,
          });
        }
      }

      return res.json(rerankResponse);
    } catch (error: any) {
      console.error('[Forwarder] Rerank 转发失败:', error.message);
      return res.status(502).json({
        error: {
          message: `转发失败: ${error.message}`,
          type: 'forwarding_error',
          code: 'forwarding_failed',
        }
      });
    }
  }

  // 没有配置转发：模拟响应
  console.log('[Manual] Rerank 模拟模式');

  // 生成模拟的重排序结果
  const topN = body.top_n || body.documents.length;
  const results = body.documents
    .map((doc, index) => ({
      index,
      relevance_score: Math.random() * 0.5 + 0.5, // 0.5 - 1.0 的随机分数
      document: body.return_documents ? doc : undefined,
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, topN);

  const rerankResponse: RerankResponse = {
    id: requestId,
    results,
    model: body.model,
    usage: {
      total_tokens: body.query.length + body.documents.reduce((sum, doc) => sum + doc.length, 0),
    },
  };

  // 记录使用情况
  if (userId && apiKeyId) {
    const cost = calculateCost(rerankResponse.usage.total_tokens, 0, model);
    await createUsageRecord({
      userId,
      apiKeyId,
      model: body.model,
      endpoint: 'rerank',
      promptTokens: rerankResponse.usage.total_tokens,
      completionTokens: 0,
      totalTokens: rerankResponse.usage.total_tokens,
      cost,
      timestamp: Date.now(),
      requestId,
    });

    const user = getUserById(userId);
    if (user) {
      await updateUser(userId, {
        balance: user.balance - cost,
        totalUsage: user.totalUsage + rerankResponse.usage.total_tokens,
      });
    }
  }

  res.json(rerankResponse);
});

export default router;
