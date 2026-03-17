import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Model, ApiKey, User, UsageRecord, Invoice, Action, Workflow, InvitationRecord, Notification } from './types.js';
import { randomBytes } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
const MODELS_FILE = join(DATA_DIR, 'models.json');
const API_KEYS_FILE = join(DATA_DIR, 'api_keys.json');
const USERS_FILE = join(DATA_DIR, 'users.json');
const USAGE_RECORDS_FILE = join(DATA_DIR, 'usage_records.json');
const INVOICES_FILE = join(DATA_DIR, 'invoices.json');
const ACTIONS_FILE = join(DATA_DIR, 'actions.json');
const WORKFLOWS_FILE = join(DATA_DIR, 'workflows.json');
const INVITATIONS_FILE = join(DATA_DIR, 'invitations.json');
const NOTIFICATIONS_FILE = join(DATA_DIR, 'notifications.json');

export interface ServerConfig {
  port: number;
  host: string;
}

export interface SystemSettings {
  streamDelay: number; // 流式响应延迟时间（毫秒）
  requireApiKey?: boolean; // 全局是否需要API Key（默认false）
  smoothOutput?: boolean; // 平滑输出模式（默认false）
  smoothSpeed?: number; // 平滑输出速度，字符/秒（默认20）
  emailVerificationEnabled?: boolean; // 是否启用邮箱验证（默认false）
  emailjs?: {
    serviceId: string; // EmailJS Service ID
    templateId: string; // EmailJS Template ID
    publicKey: string; // EmailJS Public Key
    privateKey: string; // EmailJS Private Key
  };
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
      unit?: 'K' | 'M';
      type?: 'token' | 'request';
      perRequest?: number;
    };
    api_key?: string;
    api_base_url?: string;
    api_type?: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';
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
let users: User[] = [];
let usageRecords: UsageRecord[] = [];
let invoices: Invoice[] = [];
let actions: Action[] = [];

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
      api_type: m.api_type,
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
    api_type: m.api_type,
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
    const parsed = JSON.parse(content);
    apiKeys = Array.isArray(parsed) ? parsed : [];
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

// 获取所有 API Keys（返回完整对象）
export function getAllApiKeys(): ApiKey[] {
  return apiKeys;
}

// 创建 API Key
export async function createApiKey(name: string, permissions?: ApiKey['permissions']): Promise<ApiKey> {
  const newKey: ApiKey = {
    id: `key_${Date.now()}`,
    key: generateApiKeyString(),
    name,
    createdAt: Date.now(),
    enabled: true,
    viewCount: 0, // 初始化查看计数为0
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

// ==================== 用户管理 ====================

export async function loadUsers(): Promise<User[]> {
  if (users.length > 0) return users;

  try {
    await ensureDir();
    await ensureFile(USERS_FILE, []);
    const content = await readFile(USERS_FILE, 'utf-8');
    users = JSON.parse(content);

    // 如果没有用户，创建默认管理员
    if (users.length === 0) {
      const { hashPassword } = await import('./auth.js');
      const adminUser: User = {
        id: 'admin_default',
        username: 'admin',
        email: 'admin@localhost',
        passwordHash: await hashPassword('admin123'),
        balance: 10000,
        totalUsage: 0,
        createdAt: Date.now(),
        enabled: true,
        role: 'admin',
        inviteCode: generateInviteCode(),
      };
      users.push(adminUser);
      await saveUsers();
      console.log('[Storage] 创建默认管理员用户: admin / admin123');
    } else {
      // 确保所有用户都有邀请码
      let needsSave = false;
      for (const user of users) {
        if (!user.inviteCode) {
          user.inviteCode = generateInviteCode();
          needsSave = true;
        }
      }
      if (needsSave) {
        await saveUsers();
      }
    }

    return users;
  } catch (e) {
    console.warn('[Storage] 加载用户失败:', e);
    users = [];
    return users;
  }
}

async function saveUsers(): Promise<void> {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

export function getAllUsers(): User[] {
  return users;
}

export function getUserById(id: string): User | undefined {
  return users.find(u => u.id === id);
}

export function getUserByUsername(username: string): User | undefined {
  return users.find(u => u.username === username);
}

export function getUserByEmail(email: string): User | undefined {
  return users.find(u => u.email === email);
}

export async function createUser(user: Omit<User, 'id' | 'createdAt'>): Promise<User> {
  const newUser: User = {
    ...user,
    id: `user_${Date.now()}`,
    createdAt: Date.now(),
  };
  users.push(newUser);
  await saveUsers();
  return newUser;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const index = users.findIndex(u => u.id === id);
  if (index === -1) return null;

  users[index] = { ...users[index], ...updates };
  await saveUsers();
  return users[index];
}

export async function deleteUser(id: string): Promise<boolean> {
  const index = users.findIndex(u => u.id === id);
  if (index === -1) return false;

  users.splice(index, 1);
  await saveUsers();
  return true;
}

// ==================== 使用记录管理 ====================

export async function loadUsageRecords(): Promise<UsageRecord[]> {
  if (usageRecords.length > 0) return usageRecords;

  try {
    await ensureDir();
    await ensureFile(USAGE_RECORDS_FILE, []);
    const content = await readFile(USAGE_RECORDS_FILE, 'utf-8');
    usageRecords = JSON.parse(content);
    return usageRecords;
  } catch (e) {
    console.warn('[Storage] 加载使用记录失败:', e);
    usageRecords = [];
    return usageRecords;
  }
}

async function saveUsageRecords(): Promise<void> {
  await writeFile(USAGE_RECORDS_FILE, JSON.stringify(usageRecords, null, 2));
}

export async function createUsageRecord(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
  const newRecord: UsageRecord = {
    ...record,
    id: `usage_${Date.now()}`,
  };
  usageRecords.push(newRecord);
  await saveUsageRecords();

  // 更新用户的总使用量和余额
  const user = getUserById(record.userId);
  if (user) {
    await updateUser(record.userId, {
      totalUsage: (user.totalUsage || 0) + record.totalTokens,
      balance: user.balance - record.cost,
    });
  }

  return newRecord;
}

export function getUserUsageRecords(userId: string): UsageRecord[] {
  // 只返回对应的有效 API Key 的使用记录
  const validApiKeyIds = new Set(apiKeys.map(k => k.id));
  return usageRecords.filter(r => r.userId === userId && validApiKeyIds.has(r.apiKeyId));
}

export function getUsageRecordsByDateRange(userId: string, startTime: number, endTime: number): UsageRecord[] {
  // 只返回对应的有效 API Key 的使用记录
  const validApiKeyIds = new Set(apiKeys.map(k => k.id));
  return usageRecords.filter(r => r.userId === userId && r.timestamp >= startTime && r.timestamp <= endTime && validApiKeyIds.has(r.apiKeyId));
}

// ==================== 账单管理 ====================

export async function loadInvoices(): Promise<Invoice[]> {
  if (invoices.length > 0) return invoices;

  try {
    await ensureDir();
    await ensureFile(INVOICES_FILE, []);
    const content = await readFile(INVOICES_FILE, 'utf-8');
    invoices = JSON.parse(content);
    return invoices;
  } catch (e) {
    console.warn('[Storage] 加载账单失败:', e);
    invoices = [];
    return invoices;
  }
}

async function saveInvoices(): Promise<void> {
  await writeFile(INVOICES_FILE, JSON.stringify(invoices, null, 2));
}

export async function createInvoice(invoice: Omit<Invoice, 'id'>): Promise<Invoice> {
  const newInvoice: Invoice = {
    ...invoice,
    id: `invoice_${Date.now()}`,
  };
  invoices.push(newInvoice);
  await saveInvoices();
  return newInvoice;
}

export function getUserInvoices(userId: string): Invoice[] {
  return invoices.filter(i => i.userId === userId);
}

export async function updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice | null> {
  const index = invoices.findIndex(i => i.id === id);
  if (index === -1) return null;

  invoices[index] = { ...invoices[index], ...updates };
  await saveInvoices();
  return invoices[index];
}

// ==================== Actions 管理 ====================

export async function loadActions(): Promise<Action[]> {
  if (actions.length > 0) return actions;

  try {
    await ensureDir();
    await ensureFile(ACTIONS_FILE, []);
    const content = await readFile(ACTIONS_FILE, 'utf-8');
    actions = JSON.parse(content);
    return actions;
  } catch (e) {
    console.warn('[Storage] 加载 Actions 失败:', e);
    actions = [];
    return actions;
  }
}

async function saveActions(): Promise<void> {
  await writeFile(ACTIONS_FILE, JSON.stringify(actions, null, 2));
}

export function getAllActions(): Action[] {
  return actions;
}

export function getActionById(id: string): Action | undefined {
  return actions.find(a => a.id === id);
}

export function getActionByName(name: string): Action | undefined {
  return actions.find(a => a.name === name);
}

export function getActionsByCreator(userId: string): Action[] {
  return actions.filter(a => a.createdBy === userId);
}

export function getPublicActions(): Action[] {
  return actions.filter(a => a.isPublic);
}

export function getPublicAndUserActions(userId?: string): Action[] {
  return actions.filter(a => a.isPublic || (userId && a.createdBy === userId));
}

export async function createAction(action: Omit<Action, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Action> {
  const newAction: Action = {
    ...action,
    id: `action_${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
  actions.push(newAction);
  await saveActions();
  return newAction;
}

export async function updateAction(id: string, updates: Partial<Action>): Promise<Action | null> {
  const index = actions.findIndex(a => a.id === id);
  if (index === -1) return null;

  actions[index] = {
    ...actions[index],
    ...updates,
    updatedAt: Date.now(),
    version: (actions[index].version || 0) + 1,
  };
  await saveActions();
  return actions[index];
}

export async function deleteAction(id: string): Promise<boolean> {
  const index = actions.findIndex(a => a.id === id);
  if (index === -1) return false;

  actions.splice(index, 1);
  await saveActions();
  return true;
}

export async function incrementActionUsage(id: string): Promise<void> {
  const action = getActionById(id);
  if (action) {
    await updateAction(id, {
      usageCount: (action.usageCount || 0) + 1,
    });
  }
}

// ==================== 工作流管理 ====================

let workflows: Workflow[] = [];

export async function loadWorkflows(): Promise<Workflow[]> {
  if (workflows.length > 0) return workflows;

  try {
    await ensureDir();
    await ensureFile(WORKFLOWS_FILE, []);
    const content = await readFile(WORKFLOWS_FILE, 'utf-8');
    workflows = JSON.parse(content);
    return workflows;
  } catch (e) {
    console.warn('[Storage] 加载工作流失败:', e);
    workflows = [];
    return workflows;
  }
}

async function saveWorkflows(): Promise<void> {
  await writeFile(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2));
}

export function getAllWorkflows(): Workflow[] {
  return workflows;
}

export function getWorkflowById(id: string): Workflow | undefined {
  return workflows.find(w => w.id === id);
}

export function getWorkflowsByCreator(userId: string): Workflow[] {
  return workflows.filter(w => w.createdBy === userId);
}

export function getPublicWorkflows(): Workflow[] {
  return workflows.filter(w => w.isPublic);
}

export async function createWorkflow(workflow: Workflow): Promise<Workflow> {
  workflows.push(workflow);
  await saveWorkflows();
  return workflow;
}

export async function updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow | null> {
  const index = workflows.findIndex(w => w.id === id);
  if (index === -1) return null;

  workflows[index] = {
    ...workflows[index],
    ...updates,
  };
  await saveWorkflows();
  return workflows[index];
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const index = workflows.findIndex(w => w.id === id);
  if (index === -1) return false;

  workflows.splice(index, 1);
  await saveWorkflows();
  return true;
}

// ==================== 邀请记录管理 ====================

let invitationRecords: InvitationRecord[] = [];

export async function loadInvitationRecords(): Promise<InvitationRecord[]> {
  if (invitationRecords.length > 0) return invitationRecords;

  try {
    await ensureDir();
    await ensureFile(INVITATIONS_FILE, []);
    const content = await readFile(INVITATIONS_FILE, 'utf-8');
    invitationRecords = JSON.parse(content);
    return invitationRecords;
  } catch (e) {
    console.warn('[Storage] 加载邀请记录失败:', e);
    invitationRecords = [];
    return invitationRecords;
  }
}

async function saveInvitationRecords(): Promise<void> {
  await writeFile(INVITATIONS_FILE, JSON.stringify(invitationRecords, null, 2));
}

export function getAllInvitationRecords(): InvitationRecord[] {
  return invitationRecords;
}

export function getInvitationRecordsByInviter(inviterId: string): InvitationRecord[] {
  return invitationRecords.filter(r => r.inviterId === inviterId);
}

export function getInvitationRecordsByInvitee(inviteeId: string): InvitationRecord | undefined {
  return invitationRecords.find(r => r.inviteeId === inviteeId);
}

export async function createInvitationRecord(record: Omit<InvitationRecord, 'id'>): Promise<InvitationRecord> {
  const newRecord: InvitationRecord = {
    ...record,
    id: `inv_${Date.now()}`,
  };
  invitationRecords.push(newRecord);
  await saveInvitationRecords();
  return newRecord;
}

// 生成邀请码
export function generateInviteCode(): string {
  return randomBytes(6).toString('base64url').toUpperCase();
}

// 根据邀请码查找用户
export function getUserByInviteCode(inviteCode: string): User | undefined {
  return users.find(u => u.inviteCode === inviteCode);
}

// 获取用户本月邀请数量
export function getMonthlyInviteCount(inviterId: string): number {
  const now = Date.now();
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;
  return invitationRecords.filter(
    r => r.inviterId === inviterId && r.createdAt >= oneMonthAgo
  ).length;
}

// 获取用户可用邀请次数
export function getAvailableInviteQuota(user: User): number {
  // admin 无限次数
  if (user.role === 'admin') return Infinity;
  
  const monthlyUsed = getMonthlyInviteCount(user.id);
  const monthlyQuota = 5; // 每月5次
  const extraQuota = user.extraInviteQuota || 0;
  
  return Math.max(0, monthlyQuota - monthlyUsed) + extraQuota;
}

// ==================== 通知管理 ====================

let notifications: Notification[] = [];

export async function loadNotifications(): Promise<Notification[]> {
  if (notifications.length > 0) return notifications;

  try {
    await ensureDir();
    await ensureFile(NOTIFICATIONS_FILE, []);
    const content = await readFile(NOTIFICATIONS_FILE, 'utf-8');
    notifications = JSON.parse(content);
    return notifications;
  } catch (e) {
    console.warn('[Storage] 加载通知失败:', e);
    notifications = [];
    return notifications;
  }
}

async function saveNotifications(): Promise<void> {
  await writeFile(NOTIFICATIONS_FILE, JSON.stringify(notifications, null, 2));
}

export function getAllNotifications(): Notification[] {
  return notifications;
}

export function getActiveNotifications(): Notification[] {
  return notifications
    .filter(n => n.isActive !== false)
    .sort((a, b) => {
      // 置顶优先，然后按创建时间倒序
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.createdAt - a.createdAt;
    });
}

export function getNotificationById(id: string): Notification | undefined {
  return notifications.find(n => n.id === id);
}

export async function createNotification(notification: Omit<Notification, 'id' | 'createdAt'>): Promise<Notification> {
  const newNotification: Notification = {
    ...notification,
    id: `notif_${Date.now()}`,
    createdAt: Date.now(),
    isActive: true,
  };
  notifications.push(newNotification);
  await saveNotifications();
  return newNotification;
}

export async function updateNotification(id: string, updates: Partial<Notification>): Promise<Notification | null> {
  const index = notifications.findIndex(n => n.id === id);
  if (index === -1) return null;

  notifications[index] = {
    ...notifications[index],
    ...updates,
    updatedAt: Date.now(),
  };
  await saveNotifications();
  return notifications[index];
}

export async function deleteNotification(id: string): Promise<boolean> {
  const index = notifications.findIndex(n => n.id === id);
  if (index === -1) return false;

  notifications.splice(index, 1);
  await saveNotifications();
  return true;
}
