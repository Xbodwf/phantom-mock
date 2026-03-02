import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Model } from './types.js';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const MODELS_FILE = join(DATA_DIR, 'models.json');

export interface ServerConfig {
  port: number;
  host: string;
}

export interface SystemSettings {
  streamDelay: number; // 流式响应延迟时间（毫秒）
}

export interface Config {
  server: ServerConfig;
  settings: SystemSettings;
  models: Array<{
    id: string;
    owned_by: string;
    description?: string;
    context_length?: number;
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
  }));
  await saveConfig(config);
}

// 获取服务器配置
export async function getServerConfig(): Promise<ServerConfig> {
  const cfg = await loadConfig();
  return cfg.server;
}

// 获取系统设置
export async function getSettings(): Promise<SystemSettings> {
  const cfg = await loadConfig();
  return cfg.settings || { streamDelay: 500 };
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
