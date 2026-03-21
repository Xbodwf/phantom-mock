import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { User } from '../types';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'users';

// 创建用户索引
export async function createUserIndexes(): Promise<void> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 创建唯一索引
  await collection.createIndex({ username: 1 }, { unique: true });
  await collection.createIndex({ email: 1 }, { unique: true });
  await collection.createIndex({ inviteCode: 1 }, { sparse: true, unique: true });
}

export async function createUser(user: Omit<User, 'id'> & { id?: string; _id?: ObjectId }): Promise<User> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...user,
    _id: user._id || new ObjectId(),
    createdAt: user.createdAt || Date.now(),
    // 设置默认权限等级
    permissionLevel: user.permissionLevel ?? (user.role === 'admin' ? 100 : 0),
  };

  await collection.insertOne(doc);
  return toEntity<User>(doc);
}

export async function getUser(id: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 查找
  let doc = await collection.findOne({ id });

  // 如果没找到，尝试通过 ObjectId 查找
  if (!doc && ObjectId.isValid(id) && id.length === 24) {
    doc = await collection.findOne({ _id: new ObjectId(id) });
  }

  if (!doc) return null;
  return toEntity<User>(doc);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ username });
  if (!doc) return null;

  return toEntity<User>(doc);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ email });
  if (!doc) return null;

  return toEntity<User>(doc);
}

export async function getUserByInviteCode(inviteCode: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ inviteCode });
  if (!doc) return null;

  return toEntity<User>(doc);
}

export async function getUserByUid(uid: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ uid });
  if (!doc) return null;

  return toEntity<User>(doc);
}

export async function getAllUsers(): Promise<User[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).toArray();
  return toEntities<User>(docs);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $set: updates },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档，不再包装在 { value } 中
  // 如果没找到且 id 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 删除
  let result = await collection.deleteOne({ id });

  // 如果没删除，尝试通过 ObjectId 删除
  if (result.deletedCount === 0 && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.deleteOne({ _id: new ObjectId(id) });
  }

  return result.deletedCount > 0;
}

export async function updateUserBalance(id: string, amount: number): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $inc: { balance: amount } },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档
  // 如果没找到且 id 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { balance: amount } },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}

export async function updateUserUsage(id: string, tokens: number): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $inc: { totalUsage: tokens } },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档
  // 如果没找到且 id 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { totalUsage: tokens } },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}

// 添加用户拥有的模型
export async function addUserOwnedModel(userId: string, modelId: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id: userId },
    { $addToSet: { ownedModels: modelId } },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档
  // 如果没找到且 userId 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(userId) && userId.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $addToSet: { ownedModels: modelId } },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}

// 移除用户拥有的模型
export async function removeUserOwnedModel(userId: string, modelId: string): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id: userId },
    { $pull: { ownedModels: modelId as any } },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档
  // 如果没找到且 userId 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(userId) && userId.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $pull: { ownedModels: modelId as any } },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}

// 更新用户权限等级
export async function updateUserPermissionLevel(id: string, level: number): Promise<User | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 尝试通过业务 id 更新
  let result = await collection.findOneAndUpdate(
    { id },
    { $set: { permissionLevel: level } },
    { returnDocument: 'after' }
  );

  // MongoDB 驱动 v6+ 直接返回文档
  // 如果没找到且 id 是有效的 ObjectId，尝试通过 ObjectId 更新
  if (!result && ObjectId.isValid(id) && id.length === 24) {
    result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { permissionLevel: level } },
      { returnDocument: 'after' }
    );
  }

  if (!result) return null;
  return toEntity<User>(result as any);
}
