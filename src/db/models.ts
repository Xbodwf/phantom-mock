import { getDB } from './connection';
import { Model } from '../types';
import { ObjectId } from 'mongodb';
import { toEntity, toEntities } from './utils';

const COLLECTION_NAME = 'models';

// 创建模型索引
export async function createModelIndexes(): Promise<void> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  
  // 创建唯一索引确保模型 ID 唯一
  await collection.createIndex({ id: 1 }, { unique: true });
  // 创建其他常用查询索引
  await collection.createIndex({ owned_by: 1 });
  await collection.createIndex({ category: 1 });
  await collection.createIndex({ ownerId: 1 });
  await collection.createIndex({ isPublic: 1 });
}

export async function createModel(model: Omit<Model, 'id'> & { id: string }): Promise<Model> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...model,
    _id: new ObjectId(),
    created: model.created || Date.now(),
    object: 'model',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await collection.insertOne(doc);
  return toEntity<Model>(doc);
}

// 通过模型 ID（字符串）获取模型
export async function getModelById(id: string): Promise<Model | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ id });
  if (!doc) return null;

  return toEntity<Model>(doc);
}

// 通过 MongoDB ObjectId 获取模型
export async function getModel(objectId: string): Promise<Model | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ _id: new ObjectId(objectId) });
  if (!doc) return null;

  return toEntity<Model>(doc);
}

export async function getModelByName(name: string): Promise<Model | null> {
  return getModelById(name);
}

export async function getAllModels(): Promise<Model[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).toArray();
  return toEntities<Model>(docs);
}

// 通过模型 ID（字符串）更新模型
export async function updateModelById(id: string, updates: Partial<Model>): Promise<Model | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.findOneAndUpdate(
    { id },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result || !result.value) return null;

  return toEntity<Model>(result.value);
}

// 通过 MongoDB ObjectId 更新模型
export async function updateModel(objectId: string, updates: Partial<Model>): Promise<Model | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(objectId) },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result || !result.value) return null;

  return toEntity<Model>(result.value);
}

// 通过模型 ID（字符串）删除模型
export async function deleteModelById(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteOne({ id });
  return result.deletedCount > 0;
}

// 通过 MongoDB ObjectId 删除模型
export async function deleteModel(objectId: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteOne({ _id: new ObjectId(objectId) });
  return result.deletedCount > 0;
}

// 更新模型评分
export async function updateModelRating(modelId: string, userId: string, score: number): Promise<Model | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const model = await getModelById(modelId);
  if (!model) return null;

  const currentRating = model.rating || {
    positiveCount: 0,
    negativeCount: 0,
    averageScore: 0,
    ratings: {} as Record<string, number>,
  };

  const ratings: Record<string, number> = (currentRating.ratings as Record<string, number>) || {};
  const oldScore = ratings[userId];
  
  // 更新评分统计
  if (oldScore !== undefined) {
    // 用户已评分，更新评分
    if (oldScore >= 3 && score < 3) {
      currentRating.positiveCount = (currentRating.positiveCount || 0) - 1;
      currentRating.negativeCount = (currentRating.negativeCount || 0) + 1;
    } else if (oldScore < 3 && score >= 3) {
      currentRating.positiveCount = (currentRating.positiveCount || 0) + 1;
      currentRating.negativeCount = (currentRating.negativeCount || 0) - 1;
    }
  } else {
    // 新评分
    if (score >= 3) {
      currentRating.positiveCount = (currentRating.positiveCount || 0) + 1;
    } else {
      currentRating.negativeCount = (currentRating.negativeCount || 0) + 1;
    }
  }

  ratings[userId] = score;
  currentRating.ratings = ratings;

  // 计算平均分
  const allScores = Object.values(ratings) as number[];
  currentRating.averageScore = allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length;

  const result = await collection.findOneAndUpdate(
    { id: modelId },
    {
      $set: {
        rating: currentRating,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result || !result.value) return null;

  return toEntity<Model>(result.value);
}

export async function searchModels(query: {
  category?: string;
  provider?: string;
  feature?: string;
  priceRange?: [number, number];
  ownerId?: string;
  isPublic?: boolean;
  tags?: string[];
}): Promise<Model[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const filter: any = {};

  if (query.category) {
    filter.category = query.category;
  }

  if (query.provider) {
    filter.owned_by = query.provider;
  }

  if (query.feature) {
    filter.supported_features = { $in: [query.feature] };
  }

  if (query.priceRange) {
    const [min, max] = query.priceRange;
    filter.$or = [
      { 'pricing.input': { $gte: min, $lte: max } },
      { 'pricing.perRequest': { $gte: min, $lte: max } },
    ];
  }

  if (query.ownerId) {
    filter.ownerId = query.ownerId;
  }

  if (query.isPublic !== undefined) {
    filter.isPublic = query.isPublic;
  }

  if (query.tags && query.tags.length > 0) {
    filter.tags = { $in: query.tags };
  }

  const docs = await collection.find(filter).toArray();
  return toEntities<Model>(docs);
}
