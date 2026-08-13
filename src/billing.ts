import type { Model, UsageRecord } from './types.js';
import { Tiktoken, encodingForModel } from 'js-tiktoken';

// Token 编码器缓存
const encoderCache = new Map<string, Tiktoken>();

/**
 * 获取模型的 token 编码器
 */
function getEncoder(modelId: string): Tiktoken {
  if (encoderCache.has(modelId)) {
    return encoderCache.get(modelId)!;
  }

  try {
    // 尝试为特定模型获取编码器
    const encoder = encodingForModel(modelId as any);
    encoderCache.set(modelId, encoder);
    return encoder;
  } catch {
    // 如果模型不支持，使用 cl100k_base（GPT-4/GPT-3.5 的编码）
    try {
      const encoder = encodingForModel('gpt-4');
      encoderCache.set(modelId, encoder);
      return encoder;
    } catch {
      // 如果还是失败，返回 null，使用估算方法
      return null as any;
    }
  }
}

/**
 * 精确计算 token 数量
 */
export function calculateTokens(text: string, modelId?: string): number {
  if (!text) return 0;

  // 如果提供了模型 ID，尝试使用精确计数
  if (modelId) {
    try {
      const encoder = getEncoder(modelId);
      if (encoder) {
        const tokens = encoder.encode(text);
        return tokens.length;
      }
    } catch (error) {
      console.warn(`[Billing] 精确计数失败，使用估算: ${error}`);
    }
  }

  // 回退到估算方法
  return estimateTokens(text);
}

/**
 * 估算 token 数量（简单方法）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 改进的估算方法：
  // - 英文：平均 4 个字符 = 1 token
  // - 中文：平均 1.5 个字符 = 1 token
  // - 代码：平均 3 个字符 = 1 token

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;

  // 中文字符按 1.5:1 计算，其他字符按 4:1 计算
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  const otherTokens = Math.ceil(otherChars / 4);

  return chineseTokens + otherTokens;
}

/**
 * 计算费用
 */
export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  model: Model,
  cacheHitTokens: number = 0
): number {
  if (!model.pricing) {
    return 0;
  }

  const pricingType = model.pricing.type || 'token';

  if (pricingType === 'request') {
    return model.pricing.perRequest || 0;
  }

  if (pricingType === 'tiered' && model.pricing.tieredPricing) {
    const tieredPricing = model.pricing.tieredPricing;
    let baseTokens: number;

    switch (tieredPricing.baseOn) {
      case 'input':
        baseTokens = promptTokens;
        break;
      case 'output':
        baseTokens = completionTokens;
        break;
      case 'total':
      default:
        baseTokens = promptTokens + completionTokens;
        break;
    }

    const tiers = tieredPricing.tiers.sort((a, b) => a.min - b.min);
    let matchedTier = tiers[0];

    for (const tier of tiers) {
      if (baseTokens >= tier.min && (tier.max === null || baseTokens <= tier.max)) {
        matchedTier = tier;
        break;
      }
    }

    // 新版阶梯计费分别计算输入和输出，旧版仍支持单一 pricePerToken。
    const inputMultiplier = matchedTier.inputMultiplier ?? 1;
    const outputMultiplier = matchedTier.outputMultiplier ?? 1;
    const unit = model.pricing.unit || 'K';
    const divisor = unit === 'M' ? 1000000 : 1000;
    const legacyPrice = matchedTier.pricePerToken;

    if (legacyPrice !== undefined) {
      const totalTokens = promptTokens + completionTokens;
      return (totalTokens * legacyPrice) / divisor;
    }

    const cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens);
    const inputPrice = model.pricing.input || 0;
    const cacheReadPrice = model.pricing.cacheRead ?? inputPrice;
    const outputPrice = model.pricing.output || 0;
    return (
      (cacheMissTokens * inputPrice * inputMultiplier +
        cacheHitTokens * cacheReadPrice * inputMultiplier +
        completionTokens * outputPrice * outputMultiplier) / divisor
    );
  }

  const unit = model.pricing.unit || 'K';
  const divisor = unit === 'M' ? 1000000 : 1000;

  // 区分缓存未命中（input）和缓存命中（cacheRead）的 prompt 费用
  const cacheMissTokens = promptTokens - cacheHitTokens;
  const cacheMissCost = (cacheMissTokens * (model.pricing.input || 0)) / divisor;
  const cacheHitCost = (cacheHitTokens * (model.pricing.cacheRead ?? model.pricing.input ?? 0)) / divisor;
  const outputCost = (completionTokens * (model.pricing.output || 0)) / divisor;

  return cacheMissCost + cacheHitCost + outputCost;
}

/**
 * 创建使用记录
 */
export function createUsageRecord(
  userId: string,
  apiKeyId: string,
  model: string,
  endpoint: string,
  promptTokens: number,
  completionTokens: number,
  cost: number,
  requestId: string
): UsageRecord {
  return {
    id: generateId(),
    userId,
    apiKeyId,
    model,
    endpoint,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost,
    timestamp: Date.now(),
    requestId,
  };
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
