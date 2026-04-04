import type { PendingRequest } from './types.js';

// 存储待处理的请求
const pendingRequests = new Map<string, PendingRequest>();

export function addPendingRequest(req: PendingRequest) {
  pendingRequests.set(req.requestId, req);
}

export function getPendingRequest(id: string): PendingRequest | undefined {
  return pendingRequests.get(id);
}

export function removePendingRequest(id: string) {
  pendingRequests.delete(id);
}

export function getAllPendingRequests(): PendingRequest[] {
  return Array.from(pendingRequests.values());
}

export function getPendingCount(): number {
  return pendingRequests.size;
}

// 重新导出 PendingRequest 类型
export type { PendingRequest } from './types.js';
