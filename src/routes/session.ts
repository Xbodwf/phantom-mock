import { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getChatSessionById,
  updateChatSession,
  deleteChatSession,
  getUserChatSessions,
  createChatSession,
  getChatSessionsCollection
} from '../db/chatSessions.js';
import { AuthRequest } from '../middleware.js';

const router: Router = Router();

/**
 * POST /api/session - 创建新会话（需要认证）
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    // 使用 UUID v4 生成唯一ID
    const sessionId = uuidv4();

    const newSession = {
      id: sessionId,
      title: req.body.title || '新对话',
      model: req.body.model || '',
      systemPrompt: req.body.systemPrompt || 'You are a helpful AI assistant.',
      apiType: req.body.apiType || 'openai-chat',
      stream: req.body.stream !== undefined ? req.body.stream : true,
      timeout: req.body.timeout || 60,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: false,
      ownerId: userId,
    };

    const createdSession = await createChatSession(newSession);

    if (createdSession) {
      return res.json({
        ...createdSession,
        isOwner: true,
        isReadOnly: false,
      });
    } else {
      return res.status(500).json({
        error: {
          message: 'Failed to create session',
          type: 'internal_error',
        }
      });
    }
  } catch (error) {
    console.error('Error creating session:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
      }
    });
  }
});

/**
 * GET /api/session/list - 获取用户的会话列表（需要认证）
 * 必须在 /:id 之前定义，否则 /list 会被当成 id 处理
 */
router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    const sessions = await getUserChatSessions(userId);
    
    // 为所有会话添加权限信息
    const sessionsWithPermissions = sessions.map(session => ({
      ...session,
      isOwner: true,
      isReadOnly: false,
    }));

    return res.json(sessionsWithPermissions);
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
      }
    });
  }
});

/**
 * GET /api/session/:id - 获取会话（支持公开和私有）
 * 
 * - 公开会话：任何人可以访问（无需认证）
 * - 私有会话：仅所有者可以访问（需要认证且userId匹配）
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId; // 可能为 undefined（未认证）

    console.log(`[Session] GET /api/session/${id}, userId=${userId}`);

    // 直接从数据库获取会话
    const session = await getChatSessionById(id as string);

    if (!session) {
      console.log(`[Session] Session not found: ${id}`);
      return res.status(404).json({
        error: {
          message: 'Session not found',
          type: 'not_found_error',
        }
      });
    }

    const isOwner = userId && session.ownerId === userId;
    const isPublic = session.isPublic;

    // 权限检查
    if (!isPublic && !isOwner) {
      // 私有会话且不是所有者 → 无权限
      console.log(`[Session] Permission denied: private session, not owner`);
      return res.status(403).json({
        error: {
          message: 'You do not have permission to access this session',
          type: 'permission_error',
        }
      });
    }

    // 返回会话及权限信息
    const isReadOnly = !isOwner && isPublic;

    console.log(`[Session] Returning session: isOwner=${isOwner}, isReadOnly=${isReadOnly}, messages=${session.messages?.length || 0}`);
    return res.json({
      ...session,
      isOwner: isOwner || false,
      isReadOnly,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
      }
    });
  }
});

/**
 * PUT /api/session/:id - 更新会话（需要认证且为所有者）
 */
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const updates = req.body;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    // 检查会话是否存在
    const session = await getChatSessionById(id as string);

    if (!session) {
      return res.status(404). json({
        error: {
          message: 'Session not found',
          type: 'not_found_error',
        }
      });
    }

    // 检查是否是所有者
    if (session.ownerId !== userId) {
      return res.status(403).json({
        error: {
          message: 'You do not have permission to modify this session',
          type: 'permission_error',
        }
      });
    }

    console.log(`[Session] Updating session: ${id}`);
    const success = await updateChatSession(id as string, updates);

    if (success) {
      const updatedSession = await getChatSessionById(id as string);
      return res.json({
        ...updatedSession,
        isOwner: true,
        isReadOnly: false,
      });
    } else {
      return res.status(500).json({
        error: {
          message: 'Failed to update session',
          type: 'internal_error',
        }
      });
    }
  } catch (error) {
    console.error('Error updating session:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
      }
    });
  }
});

/**
 * DELETE /api/session/:id - 删除会话（需要认证且为所有者）
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        error: {
          message: 'Authentication required',
          type: 'authentication_error',
        }
      });
    }

    // 检查会话是否存在
    const session = await getChatSessionById(id as string);

    if (!session) {
      return res.status(404). json({
        error: {
          message: 'Session not found',
          type: 'not_found_error',
        }
      });
    }

    // 检查是否是所有者
    if (session.ownerId !== userId) {
      return res.status(403).json({
        error: {
          message: 'You do not have permission to delete this session',
          type: 'permission_error',
        }
      });
    }

    console.log(`[Session] Deleting session: ${id}`);
    const success = await deleteChatSession(id as string);

    if (success) {
      return res.json({ success: true });
    } else {
      return res.status(500).json({
        error: {
          message: 'Failed to delete session',
          type: 'internal_error',
        }
      });
    }
  } catch (error) {
    console.error('Error deleting session:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'internal_error',
      }
    });
  }
});

export default router;
