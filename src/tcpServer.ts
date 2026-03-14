import net from 'net';
import { EventEmitter } from 'events';

/**
 * TCP 服务器 - 接收远程客户端的反向连接
 */
export class TCPServer extends EventEmitter {
  private server: net.Server | null = null;
  private port: number;
  private clients: Map<string, net.Socket> = new Map();
  private messageBuffers: Map<net.Socket, string> = new Map();

  constructor(port: number) {
    super();
    this.port = port;
  }

  /**
   * 启动服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        console.error('[TCP Server] 服务器错误:', error);
        this.emit('error', error);
        reject(error);
      });

      this.server.listen(this.port, () => {
        console.log(`[TCP Server] 服务器已启动，监听端口 ${this.port}`);
        this.emit('listening');
        resolve();
      });
    });
  }

  /**
   * 处理新连接
   */
  private handleConnection(socket: net.Socket): void {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP Server] 新连接: ${clientId}`);

    this.clients.set(clientId, socket);
    this.messageBuffers.set(socket, '');

    socket.on('data', (data) => {
      this.handleData(socket, data);
    });

    socket.on('error', (error) => {
      console.error(`[TCP Server] 客户端 ${clientId} 错误:`, error.message);
    });

    socket.on('close', () => {
      console.log(`[TCP Server] 客户端 ${clientId} 已断开`);
      this.clients.delete(clientId);
      this.messageBuffers.delete(socket);
      this.emit('client_disconnected', clientId);
    });

    this.emit('client_connected', { clientId, socket });
  }

  /**
   * 处理接收到的数据
   */
  private handleData(socket: net.Socket, data: Buffer): void {
    let buffer = this.messageBuffers.get(socket) || '';
    buffer += data.toString();

    // 按行分割消息
    const messages = buffer.split('\n');
    buffer = messages.pop() || '';
    this.messageBuffers.set(socket, buffer);

    for (const messageStr of messages) {
      if (!messageStr.trim()) continue;

      try {
        const message = JSON.parse(messageStr);
        this.emit('message', { socket, message });
        this.handleMessage(socket, message);
      } catch (error) {
        console.error('[TCP Server] 解析消息失败:', error);
      }
    }
  }

  /**
   * 处理消息
   */
  private handleMessage(socket: net.Socket, message: any): void {
    const { type, payload } = message;

    switch (type) {
      case 'handshake':
        // 响应握手
        this.sendToSocket(socket, {
          type: 'handshake_ack',
          payload: {
            serverType: 'phantom-mock',
            version: '1.0.0',
            timestamp: Date.now(),
          },
        });
        console.log('[TCP Server] 握手成功:', payload);
        break;

      case 'pong':
        // 心跳响应
        break;

      case 'response':
        // 处理响应
        this.emit('response', payload);
        break;

      default:
        console.log(`[TCP Server] 收到未知消息类型: ${type}`);
    }
  }

  /**
   * 发送消息到指定 socket
   */
  private sendToSocket(socket: net.Socket, message: any): boolean {
    if (socket.destroyed) {
      return false;
    }

    try {
      const messageStr = JSON.stringify(message) + '\n';
      socket.write(messageStr);
      return true;
    } catch (error) {
      console.error('[TCP Server] 发送消息失败:', error);
      return false;
    }
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(message: any): void {
    for (const [clientId, socket] of this.clients) {
      this.sendToSocket(socket, message);
    }
  }

  /**
   * 发送请求到指定客户端
   */
  sendRequest(clientId: string, requestId: string, request: any): boolean {
    const socket = this.clients.get(clientId);
    if (!socket) {
      console.error(`[TCP Server] 客户端 ${clientId} 不存在`);
      return false;
    }

    return this.sendToSocket(socket, {
      type: 'request',
      payload: {
        requestId,
        request,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * 发送心跳到所有客户端
   */
  sendHeartbeat(): void {
    this.broadcast({
      type: 'ping',
      payload: { timestamp: Date.now() },
    });
  }

  /**
   * 获取连接的客户端列表
   */
  getClients(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 停止服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      // 断开所有客户端
      for (const [clientId, socket] of this.clients) {
        socket.destroy();
      }
      this.clients.clear();
      this.messageBuffers.clear();

      this.server.close(() => {
        console.log('[TCP Server] 服务器已停止');
        this.emit('stopped');
        resolve();
      });
    });
  }
}

// 全局 TCP 服务器实例
let tcpServerInstance: TCPServer | null = null;

/**
 * 获取 TCP 服务器实例
 */
export function getTCPServer(port: number = 7144): TCPServer {
  if (!tcpServerInstance) {
    tcpServerInstance = new TCPServer(port);
  }
  return tcpServerInstance;
}

/**
 * 启动 TCP 服务器
 */
export async function startTCPServer(port: number = 7144): Promise<TCPServer> {
  const server = getTCPServer(port);
  await server.start();
  return server;
}
