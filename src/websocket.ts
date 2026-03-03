import { WebSocketServer, WebSocket } from 'ws';
import type { WSMessage, PendingRequest, Model } from './types.js';
import { addPendingRequest, getPendingRequest, removePendingRequest, getAllPendingRequests } from './requestStore.js';

let wss: WebSocketServer;
const clients = new Set<WebSocket>();

export function initWebSocket(server: import('http').Server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[WS] 客户端已连接，当前连接数:', clients.size);

    // 发送连接确认
    const msg: WSMessage = {
      type: 'connected',
      payload: { message: '已连接到 Fake OpenAI Server' }
    };
    ws.send(JSON.stringify(msg));

    // 发送当前待处理的请求
    const pending = getAllPendingRequests();
    if (pending.length > 0) {
      pending.forEach((req) => {
        const reqMsg: WSMessage = {
          type: 'request',
          payload: {
            requestId: req.requestId,
            data: req.request,
          }
        };
        ws.send(JSON.stringify(reqMsg));
      });
    }

    ws.on('message', (data) => {
      try {
        const msg: WSMessage = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        console.error('[WS] 解析消息失败:', e);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[WS] 客户端已断开，当前连接数:', clients.size);
    });
  });

  return wss;
}

function handleClientMessage(ws: WebSocket, msg: WSMessage) {
  if (msg.type === 'response' || msg.type === 'stream' || msg.type === 'stream_end' || msg.type === 'image_response' || msg.type === 'video_response') {
    const payload = msg.payload as { requestId: string; content: string; images?: any[]; videos?: any[] };
    const req = getPendingRequest(payload.requestId);

    if (!req) {
      console.warn('[WS] 未找到请求:', payload.requestId);
      return;
    }

    if (msg.type === 'response') {
      // 非流式响应
      req.resolve(payload.content);
      removePendingRequest(payload.requestId);
      console.log('[WS] 请求已处理:', payload.requestId);
    } else if (msg.type === 'stream') {
      // 流式响应 - 发送块
      if (req.streamController) {
        req.streamController.enqueue(payload.content);
      }
    } else if (msg.type === 'stream_end') {
      // 流式结束
      if (req.streamController) {
        req.streamController.close();
      }
      removePendingRequest(payload.requestId);
      console.log('[WS] 流式请求已完成:', payload.requestId);
    } else if (msg.type === 'image_response') {
      // 图片响应
      req.resolve(JSON.stringify(payload.images || []));
      removePendingRequest(payload.requestId);
      console.log('[WS] 图片请求已处理:', payload.requestId);
    } else if (msg.type === 'video_response') {
      // 视频响应
      req.resolve(JSON.stringify(payload.videos || []));
      removePendingRequest(payload.requestId);
      console.log('[WS] 视频请求已处理:', payload.requestId);
    }
  }
}

export function broadcastRequest(req: PendingRequest) {
  const msg: WSMessage = {
    type: 'request',
    payload: {
      requestId: req.requestId,
      data: req.request,
      requestParams: req.requestParams,
      requestType: req.requestType,
      imageRequest: req.imageRequest,
      videoRequest: req.videoRequest,
    }
  };
  const data = JSON.stringify(msg);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });

  console.log('[WS] 已广播请求到', clients.size, '个客户端');
}

export function getConnectedClientsCount(): number {
  return clients.size;
}

export function broadcastModelsUpdate(models: Model[]) {
  const msg: WSMessage = {
    type: 'models_update',
    payload: { models } as WSMessage['payload']
  };
  const data = JSON.stringify(msg);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });

  console.log('[WS] 已广播模型更新到', clients.size, '个客户端');
}
