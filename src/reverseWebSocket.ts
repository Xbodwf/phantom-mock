import { WebSocketServer, WebSocket } from 'ws';
import type { WSMessage, PendingRequest } from './types.js';
import {
  addPendingRequest,
  getPendingRequest,
  removePendingRequest,
  getAllPendingRequests,
} from './requestStore.js';
import { extractTokenFromHeader, verifyNodeToken } from './auth.js';
import { getNodeById, getNodeByKey, touchNodeHeartbeat, markNodeOffline } from './storage.js';

let reverseWss: WebSocketServer;
let nodeWss: WebSocketServer;
const reverseClients = new Map<string, WebSocket>();
const clientCapabilities = new Map<string, string[]>();
const nodeClients = new Map<string, WebSocket>();

// 节点请求超时时间（30秒）
const NODE_REQUEST_TIMEOUT = 30000;

/**
 * 初始化反向 WebSocket 服务
 */
export function initReverseWebSocket(server: import('http').Server, path: string = '/reverse-ws') {
  reverseWss = new WebSocketServer({ noServer: true });

  console.log(`[Reverse WS] 反向 WebSocket 服务已启动，路径: ${path}`);

  // 处理升级请求
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    if (pathname === path) {
      reverseWss.handleUpgrade(request, socket, head, (ws) => {
        reverseWss.emit('connection', ws, request);
      });
    }
  });

  reverseWss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[Reverse WS] 新的反向连接来自: ${clientIp}`);

    const connectMsg: WSMessage = {
      type: 'connected',
      payload: { message: '已连接到反向 WebSocket 服务' },
    };
    ws.send(JSON.stringify(connectMsg));

    ws.on('message', (data) => {
      try {
        const msg: WSMessage = JSON.parse(data.toString());
        handleReverseClientMessage(ws, msg);
      } catch (e) {
        console.error('[Reverse WS] 解析消息失败:', e);
      }
    });

    ws.on('close', () => {
      for (const [clientId, clientWs] of reverseClients.entries()) {
        if (clientWs === ws) {
          reverseClients.delete(clientId);
          clientCapabilities.delete(clientId);
          console.log(`[Reverse WS] 反向客户端 ${clientId} 已断开`);
          break;
        }
      }
      console.log(`[Reverse WS] 反向连接已断开，当前反向客户端数: ${reverseClients.size}`);
    });

    ws.on('error', (error) => {
      console.error('[Reverse WS] WebSocket 错误:', error.message);
    });
  });

  return reverseWss;
}

/**
 * 初始化节点 WebSocket 服务
 */
export function initNodeWebSocket(server: import('http').Server, path: string = '/node/ws') {
  nodeWss = new WebSocketServer({ noServer: true });

  console.log(`[Node WS] 节点 WebSocket 服务已启动，路径: ${path}`);

  // 处理升级请求
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    if (pathname === path) {
      nodeWss.handleUpgrade(request, socket, head, (ws) => {
        nodeWss.emit('connection', ws, request);
      });
    }
  });

  nodeWss.on('connection', async (ws, req) => {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = extractTokenFromHeader(authHeader);
    const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
    const tokenFromQuery = urlObj.searchParams.get('token');
    const keyFromQuery = urlObj.searchParams.get('key');
    const nodeCredential = tokenFromHeader || tokenFromQuery || keyFromQuery;

    console.log('[Node WS] 收到节点连接请求');
    console.log('[Node WS] 凭证来源:', tokenFromHeader ? 'header' : (tokenFromQuery ? 'query:token' : (keyFromQuery ? 'query:key' : '无')));

    if (!nodeCredential) {
      console.log('[Node WS] 拒绝连接: 缺少节点凭证');
      ws.close(1008, 'Missing node credential');
      return;
    }

    const tokenPayload = verifyNodeToken(nodeCredential);
    let node = tokenPayload ? getNodeById(tokenPayload.nodeId) : getNodeByKey(nodeCredential);
    if (!node) {
      console.log('[Node WS] 拒绝连接: 无效的节点凭证');
      ws.close(1008, 'Invalid node credential');
      return;
    }

    if (tokenPayload && tokenPayload.tokenVersion !== node.tokenVersion) {
      console.log('[Node WS] 拒绝连接: 节点 token版本不匹配');
      ws.close(1008, 'Node token version mismatch');
      return;
    }

    console.log('[Node WS] 找到节点:', node.id, node.name);

    if (!node.enabled) {
      console.log('[Node WS] 拒绝连接: 节点已禁用');
      ws.close(1008, 'Node is disabled');
      return;
    }

    const previous = nodeClients.get(node.id);
    if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
      previous.close(1000, 'Replaced by newer connection');
    }

    nodeClients.set(node.id, ws);
    await touchNodeHeartbeat(node.id);

    console.log(`[Node WS] 节点 ${node.id} 已连接`);

    const ack: WSMessage = {
      type: 'node-connect-ack',
      payload: {
        success: true,
        nodeId: node.id,
        message: 'Node connected',
        serverTime: Date.now(),
      },
    };
    ws.send(JSON.stringify(ack));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'node-heartbeat') {
          await touchNodeHeartbeat(node.id);
          const heartbeatAck: WSMessage = {
            type: 'node-heartbeat',
            payload: {
              success: true,
              nodeId: node.id,
              serverTime: Date.now(),
            },
          };
          ws.send(JSON.stringify(heartbeatAck));
          return;
        }

        // 处理各种响应类型（支持 Python 客户端格式）
        if (msg.type === 'response' || msg.type === 'stream' || msg.type === 'stream_end' || 
            msg.type === 'image_response' || msg.type === 'video_response' || msg.type === 'error') {
          await touchNodeHeartbeat(node.id);
          handleReverseResponse(msg);
          return;
        }
      } catch (e) {
        console.error('[Node WS] 解析消息失败:', e);
      }
    });

    ws.on('close', async () => {
      const active = nodeClients.get(node.id);
      if (active === ws) {
        nodeClients.delete(node.id);
        await markNodeOffline(node.id);
      }
      console.log(`[Node WS] 节点 ${node.id} 已断开`);
    });

    ws.on('error', (error) => {
      console.error(`[Node WS] 节点 ${node.id} WebSocket 错误:`, error.message);
    });
  });

  return nodeWss;
}

function handleReverseClientMessage(ws: WebSocket, msg: WSMessage) {
  switch (msg.type) {
    case 'reverse-connect':
      handleReverseConnect(ws, msg);
      break;

    case 'response':
    case 'stream':
    case 'stream_end':
    case 'image_response':
    case 'video_response':
      handleReverseResponse(msg);
      break;

    case 'reverse-disconnect':
      handleReverseDisconnect(ws);
      break;

    default:
      console.log(`[Reverse WS] 收到未知消息类型: ${msg.type}`);
  }
}

function handleReverseConnect(ws: WebSocket, msg: WSMessage) {
  const payload = msg.payload as { clientId?: string; capabilities?: string[]; maxConcurrentRequests?: number };
  const clientId = payload.clientId || `reverse-client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  if (reverseClients.has(clientId)) {
    console.log(`[Reverse WS] 客户端 ${clientId} 已存在，替换旧连接`);
  }

  reverseClients.set(clientId, ws);
  clientCapabilities.set(clientId, payload.capabilities || []);

  console.log(`[Reverse WS] 反向客户端 ${clientId} 已注册，能力: ${payload.capabilities?.join(', ') || '无'}`);

  const ackMsg: WSMessage = {
    type: 'reverse-connect-ack',
    payload: {
      success: true,
      clientId,
      message: '反向连接注册成功',
    },
  };
  ws.send(JSON.stringify(ackMsg));

  const pending = getAllPendingRequests();
  if (pending.length > 0) {
    console.log(`[Reverse WS] 向新客户端 ${clientId} 发送 ${pending.length} 个待处理请求`);
    pending.forEach((req) => {
      sendRequestToReverseClient(clientId, req);
    });
  }
}

function handleReverseResponse(msg: WSMessage | any) {
  // 支持两种格式：驼峰(requestId)和下划线(request_id)
  const payload = msg.payload || msg;
  const requestId = payload.requestId || payload.request_id;
  const req = getPendingRequest(requestId);

  if (!req) {
    console.warn('[Reverse WS] 未找到请求:', requestId);
    return;
  }

  if (msg.type === 'response') {
    // Python 客户端返回格式: { type: 'response', request_id, data: { status, headers, body } }
    // 旧格式: { type: 'response', payload: { requestId, content } }
    if (payload.data && typeof payload.data === 'object') {
      // Python 客户端格式
      const responseData = payload.data;
      const body = responseData.body || '';
      if (req.streamController && responseData.status === 200) {
        // 流式响应
        try {
          req.streamController.enqueue(body);
          req.streamController.close();
        } catch (e) {
          console.error('[Reverse WS] 处理响应失败:', e);
        }
      } else {
        // 非流式响应
        req.resolve(body);
      }
      console.log('[Reverse WS] HTTP 响应已处理:', requestId, 'status:', responseData.status);
    } else {
      // 旧格式
      req.resolve(payload.content);
      console.log('[Reverse WS] 请求已处理:', requestId);
    }
    removePendingRequest(requestId);
  } else if (msg.type === 'stream') {
    if (req.streamController) {
      req.streamController.enqueue(payload.content);
    }
  } else if (msg.type === 'stream_end') {
    if (req.streamController) {
      req.streamController.close();
    }
    removePendingRequest(requestId);
    console.log('[Reverse WS] 流式请求已完成:', requestId);
  } else if (msg.type === 'error') {
    // 错误响应
    const error = payload.error || payload.data?.error || { message: 'Unknown error' };
    console.error('[Reverse WS] 节点返回错误:', error);
    if (req.streamController) {
      req.streamController.close();
    } else {
      req.resolve(JSON.stringify({ error }));
    }
    removePendingRequest(requestId);
  } else if (msg.type === 'image_response') {
    req.resolve(JSON.stringify(payload.images || []));
    removePendingRequest(requestId);
    console.log('[Reverse WS] 图片请求已处理:', requestId);
  } else if (msg.type === 'video_response') {
    req.resolve(JSON.stringify(payload.videos || []));
    removePendingRequest(requestId);
    console.log('[Reverse WS] 视频请求已处理:', requestId);
  }
}

function handleReverseDisconnect(ws: WebSocket) {
  for (const [clientId, clientWs] of reverseClients.entries()) {
    if (clientWs === ws) {
      reverseClients.delete(clientId);
      clientCapabilities.delete(clientId);
      console.log(`[Reverse WS] 反向客户端 ${clientId} 主动断开`);
      break;
    }
  }
}

export function sendRequestToReverseClient(clientId: string, req: PendingRequest): boolean {
  const ws = reverseClients.get(clientId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(`[Reverse WS] 反向客户端 ${clientId} 不可用`);
    return false;
  }

  const msg: WSMessage = {
    type: 'request',
    payload: {
      requestId: req.requestId,
      data: req.request,
      requestParams: req.requestParams,
      requestType: req.requestType,
      imageRequest: req.imageRequest,
      videoRequest: req.videoRequest,
    },
  };

  try {
    ws.send(JSON.stringify(msg));
    console.log(`[Reverse WS] 请求 ${req.requestId} 已发送到反向客户端 ${clientId}`);
    return true;
  } catch (error) {
    console.error(`[Reverse WS] 发送请求到 ${clientId} 失败:`, error);
    return false;
  }
}

export function sendRequestToNode(nodeId: string, req: PendingRequest): boolean {
  const ws = nodeClients.get(nodeId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(`[Node WS] 节点 ${nodeId} 不可用`);
    return false;
  }

  // 构建请求消息，与 websocket.ts 格式保持一致
  // 根据请求类型确定路径
  let path = '/v1/chat/completions';
  let data: any = req.request;
  
  if (req.requestType === 'embedding') {
    path = '/v1/embeddings';
    data = req.requestParams || req.request;
  } else if (req.requestType === 'image' && req.imageRequest) {
    path = '/v1/images/generations';
    data = req.imageRequest;
  } else if (req.requestType === 'video' && req.videoRequest) {
    path = '/v1/videos/generations';
    data = req.videoRequest;
  }
  
  const msg = {
    type: 'request',
    payload: {
      requestId: req.requestId,
      data: data,
      requestParams: req.requestParams,
      requestType: req.requestType,
      imageRequest: req.imageRequest,
      videoRequest: req.videoRequest,
      embeddingRequest: req.embeddingRequest,
      // 节点转发需要的额外信息
      method: 'POST',
      path: path,
      headers: {
        'Content-Type': 'application/json',
      },
      // 额外信息供内部使用
      _internal: {
        requestParams: req.requestParams,
        requestType: req.requestType,
      },
    },
  };

  try {
    ws.send(JSON.stringify(msg));
    console.log(`[Node WS] 请求 ${req.requestId} (流式: ${req.isStream}) 已发送到节点 ${nodeId}`);
    return true;
  } catch (error) {
    console.error(`[Node WS] 发送请求到 ${nodeId} 失败:`, error);
    return false;
  }
}

export function broadcastRequestToReverseClients(req: PendingRequest): number {
  const msg: WSMessage = {
    type: 'request',
    payload: {
      requestId: req.requestId,
      data: req.request,
      requestParams: req.requestParams,
      requestType: req.requestType,
      imageRequest: req.imageRequest,
      videoRequest: req.videoRequest,
      embeddingRequest: req.embeddingRequest,
    },
  };
  const data = JSON.stringify(msg);

  let sentCount = 0;
  reverseClients.forEach((ws, clientId) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
        sentCount++;
      } catch (error) {
        console.error(`[Reverse WS] 发送请求到 ${clientId} 失败:`, error);
      }
    }
  });

  console.log(`[Reverse WS] 已广播请求到 ${sentCount} 个反向客户端`);
  return sentCount;
}

export function isNodeConnected(nodeId: string): boolean {
  const ws = nodeClients.get(nodeId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}

export function getFirstAvailableReverseClient(): string | null {
  for (const [clientId, ws] of reverseClients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      return clientId;
    }
  }
  return null;
}

export function getAllReverseClientIds(): string[] {
  return Array.from(reverseClients.keys());
}

export function getReverseClientCount(): number {
  return reverseClients.size;
}

export function getReverseClientStatus(clientId: string): { connected: boolean; capabilities: string[] } {
  const ws = reverseClients.get(clientId);
  return {
    connected: ws !== undefined && ws.readyState === WebSocket.OPEN,
    capabilities: clientCapabilities.get(clientId) || [],
  };
}

export function hasReverseClients(): boolean {
  return reverseClients.size > 0;
}