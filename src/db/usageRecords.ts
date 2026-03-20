import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { UsageRecord } from '../types';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'usageRecords';

/**
 * 将 MongoDB 文档转换为 UsageRecord
 * 确保 timestamp 是数字时间戳
 */
function toUsageRecord(doc: any): UsageRecord {
  const timestamp = doc.timestamp instanceof Date 
    ? doc.timestamp.getTime() 
    : (typeof doc.timestamp === 'number' ? doc.timestamp : Date.now());
  
  return {
    ...doc,
    id: doc._id.toString(),
    timestamp,
  } as unknown as UsageRecord;
}

export async function createUsageRecord(record: Omit<UsageRecord, 'id'> & { _id?: ObjectId }): Promise<UsageRecord> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  // 确保 timestamp 是数字
  const timestamp = record.timestamp || Date.now();

  const doc = {
    ...record,
    _id: record._id || new ObjectId(),
    timestamp,
  };

  await collection.insertOne(doc);
  return toUsageRecord(doc);
}

export async function getUsageRecord(id: string): Promise<UsageRecord | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  return toUsageRecord(doc);
}

export async function getUserUsageRecords(userId: string): Promise<UsageRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ userId }).toArray();
  return docs.map(toUsageRecord);
}

export async function getUsageRecordsByDateRange(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<UsageRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection
    .find({
      userId,
      timestamp: {
        $gte: startDate.getTime(),
        $lte: endDate.getTime(),
      },
    })
    .toArray();

  return docs.map(toUsageRecord);
}

export async function getUsageRecordsByApiKey(apiKeyId: string): Promise<UsageRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ apiKeyId }).toArray();
  return docs.map(toUsageRecord);
}

export async function getAllUsageRecords(): Promise<UsageRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).toArray();
  return docs.map(toUsageRecord);
}

export async function deleteUsageRecordsByApiKey(apiKeyId: string): Promise<number> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteMany({ apiKeyId });
  return result.deletedCount;
}

export async function getUserUsageSummary(userId: string): Promise<{
  totalTokens: number;
  totalCost: number;
  recordCount: number;
}> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection
    .aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          recordCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  if (result.length === 0) {
    return { totalTokens: 0, totalCost: 0, recordCount: 0 };
  }

  return {
    totalTokens: result[0].totalTokens,
    totalCost: result[0].totalCost,
    recordCount: result[0].recordCount,
  };
}
