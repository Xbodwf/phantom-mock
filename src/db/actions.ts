import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { Action } from '../types';
import { ObjectId, MongoServerError } from 'mongodb';

const COLLECTION_NAME = 'actions';

export async function createAction(action: Omit<Action, 'id'> & { _id?: ObjectId }): Promise<Action> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 检查是否已存在同名的 action（同一用户）
  if (action.createdBy) {
    const existing = await collection.findOne({ 
      createdBy: action.createdBy, 
      name: action.name 
    });
    if (existing) {
      throw new Error(`Action with name "${action.name}" already exists for this user`);
    }
  }

  const doc = {
    ...action,
    _id: action._id || new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    isPublic: action.isPublic ?? false, // 默认不公开
  };

  try {
    await collection.insertOne(doc);
  } catch (error) {
    // 处理唯一索引冲突
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new Error(`Action with name "${action.name}" already exists for this user`);
    }
    throw error;
  }

  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Action;
}

export async function getAction(id: string): Promise<Action | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Action;
}

export async function getActionsByUser(userId: string): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ createdBy: userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Action[];
}

export async function getPublicActions(): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ isPublic: true }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Action[];
}

export async function getAllActions(): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Action[];
}

export async function updateAction(id: string, updates: Partial<Action>): Promise<Action | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // MongoDB 驱动 v6+ 直接返回文档，不再包装在 { value } 中
  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result) return null;

  const doc = result as any;
  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Action;
}

export async function deleteAction(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

export async function searchActions(query: {
  tags?: string[];
  category?: string;
  isPublic?: boolean;
}): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const filter: any = {};

  if (query.tags && query.tags.length > 0) {
    filter.tags = { $in: query.tags };
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.isPublic !== undefined) {
    filter.isPublic = query.isPublic;
  }

  const docs = await collection.find(filter).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Action[];
}
