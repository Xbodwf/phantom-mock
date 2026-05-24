import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PendingRequest, Model, WSMessage, Stats, SystemSettings, ApiKey } from '../types';
import { useAuth } from './AuthContext';

interface ServerContextType {
 connected: boolean;
 pendingRequests: Map<string, PendingRequest>;
 models: Model[];
 stats: Stats;
 settings: SystemSettings;
 apiKeys: ApiKey[];
 sendResponse: (requestId: string, content: string) => void;
 sendStreamChunk: (requestId: string, content: string) => void;
 endStream: (requestId: string) => void;
 sendToolCall: (requestId: string, toolCalls: Array<{ id: string; name: string; arguments: string }>) => void;
 sendImageResponse: (requestId: string, images: Array<{ url?: string; b64_json?: string }>) => void;
 sendVideoResponse: (requestId: string, videos: Array<{ url?: string; b64_json?: string }>) => void;
 addModel: (model: Partial<Model>) => Promise<void>;
 updateModel: (id: string, model: Partial<Model>) => Promise<void>;
 deleteModel: (id: string) => Promise<void>;
 removeRequest: (requestId: string) => void;
 updateSettings: (settings: Partial<SystemSettings>) => Promise<void>;
 // API Key 管理
 createApiKey: (name: string, permissions?: ApiKey['permissions']) => Promise<ApiKey>;
 updateApiKey: (id: string, updates: Partial<ApiKey>) => Promise<void>;
 deleteApiKey: (id: string) => Promise<void>;
 refreshApiKeys: () => Promise<void>;
 // WebSocket连接控制
 connectWebSocket: () => void;
 disconnectWebSocket: () => void;
}

const ServerContext = createContext<ServerContextType | null>(null);

export function useServer() {
 const ctx = useContext(ServerContext);
 if (!ctx) throw new Error('useServer must be used within ServerProvider');
 return ctx;
}

export function ServerProvider({ children }: { children: ReactNode }) {
 const [connected, setConnected] = useState(false);
 const [ws, setWs] = useState<WebSocket | null>(null);
 const [pendingRequests, setPendingRequests] = useState<Map<string, PendingRequest>>(new Map());
 const [models, setModels] = useState<Model[]>([]);
 const [stats, setStats] = useState<Stats>({ pendingRequests:0, connectedClients:0, totalModels:0 });
 const [settings, setSettings] = useState<SystemSettings>({ streamDelay:500, port:7143 });
 const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
 const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const shouldReconnectRef = useRef(false);

 const { token, user, isLoading: authLoading } = useAuth();

 const fetchModels = useCallback(async () => {
 if (authLoading) return;

 try {
 const headers: HeadersInit = {};
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }

 const res = await fetch('/api/models', { headers });
 const data = await res.json();
 setModels(data.data || data.models || []);
 } catch (error) {
 console.error('Failed to fetch models:', error);
 }
 }, [token, authLoading]);

 // 初始化时只获取模型和其他数据，不连接 WebSocket
 useEffect(() => {
 if (authLoading) return;

 fetchModels();

 const isAdmin = user?.role === 'admin';
 const headers: HeadersInit = {};
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }

 //只有管理员才获取 stats 和 settings
 if (isAdmin) {
 fetch('/api/stats', { headers })
 .then(res => res.json())
 .then(setStats)
 .catch(console.error);

 fetch('/api/settings', { headers })
 .then(res => res.json())
 .then(setSettings)
 .catch(console.error);
 }

 fetch('/api/user/api-keys', { headers })
 .then(res => res.json())
 .then(data => setApiKeys(data.keys || []))
 .catch(console.error);
 }, [fetchModels, token, user, authLoading]);

 const handleMessage = useCallback((msg: WSMessage) => {
  console.log('[WS Client] handleMessage - 消息类型:', msg.type, '载荷:', msg.payload);
   
   switch (msg.type) {
     case 'request': {
       const payload = msg.payload as {
         requestId: string;
         data: any;
         requestParams?: any;
         requestType?: 'chat' | 'image' | 'video';
         imageRequest?: any;
         videoRequest?: any;
       };
       
       console.log('[WS Client] 处理请求消息:', payload.requestId, '模型:', payload.data?.model);
       
       setPendingRequests(prev => {
         const next = new Map(prev);
         next.set(payload.requestId, {
           requestId: payload.requestId,
           request: payload.data,
           isStream: payload.data.stream === true,
           createdAt: Date.now(),
           requestParams: payload.requestParams,
           requestType: payload.requestType || 'chat',
           imageRequest: payload.imageRequest,
           videoRequest: payload.videoRequest,
         });
         console.log('[WS Client] 已添加请求到列表，当前请求数:', next.size);
         return next;
       });
       break;
     } case 'models_update': {
 const payload = msg.payload as { models: Model[] };
 setModels(payload.models);
 break;
 }
 }
 }, []);

 //连接 WebSocket
 const connectWebSocket = useCallback(() => {
 if (ws && ws.readyState === WebSocket.OPEN) return; // 已连接

 shouldReconnectRef.current = true;

 const connect = () => {
 if (!shouldReconnectRef.current) return;

 // 使用代理路径连接WebSocket
 const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
 const wsUrl = `${protocol}//${window.location.host}/ws`;
 
 console.log('[WS Client] 正在连接到 WebSocket (通过代理):', wsUrl);
 console.log('[WS Client] 当前页面URL:', window.location.href);

 const socket = new WebSocket(wsUrl);

 socket.onopen = () => {
 console.log('[WS Client] WebSocket 连接成功');
 setConnected(true);
 setWs(socket);
 };

 socket.onclose = (event) => {
 console.log('[WS Client] WebSocket 连接关闭，代码:', event.code, '原因:', event.reason);
 setConnected(false);
 setWs(null);
 //只有在需要重连时才重连
 if (shouldReconnectRef.current) {
 console.log('[WS Client] 3秒后重新连接...');
 reconnectTimeoutRef.current = setTimeout(connect,3000);
 }
 };

 socket.onerror = (error) => {
 console.error('[WS Client] WebSocket 错误:', error);
 };

 socket.onmessage = (event) => {
 console.log('[WS Client] 收到消息:', event.data);
 try {
 const msg: WSMessage = JSON.parse(event.data);
 console.log('[WS Client] 解析后的消息:', msg.type);
 handleMessage(msg);
 } catch (e) {
 console.error('[WS Client] 解析消息失败:', e);
 }
 };
 };

 connect();
 }, [ws, handleMessage]);

 //断开 WebSocket
 const disconnectWebSocket = useCallback(() => {
 shouldReconnectRef.current = false;

 if (reconnectTimeoutRef.current) {
 clearTimeout(reconnectTimeoutRef.current);
 reconnectTimeoutRef.current = null;
 }

 if (ws) {
 ws.close();
 setWs(null);
 }

 setConnected(false);
 setPendingRequests(new Map());
 }, [ws]);

 //组件卸载时断开连接
 useEffect(() => {
 return () => {
 shouldReconnectRef.current = false;
 if (reconnectTimeoutRef.current) {
 clearTimeout(reconnectTimeoutRef.current);
 }
 if (ws) {
 ws.close();
 }
 };
 }, [ws]);

  const sendResponse = useCallback((requestId: string, content: string) => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: 'response', payload: { requestId, content } }));
  setPendingRequests(prev => {
  const next = new Map(prev);
  next.delete(requestId);
  return next;
  });
  }, [ws]);

  const sendToolCall = useCallback((requestId: string, toolCalls: Array<{ id: string; name: string; arguments: string }>) => {
  if (!ws) return;
  ws.send(JSON.stringify({ type: 'tool_call', payload: { requestId, toolCalls } }));
  // 不删除请求，流式模式下可继续发送（由 stream_end 触发移除）
  }, [ws]);

 const sendStreamChunk = useCallback((requestId: string, content: string) => {
 if (!ws) return;
 ws.send(JSON.stringify({ type: 'stream', payload: { requestId, content } }));
 }, [ws]);

 const endStream = useCallback((requestId: string) => {
 if (!ws) return;
 ws.send(JSON.stringify({ type: 'stream_end', payload: { requestId, content: '' } }));
 setPendingRequests(prev => {
 const next = new Map(prev);
 next.delete(requestId);
 return next;
 });
 }, [ws]);

 const sendImageResponse = useCallback((requestId: string, images: Array<{ url?: string; b64_json?: string }>) => {
 if (!ws) return;
 ws.send(JSON.stringify({ type: 'image_response', payload: { requestId, images } }));
 setPendingRequests(prev => {
 const next = new Map(prev);
 next.delete(requestId);
 return next;
 });
 }, [ws]);

 const sendVideoResponse = useCallback((requestId: string, videos: Array<{ url?: string; b64_json?: string }>) => {
 if (!ws) return;
 ws.send(JSON.stringify({ type: 'video_response', payload: { requestId, videos } }));
 setPendingRequests(prev => {
 const next = new Map(prev);
 next.delete(requestId);
 return next;
 });
 }, [ws]);

 const removeRequest = useCallback((requestId: string) => {
 setPendingRequests(prev => {
 const next = new Map(prev);
 next.delete(requestId);
 return next;
 });
 }, []);

 const addModel = useCallback(async (model: Partial<Model> & { newId?: string }) => {
 try {
 const headers: HeadersInit = { 'Content-Type': 'application/json' };
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const response = await fetch('/api/models', {
 method: 'POST',
 headers,
 body: JSON.stringify(model),
 });
 if (response.ok) {
 await fetchModels();
 } else {
 console.error('Failed to add model:', await response.text());
 }
 } catch (error) {
 console.error('Error adding model:', error);
 }
 }, [fetchModels, token]);

 const updateModel = useCallback(async (id: string, model: Partial<Model> & { newId?: string }) => {
 try {
 const headers: HeadersInit = { 'Content-Type': 'application/json' };
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const response = await fetch(`/api/models/${encodeURIComponent(id)}`, {
 method: 'PUT',
 headers,
 body: JSON.stringify(model),
 });
 if (response.ok) {
 await fetchModels();
 } else {
 console.error('Failed to update model:', await response.text());
 }
 } catch (error) {
 console.error('Error updating model:', error);
 }
 }, [fetchModels, token]);

 const deleteModel = useCallback(async (id: string) => {
 try {
 const headers: HeadersInit = {};
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const response = await fetch(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
 if (response.ok) {
 await fetchModels();
 } else {
 console.error('Failed to delete model:', await response.text());
 }
 } catch (error) {
 console.error('Error deleting model:', error);
 }
 }, [fetchModels, token]);

 const updateSettingsCallback = useCallback(async (newSettings: Partial<SystemSettings>) => {
 const headers: HeadersInit = { 'Content-Type': 'application/json' };
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const res = await fetch('/api/settings', {
 method: 'PUT',
 headers,
 body: JSON.stringify(newSettings),
 });
 const data = await res.json();
 if (data.settings) {
 setSettings(data.settings);
 }
 }, [token]);

 // API Key 管理
 const refreshApiKeys = useCallback(async () => {
 const headers: HeadersInit = {};
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const res = await fetch('/api/user/api-keys', { headers });
 const data = await res.json();
 setApiKeys(data.keys || []);
 }, [token]);

 const createApiKey = useCallback(async (name: string, permissions?: ApiKey['permissions']): Promise<ApiKey> => {
 const headers: HeadersInit = { 'Content-Type': 'application/json' };
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 const res = await fetch('/api/user/api-keys', {
 method: 'POST',
 headers,
 body: JSON.stringify({ name, permissions }),
 });
 const data = await res.json();
 if (data.key) {
 await refreshApiKeys();
 return data.key;
 }
 throw new Error('Failed to create API key');
 }, [refreshApiKeys, token]);

 const updateApiKeyCallback = useCallback(async (id: string, updates: Partial<ApiKey>) => {
 const headers: HeadersInit = { 'Content-Type': 'application/json' };
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 await fetch(`/api/user/api-keys/${id}`, {
 method: 'PUT',
 headers,
 body: JSON.stringify(updates),
 });
 await refreshApiKeys();
 }, [refreshApiKeys, token]);

 const deleteApiKeyCallback = useCallback(async (id: string) => {
 const headers: HeadersInit = {};
 if (token) {
 headers['Authorization'] = `Bearer ${token}`;
 }
 await fetch(`/api/user/api-keys/${id}`, { method: 'DELETE', headers });
 await refreshApiKeys();
 }, [refreshApiKeys, token]);

 return (
 <ServerContext.Provider value={{
 connected,
 pendingRequests,
 models,
 stats,
 settings,
 apiKeys,
 sendResponse,
  sendStreamChunk,
  endStream,
  sendToolCall,
  sendImageResponse,
  sendVideoResponse,
 addModel,
 updateModel,
 deleteModel,
 removeRequest,
 updateSettings: updateSettingsCallback,
 createApiKey,
 updateApiKey: updateApiKeyCallback,
 deleteApiKey: deleteApiKeyCallback,
 refreshApiKeys,
 connectWebSocket,
 disconnectWebSocket,
 }}>
 {children}
 </ServerContext.Provider>
 );
}
