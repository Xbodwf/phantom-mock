import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { PendingRequest, Model, WSMessage, Stats, SystemSettings, ApiKey } from '../types';

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
  const [stats, setStats] = useState<Stats>({ pendingRequests: 0, connectedClients: 0, totalModels: 0 });
  const [settings, setSettings] = useState<SystemSettings>({ streamDelay: 500, port: 7143 });
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  const fetchModels = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
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
  }, []);

  useEffect(() => {
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${location.host}`;
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setConnected(true);
        setWs(socket);
      };

      socket.onclose = () => {
        setConnected(false);
        setWs(null);
        setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) {
          console.error('Parse error:', e);
        }
      };
    };

    connect();

    // Fetch initial data
    fetchModels();

    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    const isAdmin = user ? JSON.parse(user).role === 'admin' : false;

    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 只有管理员才获取 stats 和 settings
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
  }, [fetchModels]);

  const handleMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case 'request': {
        const payload = msg.payload as { requestId: string; data: any; requestParams?: any; requestType?: 'chat' | 'image' | 'video'; imageRequest?: any; videoRequest?: any };
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
          return next;
        });
        break;
      }
      case 'models_update': {
        const payload = msg.payload as { models: Model[] };
        setModels(payload.models);
        break;
      }
    }
  }, []);

  const sendResponse = useCallback((requestId: string, content: string) => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'response', payload: { requestId, content } }));
    setPendingRequests(prev => {
      const next = new Map(prev);
      next.delete(requestId);
      return next;
    });
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
      const token = localStorage.getItem('token');
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
  }, [fetchModels]);

  const updateModel = useCallback(async (id: string, model: Partial<Model> & { newId?: string }) => {
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/models/${id}`, {
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
  }, [fetchModels]);

  const deleteModel = useCallback(async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/models/${id}`, { method: 'DELETE', headers });
      if (response.ok) {
        await fetchModels();
      } else {
        console.error('Failed to delete model:', await response.text());
      }
    } catch (error) {
      console.error('Error deleting model:', error);
    }
  }, [fetchModels]);

  const updateSettingsCallback = useCallback(async (newSettings: Partial<SystemSettings>) => {
    const token = localStorage.getItem('token');
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
  }, []);

  // API Key 管理
  const refreshApiKeys = useCallback(async () => {
    const token = localStorage.getItem('token');
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/api/user/api-keys', { headers });
    const data = await res.json();
    setApiKeys(data.keys || []);
  }, []);

  const createApiKey = useCallback(async (name: string, permissions?: ApiKey['permissions']): Promise<ApiKey> => {
    const token = localStorage.getItem('token');
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
  }, [refreshApiKeys]);

  const updateApiKeyCallback = useCallback(async (id: string, updates: Partial<ApiKey>) => {
    const token = localStorage.getItem('token');
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
  }, [refreshApiKeys]);

  const deleteApiKeyCallback = useCallback(async (id: string) => {
    const token = localStorage.getItem('token');
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    await fetch(`/api/user/api-keys/${id}`, { method: 'DELETE', headers });
    await refreshApiKeys();
  }, [refreshApiKeys]);

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
    }}>
      {children}
    </ServerContext.Provider>
  );
}