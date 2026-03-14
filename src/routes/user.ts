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
      key: undefined, // 不返回完整 key
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

    const apiKey = await createApiKey(name, {
      models: [],
      endpoints: ['chat', 'image', 'video'],
    });

    // 关联到用户
    await updateApiKey(apiKey.id, { userId: req.userId });

    const fullKey = getFullApiKey(apiKey.id);

    res.status(201).json({
      success: true,
      key: {
        id: apiKey.id,
        name: apiKey.name,
        key: fullKey,
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
    const { name, enabled } = req.body;

    const allKeys = getAllApiKeys();
    const key = allKeys.find(k => k.id === id && k.userId === req.userId);

    if (!key) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (enabled !== undefined) updates.enabled = enabled;

    const updated = await updateApiKey(id, updates);
    res.json(updated);
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
      const start = new Date(startDate as string).getTime();
      const end = new Date(endDate as string).getTime();
      records = getUsageRecordsByDateRange(req.userId!, start, end);
    }

    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage records' });
  }
});

export default router;
