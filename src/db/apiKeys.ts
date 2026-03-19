import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { ApiKey } from '../types';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'apiKeys';

export async function createApiKey(apiKey: Omit<ApiKey, 'id'> & { id?: string; _id?: ObjectId }): Promise<ApiKey> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...apiKey,
    _id: apiKey._id || new ObjectId(),
    createdAt: apiKey.createdAt || new Date(),
  };

  await collection.insertOne(doc);
  return toEntity<ApiKey>(doc);
}

export async function getApiKey(id: string): Promise<ApiKey | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 查找
  let doc = await collection.findOne({ id });
  
  // 如果没找到，尝试通过 ObjectId 查找
  if (!doc && ObjectId.isValid(id) && id.length === 24) {
    doc = await collection.findOne({ _id: new ObjectId(id) });
  }

  if (!doc) return null;
  return toEntity<ApiKey>(doc);
}

export async function getApiKeyByKey(key: string): Promise<ApiKey | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ key });
  if (!doc) return null;

  return toEntity<ApiKey>(doc);
}

export async function getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ userId }).toArray();
  return toEntities<ApiKey>(docs);
}

export async function getAllApiKeys(): Promise<ApiKey[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).toArray();
  return toEntities<ApiKey>(docs);
}

export async function updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $set: updates },
    { returnDocument: 'after' }
  );

  // 如果没找到，尝试通过 ObjectId 更新
  if (!result || !result.value) {
    if (ObjectId.isValid(id) && id.length === 24) {
      result = await collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updates },
        { returnDocument: 'after' }
      );
    }
  }

  if (!result || !result.value) return null;
  return toEntity<ApiKey>(result.value);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 通过业务 id 删除
  let result = await collection.deleteOne({ id });

  // 如果没删除，尝试通过 ObjectId 删除
  if (result.deletedCount === 0 && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.deleteOne({ _id: new ObjectId(id) });
  }

  return result.deletedCount > 0;
}

export async function updateApiKeyLastUsed(id: string): Promise<ApiKey | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $set: { lastUsedAt: new Date() } },
    { returnDocument: 'after' }
  );

  // 如果没找到，尝试通过 ObjectId 更新
  if (!result || !result.value) {
    if (ObjectId.isValid(id) && id.length === 24) {
      result = await collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { lastUsedAt: new Date() } },
        { returnDocument: 'after' }
      );
    }
  }

  if (!result || !result.value) return null;
  return toEntity<ApiKey>(result.value);
}