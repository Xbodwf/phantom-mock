import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Model, ApiKey } from './types.js';
import { randomBytes } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const MODELS_FILE = join(DATA_DIR, 'models.json');
const API_KEYS_FILE = join(DATA_DIR, 'api_keys.json');

export interface ServerConfig {
  port: number;
  host: string;
}

export interface SystemSettings {
  streamDelay: number; // 流式响应延迟时间（毫秒）
  requireApiKey?: boolean; // 全局是否需要API Key（默认false）
  smoothOutput?: boolean; // 平滑输出模式（默认false）
  smoothSpeed?: number; // 平滑输出速度，字符/秒（默认20）
}

export interface Config {
  server: ServerConfig;
  settings: SystemSettings;
  models: Array<{
    id: string;
    owned_by: string;
    description?: string;
    context_length?: number;
    aliases?: string[];
    max_output_tokens?: number;
    pricing?: {
      input?: number;
      output?: number;
    };
    api_key?: string;
    api_base_url?: string;
    supported_features?: string[];
    require_api_key?: boolean;
  }>;
}

// 默认配置
const defaultConfig: Config = {
  server: {
    port: 7143,
    host: '0.0.0.0',
  },
  settings: {
    streamDelay: 500, // 默认 500ms 延迟
    requireApiKey: false, // 默认不需要API Key
    smoothOutput: false, // 默认不启用平滑输出
    smoothSpeed: 20, // 默认每秒20个字符
  },
  models: [
    { id: 'gemini-2.5-flash', owned_by: 'google', description: 'Fast and efficient Gemini 2.5', context_length: 1000000 },
    { id: 'gemini-2.5-pro', owned_by: 'google', description: 'Most advanced Gemini 2.5 reasoning', context_length: 1000000 },
    { id: 'gemini-3-flash-preview', owned_by: 'google', description: 'Gemini 3 Flash Preview', context_length: 1048576 },
    { id: 'gemini-3-pro-preview', owned_by: 'google', description: 'Gemini 3 Pro Preview', context_length: 1048576 },
    { id: 'gemini-3.1-flash-preview', owned_by: 'google', description: 'Gemini 3.1 Flash Preview', context_length: 1048576 },
    { id: 'gemini-3.1-pro-preview', owned_by: 'google', description: 'Gemini 3.1 Pro Preview', context_length: 1048576 },
    { id: 'claude-opus-4.6', owned_by: 'anthropic', description: 'Anthropic strongest model with 1M context', context_length: 1000000 },
  ],
};

let config: Config | null = null;
let models: Model[] = [];
let apiKeys: ApiKey[] = [];

// 确保目录存在
async function ensureDir() {
  try {
    await access(DATA_DIR);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// 确保文件存在
async function ensureFile(filePath: string, defaultContent: object) {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, JSON.stringify(defaultContent, null, 2));
  }
}

// 加载配置
export async function loadConfig(): Promise<Config> {
  if (config) return config;

  try {
    await ensureDir();
    await ensureFile(CONFIG_FILE, defaultConfig);
    const content = await readFile(CONFIG_FILE, 'utf-8');
    config = JSON.parse(content);
    return config!;
  } catch (e) {
    console.warn('[Storage] 加载配置失败，使用默认配置:', e);
    config = defaultConfig;
    return config;
  }
}

// 保存配置
export async function saveConfig(newConfig: Config): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  config = newConfig;
}

// 加载模型列表
export async function loadModels(): Promise<Model[]> {
  if (models.length > 0) return models;

  try {
    const cfg = await loadConfig();
    models = cfg.models.map((m, i) => ({
      id: m.id,
      object: 'model' as const,
      created: 1700000000 + i * 10000,
      owned_by: m.owned_by,
      description: m.description,
      context_length: m.context_length,
      aliases: m.aliases,
      max_output_tokens: m.max_output_tokens,
      pricing: m.pricing,
      api_key: m.api_key,
      api_base_url: m.api_base_url,
      supported_features: m.supported_features,
      require_api_key: m.require_api_key,
    }));
    return models;
  } catch (e) {
    console.warn('[Storage] 加载模型列表失败:', e);
    return [];
  }
}

// 获取单个模型
export function getModel(id: string): Model | undefined {
  return models.find(m => m.id === id);
}

// 获取所有模型
export function getAllModels(): Model[] {
  return models;
}

// 添加模型
export async function addModel(model: Omit<Model, 'object' | 'created'>): Promise<Model> {
  const newModel: Model = {
    ...model,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
  };
  models.push(newModel);
  await saveModels();
  return newModel;
}

// 更新模型
export async function updateModel(id: string, updates: Partial<Model>): Promise<Model | null> {
  const index = models.findIndex(m => m.id === id);
  if (index === -1) return null;

  models[index] = { ...models[index], ...updates };
  await saveModels();
  return models[index];
}

// 删除模型
export async function deleteModel(id: string): Promise<boolean> {
  const index = models.findIndex(m => m.id === id);
  if (index === -1) return false;

  models.splice(index, 1);
  await saveModels();
  return true;
}

// 保存模型到配置文件
async function saveModels(): Promise<void> {
  if (!config) {
    config = await loadConfig();
  }
  config.models = models.map(m => ({
    id: m.id,
    owned_by: m.owned_by,
    description: m.description,
    context_length: m.context_length,
    aliases: m.aliases,
    max_output_tokens: m.max_output_tokens,
    pricing: m.pricing,
    api_key: m.api_key,
    api_base_url: m.api_base_url,
    supported_features: m.supported_features,
    require_api_key: m.require_api_key,
  }));
  await saveConfig(config);
}

// ==================== API Key 管理 ====================

// 生成随机 API Key
function generateApiKeyString(): string {
  const prefix = 'sk-fake';
  const random = randomBytes(24).toString('base64url');
  return `${prefix}-${random}`;
}

// 加载 API Keys
export async function loadApiKeys(): Promise<ApiKey[]> {
  if (apiKeys.length > 0) return apiKeys;

  try {
    await ensureDir();
    await ensureFile(API_KEYS_FILE, []);
    const content = await readFile(API_KEYS_FILE, 'utf-8');
    apiKeys = JSON.parse(content);
    return apiKeys;
  } catch (e) {
    console.warn('[Storage] 加载 API Keys 失败:', e);
    apiKeys = [];
    return apiKeys;
  }
}

// 保存 API Keys
async function saveApiKeys(): Promise<void> {
  await writeFile(API_KEYS_FILE, JSON.stringify(apiKeys, null, 2));
}

// 获取所有 API Keys
export function getAllApiKeys(): ApiKey[] {
  return apiKeys.map(k => ({
    ...k,
    key: k.key.substring(0, 12) + '...', // 隐藏完整 key
  }));
}

// 创建 API Key
export async function createApiKey(name: string, permissions?: ApiKey['permissions']): Promise<ApiKey> {
  const newKey: ApiKey = {
    id: `key_${Date.now()}`,
    key: generateApiKeyString(),
    name,
    createdAt: Date.now(),
    enabled: true,
    permissions,
  };
  apiKeys.push(newKey);
  await saveApiKeys();
  return newKey;
}

// 验证 API Key
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  const found = apiKeys.find(k => k.key === key && k.enabled);
  if (found) {
    found.lastUsedAt = Date.now();
    await saveApiKeys();
    return found;
  }
  return null;
}

// 更新 API Key
export async function updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
  const index = apiKeys.findIndex(k => k.id === id);
  if (index === -1) return null;

  // 不允许更新 key 本身
  delete updates.key;
  apiKeys[index] = { ...apiKeys[index], ...updates };
  await saveApiKeys();
  return apiKeys[index];
}

// 删除 API Key
export async function deleteApiKey(id: string): Promise<boolean> {
  const index = apiKeys.findIndex(k => k.id === id);
  if (index === -1) return false;

  apiKeys.splice(index, 1);
  await saveApiKeys();
  return true;
}

// 获取完整 API Key（仅用于显示一次）
export function getFullApiKey(id: string): string | null {
  const found = apiKeys.find(k => k.id === id);
  return found ? found.key : null;
}

// 获取服务器配置
export async function getServerConfig(): Promise<ServerConfig> {
  const cfg = await loadConfig();
  return cfg.server;
}

// 获取系统设置
export async function getSettings(): Promise<SystemSettings> {
  const cfg = await loadConfig();
  return cfg.settings || { streamDelay: 500, requireApiKey: false, smoothOutput: false, smoothSpeed: 20 };
}

// 更新系统设置
export async function updateSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  if (!config) {
    config = await loadConfig();
  }
  config.settings = { ...config.settings, ...settings };
  await saveConfig(config);
  return config.settings;
}

// 更新服务器配置
export async function updateServerConfig(serverConfig: Partial<ServerConfig>): Promise<ServerConfig> {
  if (!config) {
    config = await loadConfig();
  }
  config.server = { ...config.server, ...serverConfig };
  await saveConfig(config);
  return config.server;
}
