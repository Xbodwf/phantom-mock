import { Router, Response, NextFunction } from 'express';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';
import { generateNodeToken } from '../auth.js';
import { isNodeConnected } from '../reverseWebSocket.js';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getAllApiKeys,
  getUserUsageRecords,
  getAllActions,
  getAllModels,
  getModel,
  addModel,
  updateModel,
  deleteModel,
  getAllNotifications,
  getNotificationById,
  createNotification,
  updateNotification,
  deleteNotification,
  loadNotifications,
  getInvitationRecordsByInviter,
 getAllProviders,
 getProviderById,
 addProvider,
 updateProvider,
 deleteProvider,
 addProviderKey,
 updateProviderKey,
 deleteProviderKey,
 getAllNodes,
 getNodeById,
 addNode,
 updateNode,
 deleteNode,
} from '../storage.js';

const router: Router = Router();

/**
 * 获取所有用户
 */
router.get('/users', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    let users = getAllUsers();

    // 搜索和筛选
    const { search, role, enabled, sortBy, sortOrder } = req.query;

    // 搜索：用户名、邮箱、ID
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      users = users.filter(u =>
        u.username.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower) ||
        u.id.toLowerCase().includes(searchLower)
      );
    }

    // 按角色筛选
    if (role && typeof role === 'string' && (role === 'user' || role === 'admin')) {
      users = users.filter(u => u.role === role);
    }

    // 按启用状态筛选
    if (enabled !== undefined) {
      const enabledBool = enabled === 'true';
      users = users.filter(u => u.enabled === enabledBool);
    }

    // 排序
    const sortByField = (sortBy as string) || 'createdAt';
    const sortOrderVal = (sortOrder as string) === 'asc' ? 1 : -1;

    users.sort((a, b) => {
      let aVal: any = a[sortByField as keyof typeof a];
      let bVal: any = b[sortByField as keyof typeof b];

      if (aVal === undefined) aVal = '';
      if (bVal === undefined) bVal = '';

      if (typeof aVal === 'string') {
        return aVal.localeCompare(bVal) * sortOrderVal;
      }
      return (aVal - bVal) * sortOrderVal;
    });

    // 创建用户ID到用户名的映射
    const userIdToName = new Map<string, string>();
    getAllUsers().forEach(u => userIdToName.set(u.id, u.username));

    res.json(
      users.map(u => {
        // 计算该用户邀请的人数
        const invitationRecords = getInvitationRecordsByInviter(u.id);

        return {
          id: u.id,
          username: u.username,
          email: u.email,
          balance: u.balance,
          totalUsage: u.totalUsage,
          role: u.role,
          enabled: u.enabled,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          inviteCode: u.inviteCode,
          invitedBy: u.invitedBy,
          invitedByName: u.invitedBy ? userIdToName.get(u.invitedBy) || '-' : null,
          invitationCount: invitationRecords.length,
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * 获取用户详情
 */
router.get('/users/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const apiKeys = getAllApiKeys().filter(k => k.userId === user.id);
    const usageRecords = getUserUsageRecords(user.id);

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      totalUsage: user.totalUsage,
      role: user.role,
      enabled: user.enabled,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      apiKeys: apiKeys.length,
      totalRequests: usageRecords.length,
      totalCost: usageRecords.reduce((sum, r) => sum + r.cost, 0),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

/**
 * 更新用户（充值/扣费/启用/禁用）
 */
router.put('/users/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { balance, enabled, role } = req.body;

    const user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates: any = {};
    if (balance !== undefined) {
      updates.balance = balance;
    }
    if (enabled !== undefined) {
      updates.enabled = enabled;
    }
    if (role !== undefined && (role === 'user' || role === 'admin')) {
      updates.role = role;
    }

    const updated = await updateUser(userId, updates);
    res.json({
      id: updated!.id,
      username: updated!.username,
      email: updated!.email,
      balance: updated!.balance,
      role: updated!.role,
      enabled: updated!.enabled,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * 删除用户
 */
router.delete('/users/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const user = getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await deleteUser(id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * 获取全局使用统计
 */
router.get('/analytics/usage', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const users = getAllUsers();
    let totalUsers = users.length;
    let totalBalance = users.reduce((sum, u) => sum + u.balance, 0);
    let totalUsage = users.reduce((sum, u) => sum + u.totalUsage, 0);
    let totalCost = 0;

    users.forEach(user => {
      const records = getUserUsageRecords(user.id);
      totalCost += records.reduce((sum, r) => sum + r.cost, 0);
    });

    res.json({
      totalUsers,
      totalBalance,
      totalUsage,
      totalCost,
      averageBalance: totalUsers > 0 ? totalBalance / totalUsers : 0,
      averageUsage: totalUsers > 0 ? totalUsage / totalUsers : 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

/**
 * 获取系统统计
 */
router.get('/analytics/system', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const users = getAllUsers();
    const apiKeys = getAllApiKeys();
    const actions = getAllActions();
    const models = getAllModels();

    res.json({
      totalUsers: users.length,
      totalApiKeys: apiKeys.length,
      totalActions: actions.length,
      totalModels: models.length,
      activeUsers: users.filter(u => u.enabled).length,
      adminUsers: users.filter(u => u.role === 'admin').length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get system analytics' });
  }
});

/**
 * 获取用户的 API Keys
 */
router.get('/users/:id/api-keys', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const apiKeys = getAllApiKeys().filter(k => k.userId === id);
    res.json(apiKeys);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user API keys' });
  }
});

/**
 * 获取用户的使用记录
 */
router.get('/users/:id/usage', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const records = getUserUsageRecords(id);
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user usage' });
  }
});

// ==================== 通知管理 ====================

/**
 * 获取所有通知
 */
router.get('/notifications', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await loadNotifications();
    const notifications = getAllNotifications();
    res.json(notifications.sort((a, b) => b.createdAt - a.createdAt));
  } catch (error) {
    console.error('[Get Notifications Error]', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * 创建通知
 */
router.post('/notifications', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, isPinned } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const notification = await createNotification({
      title,
      content,
      createdBy: req.userId!,
      isPinned: isPinned || false,
      isActive: true,
    });

    res.status(201).json(notification);
  } catch (error) {
    console.error('[Create Notification Error]', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

/**
 * 更新通知
 */
router.put('/notifications/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { title, content, isPinned, isActive } = req.body;

    const notification = getNotificationById(id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (isPinned !== undefined) updates.isPinned = isPinned;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await updateNotification(id, updates);
    res.json(updated);
  } catch (error) {
    console.error('[Update Notification Error]', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

/**
 * 删除通知
 */
router.delete('/notifications/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const notification = getNotificationById(id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await deleteNotification(id);
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('[Delete Notification Error]', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

/**
 * 获取所有模型
 */
router.get('/models', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const models = getAllModels();
    res.json({ models });
  } catch (error) {
    console.error('[Get Models Error]', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

/**
 * 获取单个模型
 */
router.get('/models/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    // 处理模型名称中包含"/"的情况
    const decodedId = decodeURIComponent(id);
    const model = getModel(decodedId);

    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    res.json(model);
  } catch (error) {
    console.error('[Get Model Error]', error);
    res.status(500).json({ error: 'Failed to get model' });
  }
});

/**
 * 创建模型
 */
router.post('/models', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id, description, owned_by, type, pricing, supported_features, icon, api_key, api_base_url, api_type, api_url_templates, forwardModelName, forwardingMode, providerId, nodeId, providerUid, commissionRatio, targets } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Model ID is required' });
    }

    if (!type) {
      return res.status(400).json({ error: 'Model type is required' });
    }

    const newModel = await addModel({
      id,
      description,
      owned_by,
      type,
      pricing,
      supported_features,
      icon,
      api_key,
      api_base_url,
      api_type,
      api_url_templates,
      forwardModelName,
 forwardingMode,
 providerId,
 nodeId,
 providerUid,
  commissionRatio,
  targets,
    });

    res.status(201).json(newModel);
  } catch (error) {
    console.error('[Create Model Error]', error);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

/**
 * 更新模型
 */
router.put('/models/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    // 处理模型名称中包含"/"的情况
    const decodedId = decodeURIComponent(id);
    const updates = req.body;

    const model = getModel(decodedId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const updated = await updateModel(decodedId, updates);
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update model' });
    }

    res.json(updated);
  } catch (error) {
    console.error('[Update Model Error]', error);
    res.status(500).json({ error: 'Failed to update model' });
  }
});

/**
 * 删除模型
 */
router.delete('/models/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    // 处理模型名称中包含"/"的情况
    const decodedId = decodeURIComponent(id);

    const model = getModel(decodedId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const deleted = await deleteModel(decodedId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete model' });
    }

    res.json({ message: 'Model deleted successfully' });
  } catch (error) {
    console.error('[Delete Model Error]', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

/**
 * 获取所有提供商
 */
router.get('/providers', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
 try {
 const providers = getAllProviders().map(p => ({
 ...p,
 keys: (p.keys || []).map(k => ({ ...k, key: '***' })),
 }));
 res.json({ providers });
 } catch (error) {
 console.error('[Get Providers Error]', error);
 res.status(500).json({ error: 'Failed to get providers' });
 }
});

/**
 * 创建提供商
 */
router.post('/providers', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const { id, name, slug, description, enabled, api_type, api_base_url, api_url_templates, defaultHeaders, proxy, keys } = req.body;

 if (!id || !name || !slug || !api_type || !api_base_url) {
 return res.status(400).json({ error: 'id, name, slug, api_type, api_base_url are required' });
 }

 const created = await addProvider({
 id,
 name,
 slug,
 description,
 enabled: enabled !== false,
 api_type,
 api_base_url,
 api_url_templates,
 defaultHeaders,
 proxy,
 keys: Array.isArray(keys) ? keys : [],
 });

 res.status(201).json(created);
 } catch (error) {
 console.error('[Create Provider Error]', error);
 res.status(500).json({ error: 'Failed to create provider' });
 }
});

/**
 * 更新提供商
 */
router.put('/providers/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const exists = getProviderById(id);
 if (!exists) {
 return res.status(404).json({ error: 'Provider not found' });
 }

 const updated = await updateProvider(id, req.body || {});
 if (!updated) {
 return res.status(500).json({ error: 'Failed to update provider' });
 }

 res.json(updated);
 } catch (error) {
 console.error('[Update Provider Error]', error);
 res.status(500).json({ error: 'Failed to update provider' });
 }
});

/**
 * 删除提供商
 */
router.delete('/providers/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const exists = getProviderById(id);
 if (!exists) {
 return res.status(404).json({ error: 'Provider not found' });
 }

 const deleted = await deleteProvider(id);
 if (!deleted) {
 return res.status(500).json({ error: 'Failed to delete provider' });
 }

 res.json({ message: 'Provider deleted successfully' });
 } catch (error) {
 console.error('[Delete Provider Error]', error);
 res.status(500).json({ error: 'Failed to delete provider' });
 }
});

/**
 * 添加提供商Key
 */
router.post('/providers/:id/keys', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const { keyId, name, key, enabled } = req.body;
 if (!keyId || !name || !key) {
 return res.status(400).json({ error: 'keyId, name, key are required' });
 }

 const updated = await addProviderKey(id, { id: keyId, name, key, enabled: enabled !== false });
 if (!updated) {
 return res.status(404).json({ error: 'Provider not found' });
 }

 res.json(updated);
 } catch (error) {
 console.error('[Add Provider Key Error]', error);
 res.status(500).json({ error: 'Failed to add provider key' });
 }
});

/**
 * 更新提供商Key
 */
router.put('/providers/:id/keys/:keyId', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
 const updated = await updateProviderKey(id, keyId, req.body || {});
 if (!updated) {
 return res.status(404).json({ error: 'Provider or key not found' });
 }
 res.json(updated);
 } catch (error) {
 console.error('[Update Provider Key Error]', error);
 res.status(500).json({ error: 'Failed to update provider key' });
 }
});

/**
 * 删除提供商Key
 */
router.delete('/providers/:id/keys/:keyId', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
 const updated = await deleteProviderKey(id, keyId);
 if (!updated) {
 return res.status(404).json({ error: 'Provider or key not found' });
 }
 res.json(updated);
 } catch (error) {
 console.error('[Delete Provider Key Error]', error);
 res.status(500).json({ error: 'Failed to delete provider key' });
 }
});

/**
 * 获取所有节点
 */
router.get('/nodes', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
 try {
 const nodes = getAllNodes();
 res.json({ nodes });
 } catch (error) {
 console.error('[Get Nodes Error]', error);
 res.status(500).json({ error: 'Failed to get nodes' });
 }
});

/**
 * 创建节点
 */
router.post('/nodes', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const { id, name, description, enabled, capabilities, tags, tokenVersion } = req.body;
 if (!id || !name) {
 return res.status(400).json({ error: 'id and name are required' });
 }

 // 自动生成节点 key
 const { randomBytes } = await import('crypto');
 const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
 const randomValues = randomBytes(32);
 const key = 'node-' + Array.from(randomValues).map(b => chars[b % chars.length]).join('');

 const created = await addNode({
 id,
 name,
 key,
 description,
 enabled: enabled !== false,
 capabilities,
 tags,
 tokenVersion: typeof tokenVersion === 'number' ? tokenVersion : 1,
 });

 res.status(201).json(created);
 } catch (error) {
 console.error('[Create Node Error]', error);
 res.status(500).json({ error: 'Failed to create node' });
 }
});

/**
 * 更新节点
 */
router.put('/nodes/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const exists = getNodeById(id);
 if (!exists) {
 return res.status(404).json({ error: 'Node not found' });
 }

 const updated = await updateNode(id, req.body || {});
 if (!updated) {
 return res.status(500).json({ error: 'Failed to update node' });
 }

 res.json(updated);
 } catch (error) {
 console.error('[Update Node Error]', error);
 res.status(500).json({ error: 'Failed to update node' });
 }
});

/**
 * 删除节点
 */
router.delete('/nodes/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const exists = getNodeById(id);
 if (!exists) {
 return res.status(404).json({ error: 'Node not found' });
 }

 const deleted = await deleteNode(id);
 if (!deleted) {
 return res.status(500).json({ error: 'Failed to delete node' });
 }

 res.json({ message: 'Node deleted successfully' });
 } catch (error) {
 console.error('[Delete Node Error]', error);
 res.status(500).json({ error: 'Failed to delete node' });
 }
});

/**
 * 签发或轮换节点 token
 */
router.post('/nodes/:id/token', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const node = getNodeById(id);
 if (!node) {
 return res.status(404).json({ error: 'Node not found' });
 }

 const shouldRotate = req.body?.rotate === true;
 const nextTokenVersion = shouldRotate ? (node.tokenVersion ||1) +1 : (node.tokenVersion ||1);

 if (shouldRotate) {
 const updated = await updateNode(id, { tokenVersion: nextTokenVersion });
 if (!updated) {
 return res.status(500).json({ error: 'Failed to rotate node token version' });
 }
 }

 const token = generateNodeToken({
 nodeId: id,
 tokenVersion: nextTokenVersion,
 });

 res.json({
 nodeId: id,
 tokenVersion: nextTokenVersion,
 token,
 });
 } catch (error) {
 console.error('[Issue Node Token Error]', error);
 res.status(500).json({ error: 'Failed to issue node token' });
 }
});

/**
 * 获取节点状态
 */
router.get('/nodes/:id/status', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
 try {
 const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
 const node = getNodeById(id);
 if (!node) {
 return res.status(404).json({ error: 'Node not found' });
 }

 res.json({
 id: node.id,
 enabled: node.enabled,
 status: node.status,
 lastSeenAt: node.lastSeenAt,
 tokenVersion: node.tokenVersion,
 connected: isNodeConnected(node.id),
 });
 } catch (error) {
 console.error('[Get Node Status Error]', error);
 res.status(500).json({ error: 'Failed to get node status' });
 }
});

export default router;
