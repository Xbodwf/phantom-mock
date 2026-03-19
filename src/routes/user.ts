import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware.js';
import {
  getUserById,
  updateUser,
  getAllApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  getFullApiKey,
  getUserUsageRecords,
  getUsageRecordsByDateRange,
  getUserInvoices,
  getInvitationRecordsByInviter,
  getAvailableInviteQuota,
  getMonthlyInviteCount,
  getAllUsers,
  getActiveNotifications,
  loadNotifications,
} from '../storage.js';
import { hashPassword, verifyPassword } from '../auth.js';

const router: Router = Router();

/**
 * 获取用户资料
 */
router.get('/profile', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const user = getUserById(req.userId!);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      balance: user.balance,
      totalUsage: user.totalUsage,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      role: user.role,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * 更新用户资料
 */
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { email } = req.body;
    const user = getUserById(req.userId!);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates: any = {};
    if (email && email !== user.email) {
      updates.email = email;
    }

    const updatedUser = await updateUser(req.userId!, updates);
    res.json({
      id: updatedUser!.id,
      username: updatedUser!.username,
      email: updatedUser!.email,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * 修改密码
 */
router.put('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = getUserById(req.userId!);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Missing password fields' });
    }

    const isValid = await verifyPassword(oldPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid old password' });
    }

    const newHash = await hashPassword(newPassword);
    await updateUser(req.userId!, { passwordHash: newHash });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

/**
 * 获取用户的 API Keys
 */
router.get('/api-keys', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const allKeys = getAllApiKeys();
    const userKeys = allKeys.filter(k => k.userId === req.userId).map(k => ({
      ...k,
      key: k.key ? `${k.key.substring(0, 10)}...` : undefined, // 显示前10位
    }));

    res.json({ keys: userKeys });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

/**
 * 查看 API Key 完整内容（增加查看计数）
 */
router.get('/api-keys/:id/reveal', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const allKeys = getAllApiKeys();
    const apiKey = allKeys.find(k => k.id === id && k.userId === req.userId);

    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // 增加查看计数
    const viewCount = (apiKey.viewCount || 0) + 1;

    if (viewCount > 3) {
      return res.status(403).json({
        error: 'View limit exceeded',
        message: '此 API Key 已超过查看次数限制（最多3次）'
      });
    }

    await updateApiKey(id, { viewCount });

    res.json({
      success: true,
      key: apiKey.key,
      viewCount,
      remainingViews: 3 - viewCount
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reveal API key' });
  }
});

/**
 * 创建 API Key
 */
router.post('/api-keys', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Missing API key name' });
    }

    const apiKey = await createApiKey(name, req.userId, {
      models: [],
      endpoints: ['chat', 'image', 'video'],
    });

    res.status(201).json({
      success: true,
      key: {
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key, // 返回完整的 key 字符串
        createdAt: apiKey.createdAt,
      },
      message: 'Save this key securely. You will not be able to see it again.',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * 更新 API Key
 */
router.put('/api-keys/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { name, enabled, permissions } = req.body;

    const allKeys = getAllApiKeys();
    const key = allKeys.find(k => k.id === id && k.userId === req.userId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (enabled !== undefined) updates.enabled = enabled;
    if (permissions !== undefined) {
      // 验证 permissions 结构
      const validatedPermissions: any = {};

      if (permissions.models !== undefined) {
        validatedPermissions.models = Array.isArray(permissions.models) ? permissions.models : [];
      }
      if (permissions.modelsMode !== undefined) {
        validatedPermissions.modelsMode = ['whitelist', 'blacklist'].includes(permissions.modelsMode)
          ? permissions.modelsMode
          : 'whitelist';
      }
      if (permissions.actions !== undefined) {
        validatedPermissions.actions = Array.isArray(permissions.actions) ? permissions.actions : [];
      }
      if (permissions.actionsMode !== undefined) {
        validatedPermissions.actionsMode = ['whitelist', 'blacklist'].includes(permissions.actionsMode)
          ? permissions.actionsMode
          : 'whitelist';
      }
      if (permissions.endpoints !== undefined) {
        validatedPermissions.endpoints = Array.isArray(permissions.endpoints) ? permissions.endpoints : [];
      }
      if (permissions.rateLimit !== undefined) {
        validatedPermissions.rateLimit = typeof permissions.rateLimit === 'number' ? permissions.rateLimit : undefined;
      }

      updates.permissions = { ...key.permissions, ...validatedPermissions };
    }

    const updated = await updateApiKey(id, updates);

    // 返回时隐藏完整的 key
    const response = {
      ...updated,
      key: updated?.key ? `${updated.key.substring(0, 10)}...` : undefined,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

/**
 * 删除 API Key
 */
router.delete('/api-keys/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const allKeys = getAllApiKeys();
    const key = allKeys.find(k => k.id === id && k.userId === req.userId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await deleteApiKey(id);
    res.json({ message: 'API key deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

/**
 * 获取使用统计
 */
router.get('/usage', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const records = getUserUsageRecords(req.userId!);

    const stats = {
      totalRequests: records.length,
      totalTokens: records.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost: records.reduce((sum, r) => sum + r.cost, 0),
      byModel: {} as Record<string, any>,
      byEndpoint: {} as Record<string, any>,
    };

    records.forEach(record => {
      // 按模型统计
      if (!stats.byModel[record.model]) {
        stats.byModel[record.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      stats.byModel[record.model].requests++;
      stats.byModel[record.model].tokens += record.totalTokens;
      stats.byModel[record.model].cost += record.cost;

      // 按端点统计
      if (!stats.byEndpoint[record.endpoint]) {
        stats.byEndpoint[record.endpoint] = { requests: 0, tokens: 0, cost: 0 };
      }
      stats.byEndpoint[record.endpoint].requests++;
      stats.byEndpoint[record.endpoint].tokens += record.totalTokens;
      stats.byEndpoint[record.endpoint].cost += record.cost;
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

/**
 * 获取账单
 */
router.get('/billing', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const invoices = getUserInvoices(req.userId!);
    const user = getUserById(req.userId!);

    res.json({
      balance: user?.balance || 0,
      invoices: invoices.map(inv => ({
        id: inv.id,
        period: inv.period,
        totalUsage: inv.totalUsage,
        totalCost: inv.totalCost,
        status: inv.status,
        createdAt: inv.createdAt,
        dueDate: inv.dueDate,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get billing info' });
  }
});

/**
 * 获取使用记录详情
 */
router.get('/usage/records', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    let records = getUserUsageRecords(req.userId!);

    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      records = getUsageRecordsByDateRange(req.userId!, start, end);
    }

    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage records' });
  }
});

// ==================== 邀请系统 ====================

/**
 * 获取邀请信息
 */
router.get('/invitation', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const user = getUserById(req.userId!);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const invitationRecords = getInvitationRecordsByInviter(req.userId!);
    const availableQuota = getAvailableInviteQuota(user.id);
    const monthlyUsed = getMonthlyInviteCount(req.userId!);

    // 获取被邀请人的详细信息
    const allUsers = getAllUsers();
    const invitedUsers = invitationRecords.map(record => {
      const invitee = allUsers.find(u => u.id === record.inviteeId);
      return {
        id: record.id,
        inviteeId: record.inviteeId,
        inviteeUsername: invitee?.username || 'Unknown',
        inviteeEmail: invitee?.email || '',
        createdAt: record.createdAt,
      };
    });

    res.json({
      inviteCode: user.inviteCode,
      invitedBy: user.invitedBy,
      availableQuota: user.role === 'admin' ? 'unlimited' : availableQuota,
      monthlyQuota: user.role === 'admin' ? 'unlimited' : 5,
      monthlyUsed,
      extraInviteQuota: user.extraInviteQuota || 0,
      totalInvited: invitationRecords.length,
      invitedUsers,
    });
  } catch (error) {
    console.error('[Get Invitation Error]', error);
    res.status(500).json({ error: 'Failed to get invitation info' });
  }
});

/**
 * 购买邀请次数
 */
router.post('/invitation/purchase', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { quantity } = req.body;
    const user = getUserById(req.userId!);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // admin 不需要购买
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Admin has unlimited invitations' });
    }

    // 验证数量
    const qty = parseInt(quantity) || 1;
    if (qty < 1 || qty > 10) {
      return res.status(400).json({ error: 'Quantity must be between 1 and 10' });
    }

    // 计算费用：每次 $2
    const cost = qty * 2;

    // 检查余额
    if (user.balance < cost) {
      return res.status(400).json({ error: 'Insufficient balance', required: cost, current: user.balance });
    }

    // 扣除余额并增加邀请次数
    await updateUser(req.userId!, {
      balance: user.balance - cost,
      extraInviteQuota: (user.extraInviteQuota || 0) + qty,
    });

    res.json({
      success: true,
      purchased: qty,
      cost,
      newBalance: user.balance - cost,
      extraInviteQuota: (user.extraInviteQuota || 0) + qty,
    });
  } catch (error) {
    console.error('[Purchase Invitation Error]', error);
    res.status(500).json({ error: 'Failed to purchase invitations' });
  }
});

// ==================== 通知系统 ====================

/**
 * 获取通知列表
 */
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await loadNotifications();
    const notifications = getActiveNotifications();
    res.json(notifications);
  } catch (error) {
    console.error('[Get Notifications Error]', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

export default router;
