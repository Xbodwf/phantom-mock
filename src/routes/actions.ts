import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware.js';
import {
  getAllActions,
  getActionById,
  getActionsByCreator,
  getPublicActions,
  createAction,
  updateAction,
  deleteAction,
  incrementActionUsage,
  getUserById,
} from '../storage.js';
import { getSandboxInterfacesDoc } from '../actions/sandboxInterfaces.js';
import { getActionMetadata, validateActionCode } from '../actions/executor.js';

const router: Router = Router();

/**
 * 获取所有 Actions（包括公开的和用户自己的）
 */
router.get('/actions', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const publicActions = getPublicActions();
    const userActions = getActionsByCreator(req.userId!);
    const allActions = [...publicActions, ...userActions];

    // 去重
    const uniqueActions = Array.from(
      new Map(allActions.map(a => [a.id, a])).values()
    );

    res.json(uniqueActions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get actions' });
  }
});

/**
 * 获取单个 Action
 */
router.get('/actions/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const action = getActionById(id);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // 检查权限
    if (!action.isPublic && action.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(action);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get action' });
  }
});

/**
 * 创建 Action
 */
router.post('/actions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, code, isPublic } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const action = await createAction({
      name,
      description,
      code,
      createdBy: req.userId!,
      isPublic: isPublic || false,
    });

    res.status(201).json(action);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create action' });
  }
});

/**
 * 更新 Action
 */
router.put('/actions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const action = getActionById(id);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // 检查权限
    if (action.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, description, code, isPublic } = req.body;
    const updated = await updateAction(id, {
      name,
      description,
      code,
      isPublic,
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update action' });
  }
});

/**
 * 删除 Action
 */
router.delete('/actions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const action = getActionById(id);
    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // 检查权限
    if (action.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await deleteAction(id);
    res.json({ message: 'Action deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete action' });
  }
});

/**
 * 获取 Action 沙箱接口文档
 */
router.get('/actions/docs/sandbox', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const doc = getSandboxInterfacesDoc();
    res.json({ documentation: doc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get sandbox documentation' });
  }
});

/**
 * 验证 Action 代码并提取 metadata
 */
router.post('/actions/validate', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // 验证代码
    const validation = validateActionCode(code);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Code validation failed',
        details: validation.error,
      });
    }

    // 提取 metadata
    const metadata = getActionMetadata({ code } as any);

    res.json({
      valid: true,
      metadata: metadata || {},
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to validate action code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 发布 Action 到市场
 * 命名规则：@uid/action_name
 */
router.post('/actions/:id/publish', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const action = getActionById(id);

    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // 检查权限
    if (action.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 获取用户信息
    const user = getUserById(req.userId!);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 检查用户是否设置了 UID
    if (!user.uid) {
      return res.status(400).json({
        error: 'UID not set',
        message: 'Please set your UID before publishing actions',
      });
    }

    // 检查是否已发布
    if (action.isPublic) {
      return res.status(400).json({ error: 'Action is already published' });
    }

    // 发布 Action
    const published = await updateAction(id, {
      isPublic: true,
    });

    res.json({
      success: true,
      action: published,
      publishedName: `@${user.uid}/${action.name}`,
      message: 'Action published successfully',
    });
  } catch (error) {
    console.error('[Publish Action Error]', error);
    res.status(500).json({ error: 'Failed to publish action' });
  }
});

/**
 * 取消发布 Action
 */
router.post('/actions/:id/unpublish', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const action = getActionById(id);

    if (!action) {
      return res.status(404).json({ error: 'Action not found' });
    }

    // 检查权限
    if (action.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 检查是否已发布
    if (!action.isPublic) {
      return res.status(400).json({ error: 'Action is not published' });
    }

    // 取消发布
    const unpublished = await updateAction(id, {
      isPublic: false,
    });

    res.json({
      success: true,
      action: unpublished,
      message: 'Action unpublished successfully',
    });
  } catch (error) {
    console.error('[Unpublish Action Error]', error);
    res.status(500).json({ error: 'Failed to unpublish action' });
  }
});

export default router;
