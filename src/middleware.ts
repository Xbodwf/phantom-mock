import { Request, Response, NextFunction } from 'express';
import type { ApiKey, User } from './types.js';
import { verifyToken, extractTokenFromHeader } from './auth.js';
import { validateApiKey, getModel } from './storage.js';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
  apiKey?: ApiKey;
}

function extractApiKey(req: Request, endpoint?: string): { key: string; source: string } | null {
  let sources: string[] = [];

  if (endpoint === 'openai') {
    sources = ['authorization', 'x-api-key', 'x-goog-api-key'];
  } else if (endpoint === 'google') {
    sources = ['x-goog-api-key', 'authorization', 'x-api-key'];
  } else {
    sources = ['authorization', 'x-api-key', 'x-goog-api-key'];
  }

  for (const source of sources) {
    if (source === 'authorization') {
      const auth = req.headers.authorization as string;
      if (auth) {
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
        if (token && token.startsWith('sk-')) {
          return { key: token, source: 'authorization' };
        }
      }
    } else if (source === 'x-api-key') {
      const key = req.headers['x-api-key'] as string;
      if (key) return { key, source: 'x-api-key' };
    } else if (source === 'x-goog-api-key') {
      const key = req.headers['x-goog-api-key'] as string;
      if (key) return { key, source: 'x-goog-api-key' };
    }
  }

  return null;
}

function getEndpointType(path: string): string | undefined {
  if (path.includes('/openai') || path.includes('/v1/chat')) return 'openai';
  if (path.includes('/google') || path.includes('/gemini')) return 'google';
  return undefined;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    let token: string | null = extractTokenFromHeader(req.headers.authorization);
    if (!token && req.query.token) token = req.query.token as string;
    if (!token) return res.status(401).json({ error: 'Missing authorization token' });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

    req.userId = payload.userId;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export async function apiKeyAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const endpoint = getEndpointType(req.path);
    const apiKeyInfo = extractApiKey(req, endpoint);
    if (!apiKeyInfo) return res.status(401).json({ error: 'Missing API key' });

    const key = await validateApiKey(apiKeyInfo.key);
    if (!key) return res.status(401).json({ error: 'Invalid API key' });

    req.apiKey = key;
    req.userId = key.userId;
    next();
  } catch {
    res.status(401).json({ error: 'API key validation failed' });
  }
}

export async function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        req.userId = payload.userId;
        req.user = payload;
      }
    }
  } catch {}
  next();
}

// ==================== 模型驱动的用户级速率限制 ====================
//
// 所有配置在 Model 上:
//   model.rpm                  → 单用户每分钟请求数上限
//   model.tpm                  → 单用户每分钟 token 数上限
//   model.maxConcurrentRequests → 单用户并发请求数上限
//
// 三个维度均按 (modelId, userId) 独立追踪。

interface ModelUserTracker {
  rpmTimestamps: number[];
  tpmRecords: Array<{ timestamp: number; count: number }>;
}

const trackers = new Map<string, ModelUserTracker>();

const activeConcurrentRequests = new Map<string, Set<string>>();

function trackerKey(modelId: string, userId: string): string {
  return `${modelId}:${userId}`;
}

function cleanupBefore(timestamps: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  return timestamps.filter(t => t > cutoff);
}

function ensureTracker(key: string): ModelUserTracker {
  if (!trackers.has(key)) {
    trackers.set(key, { rpmTimestamps: [], tpmRecords: [] });
  }
  return trackers.get(key)!;
}

/**
 * 模型级速率限制中间件（单用户维度）
 *
 * 从 req.body.model 读取模型名，按模型配置对当前用户施加速度限制：
 *   - RPM：请求到达时检查
 *   - 并发数：请求到达时检查，finish/close 时释放
 *   - TPM：不在此处拦截（因为不知道 token 数），由 recordModelTpmUsage() 记录
 */
export function modelRateLimitMiddleware() {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const modelId = (req.body as any)?.model;
    if (!modelId) return next();

    const model = getModel(modelId);
    if (!model) return next();

    const userId = req.userId || req.ip || 'anonymous';
    const key = trackerKey(modelId, userId);
    const now = Date.now();
    const windowMs = 60000;

    // 1) RPM 检查
    const rpm = model.rpm;
    if (rpm && rpm > 0) {
      const t = ensureTracker(key);
      t.rpmTimestamps = cleanupBefore(t.rpmTimestamps, windowMs);
      if (t.rpmTimestamps.length >= rpm) {
        return res.status(429).json({
          error: {
            message: `Rate limit exceeded for model '${modelId}': max ${rpm} requests per minute per user`,
            type: 'rate_limit_error',
            code: 'user_rpm_exceeded',
          },
        });
      }
      t.rpmTimestamps.push(now);
    }

    // 2) 并发检查
    const maxConcurrent = model.maxConcurrentRequests;
    if (maxConcurrent && maxConcurrent > 0) {
      const reqId = `${now}-${Math.random().toString(36).slice(2, 8)}`;
      if (!activeConcurrentRequests.has(key)) {
        activeConcurrentRequests.set(key, new Set());
      }
      const active = activeConcurrentRequests.get(key)!;
      if (active.size >= maxConcurrent) {
        return res.status(429).json({
          error: {
            message: `Too many concurrent requests for model '${modelId}': max ${maxConcurrent}`,
            type: 'rate_limit_error',
            code: 'user_concurrent_exceeded',
          },
        });
      }
      active.add(reqId);
      const cleanup = () => {
        active.delete(reqId);
        if (active.size === 0) activeConcurrentRequests.delete(key);
      };
      res.on('finish', cleanup);
      res.on('close', cleanup);
    }

    next();
  };
}

/**
 * 记录单用户的模型 TPM 使用量（在响应完成后调用）
 */
export function recordModelTpmUsage(modelId: string, tokenCount: number, userId?: string): void {
  const model = getModel(modelId);
  if (!model) return;

  const tpm = model.tpm;
  if (!tpm || tpm <= 0) return;

  const uid = userId || 'anonymous';
  const key = trackerKey(modelId, uid);
  const t = ensureTracker(key);
  const cutoff = Date.now() - 60000;
  t.tpmRecords = t.tpmRecords.filter(e => e.timestamp > cutoff);
  t.tpmRecords.push({ timestamp: Date.now(), count: tokenCount });
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.status(500).json({ error: 'Internal server error' });
}
