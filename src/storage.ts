import { join } from 'path';
import type { Model, ApiKey, User, UsageRecord, Invoice, Action, Workflow, WorkflowRun, InvitationRecord, Notification, Provider, Node, NodeGroup, ProviderApiKey } from './types.js';
import { randomBytes } from 'crypto';
import { connectDB, getDB, initializeIndexes } from './db/index.js';
import * as modelsDB from './db/models.js';
import * as usersDB from './db/users.js';
import * as apiKeysDB from './db/apiKeys.js';
import * as usageRecordsDB from './db/usageRecords.js';
import * as invoicesDB from './db/invoices.js';
import * as actionsDB from './db/actions.js';
import * as notificationsDB from './db/notifications.js';
import * as invitationsDB from './db/invitations.js';
import * as providersDB from './db/providers.js';
import * as nodesDB from './db/nodes.js';
import * as nodeGroupsDB from './db/nodeGroups.js';

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

// 内存缓存（仅用于配置和临时数据）
let modelsCache: Model[] = [];
let apiKeysCache: ApiKey[] = [];
let usersCache: User[] = [];
let usageRecordsCache: UsageRecord[] = [];
let invoicesCache: Invoice[] = [];
let actionsCache: Action[] = [];
let notificationsCache: Notification[] = [];
let providersCache: Provider[] = [];
let nodesCache: Node[] = [];
let nodeGroupsCache: NodeGroup[] = [];

export interface ServerConfig {
  port: number;
  host: string;
}

export interface SystemSettings {
  streamDelay: number;
  requireApiKey?: boolean;
  smoothOutput?: boolean;
  smoothSpeed?: number;
  emailVerificationEnabled?: boolean;
 commission?: {
  enabled?: boolean;
  defaultRatio?: number;
  };
  emailjs?: {
    serviceId: string;
    templateId: string;
    publicKey: string;
    privateKey: string;
  };
  forwarderTimeout?: number;
}

export interface Config {
  server: ServerConfig;
  settings: SystemSettings;
}

// 默认配置
const defaultConfig: Config = {
  server: {
    port: 7143,
    host: '0.0.0.0',
  },
  settings: {
    streamDelay: 500,
    requireApiKey: false,
    smoothOutput: false,
    smoothSpeed: 20,
    forwarderTimeout: 1000,
  },
};

let config: Config | null = null;

// ==================== 数据库初始化 ====================

export async function initializeDatabase(): Promise<void> {
  await connectDB();
  await initializeIndexes();
  console.log('[Storage] Database initialized');
}

// ==================== 配置管理（仍使用 JSON 文件）====================

async function ensureDataDir(): Promise<void> {
  try {
    const { access, mkdir } = await import('fs/promises');
    try {
      await access(DATA_DIR);
    } catch {
      await mkdir(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.warn('[Storage] Failed to ensure data directory:', e);
  }
}

export async function loadConfig(): Promise<Config> {
  if (config) return config;

  try {
    await ensureDataDir();
    const { readFile } = await import('fs/promises');
    const content = await readFile(CONFIG_FILE, 'utf-8');
    config = JSON.parse(content);
    return config!;
  } catch (e) {
    console.warn('[Storage] 加载配置失败，使用默认配置:', e);
    config = defaultConfig;
    // 尝试写入默认配置文件，确保下次启动能正常读取
    try {
      await saveConfig(config);
    } catch (writeErr) {
      console.warn('[Storage] 无法写入默认配置文件:', writeErr);
    }
    return config;
  }
}

export async function saveConfig(newConfig: Config): Promise<void> {
  await ensureDataDir();
  const { writeFile } = await import('fs/promises');
  await writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  config = newConfig;
}

export async function getServerConfig(): Promise<ServerConfig> {
  const cfg = await loadConfig();
  return cfg.server;
}

export async function updateServerConfig(updates: Partial<ServerConfig>): Promise<void> {
  const cfg = await loadConfig();
  cfg.server = { ...cfg.server, ...updates };
  await saveConfig(cfg);
}

export async function getSettings(): Promise<SystemSettings> {
  const cfg = await loadConfig();
  return cfg.settings;
}

export async function updateSettings(settings: Partial<SystemSettings>): Promise<void> {
  const cfg = await loadConfig();
  cfg.settings = { ...cfg.settings, ...settings };
  await saveConfig(cfg);
}

// ==================== 模型管理 ====================

export async function loadModels(): Promise<Model[]> {
  try {
    modelsCache = await modelsDB.getAllModels();
    return modelsCache;
  } catch (e) {
    console.error('[Storage] Failed to load models:', e);
    return [];
  }
}

export function getModel(id: string): Model | undefined {
  const model = modelsCache.find(m => m.id === id);
  if (!model) {
    console.log('[getModel] Model not found:', id, 'Available models:', modelsCache.map(m => m.id).join(', '));
  }
  return model;
}

export function getAllModels(): Model[] {
  return modelsCache;
}

export async function addModel(model: Omit<Model, 'object' | 'created'>): Promise<Model> {
  const newModel = await modelsDB.createModel({
    ...model,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
  });
  modelsCache.push(newModel);
  return newModel;
}

export async function updateModel(id: string, updates: Partial<Model>): Promise<Model | null> {
  const updated = await modelsDB.updateModelById(id, updates);
  if (updated) {
    const index = modelsCache.findIndex(m => m.id === id);
    if (index !== -1) {
      modelsCache[index] = updated;
    }
  }
  return updated;
}

export async function deleteModel(id: string): Promise<boolean> {
  const deleted = await modelsDB.deleteModelById(id);
  if (deleted) {
    modelsCache = modelsCache.filter(m => m.id !== id);
  }
  return deleted;
}

// ==================== API Key 管理 ====================

export async function loadApiKeys(): Promise<ApiKey[]> {
  try {
    apiKeysCache = await apiKeysDB.getAllApiKeys();
    return apiKeysCache;
  } catch (e) {
    console.error('[Storage] Failed to load API keys:', e);
    return [];
  }
}

export function getAllApiKeys(): ApiKey[] {
  return apiKeysCache;
}

export async function createApiKey(name: string, userId?: string, permissions?: ApiKey['permissions']): Promise<ApiKey> {
  // 生成更复杂的 API key: sk- + 48位 base62 字符
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let key: string;
  let attempts = 0;
  const maxAttempts = 10;

  // 重试生成唯一的 API Key
  do {
    const randomValues = randomBytes(48);
    const keySuffix = Array.from(randomValues).map(b => chars[b % chars.length]).join('');
    key = `sk-${keySuffix}`;

    // 检查是否已存在
    const existing = apiKeysCache.find(k => k.key === key);
    if (!existing) {
      break;
    }

    attempts++;
  } while (attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    throw new Error('Failed to generate unique API key after multiple attempts');
  }

  const apiKey = await apiKeysDB.createApiKey({
    key,
    name,
    userId,
    createdAt: Date.now(),
    enabled: true,
    permissions,
  });
  apiKeysCache.push(apiKey);
  return apiKey;
}

export async function updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
  const updated = await apiKeysDB.updateApiKey(id, updates);
  if (updated) {
    const index = apiKeysCache.findIndex(k => k.id === id);
    if (index !== -1) {
      apiKeysCache[index] = updated;
    }
  }
  return updated;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const deleted = await apiKeysDB.deleteApiKey(id);
  if (deleted) {
    apiKeysCache = apiKeysCache.filter(k => k.id !== id);
  }
  return deleted;
}

export async function validateApiKey(key: string): Promise<ApiKey | null> {
  const apiKey = await apiKeysDB.getApiKeyByKey(key);
  if (!apiKey || !apiKey.enabled) return null;
  
  // 检查过期时间
  if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
    return null;
  }

  // 检查用户是否存在且启用
  if (!apiKey.userId) {
    return null; // API key 没有关联用户
  }
  let user = getUserById(apiKey.userId);

  // 内存缓存中没找到，尝试直接查数据库（防止缓存未加载导致误删）
  if (!user) {
    console.log(`[API Key] User ${apiKey.userId} not found in cache for key ${apiKey.id}, checking DB...`);
    try {
      const dbUser = await usersDB.getUser(apiKey.userId);
      if (dbUser) {
        // 数据库中有用户但缓存没有，可能是缓存过期或未加载
        // 尝试刷新用户缓存
        console.log(`[API Key] User ${apiKey.userId} found in DB but not in cache, reloading users...`);
        await loadUsers();
        user = getUserById(apiKey.userId);
      }
    } catch (e) {
      console.error(`[API Key] DB lookup failed for user ${apiKey.userId}:`, e);
    }
  }

  if (!user) {
    // 用户确实不存在（数据库中也查不到），记录日志但不删除
    console.log(`[API Key] Orphan API key detected: ${apiKey.id}, userId: ${apiKey.userId} — NOT deleting (preserving data integrity)`);
    return null;
  }
  
  if (!user.enabled) {
    // 用户已禁用
    return null;
  }
  
  // 更新最后使用时间
  await apiKeysDB.updateApiKey(apiKey.id, { lastUsedAt: Date.now() });
  
  return apiKey;
}

// ==================== 用户管理 ====================

export async function loadUsers(): Promise<User[]> {
  try {
    usersCache = await usersDB.getAllUsers();
    return usersCache;
  } catch (e) {
    console.error('[Storage] Failed to load users:', e);
    return [];
  }
}

export function getAllUsers(): User[] {
  return usersCache;
}

export function getUserById(id: string): User | undefined {
  return usersCache.find(u => u.id === id);
}

export function getUserByUsername(username: string): User | undefined {
  return usersCache.find(u => u.username === username);
}

export function getUserByEmail(email: string): User | undefined {
  return usersCache.find(u => u.email === email);
}

export function getUserByUid(uid: string): User | undefined {
  return usersCache.find(u => u.uid === uid);
}

export async function createUser(user: Omit<User, 'id'>): Promise<User> {
  const newUser = await usersDB.createUser(user);
  usersCache.push(newUser);
  return newUser;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  // 防止修改UID
  const { uid, ...safeUpdates } = updates;
  
  const updated = await usersDB.updateUser(id, safeUpdates);
  if (updated) {
    const index = usersCache.findIndex(u => u.id === id);
    if (index !== -1) {
      usersCache[index] = updated;
    }
  }
  return updated;
}

export async function deleteUser(id: string): Promise<boolean> {
  const deleted = await usersDB.deleteUser(id);
  if (deleted) {
    usersCache = usersCache.filter(u => u.id !== id);
  }
  return deleted;
}

// ==================== 使用记录管理 ====================

export async function loadUsageRecords(): Promise<UsageRecord[]> {
  try {
    usageRecordsCache = await usageRecordsDB.getAllUsageRecords();
    return usageRecordsCache;
  } catch (e) {
    console.error('[Storage] Failed to load usage records:', e);
    return [];
  }
}

export function getAllUsageRecords(): UsageRecord[] {
  return usageRecordsCache;
}

export async function createUsageRecord(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
  const newRecord = await usageRecordsDB.createUsageRecord(record);
  usageRecordsCache.push(newRecord);
  return newRecord;
}

export function getUserUsageRecords(userId: string): UsageRecord[] {
  return usageRecordsCache.filter(r => r.userId === userId);
}

export async function getUserUsageSummary(userId: string): Promise<{
  totalTokens: number;
  totalCost: number;
  recordCount: number;
}> {
  return usageRecordsDB.getUserUsageSummary(userId);
}

// ==================== 账单管理 ====================

export async function loadInvoices(): Promise<Invoice[]> {
  try {
    invoicesCache = await invoicesDB.getAllInvoices();
    return invoicesCache;
  } catch (e) {
    console.error('[Storage] Failed to load invoices:', e);
    return [];
  }
}

export function getAllInvoices(): Invoice[] {
  return invoicesCache;
}

export async function createInvoice(invoice: Omit<Invoice, 'id'>): Promise<Invoice> {
  const newInvoice = await invoicesDB.createInvoice(invoice);
  invoicesCache.push(newInvoice);
  return newInvoice;
}

// ==================== Action 管理 ====================

export async function loadActions(): Promise<Action[]> {
  try {
    const actions = await actionsDB.getAllActions();
    // 转换 ID 为 @uid/name 格式
    actionsCache = actions.map(action => {
      if (action.createdBy) {
        const user = getUserById(action.createdBy);
        if (user && user.uid) {
          return {
            ...action,
            id: `@${user.uid}/${action.name}`,
          };
        }
      }
      return action;
    });
    return actionsCache;
  } catch (e) {
    console.error('[Storage] Failed to load actions:', e);
    return [];
  }
}

export function getAllActions(): Action[] {
  return actionsCache;
}

export function getActionById(id: string): Action | undefined {
  // 支持三种格式：
  // 1. ObjectId (24 字符十六进制)
  // 2. @uid/name 格式
  // 3. 原始 id 字段
  return actionsCache.find(a =>
    a._id === id ||           // ObjectId
    a.id === id ||            // @uid/name 或其他 id
    a.name === id             // 名称
  );
}

export function getActionByName(name: string): Action | undefined {
  return actionsCache.find(a => a.name === name);
}

export function getPublicActions(): Action[] {
  return actionsCache.filter(a => a.isPublic);
}

export function getUserActions(userId: string): Action[] {
  return actionsCache.filter(a => a.createdBy === userId);
}

export function getPublicAndUserActions(userId?: string): Action[] {
  return actionsCache.filter(a => a.isPublic || a.createdBy === userId);
}

export async function createAction(action: Omit<Action, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Action> {
  const now = Date.now();
  
  // 先计算正确的 ID
  let actionId: string | undefined;
  if (action.createdBy) {
    const user = getUserById(action.createdBy);
    if (user && user.uid) {
      actionId = `@${user.uid}/${action.name}`;
    }
  }

  const newAction = await actionsDB.createAction({
    ...action,
    id: actionId, // 传入计算好的 ID
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as any);

  actionsCache.push(newAction);
  return newAction;
}

export async function updateAction(id: string, updates: Partial<Action>): Promise<Action | null> {
  const updated = await actionsDB.updateAction(id, {
    ...updates,
    updatedAt: Date.now(),
  });
  if (updated) {
    const index = actionsCache.findIndex(a => a._id === id || a.id === id || a.name === id);
    if (index !== -1) {
      actionsCache[index] = updated;
    }
  }
  return updated;
}

export async function deleteAction(id: string): Promise<boolean> {
  const deleted = await actionsDB.deleteAction(id);
  if (deleted) {
    actionsCache = actionsCache.filter(a => a._id !== id && a.id !== id && a.name !== id);
  }
  return deleted;
}

// ==================== Workflow 管理 ====================

let workflowsCache: Workflow[] = [];

export async function loadWorkflows(): Promise<Workflow[]> {
  // TODO: 实现 MongoDB workflow 存储
  return workflowsCache;
}

export function getAllWorkflows(): Workflow[] {
  return workflowsCache;
}

export function getWorkflowById(id: string): Workflow | undefined {
  return workflowsCache.find(w => w.id === id);
}

export function getUserWorkflows(userId: string): Workflow[] {
  return workflowsCache.filter(w => w.createdBy === userId);
}

export async function createWorkflow(workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workflow> {
  const now = Date.now();
  const newWorkflow: Workflow = {
    ...workflow,
    id: `wf_${Date.now()}_${randomBytes(4).toString('hex')}`,
    createdAt: now,
    updatedAt: now,
  };
  workflowsCache.push(newWorkflow);
  return newWorkflow;
}

export async function updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow | null> {
  const index = workflowsCache.findIndex(w => w.id === id);
  if (index === -1) return null;

  workflowsCache[index] = {
    ...workflowsCache[index],
    ...updates,
    updatedAt: Date.now(),
  };
  return workflowsCache[index];
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const index = workflowsCache.findIndex(w => w.id === id);
  if (index === -1) return false;

  workflowsCache.splice(index, 1);
  return true;
}

// ==================== Workflow 运行记录管理 ====================

let workflowRunsCache: WorkflowRun[] = [];

export function getAllWorkflowRuns(userId?: string, workflowId?: string): WorkflowRun[] {
  let runs = workflowRunsCache;
  if (userId) runs = runs.filter(r => r.userId === userId);
  if (workflowId) runs = runs.filter(r => r.workflowId === workflowId);
  return [...runs].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function getWorkflowRunById(id: string): WorkflowRun | undefined {
  return workflowRunsCache.find(r => r.id === id);
}

export async function createWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
  workflowRunsCache.unshift(run);
  return run;
}

export async function updateWorkflowRun(id: string, updates: Partial<WorkflowRun>): Promise<WorkflowRun | null> {
  const index = workflowRunsCache.findIndex(r => r.id === id);
  if (index === -1) return null;
  workflowRunsCache[index] = {
    ...workflowRunsCache[index],
    ...updates,
    completedAt: updates.status === 'success' || updates.status === 'failure' ? Date.now() : workflowRunsCache[index].completedAt,
  };
  return workflowRunsCache[index];
}

// ==================== 邀请记录管理 ====================

let invitationsCache: InvitationRecord[] = [];

export async function loadInvitationRecords(): Promise<InvitationRecord[]> {
  try {
    invitationsCache = await invitationsDB.getAllInvitationRecords();
    return invitationsCache;
  } catch (e) {
    console.error('[Storage] Failed to load invitations:', e);
    return [];
  }
}

export function getAllInvitationRecords(): InvitationRecord[] {
  return invitationsCache;
}

export async function createInvitationRecord(record: Omit<InvitationRecord, 'id' | 'createdAt'>): Promise<InvitationRecord> {
  const newRecord = await invitationsDB.createInvitationRecord(record);
  invitationsCache.push(newRecord);
  return newRecord;
}

export function getInvitationsByInviter(inviterId: string): InvitationRecord[] {
  return invitationsCache.filter(r => r.inviterId === inviterId);
}

// ==================== 通知管理 ====================

export async function loadNotifications(): Promise<Notification[]> {
  try {
    notificationsCache = await notificationsDB.getAllNotifications();
    return notificationsCache;
  } catch (e) {
    console.error('[Storage] Failed to load notifications:', e);
    return [];
  }
}

export function getAllNotifications(): Notification[] {
  return notificationsCache;
}

export function getActiveNotifications(): Notification[] {
  return notificationsCache
    .filter(n => n.isActive !== false)
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.createdAt - a.createdAt;
    });
}

export function getNotificationById(id: string): Notification | undefined {
  return notificationsCache.find(n => n.id === id);
}

export async function createNotification(notification: Omit<Notification, 'id' | 'createdAt'>): Promise<Notification> {
  const newNotification = await notificationsDB.createNotification({
    ...notification,
    isActive: true,
  });
  notificationsCache.push(newNotification);
  return newNotification;
}

export async function updateNotification(id: string, updates: Partial<Notification>): Promise<Notification | null> {
  const updated = await notificationsDB.updateNotification(id, {
    ...updates,
    updatedAt: Date.now(),
  });
  if (updated) {
    const index = notificationsCache.findIndex(n => n.id === id);
    if (index !== -1) {
      notificationsCache[index] = updated;
    }
  }
  return updated;
}

export async function deleteNotification(id: string): Promise<boolean> {
  const deleted = await notificationsDB.deleteNotification(id);
  if (deleted) {
    notificationsCache = notificationsCache.filter(n => n.id !== id);
  }
  return deleted;
}

// ==================== 额外的辅助函数 ====================

// ==================== 节点管理 ====================

export async function loadNodes(): Promise<Node[]> {
 try {
 nodesCache = await nodesDB.getAllNodes();
 return nodesCache;
 } catch (e) {
 console.error('[Storage] Failed to load nodes:', e);
 return [];
 }
}

export function getAllNodes(): Node[] {
 return nodesCache;
}

export function getNodeById(id: string): Node | undefined {
 return nodesCache.find(n => n.id === id);
}

export function getNodeByKey(key: string): Node | undefined {
 return nodesCache.find(n => n.key === key);
}

export async function addNode(node: Omit<Node, 'createdAt' | 'updatedAt' | 'status' | 'lastSeenAt'>): Promise<Node> {
 const newNode = await nodesDB.createNode(node);
 nodesCache.push(newNode);
 return newNode;
}

export async function updateNode(id: string, updates: Partial<Node>): Promise<Node | null> {
 const updated = await nodesDB.updateNodeById(id, updates);
 if (updated) {
 const index = nodesCache.findIndex(n => n.id === id);
 if (index !== -1) nodesCache[index] = updated;
 }
 return updated;
}

export async function deleteNode(id: string): Promise<boolean> {
 const deleted = await nodesDB.deleteNodeById(id);
 if (deleted) {
 nodesCache = nodesCache.filter(n => n.id !== id);
 }
 return deleted;
}

export async function touchNodeHeartbeat(id: string): Promise<Node | null> {
 const updated = await nodesDB.touchNodeHeartbeat(id);
 if (updated) {
 const index = nodesCache.findIndex(n => n.id === id);
 if (index !== -1) nodesCache[index] = updated;
 }
 return updated;
}

export async function markNodeOffline(id: string): Promise<void> {
 await nodesDB.markNodeOffline(id);
 const index = nodesCache.findIndex(n => n.id === id);
 if (index !== -1) {
 nodesCache[index] = {
 ...nodesCache[index],
 status: 'offline',
 updatedAt: Date.now(),
 };
 }
}

// ==================== 节点组管理 ====================

export async function loadNodeGroups(): Promise<NodeGroup[]> {
 try {
 nodeGroupsCache = await nodeGroupsDB.getAllNodeGroups();
 return nodeGroupsCache;
 } catch (e) {
 console.error('[Storage] Failed to load node groups:', e);
 return [];
 }
}

export function getAllNodeGroups(): NodeGroup[] {
 return nodeGroupsCache;
}

export function getNodeGroupById(id: string): NodeGroup | undefined {
 return nodeGroupsCache.find(g => g.id === id);
}

export async function createNodeGroup(group: Omit<NodeGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeGroup> {
 const created = await nodeGroupsDB.createNodeGroup(group);
 nodeGroupsCache.push(created);
 return created;
}

export async function updateNodeGroup(id: string, updates: Partial<NodeGroup>): Promise<NodeGroup | null> {
 const updated = await nodeGroupsDB.updateNodeGroupById(id, updates);
 if (updated) {
 const index = nodeGroupsCache.findIndex(g => g.id === id);
 if (index !== -1) nodeGroupsCache[index] = updated;
 }
 return updated;
}

export async function deleteNodeGroup(id: string): Promise<boolean> {
 const deleted = await nodeGroupsDB.deleteNodeGroupById(id);
 if (deleted) {
 nodeGroupsCache = nodeGroupsCache.filter(g => g.id !== id);
 // 解除模型对已删除组的引用
 modelsCache = modelsCache.map(m => m.nodeGroupId === id ? { ...m, nodeGroupId: undefined } : m);
 }
 return deleted;
}

// ==================== 节点组调度 ====================

let groupRRCursor: Record<string, number> = {};

/**
 * 从节点组中选择一个在线节点
 * 调度策略：round-robin 轮换 / random 随机 / priority 按优先级
 */
export function selectNodeFromGroup(group: NodeGroup): Node | null {
 if (!group.enabled || !group.nodeIds || group.nodeIds.length === 0) return null;

 const onlineNodes = group.nodeIds
 .map(id => getNodeById(id))
 .filter((n): n is Node => !!n && n.enabled && n.status === 'online');

 if (onlineNodes.length === 0) return null;

 switch (group.schedule) {
 case 'random': {
 const idx = Math.floor(Math.random() * onlineNodes.length);
 return onlineNodes[idx];
 }
 case 'priority': {
 const sorted = [...onlineNodes].sort((a, b) => {
 const pa = group.priorities?.[a.id] ?? 0;
 const pb = group.priorities?.[b.id] ?? 0;
 return pb - pa;
 });
 return sorted[0];
 }
 case 'round-robin':
 default: {
 const cursor = groupRRCursor[group.id] || 0;
 const selected = onlineNodes[cursor % onlineNodes.length];
 groupRRCursor[group.id] = cursor + 1;
 return selected;
 }
 }
}

/** 兼容入口：根据模型配置选择转发节点（优先节点组，其次单节点） */
export function selectNodeForModel(model: Model): Node | null {
 if (model.nodeGroupId) {
 const group = getNodeGroupById(model.nodeGroupId);
 if (group) {
 const node = selectNodeFromGroup(group);
 if (node) return node;
 }
 }
 if (model.nodeId) {
 const node = getNodeById(model.nodeId);
 return node && node.enabled && node.status === 'online' ? node : null;
 }
 return null;
}

// ==================== 提供商管理 ====================

export async function loadProviders(): Promise<Provider[]> {
 try {
 providersCache = await providersDB.getAllProviders();
 return providersCache;
 } catch (e) {
 console.error('[Storage] Failed to load providers:', e);
 return [];
 }
}

export function getAllProviders(): Provider[] {
 return providersCache;
}

export function getProviderById(id: string): Provider | undefined {
 return providersCache.find(p => p.id === id);
}

export async function addProvider(provider: Omit<Provider, 'createdAt' | 'updatedAt' | 'rrCursor'>): Promise<Provider> {
 const newProvider = await providersDB.createProvider(provider);
 providersCache.push(newProvider);
 return newProvider;
}

export async function updateProvider(id: string, updates: Partial<Provider>): Promise<Provider | null> {
 const updated = await providersDB.updateProviderById(id, updates);
 if (updated) {
 const index = providersCache.findIndex(p => p.id === id);
 if (index !== -1) providersCache[index] = updated;
 }
 return updated;
}

export async function deleteProvider(id: string): Promise<boolean> {
 const deleted = await providersDB.deleteProviderById(id);
 if (deleted) {
 providersCache = providersCache.filter(p => p.id !== id);
 }
 return deleted;
}

export async function addProviderKey(providerId: string, key: ProviderApiKey): Promise<Provider | null> {
 const updated = await providersDB.addProviderKey(providerId, key);
 if (updated) {
 const index = providersCache.findIndex(p => p.id === providerId);
 if (index !== -1) providersCache[index] = updated;
 }
 return updated;
}

export async function updateProviderKey(providerId: string, keyId: string, updates: Partial<ProviderApiKey>): Promise<Provider | null> {
 const updated = await providersDB.updateProviderKey(providerId, keyId, updates);
 if (updated) {
 const index = providersCache.findIndex(p => p.id === providerId);
 if (index !== -1) providersCache[index] = updated;
 }
 return updated;
}

export async function deleteProviderKey(providerId: string, keyId: string): Promise<Provider | null> {
 const updated = await providersDB.deleteProviderKey(providerId, keyId);
 if (updated) {
 const index = providersCache.findIndex(p => p.id === providerId);
 if (index !== -1) providersCache[index] = updated;
 }
 return updated;
}

export async function selectProviderKeyRoundRobin(providerId: string): Promise<{ provider: Provider; key: ProviderApiKey } | null> {
 const selected = await providersDB.selectRoundRobinProviderKey(providerId);
 if (!selected) return null;

 const index = providersCache.findIndex(p => p.id === providerId);
 if (index !== -1) {
 providersCache[index] = selected.provider;
 }

 return selected;
}

// 获取用户创建的 Actions
export function getActionsByCreator(userId: string): Action[] {
  return actionsCache.filter(a => a.createdBy === userId);
}

// 增加 Action 使用次数
export async function incrementActionUsage(id: string): Promise<void> {
  const action = actionsCache.find(a => a.id === id);
  if (action) {
    action.usageCount = (action.usageCount || 0) + 1;
    await actionsDB.updateAction(id, { usageCount: action.usageCount });
  }
}

// 获取邀请记录（别名）
export function getInvitationRecordsByInviter(inviterId: string): InvitationRecord[] {
  return getInvitationsByInviter(inviterId);
}

// 根据邀请码获取用户
export function getUserByInviteCode(inviteCode: string): User | undefined {
  return usersCache.find(u => u.inviteCode === inviteCode);
}

// 获取可用邀请配额
export function getAvailableInviteQuota(userId: string): number {
  const user = usersCache.find(u => u.id === userId);
  if (!user) return 0;
  
  // 基础配额 + 额外购买配额
  const baseQuota = 10; // 基础邀请配额
  const extraQuota = user.extraInviteQuota || 0;
  
  // 已使用的邀请次数
  const usedCount = invitationsCache.filter(r => r.inviterId === userId).length;
  
  return Math.max(0, baseQuota + extraQuota - usedCount);
}

// 生成邀请码
export function generateInviteCode(): string {
  return `INV-${randomBytes(6).toString('hex').toUpperCase()}`;
}

// 获取完整的 API Key（包含 key 字段）
export async function getFullApiKey(id: string): Promise<ApiKey | null> {
  const apiKey = await apiKeysDB.getApiKey(id);
  return apiKey;
}

// 获取日期范围内的使用记录
export function getUsageRecordsByDateRange(userId: string, startDate: Date, endDate: Date): UsageRecord[] {
  return usageRecordsCache.filter(r => 
    r.userId === userId && 
    r.timestamp >= startDate.getTime() && 
    r.timestamp <= endDate.getTime()
  );
}

// 获取用户账单
export function getUserInvoices(userId: string): Invoice[] {
  return invoicesCache.filter(i => i.userId === userId);
}

// 获取月度邀请数量
export function getMonthlyInviteCount(userId: string): number {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  return invitationsCache.filter(r => 
    r.inviterId === userId && 
    r.createdAt >= startOfMonth.getTime()
  ).length;
}

// 获取用户创建的工作流
export function getWorkflowsByCreator(userId: string): Workflow[] {
  return workflowsCache.filter(w => w.createdBy === userId);
}

// 获取公开的工作流
export function getPublicWorkflows(): Workflow[] {
  return workflowsCache.filter(w => w.isPublic);
}

// ==================== 缓存重载（导入备份后使用）====================

export async function reloadAllCaches(): Promise<void> {
  console.log('[Storage] Reloading all caches from database...');
  await loadModels();
  await loadApiKeys();
  await loadUsers();
  await loadUsageRecords();
  await loadInvoices();
  await loadActions();
  await loadWorkflows();
  await loadInvitationRecords();
  await loadNotifications();
  await loadProviders();
  await loadNodes();
  await loadNodeGroups();
  console.log('[Storage] All caches reloaded successfully');
}