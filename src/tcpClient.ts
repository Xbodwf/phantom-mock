import net from 'net';
import { EventEmitter } from 'events';

/**
 * TCP 客户端 - 反向连接到远程服务器
 */
export class TCPClient extends EventEmitter {
  private client: net.Socket | null = null;
  private host: string;
  private port: number;
  private reconnectInterval: number = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private messageBuffer: string = '';

  constructor(host: string, port: number) {
    super();
    this.host = host;
    this.port = port;
  }

  /**
   * 连接到远程服务器
   */
  connect(): void {
    if (this.isConnecting || this.client?.connecting) {
      console.log('[TCP Client] 正在连接中，跳过重复连接');
      return;
    }

    this.isConnecting = true;
    console.log(`[TCP Client] 连接到 ${this.host}:${this.port}...`);

    this.client = net.createConnection({
      host: this.host,
      port: this.port,
    });

    this.client.on('connect', () => {
      this.isConnecting = false;
      console.log(`[TCP Client] 已连接到 ${this.host}:${this.port}`);
      this.emit('connected');

      // 发送握手消息
      this.send({
        type: 'handshake',
        payload: {
          clientType: 'phantom-mock',
          version: '1.0.0',
          timestamp: Date.now(),
        },
      });
    });

    this.client.on('data', (data) => {
      this.handleData(data);
    });

    this.client.on('error', (error) => {
      this.isConnecting = false;
      console.error(`[TCP Client] 连接错误:`, error.message);
      this.emit('error', error);
    });

    this.client.on('close', () => {
      this.isConnecting = false;
      console.log('[TCP Client] 连接已关闭');
      this.emit('disconnected');

      // 自动重连
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.client.on('timeout', () => {
      console.log('[TCP Client] 连接超时');
      this.client?.destroy();
    });
  }

  /**
   * 处理接收到的数据
   */
  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString();

    // 按行分割消息（假设每条消息以换行符结束）
    const messages = this.messageBuffer.split('\n');
    this.messageBuffer = messages.pop() || ''; // 保留最后一个不完整的消息

    for (const messageStr of messages) {
      if (!messageStr.trim()) continue;

      try {
        const message = JSON.parse(messageStr);
        this.emit('message', message);
        this.handleMessage(message);
      } catch (error) {
        console.error('[TCP Client] 解析消息失败:', error);
      }
    }
  }

  /**
   * 处理消息
   */
  private handleMessage(message: any): void {
    const { type, payload } = message;

    switch (type) {
      case 'ping':
        // 响应心跳
        this.send({ type: 'pong', payload: { timestamp: Date.now() } });
        break;

      case 'request':
        // 处理请求
        this.emit('request', payload);
        break;

      case 'handshake_ack':
        console.log('[TCP Client] 握手成功');
        break;

      default:
        console.log(`[TCP Client] 收到未知消息类型: ${type}`);
    }
  }

  /**
   * 发送消息
   */
  send(message: any): boolean {
    if (!this.client || this.client.destroyed) {
      console.error('[TCP Client] 连接未建立，无法发送消息');
      return false;
    }

    try {
      const messageStr = JSON.stringify(message) + '\n';
      this.client.write(messageStr);
      return true;
    } catch (error) {
      console.error('[TCP Client] 发送消息失败:', error);
      return false;
    }
  }

  /**
   * 发送响应
   */
  sendResponse(requestId: string, response: any): boolean {
    return this.send({
      type: 'response',
      payload: {
        requestId,
        response,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    console.log(`[TCP Client] ${this.reconnectInterval / 1000} 秒后重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    console.log('[TCP Client] 已断开连接');
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.client !== null && !this.client.destroyed && this.client.writable;
  }

  /**
   * 设置重连间隔
   */
  setReconnectInterval(interval: number): void {
    this.reconnectInterval = interval;
  }
}

/**
 * TCP 客户端管理器
 */
export class TCPClientManager {
  private clients: Map<string, TCPClient> = new Map();

  /**
   * 添加客户端
   */
  addClient(name: string, host: string, port: number): TCPClient {
    if (this.clients.has(name)) {
      console.warn(`[TCP Manager] 客户端 ${name} 已存在`);
      return this.clients.get(name)!;
    }

    const client = new TCPClient(host, port);
    this.clients.set(name, client);

    client.on('connected', () => {
      console.log(`[TCP Manager] 客户端 ${name} 已连接`);
    });

    client.on('disconnected', () => {
      console.log(`[TCP Manager] 客户端 ${name} 已断开`);
    });

    client.on('error', (error) => {
      console.error(`[TCP Manager] 客户端 ${name} 错误:`, error.message);
    });

    return client;
  }

  /**
   * 获取客户端
   */
  getClient(name: string): TCPClient | undefined {
    return this.clients.get(name);
  }

  /**
   * 移除客户端
   */
  removeClient(name: string): void {
    const client = this.clients.get(name);
    if (client) {
      client.disconnect();
      this.clients.delete(name);
      console.log(`[TCP Manager] 客户端 ${name} 已移除`);
    }
  }

  /**
   * 获取所有客户端
   */
  getAllClients(): Map<string, TCPClient> {
    return this.clients;
  }

  /**
   * 断开所有客户端
   */
  disconnectAll(): void {
    for (const [name, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
    console.log('[TCP Manager] 所有客户端已断开');
  }
}

// 全局 TCP 客户端管理器
export const tcpClientManager = new TCPClientManager();
