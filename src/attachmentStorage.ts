import crypto from 'crypto';
import { Attachment, createAttachment, getAttachmentById, deleteAttachment, deleteAttachmentsBySession, getAttachmentsBySession } from './db/attachments.js';

/**
 * 生成唯一的附件ID
 */
function generateAttachmentId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 保存base64编码的附件
 */
export async function saveAttachment(
  sessionId: string,
  messageId: string,
  fileName: string,
  fileType: string,
  base64Data: string,
  userId: string
): Promise<Attachment> {
  // 提取base64数据
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid base64 data format');
  }

  const mimeType = matches[1];
  const data = matches[2];
  const fileSize = Buffer.byteLength(data, 'base64');

  // 创建数据库记录
  const attachment = await createAttachment({
    sessionId,
    messageId,
    fileName,
    fileType: mimeType,
    fileSize,
    data: base64Data, // 存储完整的base64数据（包含data:xxx;base64,前缀）
    createdBy: userId,
  });

  return attachment;
}

/**
 * 获取附件
 */
export async function getAttachment(attachmentId: string): Promise<Attachment | null> {
  return await getAttachmentById(attachmentId);
}

/**
 * 删除附件
 */
export async function removeAttachment(attachmentId: string): Promise<boolean> {
  return await deleteAttachment(attachmentId);
}

/**
 * 删除会话的所有附件
 */
export async function removeSessionAttachments(sessionId: string): Promise<number> {
  return await deleteAttachmentsBySession(sessionId);
}

/**
 * 获取会话的所有附件
 */
export async function getSessionAttachments(sessionId: string): Promise<Attachment[]> {
  return await getAttachmentsBySession(sessionId);
}
