import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware.js';
import { saveAttachment, getAttachment, removeAttachment, removeSessionAttachments } from '../attachmentStorage.js';

const router = Router();

// 所有附件路由都需要鉴权
router.use(authMiddleware);

/**
 * 上传附件
 * POST /api/attachments
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sessionId, messageId, fileName, fileType, data } = req.body;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!sessionId || !messageId || !fileName || !fileType || !data) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const attachment = await saveAttachment(
      sessionId,
      messageId,
      fileName,
      fileType,
      data,
      userId
    );

    res.json({
      success: true,
      attachment: {
        id: attachment.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
      },
    });
  } catch (error) {
    console.error('Upload attachment error:', error);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

/**
 * 获取附件
 * GET /api/attachments/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const attachment = await getAttachment(id);

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // 检查权限：只有创建者可以访问
    if (attachment.createdBy !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 返回base64数据
    res.json({
      success: true,
      attachment: {
        id: attachment.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        data: attachment.data,
      },
    });
  } catch (error) {
    console.error('Get attachment error:', error);
    res.status(500).json({ error: 'Failed to get attachment' });
  }
});

/**
 * 删除附件
 * DELETE /api/attachments/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const attachment = await getAttachment(id);

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // 检查权限：只有创建者可以删除
    if (attachment.createdBy !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const deleted = await removeAttachment(id);

    res.json({ success: deleted });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

/**
 * 删除会话的所有附件
 * DELETE /api/attachments/session/:sessionId
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const count = await removeSessionAttachments(sessionId);

    res.json({ success: true, deletedCount: count });
  } catch (error) {
    console.error('Delete session attachments error:', error);
    res.status(500).json({ error: 'Failed to delete session attachments' });
  }
});

export default router;
