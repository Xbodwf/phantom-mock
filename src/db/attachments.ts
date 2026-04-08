import { ObjectId } from 'mongodb';
import { getDB } from './connection';
import { toEntity, toEntities } from './utils';

export interface Attachment {
  id: string;
  sessionId: string;
  messageId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  data: string; // base64编码的数据
  createdAt: number;
  createdBy: string;
}

const COLLECTION_NAME = 'attachments';

export async function createAttachment(attachment: Omit<Attachment, 'id' | 'createdAt'>): Promise<Attachment> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...attachment,
    id: new ObjectId().toString(),
    createdAt: Date.now(),
    _id: new ObjectId(),
  };

  await collection.insertOne(doc);
  return toEntity<Attachment>(doc);
}

export async function getAttachmentById(id: string): Promise<Attachment | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const doc = await collection.findOne({ id });
  if (!doc) return null;
  return toEntity<Attachment>(doc as any);
}

export async function getAttachmentsBySession(sessionId: string): Promise<Attachment[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const docs = await collection.find({ sessionId }).toArray();
  return toEntities<Attachment>(docs as any);
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.deleteOne({ id });
  return result.deletedCount > 0;
}

export async function deleteAttachmentsBySession(sessionId: string): Promise<number> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.deleteMany({ sessionId });
  return result.deletedCount;
}

export async function getAttachmentCount(sessionId: string): Promise<number> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  return await collection.countDocuments({ sessionId });
}
