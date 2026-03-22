import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { Action } from '../types';
import { ObjectId, MongoServerError } from 'mongodb';

const COLLECTION_NAME = 'actions';

/**
 * 将 MongoDB 文档转换为 Action 对象
 * 优先使用存储的 id 字段，否则使用 ObjectId
 */
function docToAction(doc: any): Action {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: doc.id || _id.toString(),
    _id: _id.toString(),
  } as unknown as Action;
}

export async function createAction(action: Omit<Action, 'id'> & { _id?: ObjectId; id?: string }): Promise<Action> {
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

  // 如果传入了 id 字段，使用它；否则使用 ObjectId
  const actionId = action.id || doc._id.toString();

  return docToAction({ ...doc, id: actionId });
}

export async function getAction(id: string): Promise<Action | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 先尝试按 id 字段查找，再按 _id 查找
  let doc = await collection.findOne({ id: id });
  if (!doc) {
    // 如果 id 看起来像 ObjectId，尝试按 _id 查找
    if (ObjectId.isValid(id) && id.length === 24) {
      doc = await collection.findOne({ _id: new ObjectId(id) });
    }
  }
  if (!doc) return null;

  return docToAction(doc);
}

export async function getActionsByUser(userId: string): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ createdBy: userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => docToAction(doc));
}

export async function getPublicActions(): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ isPublic: true }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => docToAction(doc));
}

export async function getAllActions(): Promise<Action[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => docToAction(doc));
}

export async function updateAction(id: string, updates: Partial<Action>): Promise<Action | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 构建查询条件：支持按 id 字段或 _id 查找
  let query: any = { id: id };
  if (ObjectId.isValid(id) && id.length === 24) {
    query = { $or: [{ id: id }, { _id: new ObjectId(id) }] };
  }

  // MongoDB 驱动 v6+ 直接返回文档，不再包装在 { value } 中
  const result = await collection.findOneAndUpdate(
    query,
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result) return null;

  return docToAction(result);
}

export async function deleteAction(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 构建查询条件：支持按 id 字段或 _id 查找
  let query: any = { id: id };
  if (ObjectId.isValid(id) && id.length === 24) {
    query = { $or: [{ id: id }, { _id: new ObjectId(id) }] };
  }

  const result = await collection.deleteOne(query);
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
