import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getAllApiKeys, createApiKey, updateApiKey, deleteApiKey } from '../../storage.js';
import { adminMiddleware } from '../../middleware.js';

const router: RouterType = Router();

// GET /api/keys - 获取所有 API Keys（不包含完整 key）
router.get('/', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const keys = getAllApiKeys().map(k => ({
      ...k,
      key: undefined, // 不返回完整 key
    }));
    res.json({ keys });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

// GET /api/keys/:id/reveal - 查看 API Key 完整内容（增加查看计数）
router.get('/:id/reveal', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const apiKey = getAllApiKeys().find(k => k.id === id);

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
  } catch (e) {
    res.status(500).json({ error: 'Failed to reveal API key' });
  }
});

// POST /api/keys - 创建新的 API Key
router.post('/', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const { name, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const newKey = await createApiKey(name, permissions);
    res.json({ success: true, key: newKey });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// PUT /api/keys/:id - 更新 API Key
router.put('/:id', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, enabled, permissions } = req.body;

    const updated = await updateApiKey(id, { name, enabled, permissions });

    if (!updated) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ success: true, key: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// DELETE /api/keys/:id - 删除 API Key
router.delete('/:id', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const deleted = await deleteApiKey(id);

    if (!deleted) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
